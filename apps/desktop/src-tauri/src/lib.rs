mod commands;
mod selection;
mod sync_runner;
mod vault_runner;
// db and parsers modules re-export from nimble-core for backward compatibility
#[allow(unused)]
mod db;
#[allow(unused)]
mod parsers;

use sqlx::sqlite::SqlitePoolOptions;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartManagerExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use commands::{activity, ai, calendar, capture_routes, captures, demo, docs, focus, goals, habits, import, labels, local_tasks, obsidian, open_url, priorities, progress, projects, sections, settings, sync, todoist, todoist_sync, updater, vault};

/// Show and focus the main window
fn show_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Toggle main window visibility
fn toggle_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
}

/// When the capture strip was last summoned — blur-dismiss gets a grace
/// period so a lost activation race can't close the strip as it appears
static STRIP_SHOWN_AT: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);

/// Payload for the `capture-strip-prefill` event, sent when a grabbed
/// selection lands shortly after the strip opened
#[derive(Clone, serde::Serialize)]
struct CaptureStripPrefill {
    text: String,
    context: Option<String>,
}

/// Show and focus the quick-capture strip
pub(crate) fn show_capture_strip(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("capture") {
        *STRIP_SHOWN_AT.lock().unwrap() = Some(std::time::Instant::now());
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("capture-strip-opened", ());
    }
}

/// Summon the strip. The AX selection read is synchronous and runs BEFORE
/// the window shows (the source app must still be frontmost); the show +
/// set_focus stays tied to the triggering user event, which macOS requires
/// to honor the activation.
fn summon_capture_strip(app: &tauri::AppHandle) {
    let grabbed = selection::grab_selection();
    show_capture_strip(app);
    if let Some(grabbed) = grabbed {
        if let Some(window) = app.get_webview_window("capture") {
            let _ = window.emit(
                "capture-strip-prefill",
                CaptureStripPrefill { text: grabbed.text, context: grabbed.context },
            );
        }
    }
}

/// Toggle the quick-capture strip (global shortcut)
fn toggle_capture_strip(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("capture") {
        if window.is_visible().unwrap_or(false) {
            dismiss_capture_strip_inner(app);
        } else {
            summon_capture_strip(app);
        }
    }
}

/// Dismiss the capture strip without disturbing window order.
///
/// Summoning the strip activated this app; hiding the strip's window while the
/// app is still active makes AppKit promote the main window to key, dragging
/// it to the front. Deactivating FIRST hands focus back to whichever app was
/// active before the strip appeared, so hiding promotes nothing.
///
/// Must run on the main thread (NSApplication + window ops).
pub(crate) fn dismiss_capture_strip_inner(app: &tauri::AppHandle) {
    let main_focused = app
        .get_webview_window("main")
        .map(|w| w.is_focused().unwrap_or(false))
        .unwrap_or(false);
    // If the user deliberately moved into the main window, leave focus there
    if !main_focused {
        if let Some(mtm) = objc2::MainThreadMarker::new() {
            let ns_app = objc2_app_kit::NSApplication::sharedApplication(mtm);
            if ns_app.isActive() {
                ns_app.deactivate();
            }
        }
    }
    if let Some(window) = app.get_webview_window("capture") {
        let _ = window.hide();
    }
}

/// Frontend-facing dismiss (Esc, post-save, ghost-guard) — routes through
/// the focus-preserving path instead of a bare window.hide(). The reason is
/// logged with the window's focus state so unexpected dismissals are
/// diagnosable from the production log.
#[tauri::command]
fn dismiss_capture_strip(app: tauri::AppHandle, reason: Option<String>) {
    let win_focused = app
        .get_webview_window("capture")
        .map(|w| w.is_focused().unwrap_or(false))
        .unwrap_or(false);
    log::info!(
        "capture strip dismissed ({}) — window focused: {}",
        reason.as_deref().unwrap_or("unspecified"),
        win_focused
    );
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || dismiss_capture_strip_inner(&app2));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            // Capture strip is positioned/shown programmatically — keep it out of saved state
            tauri_plugin_window_state::Builder::new()
                .with_denylist(&["capture"])
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let cmd_shift_t = Shortcut::new(
                            Some(Modifiers::SUPER | Modifiers::SHIFT),
                            Code::KeyT,
                        );
                        if shortcut == &cmd_shift_t {
                            toggle_window(app);
                        }
                        let opt_cmd_space = Shortcut::new(
                            Some(Modifiers::SUPER | Modifiers::ALT),
                            Code::Space,
                        );
                        if shortcut == &opt_cmd_space {
                            toggle_capture_strip(app);
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            // Logging in ALL builds — the shift-shift permission failure went
            // invisible for a day because release builds had no logger
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            // --- Register global shortcut: Cmd+Shift+T ---
            let cmd_shift_t = Shortcut::new(
                Some(Modifiers::SUPER | Modifiers::SHIFT),
                Code::KeyT,
            );
            app.global_shortcut().on_shortcut(cmd_shift_t, |_app, _shortcut, _event| {
                // Handled by the plugin-level handler above
            }).unwrap_or_else(|e| {
                log::warn!("Failed to register global shortcut: {}", e);
            });

            // --- Register global shortcut: Opt+Cmd+Space (quick-capture strip) ---
            let opt_cmd_space = Shortcut::new(
                Some(Modifiers::SUPER | Modifiers::ALT),
                Code::Space,
            );
            app.global_shortcut().on_shortcut(opt_cmd_space, |_app, _shortcut, _event| {
                // Handled by the plugin-level handler above
            }).unwrap_or_else(|e| {
                log::warn!("Failed to register capture shortcut: {}", e);
            });

            // --- Auto-launch on login ---
            // Always re-enable: rewrites the LaunchAgent so it tracks the
            // current bundle path even after the app is renamed or moved
            let autostart = app.autolaunch();
            let _ = autostart.enable();

            // --- System tray ---
            let show_item = MenuItemBuilder::with_id("show", "Show Nimble")
                .build(app)?;
            let capture_item = MenuItemBuilder::with_id("capture", "Quick Capture...")
                .build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit")
                .build(app)?;

            let tray_menu = MenuBuilder::new(app)
                .item(&show_item)
                .item(&capture_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let tray_icon = Image::from_path("icons/tray.png")
                .unwrap_or_else(|_| Image::from_bytes(include_bytes!("../icons/tray.png")).expect("failed to load tray icon"));

            TrayIconBuilder::new()
                .icon(tray_icon)
                // Template image: macOS recolors it to match the menu bar theme
                .icon_as_template(true)
                .menu(&tray_menu)
                .tooltip("Nimble")
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            show_window(app);
                        }
                        "capture" => {
                            summon_capture_strip(app);
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                        toggle_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // Initialize SQLite database
            let app_handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let app_dir = app_handle
                    .path()
                    .app_data_dir()
                    .expect("failed to get app data dir");
                std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");

                // Demo mode: a marker file switches the app to a throwaway
                // demo.db so real data never loads. See commands/demo.rs.
                let demo_mode = app_dir.join("demo-mode").exists();
                let db_path = if demo_mode {
                    app_dir.join("demo.db")
                } else {
                    let path = app_dir.join("nimble.db");
                    // The pre-rename app stored data in daily-triage.db. Adopt it
                    // once if nimble.db doesn't exist yet, so an update never
                    // boots against an empty database.
                    let legacy = app_dir.join("daily-triage.db");
                    if !path.exists() && legacy.exists() {
                        std::fs::copy(&legacy, &path)
                            .expect("failed to adopt legacy daily-triage.db");
                        log::info!("Adopted legacy database from {:?}", legacy);
                    }
                    path
                };
                let db_url = format!("sqlite:{}?mode=rwc", db_path.display());

                let pool = SqlitePoolOptions::new()
                    .max_connections(5)
                    .connect(&db_url)
                    .await
                    .expect("failed to connect to database");

                // Run migrations from core crate
                nimble_core::db::migrations::run_migrations(&pool)
                    .await
                    .expect("failed to run migrations");

                if demo_mode {
                    log::info!("DEMO MODE — database initialized at {:?}", db_path);
                } else {
                    log::info!("Database initialized at {:?}", db_path);
                }

                // Store pool in app state
                app_handle.manage(pool);
            });

            // --- Obsidian vault: launch scan, then debounced watch ---
            app.manage(crate::vault_runner::VaultWatchState(std::sync::Mutex::new(None)));
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    crate::vault_runner::start(&handle).await;
                });
            }

            // --- Background sync: 5-minute interval, min 60s apart ---
            // First tick fires immediately (tokio::time::interval semantics),
            // covering an on-launch sync without a separate code path.
            //
            // Both integrations run here. Turso is the device-to-device sync, so
            // leaving it out (as this loop did until 2026-08-15) meant local
            // changes reached the cloud only when someone pressed the button on
            // the Settings page, and remote changes never arrived at all.
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
                    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                    loop {
                        interval.tick().await; // first tick fires immediately → covers on-launch sync
                        crate::sync_runner::run_if_due_and_emit(&handle, 60).await;
                        crate::sync_runner::run_turso_sync_if_due(&handle, 60).await;
                    }
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                // Hide on close instead of quitting — tray icon keeps the app alive
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                // Capture strip dismisses when it loses focus (after a short
                // grace period — losing an activation race right at show time
                // must not close it)
                WindowEvent::Focused(false) if window.label() == "capture" => {
                    let recently_shown = STRIP_SHOWN_AT
                        .lock()
                        .unwrap()
                        .map(|t| t.elapsed() < std::time::Duration::from_millis(500))
                        .unwrap_or(false);
                    if !recently_shown && window.is_visible().unwrap_or(false) {
                        log::info!("capture strip blurred — dismissing");
                        dismiss_capture_strip_inner(&window.app_handle().clone());
                    }
                }
                // Window regaining focus is a good moment to catch up on both
                // syncs (e.g. changes made on mobile/web while this window was
                // backgrounded) — gated by the same min-interval as the
                // background loop so refocusing repeatedly can't spam the API.
                //
                // For the web client this is the trigger that matters most: it is
                // how a task captured on the phone shows up within seconds of
                // coming back to the Mac, rather than on the next 5-minute tick.
                WindowEvent::Focused(true) => {
                    let app = window.app_handle().clone();
                    tauri::async_runtime::spawn(async move {
                        crate::sync_runner::run_if_due_and_emit(&app, 60).await;
                        crate::sync_runner::run_turso_sync_if_due(&app, 60).await;
                    });
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            dismiss_capture_strip,
            settings::check_setup_complete,
            settings::get_setting,
            settings::set_setting,
            settings::get_all_settings,
            settings::clear_all_settings,
            obsidian::read_today_md,
            obsidian::toggle_obsidian_checkbox,
            todoist::preview_todoist_migration,
            todoist::migrate_todoist,
            todoist::migrated_todoist_ids,
            todoist_sync::todoist_sync_now,
            todoist_sync::get_todoist_sync_status,
            todoist_sync::set_todoist_sync_enabled,
            calendar::fetch_calendar_events,
            calendar::get_cached_calendar_events,
            calendar::get_calendar_feeds,
            calendar::add_calendar_feed,
            calendar::remove_calendar_feed,
            obsidian::read_daily_brief,
            obsidian::list_brief_dates,
            obsidian::read_quick_captures,
            obsidian::write_quick_capture,
            obsidian::read_session_log,
            progress::save_progress,
            updater::check_for_updates,
            open_url::open_url,
            priorities::get_daily_state,
            priorities::generate_priorities,
            projects::get_projects,
            projects::create_project,
            projects::update_project,
            projects::delete_project,
            sections::list_sections,
            sections::create_section,
            sections::rename_section,
            sections::delete_section,
            sections::reorder_sections,
            local_tasks::get_local_tasks,
            local_tasks::create_local_task,
            local_tasks::update_local_task,
            local_tasks::complete_local_task,
            local_tasks::uncomplete_local_task,
            local_tasks::delete_local_task,
            local_tasks::update_task_status,
            local_tasks::reorder_local_tasks,
            local_tasks::preview_tasks_markdown_migration,
            local_tasks::migrate_tasks_to_markdown,
            labels::list_labels,
            labels::create_label,
            labels::update_label,
            labels::delete_label,
            labels::set_task_labels,
            activity::log_activity,
            activity::get_activity_log,
            activity::get_activity_summary,
            ai::break_down_task,
            docs::get_doc_folders,
            docs::create_doc_folder,
            docs::rename_doc_folder,
            docs::delete_doc_folder,
            docs::get_documents,
            docs::get_document,
            docs::create_document,
            docs::update_document,
            docs::delete_document,
            docs::search_documents,
            docs::get_doc_notes,
            docs::create_doc_note,
            docs::delete_doc_note,
            docs::reorder_doc_notes,
            docs::preview_docs_markdown_migration,
            docs::migrate_docs_to_markdown,
            vault::vault_status,
            vault::vault_rescan,
            vault::vault_list_notes,
            vault::vault_get_note,
            vault::vault_search,
            vault::vault_backlinks,
            vault::vault_resolve_link,
            vault::vault_save_note,
            vault::vault_create_note,
            vault::vault_open_in_obsidian,
            captures::get_captures,
            captures::create_capture,
            captures::convert_capture_to_task,
            captures::delete_capture,
            captures::import_obsidian_captures,
            capture_routes::get_capture_routes,
            capture_routes::create_capture_route,
            capture_routes::update_capture_route,
            capture_routes::delete_capture_route,
            capture_routes::route_capture,
            focus::start_focus_session,
            focus::end_focus_session,
            focus::get_active_focus,
            goals::get_goals,
            goals::get_goal,
            goals::create_goal,
            goals::update_goal,
            goals::delete_goal,
            goals::get_milestones,
            goals::create_milestone,
            goals::update_milestone,
            goals::delete_milestone,
            goals::get_life_areas,
            goals::create_life_area,
            goals::update_life_area,
            goals::delete_life_area,
            habits::get_habits,
            habits::create_habit,
            habits::update_habit,
            habits::delete_habit,
            habits::log_habit,
            habits::unlog_habit,
            habits::get_habit_logs,
            habits::get_habit_heatmap,
            import::import_goals_from_vault,
            sync::sync_push,
            sync::sync_pull,
            sync::sync_get_status,
            sync::sync_configure,
            sync::sync_test_connection,
            sync::sync_initialize_remote,
            sync::sync_seed_existing,
            demo::demo_status,
            demo::demo_toggle,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
