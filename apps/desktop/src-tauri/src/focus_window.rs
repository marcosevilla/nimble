//! The always-on-top focus companion window and the native focus lifecycle.
//!
//! One process-wide `FocusRuntime` serves both windows; this module owns only
//! the native pieces that keep its timing honest (spec §6–7):
//!
//! - the 20-second heartbeat, driven by a Rust timer (never a webview
//!   interval); the credited delta comes from the service's own
//!   sleep-inclusive monotonic clock,
//! - visible-surface accounting: closing the companion or hiding main only
//!   closes a view, but hiding the LAST visible focus surface pauses,
//! - explicit Quit settles before exit (a forced quit follows the startup
//!   crash recovery at the last durable checkpoint),
//! - system sleep settles at the notice; wake never resumes (explicit Resume).
//!   Without a timely notice the heartbeat's > 40 s gap rule pauses at the
//!   last durable checkpoint.
//!
//! Live timing is advertised only after `wire_lifecycle` ran in the process
//! that holds the profile owner lock.
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use nimble_core::focus_types::{FocusError, FocusErrorCode};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewWindow};

use crate::focus_service::{self, FocusRuntime};

pub const COMPANION_LABEL: &str = "focus";
/// Windows that render a focus surface (main shows the banner/tray).
const SURFACE_LABELS: [&str; 2] = ["main", COMPANION_LABEL];
const HEARTBEAT: Duration = Duration::from_secs(20);
/// How long quit/sleep may block the main thread to settle focus.
const SETTLE_BUDGET: Duration = Duration::from_secs(3);

pub const REASON_SURFACE_CLOSED: &str = "the last focus window was closed";
pub const REASON_SLEEP: &str = "the Mac went to sleep";
pub const REASON_QUIT: &str = "Nimble quit";

// ── Companion window ──

/// Show and activate the companion. Runs synchronously inside the user's
/// invoke, so macOS honors the activation. Opening a view never starts,
/// resumes or retimes anything.
pub fn open_companion(app: &AppHandle) -> Result<(), FocusError> {
    let lifecycle = app
        .try_state::<FocusRuntime>()
        .is_some_and(|rt| rt.lifecycle_wired());
    if !lifecycle {
        return Err(FocusError {
            code: FocusErrorCode::Unsupported,
            message: "The focus companion isn't available in this process.".into(),
        });
    }
    let window = app
        .get_webview_window(COMPANION_LABEL)
        .ok_or_else(|| FocusError {
            code: FocusErrorCode::Unsupported,
            message: "The focus companion window is missing.".into(),
        })?;
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    Ok(())
}

pub const OPEN_TASK_EVENT: &str = "nimble-focus-open-task";

/// The companion has no detail page: show main and ask it to open the task.
/// Carries only the task ID; main re-reads the task through its provider.
pub fn open_task_in_main(app: &AppHandle, task_id: &str) -> Result<(), FocusError> {
    if task_id.is_empty() || task_id.len() > 128 {
        return Err(FocusError {
            code: FocusErrorCode::Invalid,
            message: "invalid task id".into(),
        });
    }
    let main = app.get_webview_window("main").ok_or_else(|| FocusError {
        code: FocusErrorCode::Unsupported,
        message: "The main window is missing.".into(),
    })?;
    let _ = main.show();
    let _ = main.unminimize();
    let _ = main.set_focus();
    let _ = main.emit_to(
        "main",
        OPEN_TASK_EVENT,
        serde_json::json!({ "version": 1, "task_id": task_id }),
    );
    Ok(())
}

/// Geometry computed by `src/lib/focusWindow.ts` (logical px, inner size).
#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
pub struct CompanionGeometry {
    pub width: f64,
    pub height: f64,
    pub min_width: f64,
    pub max_width: f64,
    pub min_height: f64,
    pub max_height: f64,
    pub x: Option<f64>,
    pub y: Option<f64>,
}

const MAX_EXTENT: f64 = 16_384.0;

impl CompanionGeometry {
    /// Reject anything that is not a sane, ordered size before touching the window.
    pub fn validate(&self) -> Result<(), FocusError> {
        let sizes = [
            self.width,
            self.height,
            self.min_width,
            self.max_width,
            self.min_height,
            self.max_height,
        ];
        let sane = sizes
            .iter()
            .all(|v| v.is_finite() && *v >= 1.0 && *v <= MAX_EXTENT)
            && self.min_width <= self.width
            && self.width <= self.max_width
            && self.min_height <= self.height
            && self.height <= self.max_height
            && [self.x, self.y]
                .iter()
                .flatten()
                .all(|v| v.is_finite() && v.abs() <= MAX_EXTENT * 4.0);
        if sane {
            Ok(())
        } else {
            Err(FocusError {
                code: FocusErrorCode::Invalid,
                message: "invalid companion geometry".into(),
            })
        }
    }
}

/// Apply a computed geometry to the companion only (never to main).
pub fn apply_geometry(
    window: &WebviewWindow,
    geometry: CompanionGeometry,
) -> Result<(), FocusError> {
    if window.label() != COMPANION_LABEL {
        return Err(FocusError {
            code: FocusErrorCode::Invalid,
            message: "not the focus companion".into(),
        });
    }
    geometry.validate()?;
    // Loosen constraints first so the new size is always allowed.
    let _ = window.set_min_size(None::<LogicalSize<f64>>);
    let _ = window.set_max_size(None::<LogicalSize<f64>>);
    let _ = window.set_size(LogicalSize::new(geometry.width, geometry.height));
    let _ = window.set_min_size(Some(LogicalSize::new(
        geometry.min_width,
        geometry.min_height,
    )));
    let _ = window.set_max_size(Some(LogicalSize::new(
        geometry.max_width,
        geometry.max_height,
    )));
    if let (Some(x), Some(y)) = (geometry.x, geometry.y) {
        let _ = window.set_position(LogicalPosition::new(x, y));
    }
    Ok(())
}

// ── Visible surfaces ──

fn visible_surfaces(app: &AppHandle) -> usize {
    SURFACE_LABELS
        .iter()
        .filter_map(|label| app.get_webview_window(label))
        .filter(|w| w.is_visible().unwrap_or(false))
        .count()
}

/// Call right after hiding a focus surface. Closing one view keeps timing
/// while another focus surface is visible; hiding the last one pauses so
/// no timer runs unseen.
pub fn surface_hidden(app: &AppHandle) {
    if visible_surfaces(app) > 0 {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        focus_service::interrupt(&app, REASON_SURFACE_CLOSED).await;
    });
}

pub fn is_surface(label: &str) -> bool {
    SURFACE_LABELS.contains(&label)
}

// ── Quit ──

static SETTLED_ON_EXIT: AtomicBool = AtomicBool::new(false);

/// Explicit Quit (tray, ⌘Q, app.exit): settle and checkpoint once, before
/// the process ends. Blocks the calling (main) thread for at most
/// `SETTLE_BUDGET`; a hung disk falls back to crash recovery on next launch.
pub fn settle_on_exit(app: &AppHandle) {
    if SETTLED_ON_EXIT.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    let _ = tauri::async_runtime::block_on(async move {
        tokio::time::timeout(SETTLE_BUDGET, focus_service::interrupt(&app, REASON_QUIT)).await
    });
}

// ── Heartbeat and power ──

/// Install the heartbeat and power observers, then advertise live timing.
/// Only a process that holds the profile owner lock wires anything.
pub fn wire_lifecycle(app: &AppHandle) {
    let Some(rt) = app.try_state::<FocusRuntime>() else {
        return;
    };
    if !rt.owns_profile() {
        log::warn!("Focus live timing disabled: this process does not own the profile");
        return;
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut timer = tokio::time::interval(HEARTBEAT);
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            timer.tick().await;
            focus_service::heartbeat(&handle).await;
        }
    });
    install_power_observers(app);
    rt.mark_lifecycle_wired();
}

#[cfg(target_os = "macos")]
fn install_power_observers(app: &AppHandle) {
    use block2::RcBlock;
    use objc2_app_kit::{
        NSWorkspace, NSWorkspaceDidWakeNotification, NSWorkspaceWillSleepNotification,
    };
    use objc2_foundation::NSNotification;
    use std::ptr::NonNull;

    let center = NSWorkspace::sharedWorkspace().notificationCenter();

    let sleep_app = app.clone();
    let on_sleep = RcBlock::new(move |_: NonNull<NSNotification>| {
        // Settle at the notice, before the machine sleeps. Posted on the
        // main thread; the service itself never needs the main thread.
        let app = sleep_app.clone();
        let _ = tauri::async_runtime::block_on(async move {
            tokio::time::timeout(SETTLE_BUDGET, focus_service::interrupt(&app, REASON_SLEEP)).await
        });
    });
    let wake_app = app.clone();
    let on_wake = RcBlock::new(move |_: NonNull<NSNotification>| {
        // Wake never resumes: just let windows re-read the paused snapshot.
        let app = wake_app.clone();
        tauri::async_runtime::spawn(async move { focus_service::broadcast(&app).await });
    });
    // SAFETY: the blocks are Send-safe (they only clone an AppHandle and
    // hand work to the async runtime); a nil queue runs them on the posting
    // (main) thread. The observers live for the whole process.
    unsafe {
        let sleep_token = center.addObserverForName_object_queue_usingBlock(
            Some(NSWorkspaceWillSleepNotification),
            None,
            None,
            &on_sleep,
        );
        let wake_token = center.addObserverForName_object_queue_usingBlock(
            Some(NSWorkspaceDidWakeNotification),
            None,
            None,
            &on_wake,
        );
        std::mem::forget(sleep_token);
        std::mem::forget(wake_token);
    }
}

#[cfg(not(target_os = "macos"))]
fn install_power_observers(_app: &AppHandle) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn geometry() -> CompanionGeometry {
        CompanionGeometry {
            width: 340.0,
            height: 560.0,
            min_width: 340.0,
            max_width: 340.0,
            min_height: 420.0,
            max_height: 640.0,
            x: Some(100.0),
            y: Some(40.0),
        }
    }

    #[test]
    fn geometry_validation_accepts_the_baseline_and_rejects_nonsense() {
        assert!(geometry().validate().is_ok());
        for bad in [
            CompanionGeometry {
                width: f64::NAN,
                ..geometry()
            },
            CompanionGeometry {
                height: 0.0,
                min_height: 0.0,
                ..geometry()
            },
            CompanionGeometry {
                width: 400.0,
                ..geometry()
            },
            CompanionGeometry {
                height: 700.0,
                ..geometry()
            },
            CompanionGeometry {
                x: Some(f64::INFINITY),
                ..geometry()
            },
            CompanionGeometry {
                max_height: 1e9,
                ..geometry()
            },
        ] {
            assert!(bad.validate().is_err(), "{bad:?}");
        }
    }

    #[test]
    fn only_main_and_companion_are_focus_surfaces() {
        assert!(is_surface("main") && is_surface(COMPANION_LABEL));
        assert!(!is_surface("capture"));
    }
}
