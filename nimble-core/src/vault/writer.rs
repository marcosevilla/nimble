use std::path::{Path, PathBuf};

use crate::vault::scanner::hash_content;
use crate::vault::{is_indexable, VaultConfig};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WriteOutcome {
    /// The file was replaced atomically; `hash` is the new content hash and
    /// becomes the caller's next `expected_hash`.
    Written { hash: String },
    /// The file on disk changed since the app read it. The app's version was
    /// written beside it as `conflict_path` (vault-relative) and the original
    /// was left exactly as-is.
    Conflict { conflict_path: String, disk_hash: String },
}

/// Resolve a vault-relative path to an absolute one, refusing anything that
/// escapes the vault root or isn't an indexable markdown file.
fn resolve(cfg: &VaultConfig, rel: &str) -> crate::Result<PathBuf> {
    if rel.trim().is_empty() {
        return Err(crate::Error::Other("Empty note path".into()));
    }
    if rel.split('/').any(|seg| seg == ".." || seg == ".") || rel.starts_with('/') {
        return Err(crate::Error::Other(format!("Unsafe note path: {rel}")));
    }
    if !is_indexable(rel, &cfg.excludes) {
        return Err(crate::Error::Other(format!(
            "Not an editable vault note (markdown only, not excluded): {rel}"
        )));
    }
    Ok(cfg.root.join(rel))
}

/// Hash of whatever is currently on disk.
///
/// `Ok(None)` means the file genuinely does not exist — safe to create.
/// `Err` means it exists but could not be read: an iCloud-evicted (dataless)
/// note, a permissions problem, or non-UTF-8 content. That case must never
/// collapse into `None`: the caller's divergence check would not fire and it
/// would overwrite a note whose contents we were unable to compare.
async fn read_disk_hash(abs: &Path) -> crate::Result<Option<String>> {
    match tokio::fs::read_to_string(abs).await {
        Ok(c) => Ok(Some(hash_content(&c))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(crate::Error::Other(format!(
            "Can't read {} to check for outside edits ({e}) — refusing to overwrite it.",
            abs.display()
        ))),
    }
}

/// Write `content` to a vault note, atomically (temp file + rename) and only
/// when the file on disk still matches `expected_hash`.
///
/// Divergence never overwrites: the app's version lands in
/// `<stem> (conflict <timestamp>).md` beside the original and the caller
/// surfaces a non-blocking banner. The watcher then re-indexes both files.
///
/// `expected_hash: None` means "this file does not exist yet". It is **not** a
/// force flag: if the file is on disk, the write is refused rather than
/// clobbering a note whose version we cannot prove we started from.
pub async fn write_note(
    cfg: &VaultConfig,
    rel: &str,
    content: &str,
    expected_hash: Option<&str>,
) -> crate::Result<WriteOutcome> {
    let abs = resolve(cfg, rel)?;
    let disk_hash = read_disk_hash(&abs).await?;

    if disk_hash.is_some() && expected_hash.is_none() {
        // Latent today — every indexed row carries a hash — but a
        // mobile-originated or replayed write reaching here with no hash must
        // not become an unconditional overwrite of one of Marco's notes.
        return Err(crate::Error::Other(format!(
            "Refusing to overwrite {rel}: no expected hash, so there is nothing to \
             compare against what's on disk. A hash-less write is only valid when creating a \
             note that doesn't exist yet."
        )));
    }

    if let (Some(expected), Some(actual)) = (expected_hash, disk_hash.as_deref()) {
        if expected != actual {
            // The conflict copy is created exclusively and its name is
            // disambiguated on collision: the timestamp has one-second
            // resolution, and a plain rename would silently destroy an earlier
            // conflict copy — the file holding the user's other unsaved version.
            let stem = rel.trim_end_matches(".md");
            let stamp = chrono::Local::now().format("%Y-%m-%d %H%M%S").to_string();
            let mut attempt = 1;
            let conflict_rel = loop {
                let candidate = if attempt == 1 {
                    format!("{stem} (conflict {stamp}).md")
                } else {
                    format!("{stem} (conflict {stamp} {attempt}).md")
                };
                match write_new(&cfg.root.join(&candidate), content).await {
                    Ok(()) => break candidate,
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                        attempt += 1;
                        if attempt > 50 {
                            return Err(crate::Error::Other(format!(
                                "Too many conflict copies of {rel} in the same second"
                            )));
                        }
                    }
                    Err(e) => return Err(e.into()),
                }
            };
            log::warn!("vault write conflict on {rel} — app copy saved as {conflict_rel}");
            return Ok(WriteOutcome::Conflict {
                conflict_path: conflict_rel,
                disk_hash: actual.to_string(),
            });
        }
    }

    atomic_write(&abs, content).await?;
    Ok(WriteOutcome::Written { hash: hash_content(content) })
}

/// Create a new note, making parent directories as needed. Errors if the file
/// already exists — creation never clobbers.
pub async fn create_note(cfg: &VaultConfig, rel: &str, content: &str) -> crate::Result<String> {
    let abs = resolve(cfg, rel)?;
    match write_new(&abs, content).await {
        Ok(()) => Ok(hash_content(content)),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            Err(crate::Error::Other(format!("Note already exists: {rel}")))
        }
        Err(e) => Err(e.into()),
    }
}

/// Write via a temp file in the same directory followed by a rename, so a
/// crash mid-write can never leave a half-written note on disk.
async fn atomic_write(abs: &Path, content: &str) -> crate::Result<()> {
    let parent = abs
        .parent()
        .ok_or_else(|| crate::Error::Other(format!("No parent directory for {}", abs.display())))?;
    tokio::fs::create_dir_all(parent).await?;

    let file_name = abs
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "note.md".to_string());
    let tmp = parent.join(format!(".{file_name}.tmp-{}", uuid::Uuid::new_v4()));

    if let Err(e) = tokio::fs::write(&tmp, content).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(e.into());
    }
    if let Err(e) = tokio::fs::rename(&tmp, abs).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(e.into());
    }
    Ok(())
}

/// Create a file that must not already exist, failing with
/// `ErrorKind::AlreadyExists` if it does. Exclusive creation is atomic in the
/// filesystem, unlike an `exists()` check followed by a write — which loses to
/// anything that creates the file in between (Obsidian, a sync daemon).
async fn write_new(abs: &Path, content: &str) -> std::io::Result<()> {
    use tokio::io::AsyncWriteExt;
    if let Some(parent) = abs.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(abs)
        .await?;
    file.write_all(content.as_bytes()).await?;
    file.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::scanner::hash_content;
    use crate::vault::VaultConfig;

    fn temp_vault() -> VaultConfig {
        let root = std::env::temp_dir().join(format!("dt-vaultw-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        VaultConfig {
            root,
            excludes: crate::vault::DEFAULT_EXCLUDES.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[tokio::test]
    async fn matching_hash_writes_in_place_and_leaves_no_temp_files() {
        let cfg = temp_vault();
        let path = cfg.root.join("A.md");
        std::fs::write(&path, "old body").unwrap();
        let expected = hash_content("old body");

        let outcome = write_note(&cfg, "A.md", "new body", Some(&expected)).await.unwrap();
        match outcome {
            WriteOutcome::Written { hash } => assert_eq!(hash, hash_content("new body")),
            other => panic!("expected Written, got {other:?}"),
        }
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new body");

        let leftovers: Vec<_> = std::fs::read_dir(&cfg.root)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.contains(".tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "temp files left behind: {leftovers:?}");

        std::fs::remove_dir_all(&cfg.root).ok();
    }

    #[tokio::test]
    async fn diverged_hash_writes_conflict_copy_and_never_overwrites() {
        let cfg = temp_vault();
        let path = cfg.root.join("A.md");
        std::fs::write(&path, "changed on disk by obsidian").unwrap();
        let stale = hash_content("what the app last read");

        let outcome = write_note(&cfg, "A.md", "app version", Some(&stale)).await.unwrap();
        let conflict_path = match outcome {
            WriteOutcome::Conflict { conflict_path, .. } => conflict_path,
            other => panic!("expected Conflict, got {other:?}"),
        };

        // Original file is untouched — this is the whole point.
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "changed on disk by obsidian"
        );
        let conflict_abs = cfg.root.join(&conflict_path);
        assert_eq!(std::fs::read_to_string(&conflict_abs).unwrap(), "app version");
        assert!(conflict_path.contains("(conflict "), "got {conflict_path}");
        assert!(conflict_path.ends_with(".md"));

        std::fs::remove_dir_all(&cfg.root).ok();
    }

    #[tokio::test]
    async fn no_expected_hash_refuses_to_overwrite_an_existing_file() {
        let cfg = temp_vault();
        std::fs::write(cfg.root.join("A.md"), "old").unwrap();

        // A caller with no expected hash cannot prove which version it edited,
        // so an existing note must be left exactly as it is.
        let err = write_note(&cfg, "A.md", "forced", None).await.unwrap_err();
        assert!(err.to_string().contains("Refusing to overwrite"), "got: {err}");
        assert_eq!(std::fs::read_to_string(cfg.root.join("A.md")).unwrap(), "old");

        // The None path stays valid for genuine creation — nothing on disk.
        let outcome = write_note(&cfg, "New.md", "fresh", None).await.unwrap();
        assert!(matches!(outcome, WriteOutcome::Written { .. }));
        assert_eq!(std::fs::read_to_string(cfg.root.join("New.md")).unwrap(), "fresh");

        std::fs::remove_dir_all(&cfg.root).ok();
    }

    #[tokio::test]
    async fn create_note_makes_parent_dirs_and_refuses_duplicates_and_escapes() {
        let cfg = temp_vault();
        let hash = create_note(&cfg, "journal/new/Note.md", "# Note\n").await.unwrap();
        assert_eq!(hash, hash_content("# Note\n"));
        assert!(cfg.root.join("journal/new/Note.md").exists());

        assert!(create_note(&cfg, "journal/new/Note.md", "x").await.is_err(), "no clobber");
        assert!(create_note(&cfg, "../escape.md", "x").await.is_err(), "no path escape");
        assert!(create_note(&cfg, "notes/thing.txt", "x").await.is_err(), "markdown only");

        std::fs::remove_dir_all(&cfg.root).ok();
    }

    #[tokio::test]
    async fn unreadable_file_is_never_overwritten() {
        let cfg = temp_vault();
        let path = cfg.root.join("A.md");
        let original: [u8; 3] = [0xff, 0xfe, 0xfd];
        std::fs::write(&path, original).unwrap();

        let err = write_note(&cfg, "A.md", "app version", Some("some-stale-hash"))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("refusing to overwrite"), "got: {err}");
        assert_eq!(std::fs::read(&path).unwrap(), original);

        assert!(write_note(&cfg, "A.md", "app version", None).await.is_err());
        assert_eq!(std::fs::read(&path).unwrap(), original);

        std::fs::remove_dir_all(&cfg.root).ok();
    }

    #[tokio::test]
    async fn same_second_conflicts_do_not_destroy_each_other() {
        let cfg = temp_vault();
        let path = cfg.root.join("A.md");
        std::fs::write(&path, "on disk").unwrap();
        let stale = hash_content("what the app last read");

        let first = write_note(&cfg, "A.md", "first app version", Some(&stale)).await.unwrap();
        let second = write_note(&cfg, "A.md", "second app version", Some(&stale)).await.unwrap();

        let (p1, p2) = match (first, second) {
            (WriteOutcome::Conflict { conflict_path: a, .. }, WriteOutcome::Conflict { conflict_path: b, .. }) => (a, b),
            other => panic!("expected two conflicts, got {other:?}"),
        };
        assert_ne!(p1, p2, "second conflict must not reuse the first filename");
        assert_eq!(std::fs::read_to_string(cfg.root.join(&p1)).unwrap(), "first app version");
        assert_eq!(std::fs::read_to_string(cfg.root.join(&p2)).unwrap(), "second app version");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "on disk");

        std::fs::remove_dir_all(&cfg.root).ok();
    }
}
