#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

typedef void* webview_t;
#define WEBVIEW_NATIVE_HANDLE_KIND_BROWSER_CONTROLLER 2

extern "C" {
    void* webview_get_native_handle(webview_t w, int kind);
    int webview_eval(webview_t w, const char* js);
}

static void notify(webview_t w, const char* status) {
    NSString* js = [NSString stringWithFormat:
        @"window.dispatchEvent(new CustomEvent('pdfexport', {detail: {status: '%s'}}))",
        status];
    webview_eval(w, [js UTF8String]);
}

@interface NotePDFDelegate : NSObject
@property (nonatomic) webview_t webviewRef;
@end

@implementation NotePDFDelegate
- (void)printOperationDidRun:(NSPrintOperation*)op
                     success:(BOOL)success
                 contextInfo:(void*)ctx {
    notify(self.webviewRef, success ? "done" : "cancelled");
}
@end

extern "C" void note_export_pdf(webview_t w, const char* defaultName) {
    @autoreleasepool {
        WKWebView* webView = (WKWebView*)webview_get_native_handle(
            w, WEBVIEW_NATIVE_HANDLE_KIND_BROWSER_CONTROLLER);
        if (!webView) {
            notify(w, "failed");
            return;
        }

        NSPrintInfo* info = [[NSPrintInfo sharedPrintInfo] copy];
        info.topMargin = 36;
        info.bottomMargin = 36;
        info.leftMargin = 36;
        info.rightMargin = 36;
        info.horizontalPagination = NSPrintingPaginationModeAutomatic;
        info.verticalPagination = NSPrintingPaginationModeAutomatic;
        info.horizontallyCentered = NO;
        info.verticallyCentered = NO;

        NSPrintOperation* op = [webView printOperationWithPrintInfo:info];
        op.showsPrintPanel = YES;
        op.showsProgressPanel = YES;
        op.jobTitle = [NSString stringWithUTF8String:(defaultName ?: "note")];

        NotePDFDelegate* delegate = [[NotePDFDelegate alloc] init];
        delegate.webviewRef = w;
        // Static reference so ARC-less code keeps the delegate alive until the
        // operation completes. Multiple exports overwrite — they're modal,
        // sequential, so only one is alive at a time.
        static NotePDFDelegate* sActive = nil;
        sActive = delegate;

        NSWindow* window = webView.window;
        if (window) {
            [op runOperationModalForWindow:window
                                  delegate:delegate
                            didRunSelector:@selector(printOperationDidRun:success:contextInfo:)
                               contextInfo:nil];
        } else {
            BOOL ok = [op runOperation];
            notify(w, ok ? "done" : "cancelled");
        }
    }
}
