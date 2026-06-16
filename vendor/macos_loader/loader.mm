#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

typedef void* webview_t;
#define WEBVIEW_NATIVE_HANDLE_KIND_BROWSER_CONTROLLER 2

extern "C" {
    void* webview_get_native_handle(webview_t w, int kind);
}

// Load the editor HTML using WKWebView's loadFileURL:allowingReadAccessToURL:
// so the page can also fetch user-vault files (images) via file:// URLs.
extern "C" void note_load_with_access(
    webview_t w,
    const char* htmlPath,
    const char* accessRoot
) {
    @autoreleasepool {
        WKWebView* webView = (WKWebView*)webview_get_native_handle(
            w, WEBVIEW_NATIVE_HANDLE_KIND_BROWSER_CONTROLLER);
        if (!webView) return;
        NSURL* fileURL = [NSURL fileURLWithPath:
            [NSString stringWithUTF8String:(htmlPath ?: "")]];
        NSURL* accessURL = [NSURL fileURLWithPath:
            [NSString stringWithUTF8String:(accessRoot ?: "/")]];
        [webView loadFileURL:fileURL allowingReadAccessToURL:accessURL];
    }
}
