#import <Cocoa/Cocoa.h>

extern "C" void note_setup_macos_menu(const char* appName) {
    @autoreleasepool {
        NSString* name = [NSString stringWithUTF8String:appName];
        NSApplication* app = [NSApplication sharedApplication];
        NSMenu* mainMenu = [[NSMenu alloc] init];

        // ── App menu (named after the app) ──────────────────────────────────
        NSMenuItem* appMenuItem = [[NSMenuItem alloc] init];
        [mainMenu addItem:appMenuItem];
        NSMenu* appMenu = [[NSMenu alloc] initWithTitle:name];
        [appMenuItem setSubmenu:appMenu];
        [appMenu addItemWithTitle:[NSString stringWithFormat:@"About %@", name]
                           action:@selector(orderFrontStandardAboutPanel:)
                    keyEquivalent:@""];
        [appMenu addItem:[NSMenuItem separatorItem]];
        [appMenu addItemWithTitle:[NSString stringWithFormat:@"Hide %@", name]
                           action:@selector(hide:)
                    keyEquivalent:@"h"];
        NSMenuItem* hideOthers = [appMenu addItemWithTitle:@"Hide Others"
                                                    action:@selector(hideOtherApplications:)
                                             keyEquivalent:@"h"];
        [hideOthers setKeyEquivalentModifierMask:
            (NSEventModifierFlagOption | NSEventModifierFlagCommand)];
        [appMenu addItemWithTitle:@"Show All"
                           action:@selector(unhideAllApplications:)
                    keyEquivalent:@""];
        [appMenu addItem:[NSMenuItem separatorItem]];
        [appMenu addItemWithTitle:[NSString stringWithFormat:@"Quit %@", name]
                           action:@selector(terminate:)
                    keyEquivalent:@"q"];

        // ── Edit menu (Cut/Copy/Paste/Undo/Redo/Select All) ─────────────────
        NSMenuItem* editMenuItem = [[NSMenuItem alloc] init];
        [mainMenu addItem:editMenuItem];
        NSMenu* editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
        [editMenuItem setSubmenu:editMenu];
        [editMenu addItemWithTitle:@"Undo"
                            action:@selector(undo:)
                     keyEquivalent:@"z"];
        NSMenuItem* redo = [editMenu addItemWithTitle:@"Redo"
                                               action:@selector(redo:)
                                        keyEquivalent:@"z"];
        [redo setKeyEquivalentModifierMask:
            (NSEventModifierFlagShift | NSEventModifierFlagCommand)];
        [editMenu addItem:[NSMenuItem separatorItem]];
        [editMenu addItemWithTitle:@"Cut"
                            action:@selector(cut:)
                     keyEquivalent:@"x"];
        [editMenu addItemWithTitle:@"Copy"
                            action:@selector(copy:)
                     keyEquivalent:@"c"];
        [editMenu addItemWithTitle:@"Paste"
                            action:@selector(paste:)
                     keyEquivalent:@"v"];
        [editMenu addItemWithTitle:@"Select All"
                            action:@selector(selectAll:)
                     keyEquivalent:@"a"];

        [app setMainMenu:mainMenu];
    }
}
