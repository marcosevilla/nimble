//! Double-tap-Shift selection capture (Copper-style).
//!
//! A global CGEventTap watches for two bare Shift taps in quick succession.
//! On trigger: copy the frontmost app's selection via a synthesized Cmd+C,
//! save it as an Inbox capture tagged with the source app name, restore the
//! clipboard, and flash the capture strip as confirmation. With no selection,
//! the strip opens for manual typing instead.
//!
//! Hand-rolled tap instead of an input library: we only need raw keycodes,
//! and rdev's listener crashes on modern macOS (it calls TIS keyboard-layout
//! APIs off the main thread on every event → dispatch_assert_queue SIGTRAP).
//!
//! Requires the Accessibility permission (System Settings → Privacy & Security
//! → Accessibility) — both the event tap and the synthesized Cmd+C need it.

use std::cell::Cell;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use core_foundation::runloop::CFRunLoop;
use core_graphics::event::{
    CGEvent, CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions,
    CGEventTapPlacement, CGEventType, CallbackResult, EventField,
};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use sqlx::SqlitePool;
use tauri::{Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

/// Two bare Shift taps within this window = trigger
const DOUBLE_TAP_WINDOW: Duration = Duration::from_millis(400);
/// Ignore re-triggers within this window
const TRIGGER_COOLDOWN: Duration = Duration::from_millis(1000);
/// How long the frontmost app gets to service the synthesized Cmd+C
const COPY_SETTLE: Duration = Duration::from_millis(150);

const KEYCODE_SHIFT_LEFT: i64 = 56;
const KEYCODE_SHIFT_RIGHT: i64 = 60;
const KEYCODE_C: u16 = 8;

pub fn start(app: tauri::AppHandle) {
    let (tx, rx) = mpsc::channel::<()>();

    // Worker: runs the capture flow off the event-tap callback, which must
    // stay fast — a slow tap callback stalls keyboard input system-wide.
    thread::spawn(move || {
        let mut last_trigger: Option<Instant> = None;
        while rx.recv().is_ok() {
            if last_trigger.map(|t| t.elapsed() < TRIGGER_COOLDOWN).unwrap_or(false) {
                continue;
            }
            last_trigger = Some(Instant::now());
            capture_selection(&app);
        }
    });

    thread::spawn(move || {
        // Tap callback is Fn + single-threaded (this thread's run loop) — Cells for state
        let shift_down_alone = Cell::new(false);
        let last_bare_tap: Cell<Option<Instant>> = Cell::new(None);

        let result = CGEventTap::with_enabled(
            CGEventTapLocation::HID,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            vec![
                CGEventType::KeyDown,
                CGEventType::FlagsChanged,
                CGEventType::LeftMouseDown,
                CGEventType::RightMouseDown,
            ],
            |_proxy, event_type, event| {
                match event_type {
                    CGEventType::FlagsChanged => {
                        let keycode =
                            event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE);
                        if keycode != KEYCODE_SHIFT_LEFT && keycode != KEYCODE_SHIFT_RIGHT {
                            // Some other modifier (Cmd, Opt, ...) — breaks the sequence
                            shift_down_alone.set(false);
                            last_bare_tap.set(None);
                            return CallbackResult::Keep;
                        }
                        let shift_now =
                            event.get_flags().contains(CGEventFlags::CGEventFlagShift);
                        if shift_now {
                            // Shift pressed
                            let armed = last_bare_tap
                                .get()
                                .map(|t| t.elapsed() < DOUBLE_TAP_WINDOW)
                                .unwrap_or(false);
                            if armed {
                                last_bare_tap.set(None);
                                shift_down_alone.set(false);
                                let _ = tx.send(());
                            } else {
                                shift_down_alone.set(true);
                            }
                        } else {
                            // Shift released
                            if shift_down_alone.get() {
                                last_bare_tap.set(Some(Instant::now()));
                            }
                            shift_down_alone.set(false);
                        }
                    }
                    // Any normal key or click breaks the double-tap sequence
                    _ => {
                        shift_down_alone.set(false);
                        last_bare_tap.set(None);
                    }
                }
                CallbackResult::Keep
            },
            || CFRunLoop::run_current(),
        );

        if result.is_err() {
            log::warn!(
                "Selection capture disabled — event tap creation failed. \
                 Grant Accessibility permission in System Settings → Privacy & Security → Accessibility, then relaunch."
            );
        }
    });
}

/// Synthesize Cmd+C at the HID level
fn send_cmd_c() -> Result<(), ()> {
    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)?;
    let down = CGEvent::new_keyboard_event(source.clone(), KEYCODE_C, true)?;
    down.set_flags(CGEventFlags::CGEventFlagCommand);
    down.post(CGEventTapLocation::HID);
    thread::sleep(Duration::from_millis(30));
    let up = CGEvent::new_keyboard_event(source, KEYCODE_C, false)?;
    up.set_flags(CGEventFlags::CGEventFlagCommand);
    up.post(CGEventTapLocation::HID);
    Ok(())
}

fn capture_selection(app: &tauri::AppHandle) {
    // Grab the source app name before we start poking at the clipboard
    let front_app = active_win_pos_rs::get_active_window()
        .ok()
        .map(|w| w.app_name)
        .filter(|n| !n.is_empty());

    let old_clip = app.clipboard().read_text().ok();

    if send_cmd_c().is_err() {
        log::warn!("Selection capture: failed to synthesize Cmd+C (Accessibility permission?)");
        return;
    }
    thread::sleep(COPY_SETTLE);

    let new_clip = app
        .clipboard()
        .read_text()
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    match new_clip {
        Some(text) if Some(&text) != old_clip.as_ref() => {
            let pool = app.state::<SqlitePool>();
            let saved = tauri::async_runtime::block_on(
                daily_triage_core::db::captures::create_capture(
                    pool.inner(),
                    &text,
                    "selection",
                    front_app.as_deref(),
                ),
            );

            // Put the user's clipboard back — capturing shouldn't clobber it
            if let Some(old) = old_clip {
                let _ = app.clipboard().write_text(old);
            }

            match saved {
                Ok(capture) => {
                    log::info!("Selection capture: saved from {:?}", capture.context);
                    let _ = app.emit("captures-changed", ());
                    // Flash the strip as confirmation, without stealing focus.
                    // Window ops must run on the main thread — silently no-ops here otherwise.
                    let app2 = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        if let Some(window) = app2.get_webview_window("capture") {
                            let _ = window.emit("selection-captured", &capture);
                            let _ = window.center();
                            let _ = window.show();
                        }
                    });
                }
                Err(e) => log::warn!("Selection capture: failed to save: {}", e),
            }
        }
        // Nothing selected (clipboard unchanged) — open the strip for typing
        _ => {
            log::info!("Selection capture: no selection — opening strip");
            let app2 = app.clone();
            let _ = app.run_on_main_thread(move || crate::show_capture_strip(&app2));
        }
    }
}
