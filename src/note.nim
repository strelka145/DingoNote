import std/[json, options, os]
import webview
import storage

# ── Platform-specific native integration ─────────────────────────────────────
# macOS uses Objective-C++ helpers for the system menu, NSOpenPanel folder
# picker, NSPrintInfo-based PDF export, and the WKWebView sandbox-relaxing
# loader. Other platforms ship stubs so the same Nim source builds.

when defined(macosx):
  {.compile: "../vendor/macos_menu/menu.mm".}
  {.compile: "../vendor/macos_pdf/pdf.mm".}
  {.compile: "../vendor/macos_dialog/dialog.mm".}
  {.compile: "../vendor/macos_loader/loader.mm".}
  proc note_setup_macos_menu(appName: cstring) {.importc, cdecl.}
  proc note_load_with_access(w: Webview, htmlPath, accessRoot: cstring) {.importc, cdecl.}
elif defined(linux):
  {.compile: "../vendor/linux_pdf/pdf.cc".}
  {.compile: "../vendor/linux_dialog/dialog.cc".}

# Shared signatures — both macOS .mm and Linux .cc files export these
# with C linkage, so a single Nim declaration covers both platforms.
when defined(macosx) or defined(linux):
  proc note_export_pdf(w: Webview, defaultName: cstring) {.importc, cdecl.}
  proc note_pick_folder(w: Webview, cbId, startPath: cstring) {.importc, cdecl.}

const platformName: string =
  when defined(macosx): "macos"
  elif defined(linux): "linux"
  elif defined(windows): "windows"
  else: "unknown"

const hasNativePdfExport = defined(macosx) or defined(linux)
const hasNativeFolderPicker = defined(macosx) or defined(linux)

# ── JSON marshalling ──────────────────────────────────────────────────────────

proc toJson(tags: seq[string]): JsonNode =
  result = newJArray()
  for t in tags: result.add %t

proc toJson(m: NoteMeta): JsonNode =
  result = newJObject()
  result["id"] = %m.id
  result["title"] = %m.title
  result["tags"] = toJson(m.tags)
  result["updatedAt"] = %m.updatedAt

proc toJson(n: Note): JsonNode =
  result = newJObject()
  result["id"] = %n.id
  result["title"] = %n.title
  result["tags"] = toJson(n.tags)
  result["content"] = %n.content
  result["updatedAt"] = %n.updatedAt

proc toJson(h: SearchHit): JsonNode =
  result = newJObject()
  result["id"] = %h.id
  result["title"] = %h.title
  result["tags"] = toJson(h.tags)
  result["updatedAt"] = %h.updatedAt
  result["snippet"] = %h.snippet

proc parseTags(node: JsonNode): seq[string] =
  if node.kind == JArray:
    for t in node.getElems():
      if t.kind == JString and t.getStr().len > 0:
        result.add t.getStr()

proc reply(w: Webview, id: cstring, node: JsonNode) =
  discard webview_return(w, id, 0, ($node).cstring)

proc replyError(w: Webview, id: cstring, msg: string) =
  let node = %* {"error": msg}
  discard webview_return(w, id, 1, ($node).cstring)

# Wrap a callback body so any exception is reported back to the frontend
# instead of crashing the webview thread. Replaces the identical
# `try: … except CatchableError as e: replyError(w, id, e.msg)` in every handler.
template respond(w, id, body: untyped) =
  try:
    body
  except CatchableError as e:
    replyError(w, id, e.msg)

# ── Bound callbacks ───────────────────────────────────────────────────────────

proc cbList(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    let arr = newJArray()
    for m in listNotes():
      arr.add toJson(m)
    reply(w, id, arr)
proc cbLoad(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    let args = parseJson($req).getElems()
    let n = loadNote(args[0].getStr())
    if n.isSome:
      reply(w, id, toJson(n.get))
    else:
      reply(w, id, newJNull())
proc cbSave(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    let args = parseJson($req).getElems()
    saveNote(args[0].getStr(), args[1].getStr(), parseTags(args[2]), args[3].getStr())
    reply(w, id, newJNull())
proc cbCreate(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    reply(w, id, toJson(createNote()))
proc cbDelete(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    let args = parseJson($req).getElems()
    deleteNote(args[0].getStr())
    reply(w, id, newJNull())
proc cbDuplicate(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    let args = parseJson($req).getElems()
    reply(w, id, toJson(duplicateNote(args[0].getStr())))
proc cbRenameWikilinks(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    let args = parseJson($req).getElems()
    let n = renameWikilinks(args[0].getStr(), args[1].getStr())
    reply(w, id, %n)
proc cbSearch(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    let args = parseJson($req).getElems()
    let query = args[0].getStr()
    let arr = newJArray()
    for h in searchNotes(query):
      arr.add toJson(h)
    reply(w, id, arr)
# ── Archive callbacks ────────────────────────────────────────────────────────

proc cbArchiveList(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    let arr = newJArray()
    for m in listArchive():
      arr.add toJson(m)
    reply(w, id, arr)
proc cbArchiveLoad(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    let args = parseJson($req).getElems()
    let n = loadArchive(args[0].getStr())
    if n.isSome:
      reply(w, id, toJson(n.get))
    else:
      reply(w, id, newJNull())
proc cbArchiveSearch(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    let args = parseJson($req).getElems()
    let arr = newJArray()
    for h in searchArchive(args[0].getStr()):
      arr.add toJson(h)
    reply(w, id, arr)
proc cbRestore(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    let args = parseJson($req).getElems()
    restoreNote(args[0].getStr())
    reply(w, id, newJNull())
proc cbPurge(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    let args = parseJson($req).getElems()
    purgeArchive(args[0].getStr())
    reply(w, id, newJNull())
# ── Template callbacks ───────────────────────────────────────────────────────

proc cbTplList(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    let arr = newJArray()
    for m in listTemplates():
      arr.add toJson(m)
    reply(w, id, arr)
proc cbTplLoad(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    let args = parseJson($req).getElems()
    let n = loadTemplate(args[0].getStr())
    if n.isSome:
      reply(w, id, toJson(n.get))
    else:
      reply(w, id, newJNull())
proc cbTplSave(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    let args = parseJson($req).getElems()
    saveTemplate(args[0].getStr(), args[1].getStr(), parseTags(args[2]), args[3].getStr())
    reply(w, id, newJNull())
proc cbTplCreate(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    reply(w, id, toJson(createTemplate()))
proc cbTplDelete(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    let args = parseJson($req).getElems()
    deleteTemplate(args[0].getStr())
    reply(w, id, newJNull())
proc cbTplDuplicate(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    let args = parseJson($req).getElems()
    reply(w, id, toJson(duplicateTemplate(args[0].getStr())))
proc cbTplSearch(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    let args = parseJson($req).getElems()
    let arr = newJArray()
    for h in searchTemplates(args[0].getStr()):
      arr.add toJson(h)
    reply(w, id, arr)
proc cbExportPDF(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    when defined(macosx) or defined(linux):
      let args = parseJson($req).getElems()
      let defaultName =
        if args.len > 0 and args[0].kind == JString: args[0].getStr()
        else: "note.pdf"
      note_export_pdf(w, defaultName.cstring)
      reply(w, id, newJNull())
    else:
      replyError(w, id, "PDF export is not supported on this platform yet")
# ── Config callbacks ─────────────────────────────────────────────────────────

proc cbConfigGet(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    let obj = %* {
      "vaultPath": getVaultPath(),
      "platform": platformName,
      "features": {
        "pdfExport": hasNativePdfExport,
        "nativeFolderPicker": hasNativeFolderPicker,
      },
    }
    reply(w, id, obj)
proc cbConfigSet(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    let args = parseJson($req).getElems()
    if args.len > 0 and args[0].kind == JObject and args[0].hasKey("vaultPath"):
      setVaultPath(args[0]["vaultPath"].getStr())
    let obj = %* {"vaultPath": getVaultPath()}
    reply(w, id, obj)
proc cbPickFolder(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    when defined(macosx) or defined(linux):
      let args = parseJson($req).getElems()
      let start =
        if args.len > 0 and args[0].kind == JString: args[0].getStr()
        else: getVaultPath()
      # Native callback is responsible for calling webview_return — do NOT
      # reply here, otherwise we'd resolve the promise twice.
      note_pick_folder(w, id, start.cstring)
    else:
      # No native picker on this platform yet — resolve with null so the JS
      # side can fall back to a text-input prompt.
      reply(w, id, newJNull())
proc cbWriteGitignore(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    let (created, path) = writeGitignore()
    reply(w, id, %* {"created": created, "path": path})
proc cbSaveAttachment(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  respond(w, id):
    let args = parseJson($req).getElems()
    let url = args[0].getStr()
    let rel = saveAttachment(url)
    reply(w, id, %rel)
# ── Entry ────────────────────────────────────────────────────────────────────

proc resolveIndexHtml(): string =
  let exeDir = getAppDir()
  let candidates = [
    exeDir / "frontend" / "dist" / "index.html",
    exeDir.parentDir / "frontend" / "dist" / "index.html",
  ]
  for c in candidates:
    if fileExists(c): return c
  raise newException(IOError, "frontend/dist/index.html not found near " & exeDir)

proc main() =
  when defined(macosx):
    note_setup_macos_menu("DingoNote")
  let w = webview_create(1, nil)  # 1 = enable Web Inspector (right-click → Inspect Element)
  if w == nil:
    quit "webview_create failed"
  discard webview_set_title(w, "DingoNote")
  discard webview_set_size(w, 1100, 720, hintNone)

  let warg = cast[pointer](w)
  let handlers = [
    ("noteList", cbList),
    ("noteLoad", cbLoad),
    ("noteSave", cbSave),
    ("noteCreate", cbCreate),
    ("noteDelete", cbDelete),
    ("noteSearch", cbSearch),
    ("noteDuplicate", cbDuplicate),
    ("renameWikilinks", cbRenameWikilinks),
    ("archiveList", cbArchiveList),
    ("archiveLoad", cbArchiveLoad),
    ("archiveSearch", cbArchiveSearch),
    ("archiveRestore", cbRestore),
    ("archivePurge", cbPurge),
    ("templateList", cbTplList),
    ("templateLoad", cbTplLoad),
    ("templateSave", cbTplSave),
    ("templateCreate", cbTplCreate),
    ("templateDelete", cbTplDelete),
    ("templateDuplicate", cbTplDuplicate),
    ("templateSearch", cbTplSearch),
    ("exportPDF", cbExportPDF),
    ("configGet", cbConfigGet),
    ("configSet", cbConfigSet),
    ("pickFolder", cbPickFolder),
    ("writeGitignore", cbWriteGitignore),
    ("saveAttachment", cbSaveAttachment),
  ]
  for (name, cb) in handlers:
    discard webview_bind(w, name.cstring, cb, warg)

  when defined(macosx):
    # loadFileURL:allowingReadAccessToURL: grants the page read access to any
    # file under `/`, so vault images (e.g. file:///Users/.../attachments/x.png)
    # load correctly without CORS errors. WebKitGTK / WebView2 don't have the
    # same sandboxing, so a plain navigate works for them.
    note_load_with_access(w, resolveIndexHtml().cstring, "/".cstring)
  else:
    discard webview_navigate(w, ("file://" & resolveIndexHtml()).cstring)

  discard webview_run(w)
  discard webview_destroy(w)

when isMainModule:
  main()
