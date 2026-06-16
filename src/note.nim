import std/[json, options, os, strutils]
import webview
import storage

{.compile: "../vendor/macos_menu/menu.mm".}
{.compile: "../vendor/macos_pdf/pdf.mm".}
proc note_setup_macos_menu(appName: cstring) {.importc, cdecl.}
proc note_export_pdf(w: Webview, defaultName: cstring) {.importc, cdecl.}

# ── JSON marshalling ──────────────────────────────────────────────────────────

proc toJson(m: NoteMeta): JsonNode =
  result = newJObject()
  result["id"] = %m.id
  result["title"] = %m.title
  result["updatedAt"] = %m.updatedAt

proc toJson(n: Note): JsonNode =
  result = newJObject()
  result["id"] = %n.id
  result["title"] = %n.title
  result["content"] = %n.content
  result["updatedAt"] = %n.updatedAt

proc toJson(h: SearchHit): JsonNode =
  result = newJObject()
  result["id"] = %h.id
  result["title"] = %h.title
  result["updatedAt"] = %h.updatedAt
  result["snippet"] = %h.snippet

proc reply(w: Webview, id: cstring, node: JsonNode) =
  discard webview_return(w, id, 0, ($node).cstring)

proc replyError(w: Webview, id: cstring, msg: string) =
  let node = %* {"error": msg}
  discard webview_return(w, id, 1, ($node).cstring)

# ── Bound callbacks ───────────────────────────────────────────────────────────

proc cbList(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  try:
    let arr = newJArray()
    for m in listNotes():
      arr.add toJson(m)
    reply(w, id, arr)
  except CatchableError as e:
    replyError(w, id, e.msg)

proc cbLoad(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  try:
    let args = parseJson($req).getElems()
    let n = loadNote(args[0].getStr())
    if n.isSome:
      reply(w, id, toJson(n.get))
    else:
      reply(w, id, newJNull())
  except CatchableError as e:
    replyError(w, id, e.msg)

proc cbSave(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  try:
    let args = parseJson($req).getElems()
    saveNote(args[0].getStr(), args[1].getStr(), args[2].getStr())
    reply(w, id, newJNull())
  except CatchableError as e:
    replyError(w, id, e.msg)

proc cbCreate(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  try:
    reply(w, id, toJson(createNote()))
  except CatchableError as e:
    replyError(w, id, e.msg)

proc cbDelete(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  try:
    let args = parseJson($req).getElems()
    deleteNote(args[0].getStr())
    reply(w, id, newJNull())
  except CatchableError as e:
    replyError(w, id, e.msg)

proc cbSearch(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  try:
    let args = parseJson($req).getElems()
    let query = args[0].getStr()
    let arr = newJArray()
    for h in searchNotes(query):
      arr.add toJson(h)
    reply(w, id, arr)
  except CatchableError as e:
    replyError(w, id, e.msg)

# ── Template callbacks ───────────────────────────────────────────────────────

proc cbTplList(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  try:
    let arr = newJArray()
    for m in listTemplates():
      arr.add toJson(m)
    reply(w, id, arr)
  except CatchableError as e:
    replyError(w, id, e.msg)

proc cbTplLoad(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  try:
    let args = parseJson($req).getElems()
    let n = loadTemplate(args[0].getStr())
    if n.isSome:
      reply(w, id, toJson(n.get))
    else:
      reply(w, id, newJNull())
  except CatchableError as e:
    replyError(w, id, e.msg)

proc cbTplSave(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  try:
    let args = parseJson($req).getElems()
    saveTemplate(args[0].getStr(), args[1].getStr(), args[2].getStr())
    reply(w, id, newJNull())
  except CatchableError as e:
    replyError(w, id, e.msg)

proc cbTplCreate(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  try:
    reply(w, id, toJson(createTemplate()))
  except CatchableError as e:
    replyError(w, id, e.msg)

proc cbTplDelete(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  try:
    let args = parseJson($req).getElems()
    deleteTemplate(args[0].getStr())
    reply(w, id, newJNull())
  except CatchableError as e:
    replyError(w, id, e.msg)

proc cbTplSearch(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  try:
    let args = parseJson($req).getElems()
    let arr = newJArray()
    for h in searchTemplates(args[0].getStr()):
      arr.add toJson(h)
    reply(w, id, arr)
  except CatchableError as e:
    replyError(w, id, e.msg)

proc cbExportPDF(id: cstring, req: cstring, arg: pointer) {.cdecl.} =
  let w = cast[Webview](arg)
  try:
    let args = parseJson($req).getElems()
    let defaultName =
      if args.len > 0 and args[0].kind == JString: args[0].getStr()
      else: "note.pdf"
    note_export_pdf(w, defaultName.cstring)
    reply(w, id, newJNull())
  except CatchableError as e:
    replyError(w, id, e.msg)

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
  note_setup_macos_menu("Note")
  let w = webview_create(1, nil)  # 1 = enable Web Inspector (right-click → Inspect Element)
  if w == nil:
    quit "webview_create failed"
  discard webview_set_title(w, "Note")
  discard webview_set_size(w, 1100, 720, hintNone)

  let warg = cast[pointer](w)
  discard webview_bind(w, "noteList", cbList, warg)
  discard webview_bind(w, "noteLoad", cbLoad, warg)
  discard webview_bind(w, "noteSave", cbSave, warg)
  discard webview_bind(w, "noteCreate", cbCreate, warg)
  discard webview_bind(w, "noteDelete", cbDelete, warg)
  discard webview_bind(w, "noteSearch", cbSearch, warg)
  discard webview_bind(w, "templateList", cbTplList, warg)
  discard webview_bind(w, "templateLoad", cbTplLoad, warg)
  discard webview_bind(w, "templateSave", cbTplSave, warg)
  discard webview_bind(w, "templateCreate", cbTplCreate, warg)
  discard webview_bind(w, "templateDelete", cbTplDelete, warg)
  discard webview_bind(w, "templateSearch", cbTplSearch, warg)
  discard webview_bind(w, "exportPDF", cbExportPDF, warg)

  let url = "file://" & resolveIndexHtml()
  discard webview_navigate(w, url.cstring)

  discard webview_run(w)
  discard webview_destroy(w)

when isMainModule:
  main()
