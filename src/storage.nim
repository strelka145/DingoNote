## Markdown-file storage. One .md file per entry, identified by id.
## Notes live in dataDir(); templates live in templatesDir() (a `.templates`
## subdirectory, hidden by leading dot).

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

proc templatesDir*(): string =
  result = dataDir() / ".templates"
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

# ── Generic helpers ─────────────────────────────────────────────────────────

proc listIn(dir: string): seq[NoteMeta] =
  for kind, path in walkDir(dir):
    if kind != pcFile or not path.endsWith(".md"): continue
    let id = path.splitFile.name
    let full = try: readFile(path) except CatchableError: ""
    let (title, _) = parseTitleAndBody(full)
    result.add NoteMeta(id: id, title: title, updatedAt: mtimeMs(path))
  result.sort do (a, b: NoteMeta) -> int:
    cmp(b.updatedAt, a.updatedAt)

proc loadFromDir(dir, id: string): Option[Note] =
  let path = dir / (id & ".md")
  if not fileExists(path): return none(Note)
  let full = readFile(path)
  let (title, body) = parseTitleAndBody(full)
  some(Note(id: id, title: title, content: body, updatedAt: mtimeMs(path)))

proc saveToDir(dir, id, title, content: string) =
  let path = dir / (id & ".md")
  let body =
    if title.len > 0: "# " & title & "\n\n" & content
    else: content
  writeFile(path, body)

proc createInDir(dir: string): NoteMeta =
  let id = $genOid()
  let path = dir / (id & ".md")
  writeFile(path, "")
  NoteMeta(id: id, title: "", updatedAt: mtimeMs(path))

proc deleteInDir(dir, id: string) =
  let path = dir / (id & ".md")
  if fileExists(path):
    removeFile(path)

proc searchIn(dir: string; query: string; limit = 200): seq[SearchHit] =
  let q = query.toLowerAscii().strip()
  for kind, path in walkDir(dir):
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
      id: id, title: title,
      updatedAt: mtimeMs(path), snippet: snippet,
    )
    if result.len >= limit: break
  result.sort do (a, b: SearchHit) -> int:
    cmp(b.updatedAt, a.updatedAt)

# ── Notes ───────────────────────────────────────────────────────────────────

proc listNotes*(): seq[NoteMeta] = listIn(dataDir())
proc loadNote*(id: string): Option[Note] = loadFromDir(dataDir(), id)
proc saveNote*(id, title, content: string) = saveToDir(dataDir(), id, title, content)
proc createNote*(): NoteMeta = createInDir(dataDir())
proc deleteNote*(id: string) = deleteInDir(dataDir(), id)
proc searchNotes*(query: string; limit = 200): seq[SearchHit] = searchIn(dataDir(), query, limit)

# ── Templates ───────────────────────────────────────────────────────────────

proc listTemplates*(): seq[NoteMeta] = listIn(templatesDir())
proc loadTemplate*(id: string): Option[Note] = loadFromDir(templatesDir(), id)
proc saveTemplate*(id, title, content: string) = saveToDir(templatesDir(), id, title, content)
proc createTemplate*(): NoteMeta = createInDir(templatesDir())
proc deleteTemplate*(id: string) = deleteInDir(templatesDir(), id)
proc searchTemplates*(query: string; limit = 200): seq[SearchHit] = searchIn(templatesDir(), query, limit)
