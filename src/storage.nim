## Markdown-file storage for notes. One .md file per note, identified by id.

import std/[os, strutils, algorithm, times, oids, options]

type
  NoteMeta* = object
    id*: string
    title*: string
    updatedAt*: int64

  Note* = object
    id*: string
    title*: string
    content*: string
    updatedAt*: int64

  SearchHit* = object
    id*: string
    title*: string
    updatedAt*: int64
    snippet*: string

proc dataDir*(): string =
  result = getHomeDir() / "Documents" / "Note"
  createDir(result)

proc parseTitleAndBody(full: string): tuple[title, body: string] =
  let lines = full.splitLines
  var i = 0
  while i < lines.len and lines[i].strip().len == 0:
    inc i
  if i < lines.len and lines[i].startsWith("# "):
    let title = lines[i][2..^1].strip()
    inc i
    while i < lines.len and lines[i].strip().len == 0:
      inc i
    let body = if i < lines.len: lines[i..^1].join("\n") else: ""
    return (title, body)
  return ("", full)

proc mtimeMs(path: string): int64 =
  (getLastModificationTime(path).toUnix * 1000) +
    int64(getLastModificationTime(path).nanosecond div 1_000_000)

proc listNotes*(): seq[NoteMeta] =
  for kind, path in walkDir(dataDir()):
    if kind != pcFile: continue
    if not path.endsWith(".md"): continue
    let id = path.splitFile.name
    let full = try: readFile(path) except CatchableError: ""
    let (title, _) = parseTitleAndBody(full)
    result.add NoteMeta(id: id, title: title, updatedAt: mtimeMs(path))
  result.sort do (a, b: NoteMeta) -> int:
    cmp(b.updatedAt, a.updatedAt)

proc loadNote*(id: string): Option[Note] =
  let path = dataDir() / (id & ".md")
  if not fileExists(path): return none(Note)
  let full = readFile(path)
  let (title, body) = parseTitleAndBody(full)
  some(Note(id: id, title: title, content: body, updatedAt: mtimeMs(path)))

proc saveNote*(id, title, content: string) =
  let path = dataDir() / (id & ".md")
  let body =
    if title.len > 0: "# " & title & "\n\n" & content
    else: content
  writeFile(path, body)

proc createNote*(): NoteMeta =
  let id = $genOid()
  let path = dataDir() / (id & ".md")
  writeFile(path, "")
  NoteMeta(id: id, title: "", updatedAt: mtimeMs(path))

proc deleteNote*(id: string) =
  let path = dataDir() / (id & ".md")
  if fileExists(path):
    removeFile(path)

proc extractSnippet(body: string, query: string, radius = 60): string =
  if query.len == 0 or body.len == 0: return ""
  let lower = body.toLowerAscii()
  let needle = query.toLowerAscii()
  let idx = lower.find(needle)
  if idx < 0: return ""
  let startI = max(0, idx - radius)
  let endI = min(body.len, idx + needle.len + radius)
  var s = body[startI ..< endI]
  s = s.replace("\n", " ").replace("\r", " ")
  s = s.strip()
  if startI > 0: s = "…" & s
  if endI < body.len: s = s & "…"
  s

proc searchNotes*(query: string; limit = 200): seq[SearchHit] =
  let q = query.toLowerAscii().strip()
  for kind, path in walkDir(dataDir()):
    if kind != pcFile or not path.endsWith(".md"): continue
    let full = try: readFile(path) except CatchableError: ""
    let id = path.splitFile.name
    let (title, body) = parseTitleAndBody(full)

    var snippet = ""
    if q.len > 0:
      let titleMatch = title.toLowerAscii().contains(q)
      let bodyMatch = body.toLowerAscii().contains(q)
      if not titleMatch and not bodyMatch: continue
      snippet =
        if bodyMatch: extractSnippet(body, query)
        else: title

    result.add SearchHit(
      id: id,
      title: title,
      updatedAt: mtimeMs(path),
      snippet: snippet,
    )
    if result.len >= limit: break
  result.sort do (a, b: SearchHit) -> int:
    cmp(b.updatedAt, a.updatedAt)
