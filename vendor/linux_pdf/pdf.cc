// PDF export on Linux via WebKitGTK's WebKitPrintOperation.
// Mirrors the macOS macos_pdf/pdf.mm interface (note_export_pdf).
//
// User picks a save location via GtkFileChooserDialog, then we configure
// GtkPrintSettings to write directly to that path as a PDF and run
// webkit_print_operation_print() without showing a print dialog.

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

static void notify(webview_t w, const char* status) {
    std::string js =
        "window.dispatchEvent(new CustomEvent('pdfexport',{detail:{status:'";
    js += status;
    js += "'}}))";
    webview_eval(w, js.c_str());
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

    WebKitPrintOperation* op = webkit_print_operation_new(webView);
    GtkPrintSettings* settings = gtk_print_settings_new();
    gtk_print_settings_set(settings, GTK_PRINT_SETTINGS_OUTPUT_URI, uri);
    gtk_print_settings_set(settings,
        GTK_PRINT_SETTINGS_OUTPUT_FILE_FORMAT, "pdf");
    webkit_print_operation_set_print_settings(op, settings);

    webkit_print_operation_print(op);
    notify(w, "success");

    g_object_unref(op);
    g_object_unref(settings);
    g_free(uri);
}
