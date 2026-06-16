## Minimal FFI bindings for the webview/webview C API.
## Compiled together with vendor/webview/webview.mm (Objective-C++ on macOS).

{.compile: "../vendor/webview/webview.mm".}

type
  Webview* = pointer
  WebviewError* = cint
  WebviewHint* = cint
  BindCallback* = proc (id: cstring, req: cstring, arg: pointer) {.cdecl.}

const
  hintNone* = WebviewHint(0)
  hintMin* = WebviewHint(1)
  hintMax* = WebviewHint(2)
  hintFixed* = WebviewHint(3)

  errOk* = WebviewError(0)

proc webview_create*(debug: cint, window: pointer): Webview {.importc, cdecl.}
proc webview_destroy*(w: Webview): WebviewError {.importc, cdecl.}
proc webview_run*(w: Webview): WebviewError {.importc, cdecl.}
proc webview_terminate*(w: Webview): WebviewError {.importc, cdecl.}
proc webview_set_title*(w: Webview, title: cstring): WebviewError {.importc, cdecl.}
proc webview_set_size*(w: Webview, width, height: cint, hints: WebviewHint): WebviewError {.importc, cdecl.}
proc webview_navigate*(w: Webview, url: cstring): WebviewError {.importc, cdecl.}
proc webview_set_html*(w: Webview, html: cstring): WebviewError {.importc, cdecl.}
proc webview_init*(w: Webview, js: cstring): WebviewError {.importc, cdecl.}
proc webview_eval*(w: Webview, js: cstring): WebviewError {.importc, cdecl.}
proc webview_bind*(w: Webview, name: cstring, cb: BindCallback, arg: pointer): WebviewError {.importc, cdecl.}
proc webview_unbind*(w: Webview, name: cstring): WebviewError {.importc, cdecl.}
proc webview_return*(w: Webview, id: cstring, status: cint, res: cstring): WebviewError {.importc, cdecl.}
