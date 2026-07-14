// Native folder picker on Linux using GtkFileChooserDialog.
// Mirrors the macOS macos_dialog/dialog.mm interface (note_pick_folder).

#include <gtk/gtk.h>
#include <string>

typedef void* webview_t;
#define WEBVIEW_NATIVE_HANDLE_KIND_UI_WINDOW 0

extern "C" {
    void* webview_get_native_handle(webview_t w, int kind);
    int webview_return(webview_t w, const char* id, int status, const char* result);
}

static std::string json_string(const char* s) {
    std::string out = "\"";
    for (const char* p = s; *p; ++p) {
        unsigned char c = static_cast<unsigned char>(*p);
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            default:
                if (c < 0x20) {
                    char buf[8];
                    snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                } else {
                    out += static_cast<char>(c);
                }
        }
    }
    out += "\"";
    return out;
}

extern "C" void note_pick_folder(
    webview_t w, const char* cb_id, const char* start_path
) {
    GtkWindow* parent = static_cast<GtkWindow*>(
        webview_get_native_handle(w, WEBVIEW_NATIVE_HANDLE_KIND_UI_WINDOW));

    GtkWidget* dialog = gtk_file_chooser_dialog_new(
        "Choose Vault Folder",
        parent,
        GTK_FILE_CHOOSER_ACTION_SELECT_FOLDER,
        "_Cancel", GTK_RESPONSE_CANCEL,
        "_Choose", GTK_RESPONSE_ACCEPT,
        nullptr
    );

    if (start_path && *start_path) {
        gtk_file_chooser_set_current_folder(
            GTK_FILE_CHOOSER(dialog), start_path);
    }

    gint res = gtk_dialog_run(GTK_DIALOG(dialog));
    if (res == GTK_RESPONSE_ACCEPT) {
        gchar* path = gtk_file_chooser_get_filename(GTK_FILE_CHOOSER(dialog));
        if (path) {
            webview_return(w, cb_id, 0, json_string(path).c_str());
            g_free(path);
        } else {
            webview_return(w, cb_id, 0, "null");
        }
    } else {
        webview_return(w, cb_id, 0, "null");
    }

    gtk_widget_destroy(dialog);
}
