#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

typedef void* webview_t;
#define WEBVIEW_NATIVE_HANDLE_KIND_BROWSER_CONTROLLER 2

extern "C" {
    void* webview_get_native_handle(webview_t w, int kind);
    int webview_return(webview_t w, const char* id, int status, const char* result);
}

static NSString* jsonString(NSString* s) {
    NSString* escaped = [s stringByReplacingOccurrencesOfString:@"\\" withString:@"\\\\"];
    escaped = [escaped stringByReplacingOccurrencesOfString:@"\"" withString:@"\\\""];
    escaped = [escaped stringByReplacingOccurrencesOfString:@"\n" withString:@"\\n"];
    escaped = [escaped stringByReplacingOccurrencesOfString:@"\r" withString:@"\\r"];
    escaped = [escaped stringByReplacingOccurrencesOfString:@"\t" withString:@"\\t"];
    return [NSString stringWithFormat:@"\"%@\"", escaped];
}

extern "C" void note_pick_folder(webview_t w, const char* cbId, const char* startPath) {
    @autoreleasepool {
        WKWebView* webView = (WKWebView*)webview_get_native_handle(
            w, WEBVIEW_NATIVE_HANDLE_KIND_BROWSER_CONTROLLER);
        NSString* idStr = [NSString stringWithUTF8String:(cbId ?: "")];
        webview_t wRef = w;

        NSOpenPanel* panel = [NSOpenPanel openPanel];
        panel.canChooseFiles = NO;
        panel.canChooseDirectories = YES;
        panel.allowsMultipleSelection = NO;
        panel.canCreateDirectories = YES;
        panel.title = @"Choose vault location";
        panel.prompt = @"Choose";
        if (startPath && strlen(startPath) > 0) {
            NSString* sp = [NSString stringWithUTF8String:startPath];
            panel.directoryURL = [NSURL fileURLWithPath:sp];
        }

        void (^complete)(NSModalResponse) = ^(NSModalResponse result) {
            NSString* path = @"";
            if (result == NSModalResponseOK && panel.URL) {
                path = panel.URL.path ?: @"";
            }
            NSString* json = jsonString(path);
            webview_return(wRef, [idStr UTF8String], 0, [json UTF8String]);
        };

        NSWindow* window = webView ? webView.window : nil;
        if (window) {
            [panel beginSheetModalForWindow:window completionHandler:complete];
        } else {
            complete([panel runModal]);
        }
    }
}
