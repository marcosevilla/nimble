use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Debounce window: Obsidian writes a note as several rapid filesystem events;
/// 500ms coalesces them into one re-index.
const DEBOUNCE: Duration = Duration::from_millis(500);

/// Live filesystem watch over the vault root. **Must be held** for the watch to
/// stay active — dropping this struct stops the watcher.
pub struct VaultWatcher {
    _debouncer: Debouncer<RecommendedWatcher, RecommendedCache>,
}

/// Start watching `root` recursively. `on_paths` is invoked on a dedicated
/// background thread with the de-duplicated set of changed paths from each
/// debounced batch. Watch errors are logged and the watcher keeps running —
/// a transient error must not silently kill indexing.
pub fn spawn<F>(root: &Path, on_paths: F) -> notify::Result<VaultWatcher>
where
    F: Fn(Vec<PathBuf>) + Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::channel::<DebounceEventResult>();
    let mut debouncer = new_debouncer(DEBOUNCE, None, tx)?;
    debouncer.watch(root, RecursiveMode::Recursive)?;

    std::thread::spawn(move || {
        for result in rx {
            match result {
                Ok(events) => {
                    let mut paths: Vec<PathBuf> = Vec::new();
                    for event in events {
                        for path in &event.paths {
                            if !paths.contains(path) {
                                paths.push(path.clone());
                            }
                        }
                    }
                    if !paths.is_empty() {
                        on_paths(paths);
                    }
                }
                Err(errors) => {
                    for e in errors {
                        log::warn!("vault watcher error (watch continues): {e}");
                    }
                }
            }
        }
        log::info!("vault watcher channel closed — watch thread exiting");
    });

    Ok(VaultWatcher { _debouncer: debouncer })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn watcher_reports_changed_paths_within_the_debounce_window() {
        let root = std::env::temp_dir().join(format!("dt-vaultwatch-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();

        let seen: Arc<Mutex<Vec<PathBuf>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        let _watcher = spawn(&root, move |paths| {
            sink.lock().unwrap().extend(paths);
        })
        .expect("watcher spawns");

        std::thread::sleep(std::time::Duration::from_millis(200));
        std::fs::write(root.join("Note.md"), "# hello").unwrap();

        // Debounce is 500ms; allow generous slack for CI/filesystem latency.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            let hit = seen
                .lock()
                .unwrap()
                .iter()
                .any(|p| p.file_name().map(|n| n == "Note.md").unwrap_or(false));
            if hit {
                break;
            }
            assert!(std::time::Instant::now() < deadline, "watcher never reported Note.md");
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        std::fs::remove_dir_all(&root).ok();
    }
}
