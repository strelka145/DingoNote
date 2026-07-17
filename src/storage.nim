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
    tags*: seq[string]
    updatedAt*: int64

  Note* = object
    id*: string
    title*: string
    tags*: seq[string]
    content*: string
    updatedAt*: int64

  SearchHit* = object
    id*: string
    title*: string
    tags*: seq[string]
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

const gitignoreTemplate = """# DingoNote vault
.DS_Store

# Soft-deleted notes and templates (not version-controlled)
.archive/
.templates/
"""

proc writeGitignore*(): tuple[created: bool, path: string] =
  ## Write a sensible .gitignore into the vault folder for users who keep their
  ## notes under version control. Notes and attachments stay tracked; OS junk,
  ## backups, and the .archive/.templates folders are ignored. Does not clobber
  ## an existing .gitignore — reports created = false in that case.
  let path = dataDir() / ".gitignore"
  if fileExists(path):
    return (false, path)
  atomicWrite(path, gitignoreTemplate)
  result = (true, path)

proc parseTagLine(line: string): seq[string] =
  ## A tag line is a single line made up *entirely* of `#tag` tokens, e.g.
  ## `#assay #luciferase`. Returns the tags without their leading `#`, or an
  ## empty seq if the line is anything else. A `#` followed by a space is a
  ## Markdown heading (token `#` has length 1), so headings never qualify.
  let toks = line.splitWhitespace()
  if toks.len == 0: return @[]
  for t in toks:
    if t.len < 2 or t[0] != '#': return @[]
  for t in toks:
    result.add t[1..^1]

proc tagLine(tags: seq[string]): string =
  ## Render tags back to a `#a #b` line. Empty tags are skipped.
  for t in tags:
    if t.len == 0: continue
    if result.len > 0: result.add ' '
    result.add '#'
    result.add t

proc parseNote(full: string): tuple[title: string, tags: seq[string], body: string] =
  ## Layout: an optional `# Title` line, an optional `#tag …` line directly
  ## after it, then the body. Only that one designated line is scanned for
  ## tags — `#` anywhere in the body is left untouched.
  let lines = full.splitLines
  var i = 0
  while i < lines.len and lines[i].strip().len == 0:
    inc i
  if i < lines.len and lines[i] == "#":
    # A bare "#" is the empty-title marker saveToDir writes to keep a body that
    # starts with "# …" or a #tag line out of the title/tags fields. Consume it.
    inc i
  elif i < lines.len and lines[i].startsWith("# "):
    result.title = lines[i][2..^1].strip()
    inc i
  if i < lines.len:
    let parsed = parseTagLine(lines[i])
    if parsed.len > 0:
      result.tags = parsed
      inc i
  while i < lines.len and lines[i].strip().len == 0:
    inc i
  result.body = if i < lines.len: lines[i..^1].join("\n") else: ""

proc mtimeMs(path: string): int64 =
  (getLastModificationTime(path).toUnix * 1000) +
    int64(getLastModificationTime(path).nanosecond div 1_000_000)

proc snapToCharStart(s: string, i: int): int =
  ## Move a byte index back to the start of the UTF-8 character it lands in, so
  ## slicing there never cuts a multibyte char (which would break the snippet's
  ## UTF-8 — e.g. Japanese text with radius offsets that land mid-character).
  result = i
  while result > 0 and result < s.len and (s[result].uint8 and 0xC0'u8) == 0x80'u8:
    dec result

proc extractSnippet(body: string, query: string, radius = 60): string =
  if query.len == 0 or body.len == 0: return ""
  let lower = body.toLowerAscii()
  let needle = query.toLowerAscii()
  let idx = lower.find(needle)
  if idx < 0: return ""
  let startI = snapToCharStart(body, max(0, idx - radius))
  let endI = snapToCharStart(body, min(body.len, idx + needle.len + radius))
  var s = body[startI ..< endI]
  s = s.replace("\n", " ").replace("\r", " ")
  s = s.strip()
  if startI > 0: s = "…" & s
  if endI < body.len: s = s & "…"
  s

# ── Generic helpers ─────────────────────────────────────────────────────────

proc loadFromDir(dir, id: string): Option[Note] =
  let path = dir / (id & ".md")
  if not fileExists(path): return none(Note)
  let full = readFile(path)
  let (title, tags, body) = parseNote(full)
  some(Note(id: id, title: title, tags: tags, content: body, updatedAt: mtimeMs(path)))

proc bodyStartsAmbiguous(content: string): bool =
  ## True if the body's first non-blank line would be re-parsed as a title
  ## (`# …`) or a tag line (`#a #b`). Only meaningful when no title/tag header
  ## is written — otherwise that content line migrates into a field on load.
  for line in content.splitLines:
    if line.strip().len == 0: continue
    return line.startsWith("# ") or parseTagLine(line).len > 0
  false

proc saveToDir(dir, id, title: string, tags: seq[string], content: string) =
  let path = dir / (id & ".md")
  var head = ""
  if title.len > 0: head.add "# " & title & "\n"
  let tl = tagLine(tags)
  if tl.len > 0: head.add tl & "\n"
  # With no title/tag header, disambiguate a body that itself starts with a
  # "# …" or #tag line by writing a bare "#" empty-title marker (parseNote
  # consumes it), so the body round-trips instead of losing its first line.
  if head.len == 0 and bodyStartsAmbiguous(content):
    head = "#\n"
  let body =
    if head.len > 0: head & "\n" & content
    else: content
  atomicWrite(path, body)

proc createInDir(dir: string): NoteMeta =
  let id = $genOid()
  let path = dir / (id & ".md")
  atomicWrite(path, "")
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
      atomicWrite(path, content.replace(oldRef, newRef))
      inc result

proc duplicateInDir(dir, srcId: string): NoteMeta =
  let srcPath = dir / (srcId & ".md")
  if not fileExists(srcPath):
    raise newException(IOError, "Source not found: " & srcId)
  let original = readFile(srcPath)
  let (origTitle, origTags, body) = parseNote(original)
  let newTitle =
    if origTitle.len > 0: origTitle & " (copy)"
    else: ""
  let newId = $genOid()
  let dstPath = dir / (newId & ".md")
  saveToDir(dir, newId, newTitle, origTags, body)
  NoteMeta(id: newId, title: newTitle, tags: origTags, updatedAt: mtimeMs(dstPath))

proc searchIn(dir: string; query: string; limit = 200): seq[SearchHit] =
  let q = query.toLowerAscii().strip()
  for kind, path in walkDir(dir):
    if kind != pcFile or not path.endsWith(".md"): continue
    let full = try: readFile(path) except CatchableError: ""
    let id = path.splitFile.name
    let (title, tags, body) = parseNote(full)

    var snippet = ""
    if q.len > 0:
      let titleMatch = title.toLowerAscii().contains(q)
      let bodyMatch = body.toLowerAscii().contains(q)
      var tagMatch = false
      for t in tags:
        if t.toLowerAscii().contains(q): tagMatch = true; break
      if not titleMatch and not bodyMatch and not tagMatch: continue
      snippet =
        # Use the normalized query `q` (matching used it too); the raw `query`
        # may carry surrounding whitespace that makes extractSnippet's find fail.
        if bodyMatch: extractSnippet(body, q)
        elif titleMatch: title
        else: "#" & tags.join(" #")

    result.add SearchHit(
      id: id, title: title, tags: tags,
      updatedAt: mtimeMs(path), snippet: snippet,
    )
  # Collect all matches, sort newest-first, THEN truncate. Applying the limit
  # inside the walkDir loop (whose order is filesystem-dependent) would drop
  # arbitrary — possibly the newest — notes before they could be ranked.
  result.sort do (a, b: SearchHit) -> int:
    cmp(b.updatedAt, a.updatedAt)
  if result.len > limit:
    result.setLen(limit)

proc listIn(dir: string): seq[NoteMeta] =
  ## The note list is just an empty-query search (already collected + sorted
  ## newest-first); drop the empty snippet. `int.high` = no cap: the list must
  ## show every note, not the search result limit.
  for hit in searchIn(dir, "", int.high):
    result.add NoteMeta(
      id: hit.id, title: hit.title, tags: hit.tags, updatedAt: hit.updatedAt,
    )

# ── Notes ───────────────────────────────────────────────────────────────────

proc archiveDir*(): string =
  result = dataDir() / ".archive"
  createDir(result)

proc listNotes*(): seq[NoteMeta] = listIn(dataDir())
proc loadNote*(id: string): Option[Note] = loadFromDir(dataDir(), id)
proc saveNote*(id, title: string, tags: seq[string], content: string) =
  saveToDir(dataDir(), id, title, tags, content)
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
proc saveTemplate*(id, title: string, tags: seq[string], content: string) =
  saveToDir(templatesDir(), id, title, tags, content)
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
  atomicWrite(attachmentsDir() / filename, data)
  result = "attachments/" & filename
