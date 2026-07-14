## Minimal FFI bindings for the webview/webview C API.
## webview.h ships GTK (Linux), Cocoa (macOS) and WebView2 (Windows) backends;
## the matching wrapper file selects which one gets compiled.

when defined(macosx):
  {.compile: "../vendor/webview/webview.mm".}
elif defined(linux):
  {.compile: "../vendor/webview/webview.cc".}
  when gorgeEx("pkg-config --version").exitCode != 0:
    {.error: "pkg-config is required to build on Linux (install pkg-config and libwebkit2gtk-4.1-dev or -4.0-dev).".}
  const webkitPkg =
    when gorgeEx("pkg-config --exists webkit2gtk-4.1").exitCode == 0:
      "gtk+-3.0 webkit2gtk-4.1"
    else:
      "gtk+-3.0 webkit2gtk-4.0"
  {.passC: gorge("pkg-config --cflags " & webkitPkg).}
  {.passL: gorge("pkg-config --libs " & webkitPkg).}
elif defined(windows):
  {.compile: "../vendor/webview/webview.cc".}
  # NOTE: Windows builds also require the WebView2 SDK headers and loader lib.
  # That setup is not wired up yet — Windows is build-incomplete on purpose.
else:
  {.error: "Unsupported platform for webview bindings.".}

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
