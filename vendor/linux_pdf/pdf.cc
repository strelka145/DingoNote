// PDF export on Linux via WebKitGTK's WebKitPrintOperation.
// Mirrors the macOS macos_pdf/pdf.mm interface (note_export_pdf).
//
// User picks a save location via GtkFileChooserDialog, then we configure
// GtkPrintSettings to write directly to that path as a PDF and run
// webkit_print_operation_print() without showing a print dialog.
//
// IMPORTANT: webkit_print_operation_print() is async. We must:
//   1. Set the printer name to "Print to File" (the GTK file backend's
//      internal printer name) so output is routed to a file, not a printer.
//   2. Keep the WebKitPrintOperation alive until the "finished" / "failed"
//      signal fires — releasing it too early cancels the operation.

#include <gtk/gtk.h>
#include <webkit2/webkit2.h>
#include <string>

typedef void* webview_t;
#define WEBVIEW_NATIVE_HANDLE_KIND_UI_WINDOW 0
#define WEBVIEW_NATIVE_HANDLE_KIND_BROWSER_CONTROLLER 2

extern "C" {
    void* webview_get_native_handle(webview_t w, int kind);
    int webview_eval(webview_t w, const char* js);
}

struct PdfCtx {
    webview_t w;
    GtkPrintSettings* settings;
    std::string outPath;
};

static void notify(webview_t w, const char* status) {
    std::string js =
        "window.dispatchEvent(new CustomEvent('pdfexport',{detail:{status:'";
    js += status;
    js += "'}}))";
    webview_eval(w, js.c_str());
}

static void on_print_finished(WebKitPrintOperation* op, gpointer user_data) {
    PdfCtx* ctx = static_cast<PdfCtx*>(user_data);
    notify(ctx->w, "success");
    if (ctx->settings) g_object_unref(ctx->settings);
    g_object_unref(op);
    delete ctx;
}

static void on_print_failed(
    WebKitPrintOperation* op, GError* error, gpointer user_data
) {
    PdfCtx* ctx = static_cast<PdfCtx*>(user_data);
    if (error && error->message) {
        g_warning("note_export_pdf failed: %s", error->message);
    }
    notify(ctx->w, "error");
    if (ctx->settings) g_object_unref(ctx->settings);
    g_object_unref(op);
    delete ctx;
}

extern "C" void note_export_pdf(webview_t w, const char* default_name) {
    GtkWidget* widget = static_cast<GtkWidget*>(
        webview_get_native_handle(w, WEBVIEW_NATIVE_HANDLE_KIND_BROWSER_CONTROLLER));
    if (!widget || !WEBKIT_IS_WEB_VIEW(widget)) {
        notify(w, "error");
        return;
    }
    WebKitWebView* webView = WEBKIT_WEB_VIEW(widget);
    GtkWindow* parent = static_cast<GtkWindow*>(
        webview_get_native_handle(w, WEBVIEW_NATIVE_HANDLE_KIND_UI_WINDOW));

    GtkWidget* dialog = gtk_file_chooser_dialog_new(
        "Export PDF",
        parent,
        GTK_FILE_CHOOSER_ACTION_SAVE,
        "_Cancel", GTK_RESPONSE_CANCEL,
        "_Save",   GTK_RESPONSE_ACCEPT,
        nullptr
    );
    gtk_file_chooser_set_do_overwrite_confirmation(
        GTK_FILE_CHOOSER(dialog), TRUE);
    gtk_file_chooser_set_current_name(
        GTK_FILE_CHOOSER(dialog),
        (default_name && *default_name) ? default_name : "note.pdf");

    gint res = gtk_dialog_run(GTK_DIALOG(dialog));
    if (res != GTK_RESPONSE_ACCEPT) {
        gtk_widget_destroy(dialog);
        notify(w, "cancelled");
        return;
    }
    gchar* picked = gtk_file_chooser_get_filename(GTK_FILE_CHOOSER(dialog));
    gtk_widget_destroy(dialog);
    if (!picked) {
        notify(w, "cancelled");
        return;
    }
    std::string outPath(picked);
    g_free(picked);
    if (outPath.size() < 4 ||
        outPath.compare(outPath.size() - 4, 4, ".pdf") != 0) {
        outPath += ".pdf";
    }

    gchar* uri = g_filename_to_uri(outPath.c_str(), nullptr, nullptr);
    if (!uri) {
        notify(w, "error");
        return;
    }

    GtkPrintSettings* settings = gtk_print_settings_new();
    // "Print to File" is the hard-coded name used by GTK's file print
    // backend (gtkprintbackendfile.c). It is NOT localized when matched
    // internally, so this works regardless of system language.
    gtk_print_settings_set_printer(settings, "Print to File");
    gtk_print_settings_set(settings, GTK_PRINT_SETTINGS_OUTPUT_URI, uri);
    gtk_print_settings_set(settings,
        GTK_PRINT_SETTINGS_OUTPUT_FILE_FORMAT, "pdf");
    g_free(uri);

    WebKitPrintOperation* op = webkit_print_operation_new(webView);
    webkit_print_operation_set_print_settings(op, settings);

    PdfCtx* ctx = new PdfCtx{w, settings, outPath};
    g_signal_connect(op, "finished",
        G_CALLBACK(on_print_finished), ctx);
    g_signal_connect(op, "failed",
        G_CALLBACK(on_print_failed), ctx);

    // Do NOT unref op here — the signal handler will release it once the
    // async print completes.
    webkit_print_operation_print(op);
}
