use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Marker file that switches startup to the demo database. See lib.rs.
const MARKER: &str = "demo-mode";

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn remove_demo_db(dir: &std::path::Path) -> Result<(), String> {
    for suffix in ["", "-wal", "-shm"] {
        let path = dir.join(format!("demo.db{suffix}"));
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn demo_status(app: AppHandle) -> Result<bool, String> {
    Ok(app_data_dir(&app)?.join(MARKER).exists())
}

#[tauri::command]
pub async fn demo_toggle(app: AppHandle, on: bool) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    let marker = dir.join(MARKER);

    if marker.exists() == on {
        return Ok(());
    }

    if on {
        // Fresh slate every entry: clear any leftover demo db before switching.
        remove_demo_db(&dir)?;
        std::fs::write(&marker, b"").map_err(|e| e.to_string())?;
    } else {
        std::fs::remove_file(&marker).map_err(|e| e.to_string())?;
        // Unlinking the open db file is safe on macOS; handles close at exit.
        remove_demo_db(&dir)?;
    }

    // Restart after the invoke resolves so the frontend can show feedback.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(400));
        app.restart();
    });

    Ok(())
}
