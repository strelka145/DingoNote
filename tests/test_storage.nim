## Unit tests for src/storage.nim.
##
## Run with:  nim c -r tests/test_storage.nim   (or: nimble test)
##
## storage.nim keeps several core helpers unexported (parseNote, parseTagLine,
## tagLine, extractSnippet), so we `include` the module to reach them. The
## module runs `loadConfig()` at init; we override the vault to a temp dir
## afterwards (by assigning gConfig directly, so nothing is persisted).

import std/[unittest, os, options, strutils, times, oids, posix, sequtils]
from std/unicode import validateUtf8

include "../src/storage"

# Point the vault at a throwaway temp directory for this test run.
let testVault = getTempDir() / ("dingo_test_" & $genOid())
gConfig.vaultPath = testVault
createDir(testVault)

proc setMtime(path: string, unixSecs: int64) =
  ## Force a file's mtime so tests can assert updatedAt ordering deterministically.
  var tv: array[2, Timeval]
  tv[0].tv_sec = posix.Time(unixSecs)
  tv[0].tv_usec = 0
  tv[1].tv_sec = posix.Time(unixSecs)
  tv[1].tv_usec = 0
  doAssert utimes(path.cstring, addr tv) == 0

suite "parseTagLine":
  test "all-#tag line parses to tags without the #":
    check parseTagLine("#assay #luciferase") == @["assay", "luciferase"]

  test "a Markdown heading is not a tag line":
    # `# Heading` -> tokens ["#", "Heading"]; the bare "#" has length 1.
    check parseTagLine("# Heading") == newSeq[string]()

  test "a line with any non-tag token is not a tag line":
    check parseTagLine("#a plus text") == newSeq[string]()

  test "empty / whitespace line yields no tags":
    check parseTagLine("") == newSeq[string]()
    check parseTagLine("   ") == newSeq[string]()

suite "tagLine":
  test "renders tags back to a #a #b line":
    check tagLine(@["assay", "wip"]) == "#assay #wip"

  test "skips empty tags":
    check tagLine(@["a", "", "b"]) == "#a #b"

  test "empty seq -> empty string":
    check tagLine(@[]) == ""

suite "parseNote":
  test "title + tag line + body":
    let (title, tags, body) = parseNote("# My Note\n#a #b\n\nhello\nworld")
    check title == "My Note"
    check tags == @["a", "b"]
    check body == "hello\nworld"

  test "title, no tag line":
    let (title, tags, body) = parseNote("# Only Title\n\nbody here")
    check title == "Only Title"
    check tags.len == 0
    check body == "body here"

  test "body whose first line looks like a heading is not eaten":
    let (title, tags, body) = parseNote("# T\n# Heading-with-space\nrest")
    check title == "T"
    check tags.len == 0
    check body == "# Heading-with-space\nrest"

  test "no title, no tags":
    let (title, tags, body) = parseNote("just body\nmore")
    check title == ""
    check tags.len == 0
    check body == "just body\nmore"

suite "parseNote/tagLine round-trip":
  test "saveNote then loadNote preserves title, tags, body":
    let id = $genOid()
    let body = "## Section\n\nsome text with a # in it #notatag"
    saveNote(id, "Round Trip", @["x", "y"], body)
    let n = loadNote(id).get
    check n.title == "Round Trip"
    check n.tags == @["x", "y"]
    check n.content == body

  test "on-disk format is title / tagline / blank / body":
    let id = $genOid()
    saveNote(id, "T", @["a"], "B")
    let raw = readFile(dataDir() / (id & ".md"))
    check raw == "# T\n#a\n\nB"

suite "extractSnippet":
  test "returns a window around the match":
    let s = extractSnippet("the quick brown fox", "brown")
    check "brown" in s

  test "no match -> empty":
    check extractSnippet("hello world", "zzz") == ""

  test "empty query -> empty":
    check extractSnippet("hello", "") == ""

suite "saveAttachment":
  test "decodes a data:image URL and writes a file":
    # 1x1 transparent PNG
    let png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
    let rel = saveAttachment(png)
    check rel.startsWith("attachments/")
    check rel.endsWith(".png")
    check fileExists(dataDir() / rel)

  test "rejects a non-image data URL":
    expect ValueError:
      discard saveAttachment("data:text/plain;base64,aGk=")

suite "searchIn limit (bug 1-1: newest must survive the limit)":
  test "with more notes than the limit, the newest are returned":
    let dir = testVault / ("srch_" & $genOid())
    createDir(dir)
    # Create 10 notes with strictly increasing mtimes (id encodes recency).
    let base = 1_700_000_000'i64
    for i in 0 ..< 10:
      let id = "note" & align($i, 2, '0')
      let p = dir / (id & ".md")
      writeFile(p, "# note " & $i & "\n\nbody")
      setMtime(p, base + i.int64)  # note09 is the newest
    let hits = searchIn(dir, "", 3)
    check hits.len == 3
    # The 3 newest are note09, note08, note07 — they must not be dropped by an
    # early truncation that happens before sorting.
    let ids = hits.mapIt(it.id)
    check ids == @["note09", "note08", "note07"]

suite "searchIn snippet (bug 9-5: query must be stripped for the snippet)":
  test "a query with surrounding whitespace still yields a snippet":
    let dir = testVault / ("snip_" & $genOid())
    createDir(dir)
    writeFile(dir / "n.md", "# title\n\nthe quick brown fox jumps")
    let hits = searchIn(dir, "  brown  ")
    check hits.len == 1
    # Match uses the stripped query, so the snippet must too — otherwise
    # find() fails on the padded query and the snippet comes back empty.
    check hits[0].snippet.len > 0
    check "brown" in hits[0].snippet

suite "extractSnippet UTF-8 (bug 9-3: byte slicing must not cut a char)":
  test "snippet stays valid UTF-8 when radius lands mid multibyte char":
    # 21×"あ" (63 bytes) + "X" (1) shifts alignment so idx-radius (64-60=4)
    # falls inside the 2nd "あ" (bytes 3..5) — a byte-index slice would cut it.
    let body = "あ".repeat(21) & "X" & "target" & "い".repeat(30)
    let snip = extractSnippet(body, "target")
    check snip.len > 0
    check validateUtf8(snip) == -1  # -1 == the whole string is valid UTF-8

suite "parseNote round-trip (bug 9-4: empty title must not swallow the body)":
  # KNOWN-FAILING reproductions (fix deferred — needs a format decision).
  # When the title is empty, saveToDir writes the body verbatim; if that body
  # starts with "# …" or a "#tag …" line, the next parseNote promotes it to the
  # title/tags, moving body content into fields and breaking the round-trip.
  test "title-less note whose body starts with a heading round-trips":
    let id = $genOid()
    let body = "# Not a title\nbody text"
    saveNote(id, "", @[], body)
    let n = loadNote(id).get
    check n.title == ""
    check n.content == body

  test "title-less note whose body starts with a tag line round-trips":
    let id = $genOid()
    let body = "#alpha #beta\nbody text"
    saveNote(id, "", @[], body)
    let n = loadNote(id).get
    check n.title == ""
    check n.tags.len == 0
    check n.content == body

suite "atomicWrite (bug 1-2: durable writes via temp + rename)":
  test "writes the content and leaves no temp file behind":
    let dir = testVault / ("aw_" & $genOid())
    createDir(dir)
    let p = dir / "f.txt"
    atomicWrite(p, "hello")
    check readFile(p) == "hello"
    var others = 0
    for kind, path in walkDir(dir):
      if path != p: inc others
    check others == 0  # the temp file was renamed away, not left behind

  test "overwrites an existing file":
    let dir = testVault / ("aw2_" & $genOid())
    createDir(dir)
    let p = dir / "f.txt"
    atomicWrite(p, "old")
    atomicWrite(p, "new")
    check readFile(p) == "new"

# Clean up the temp vault.
removeDir(testVault)
echo "storage tests done"
