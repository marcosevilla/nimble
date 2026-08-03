//! Selection grab for the quick-capture strip.
//!
//! When the strip is summoned (⌥⌘Space or the tray item), read the frontmost
//! app's selected text via the Accessibility API (AXSelectedText on the
//! focused UI element) and hand it to the strip as prefill, tagged with the
//! source app name. No selection → no prefill.
//!
//! Earlier attempts synthesized Cmd+C (first via a double-tap-Shift event
//! tap, then posted to the app's PID): macOS starved the listen-only tap of
//! events, and a synthesized keystroke delivered during our own activation
//! transition made macOS cancel the strip's activation. Passively reading
//! the AX tree has neither problem — no events, no clipboard, no focus
//! interference — and it's synchronous, so the prefill shows instantly.
//!
//! Requires the Accessibility permission (System Settings → Privacy &
//! Security → Accessibility). Without it the read fails quietly and the
//! strip opens empty. "AXManualAccessibility" is set on the target app
//! first — Chromium/Electron apps only build their AX tree when an
//! assistive client announces itself.

use core_foundation::base::{CFRelease, CFTypeRef, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::string::{CFString, CFStringRef};

type AXUIElementRef = *mut std::ffi::c_void;
type AXError = i32;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> AXError;
    fn AXUIElementSetAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: CFTypeRef,
    ) -> AXError;
}

pub struct GrabbedSelection {
    pub text: String,
    /// Name of the app the selection came from
    pub context: Option<String>,
}

/// Read the frontmost app's selected text. Synchronous and fast — call
/// BEFORE showing the strip, while the source app is still frontmost.
/// Returns None when nothing is selected or the app doesn't expose its
/// selection through the Accessibility API.
pub fn grab_selection() -> Option<GrabbedSelection> {
    let front = active_win_pos_rs::get_active_window().ok()?;
    let pid = front.process_id as i32;
    let app_name = Some(front.app_name).filter(|n| !n.is_empty());

    let text = unsafe { read_ax_selected_text(pid) };
    match text {
        Some(text) => {
            log::info!("Selection grab: prefilled from {:?}", app_name);
            Some(GrabbedSelection { text, context: app_name })
        }
        None => None,
    }
}

unsafe fn read_ax_selected_text(pid: i32) -> Option<String> {
    let app_el = AXUIElementCreateApplication(pid);
    if app_el.is_null() {
        return None;
    }

    // Chromium/Electron apps gate their AX tree behind an assistive-client
    // check — this attribute opts us in. Errors are expected elsewhere.
    let manual_ax = CFString::from_static_string("AXManualAccessibility");
    let _ = AXUIElementSetAttributeValue(
        app_el,
        manual_ax.as_concrete_TypeRef(),
        CFBoolean::true_value().as_CFTypeRef(),
    );

    let focused_attr = CFString::from_static_string("AXFocusedUIElement");
    let mut focused: CFTypeRef = std::ptr::null();
    let err = AXUIElementCopyAttributeValue(
        app_el,
        focused_attr.as_concrete_TypeRef(),
        &mut focused,
    );
    if err != 0 || focused.is_null() {
        log::info!("Selection grab: no focused AX element (err {err})");
        CFRelease(app_el.cast());
        return None;
    }

    let selected_attr = CFString::from_static_string("AXSelectedText");
    let mut selected: CFTypeRef = std::ptr::null();
    let err = AXUIElementCopyAttributeValue(
        focused.cast_mut().cast(),
        selected_attr.as_concrete_TypeRef(),
        &mut selected,
    );

    let text = if err == 0 && !selected.is_null() {
        // Copy rule — we own `selected`; wrap_under_create_rule releases it
        let s = CFString::wrap_under_create_rule(selected.cast());
        let s = s.to_string();
        let s = s.trim().to_string();
        if s.is_empty() { None } else { Some(s) }
    } else {
        log::info!("Selection grab: no AXSelectedText (err {err})");
        None
    };

    CFRelease(focused);
    CFRelease(app_el.cast());
    text
}
