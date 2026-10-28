//! Keep the native macOS controls centered in the web titlebar.
use objc2_app_kit::{NSWindow, NSWindowButton, NSWindowStyleMask};
use tauri::Manager;

// Logical points; keep in sync with WindowTitlebar's 64px height.
// Its center aligns with the content header: 8px inset + 48px / 2.
const TITLEBAR_HEIGHT: f64 = 64.0;
const CONTROLS_LEFT: f64 = 14.0;

pub fn align(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let target = window.clone();
    let _ = window.run_on_main_thread(move || {
        let Ok(pointer) = target.ns_window() else {
            return;
        };
        if pointer.is_null() {
            return;
        }
        // Tauri owns this NSWindow; all AppKit reads and writes stay on its main thread.
        let window = unsafe { &*pointer.cast::<NSWindow>() };
        if window.styleMask().contains(NSWindowStyleMask::FullScreen) {
            return;
        }
        let Some(close) = window.standardWindowButton(NSWindowButton::CloseButton) else {
            return;
        };
        let Some(titlebar) = (unsafe { close.superview() }) else {
            return;
        };
        let Some(container) = (unsafe { titlebar.superview() }) else {
            return;
        };

        // Overlay keeps the WebView full size. Expand only the native titlebar,
        // anchored to the same top edge, so its hit area also contains the buttons.
        let mut frame = container.frame();
        frame.origin.y += frame.size.height - TITLEBAR_HEIGHT;
        frame.size.height = TITLEBAR_HEIGHT;
        container.setFrame(frame);
        let mut frame = titlebar.frame();
        frame.origin.y = 0.0;
        frame.size.height = TITLEBAR_HEIGHT;
        titlebar.setFrame(frame);

        let left = close.frame().origin.x;
        for kind in [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ] {
            if let Some(button) = window.standardWindowButton(kind) {
                let mut frame = button.frame();
                frame.origin.x += CONTROLS_LEFT - left;
                frame.origin.y = (TITLEBAR_HEIGHT - frame.size.height) / 2.0;
                button.setFrameOrigin(frame.origin);
            }
        }
    });
}
