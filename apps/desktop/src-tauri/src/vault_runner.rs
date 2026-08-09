use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager};

use nimble_core::vault::{self, scanner, watcher::VaultWatcher};

/// Holds the live watcher so it isn't dropped (dropping stops the watch).
pub struct VaultWatchState(pub std::sync::Mutex<Option<VaultWatcher>>);

/// Full scan on launch, then start the debounced watcher. Both steps are
/// best-effort: an unconfigured or missing vault leaves the app fully working.
pub async fn start(app: &AppHandle) {
    let pool = app.state::<SqlitePool>();

    match vault::scan_now(pool.inner()).await {
        Ok(Some(report)) => {
            log::info!(
                "vault scan: {} scanned, {} indexed, {} unchanged, {} removed, {} skipped",
                report.scanned, report.indexed, report.unchanged, report.removed, report.skipped
            );
            if report.indexed > 0 || report.removed > 0 {
                let _ = app.emit("vault-changed", ());
            }
        }
        Ok(None) => log::info!("vault scan skipped — no vault path configured"),
        Err(e) => log::warn!("vault scan failed (watch still starts if possible): {e}"),
    }

    let Ok(Some(cfg)) = vault::load_config(pool.inner()).await else { return };
    if !cfg.root.is_dir() {
        log::warn!("vault watch not started — {} is not a directory", cfg.root.display());
        return;
    }

    let handle = app.clone();
    let watch_cfg = cfg.clone();
    let spawned = nimble_core::vault::watcher::spawn(&cfg.root, move |paths| {
        let handle = handle.clone();
        let cfg = watch_cfg.clone();
        tauri::async_runtime::spawn(async move {
            let pool = handle.state::<SqlitePool>();
            let mut changed = false;
            for path in paths {
                match scanner::index_one(pool.inner(), &cfg, &path).await {
                    Ok(true) => changed = true,
                    Ok(false) => {}
                    Err(e) => log::warn!("vault watch: index of {} failed: {e}", path.display()),
                }
            }
            if changed {
                let _ = handle.emit("vault-changed", ());
            }
        });
    });

    match spawned {
        Ok(w) => {
            log::info!("vault watcher started on {}", cfg.root.display());
            if let Some(state) = app.try_state::<VaultWatchState>() {
                *state.0.lock().unwrap() = Some(w);
            }
        }
        Err(e) => log::warn!("vault watcher failed to start: {e}"),
    }
}
