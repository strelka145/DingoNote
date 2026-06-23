## Markdown-file storage. One .md file per entry, identified by id.
## Notes live in dataDir(); templates live in templatesDir() (a `.templates`
## subdirectory, hidden by leading dot).

import std/[os, strutils, algorithm, times, oids, options, base64]
import config

var gConfig: Config = loadConfig()

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
  result =
    if gConfig.vaultPath.len > 0: gConfig.vaultPath
    else: defaultVaultPath()
  createDir(result)

proc templatesDir*(): string =
  result = dataDir() / ".templates"
  createDir(result)

proc getVaultPath*(): string = dataDir()

proc setVaultPath*(path: string) =
  gConfig.vaultPath = path
  saveConfig(gConfig)

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

proc renameWikilinks*(oldTitle, newTitle: string): int =
  ## Rewrite `[[oldTitle]]` references in every note/template file to
  ## `[[newTitle]]`. Returns the count of files actually modified.
  ## Archive is intentionally skipped — archived files are frozen.
  if oldTitle.len == 0 or newTitle.len == 0 or oldTitle == newTitle: return 0
  let oldRef = "[[" & oldTitle & "]]"
  let newRef = "[[" & newTitle & "]]"
  for dir in [dataDir(), templatesDir()]:
    for kind, path in walkDir(dir):
      if kind != pcFile or not path.endsWith(".md"): continue
      let content = try: readFile(path) except CatchableError: continue
      if not content.contains(oldRef): continue
      writeFile(path, content.replace(oldRef, newRef))
      inc result

proc duplicateInDir(dir, srcId: string): NoteMeta =
  let srcPath = dir / (srcId & ".md")
  if not fileExists(srcPath):
    raise newException(IOError, "Source not found: " & srcId)
  let original = readFile(srcPath)
  let (origTitle, body) = parseTitleAndBody(original)
  let newTitle =
    if origTitle.len > 0: origTitle & " (copy)"
    else: ""
  let newId = $genOid()
  let dstPath = dir / (newId & ".md")
  let newContent =
    if newTitle.len > 0: "# " & newTitle & "\n\n" & body
    else: body
  writeFile(dstPath, newContent)
  NoteMeta(id: newId, title: newTitle, updatedAt: mtimeMs(dstPath))

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

proc archiveDir*(): string =
  result = dataDir() / ".archive"
  createDir(result)

proc listNotes*(): seq[NoteMeta] = listIn(dataDir())
proc loadNote*(id: string): Option[Note] = loadFromDir(dataDir(), id)
proc saveNote*(id, title, content: string) = saveToDir(dataDir(), id, title, content)
proc createNote*(): NoteMeta = createInDir(dataDir())
proc duplicateNote*(id: string): NoteMeta = duplicateInDir(dataDir(), id)
proc searchNotes*(query: string; limit = 200): seq[SearchHit] = searchIn(dataDir(), query, limit)

# Soft delete: move the note into the archive. The original ID is preserved.
proc deleteNote*(id: string) =
  let src = dataDir() / (id & ".md")
  if not fileExists(src): return
  let dst = archiveDir() / (id & ".md")
  if fileExists(dst): removeFile(dst)
  moveFile(src, dst)

# ── Archive ─────────────────────────────────────────────────────────────────

proc listArchive*(): seq[NoteMeta] = listIn(archiveDir())
proc loadArchive*(id: string): Option[Note] = loadFromDir(archiveDir(), id)
proc searchArchive*(query: string; limit = 200): seq[SearchHit] =
  searchIn(archiveDir(), query, limit)

# Move a note out of the archive back to the active vault.
proc restoreNote*(id: string) =
  let src = archiveDir() / (id & ".md")
  if not fileExists(src): return
  let dst = dataDir() / (id & ".md")
  if fileExists(dst): removeFile(dst)
  moveFile(src, dst)

# Permanently delete from the archive (no recovery).
proc purgeArchive*(id: string) =
  let path = archiveDir() / (id & ".md")
  if fileExists(path): removeFile(path)

# ── Templates ───────────────────────────────────────────────────────────────

proc listTemplates*(): seq[NoteMeta] = listIn(templatesDir())
proc loadTemplate*(id: string): Option[Note] = loadFromDir(templatesDir(), id)
proc saveTemplate*(id, title, content: string) = saveToDir(templatesDir(), id, title, content)
proc createTemplate*(): NoteMeta = createInDir(templatesDir())
proc duplicateTemplate*(id: string): NoteMeta = duplicateInDir(templatesDir(), id)
proc deleteTemplate*(id: string) = deleteInDir(templatesDir(), id)
proc searchTemplates*(query: string; limit = 200): seq[SearchHit] = searchIn(templatesDir(), query, limit)

# ── Attachments ─────────────────────────────────────────────────────────────

proc attachmentsDir*(): string =
  result = dataDir() / "attachments"
  createDir(result)

proc saveAttachment*(dataUrl: string): string =
  ## Decode a data: URL of an image and persist to attachments/. Returns the
  ## vault-relative path (e.g. "attachments/abc.png").
  const prefix = "data:image/"
  if not dataUrl.startsWith(prefix):
    raise newException(ValueError, "expected a data:image/… URL")
  let semicolon = dataUrl.find(';', prefix.len)
  let comma = dataUrl.find(',', max(semicolon, prefix.len))
  if semicolon < 0 or comma < 0:
    raise newException(ValueError, "malformed data URL")
  var ext = dataUrl[prefix.len ..< semicolon].toLowerAscii()
  # Sanitize: e.g. "svg+xml" → "svg"
  let plus = ext.find('+')
  if plus >= 0: ext = ext[0 ..< plus]
  if ext.len == 0 or ext.len > 6: ext = "bin"
  let payload = dataUrl[(comma + 1) .. ^1]
  let data = base64.decode(payload)
  let filename = $genOid() & "." & ext
  writeFile(attachmentsDir() / filename, data)
  result = "attachments/" & filename
