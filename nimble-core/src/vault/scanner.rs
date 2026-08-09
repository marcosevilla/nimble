use sqlx::SqlitePool;
use std::path::Path;
use walkdir::WalkDir;

use crate::vault::{index, is_indexable, rel_path, VaultConfig};

/// macOS `SF_DATALESS`: the file is an iCloud placeholder whose contents live
/// in the cloud. Reading it would trigger a download, so the scanner treats it
/// as pending and skips it rather than materialising Marco's whole vault.
const SF_DATALESS: u32 = 0x4000_0000;

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct ScanReport {
    /// Markdown files considered (after exclusions).
    pub scanned: usize,
    /// Files whose content changed and were (re-)indexed.
    pub indexed: usize,
    /// Files already indexed with identical content.
    pub unchanged: usize,
    /// Indexed notes whose file no longer exists — tombstoned.
    pub removed: usize,
    /// Files skipped this pass (unreadable, dataless, non-UTF-8).
    pub skipped: usize,
    /// Directory-level walk failures (permissions, a cloud unmount, EIO). Any
    /// of these means the walk did not see the whole vault, so its silence
    /// about a note proves nothing — the tombstone phase is skipped.
    pub walk_errors: usize,
}

pub fn hash_content(content: &str) -> String {
    blake3::hash(content.as_bytes()).to_hex().to_string()
}

/// True when the file is an iCloud placeholder with no local content.
pub fn is_dataless(path: &Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        use std::os::macos::fs::MetadataExt;
        if let Ok(md) = std::fs::metadata(path) {
            return md.st_flags() & SF_DATALESS != 0;
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
    }
    false
}

fn mtime_string(md: &std::fs::Metadata) -> Option<String> {
    md.modified()
        .ok()
        .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
}

/// Walk the whole vault and reconcile the index with the filesystem.
///
/// Cheap path: a file whose size *and* mtime match the index is not read at
/// all. Otherwise the file is read and hashed; only a changed hash triggers a
/// re-parse.
///
/// A file that cannot be stat'd or read is logged, counted in `skipped` and
/// passed over — one unreadable note must not break the scan. An *indexing*
/// failure is different: `upsert_note`/`touch_stat` propagate with `?`, so a
/// database or sync_log error aborts the whole scan. That is deliberate, and
/// safe: the early return happens before the tombstone phase, so an aborted
/// scan never deletes anything.
pub async fn full_scan(pool: &SqlitePool, cfg: &VaultConfig) -> crate::Result<ScanReport> {
    if !cfg.root.is_dir() {
        return Err(crate::Error::Other(format!(
            "Vault path is not a directory: {}",
            cfg.root.display()
        )));
    }

    let mut report = ScanReport::default();
    let known = index::indexed_files(pool).await?;
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for result in WalkDir::new(&cfg.root).follow_links(false) {
        // A directory that fails to enumerate yields none of its files. Dropping
        // that error silently would let the reconcile loop below conclude every
        // note under it is gone, so count it and let the tombstone guard see it.
        let entry = match result {
            Ok(e) => e,
            Err(e) => {
                log::warn!(
                    "vault scan: cannot walk {} — {e}",
                    e.path().map(|p| p.display().to_string()).unwrap_or_else(|| cfg.root.display().to_string())
                );
                report.walk_errors += 1;
                continue;
            }
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let abs = entry.path();
        let Some(rel) = rel_path(&cfg.root, abs) else { continue };
        if !is_indexable(&rel, &cfg.excludes) {
            continue;
        }
        report.scanned += 1;
        seen.insert(rel.clone());

        if is_dataless(abs) {
            log::info!("vault scan: skipping dataless (iCloud) file {rel}");
            report.skipped += 1;
            continue;
        }

        let md = match std::fs::metadata(abs) {
            Ok(md) => md,
            Err(e) => {
                log::warn!("vault scan: cannot stat {rel}: {e}");
                report.skipped += 1;
                continue;
            }
        };
        let size = md.len() as i64;
        let mtime = mtime_string(&md);

        if let Some(prev) = known.get(&rel) {
            if prev.size == size && prev.mtime == mtime {
                report.unchanged += 1;
                continue;
            }
        }

        let content = match tokio::fs::read_to_string(abs).await {
            Ok(c) => c,
            Err(e) => {
                log::warn!("vault scan: cannot read {rel}: {e}");
                report.skipped += 1;
                continue;
            }
        };
        let hash = hash_content(&content);

        if let Some(prev) = known.get(&rel) {
            if prev.hash == hash {
                // Touched but identical (e.g. an Obsidian save that rewrote the
                // same bytes). Refresh the stat columns so the next scan takes
                // the cheap path, and generate no sync traffic.
                index::touch_stat(pool, &rel, mtime.as_deref(), size).await?;
                report.unchanged += 1;
                continue;
            }
        }

        index::upsert_note(pool, &rel, &content, mtime.as_deref(), size, &hash).await?;
        report.indexed += 1;
    }

    // The tombstone phase argues from absence: a known path the walk never saw
    // must be gone. That argument only holds if the walk actually saw the whole
    // vault. Two conditions say it did not — a directory that failed to
    // enumerate, and a walk that found no markdown at all while the index holds
    // notes (a mistyped vault path pointing at a real-but-wrong directory).
    // Either would otherwise tombstone every indexed note in one pass and
    // replicate that to every device.
    let walk_is_trustworthy = report.walk_errors == 0 && !(report.scanned == 0 && !known.is_empty());

    if walk_is_trustworthy {
        for path in known.keys() {
            if !seen.contains(path) {
                index::soft_delete_note(pool, path).await?;
                report.removed += 1;
            }
        }
    } else {
        log::warn!(
            "vault scan: not removing anything this pass — {} walk error(s), {} file(s) seen, \
             {} note(s) already indexed. The walk can't prove a note is gone, so no tombstones.",
            report.walk_errors,
            report.scanned,
            known.len()
        );
    }

    Ok(report)
}

/// Index a single absolute path (used by the watcher). Returns `Ok(false)` when
/// the path is not an indexable vault file. A path that no longer exists is
/// tombstoned.
pub async fn index_one(pool: &SqlitePool, cfg: &VaultConfig, abs: &Path) -> crate::Result<bool> {
    let Some(rel) = rel_path(&cfg.root, abs) else { return Ok(false) };
    if !is_indexable(&rel, &cfg.excludes) {
        return Ok(false);
    }

    if !abs.exists() {
        index::soft_delete_note(pool, &rel).await?;
        return Ok(true);
    }
    if is_dataless(abs) {
        log::info!("vault watch: skipping dataless (iCloud) file {rel}");
        return Ok(false);
    }

    let md = std::fs::metadata(abs)?;
    let size = md.len() as i64;
    let mtime = mtime_string(&md);
    let content = match tokio::fs::read_to_string(abs).await {
        Ok(c) => c,
        Err(e) => {
            log::warn!("vault watch: cannot read {rel}: {e}");
            return Ok(false);
        }
    };
    let hash = hash_content(&content);

    if let Some(existing) = index::get_note_by_path(pool, &rel).await? {
        if existing.hash.as_deref() == Some(hash.as_str()) && existing.deleted_at.is_none() {
            index::touch_stat(pool, &rel, mtime.as_deref(), size).await?;
            return Ok(false);
        }
    }

    index::upsert_note(pool, &rel, &content, mtime.as_deref(), size, &hash).await?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::test_pool;
    use crate::vault::VaultConfig;

    fn temp_vault() -> (std::path::PathBuf, VaultConfig) {
        let root = std::env::temp_dir().join(format!("dt-vault-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("journal")).unwrap();
        std::fs::create_dir_all(root.join(".obsidian")).unwrap();
        std::fs::create_dir_all(root.join("attachments")).unwrap();
        let cfg = VaultConfig {
            root: root.clone(),
            excludes: crate::vault::DEFAULT_EXCLUDES.iter().map(|s| s.to_string()).collect(),
        };
        (root, cfg)
    }

    #[tokio::test]
    async fn scan_indexes_markdown_and_skips_excluded_and_binary() {
        let pool = test_pool().await;
        let (root, cfg) = temp_vault();
        std::fs::write(root.join("journal/Brief.md"), "# Brief\n\n[[Other]]\n").unwrap();
        std::fs::write(root.join("Root Note.md"), "plain body").unwrap();
        std::fs::write(root.join(".obsidian/workspace.json"), "{}").unwrap();
        std::fs::write(root.join("attachments/photo.png"), [0u8, 1, 2]).unwrap();

        let report = full_scan(&pool, &cfg).await.unwrap();
        assert_eq!(report.indexed, 2, "{report:?}");
        assert_eq!(report.removed, 0);

        let notes = crate::vault::index::list_notes(&pool).await.unwrap();
        let paths: Vec<&str> = notes.iter().map(|n| n.path.as_str()).collect();
        assert_eq!(paths, vec!["Root Note.md", "journal/Brief.md"]);

        std::fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn rescan_skips_unchanged_files_and_tombstones_deleted_ones() {
        let pool = test_pool().await;
        let (root, cfg) = temp_vault();
        std::fs::write(root.join("A.md"), "# A").unwrap();
        std::fs::write(root.join("B.md"), "# B").unwrap();
        full_scan(&pool, &cfg).await.unwrap();

        std::fs::remove_file(root.join("B.md")).unwrap();
        let report = full_scan(&pool, &cfg).await.unwrap();
        assert_eq!(report.unchanged, 1, "A.md untouched: {report:?}");
        assert_eq!(report.indexed, 0);
        assert_eq!(report.removed, 1);

        let live: Vec<String> = crate::vault::index::list_notes(&pool)
            .await
            .unwrap()
            .into_iter()
            .map(|n| n.path)
            .collect();
        assert_eq!(live, vec!["A.md".to_string()]);

        std::fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn changed_content_reindexes_and_keeps_note_id() {
        let pool = test_pool().await;
        let (root, cfg) = temp_vault();
        std::fs::write(root.join("A.md"), "# First").unwrap();
        full_scan(&pool, &cfg).await.unwrap();
        let before = crate::vault::index::get_note_by_path(&pool, "A.md").await.unwrap().unwrap();

        std::fs::write(root.join("A.md"), "# Second\n\nmore text").unwrap();
        let report = full_scan(&pool, &cfg).await.unwrap();
        assert_eq!(report.indexed, 1, "{report:?}");

        let after = crate::vault::index::get_note_by_path(&pool, "A.md").await.unwrap().unwrap();
        assert_eq!(after.id, before.id);
        assert_eq!(after.title, "Second");
        assert_ne!(after.hash, before.hash);

        std::fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn unreadable_file_is_skipped_not_fatal() {
        let pool = test_pool().await;
        let (root, cfg) = temp_vault();
        std::fs::write(root.join("Good.md"), "# Good").unwrap();
        // Invalid UTF-8 makes read_to_string fail — stands in for any per-file
        // read error (dataless iCloud file, permissions, race with a delete).
        std::fs::write(root.join("Bad.md"), [0xff, 0xfe, 0xfd]).unwrap();

        let report = full_scan(&pool, &cfg).await.unwrap();
        assert_eq!(report.indexed, 1);
        assert_eq!(report.skipped, 1, "{report:?}");

        std::fs::remove_dir_all(&root).ok();
    }

    /// A file rewritten with byte-identical content gets a new mtime, so the
    /// cheap stat pre-check misses and the file is read — but its hash still
    /// matches, which must take the `touch_stat` branch: no re-index, no sync
    /// traffic, just refreshed stat columns so the next scan is cheap again.
    #[tokio::test]
    async fn identical_rewrite_touches_stat_without_reindexing() {
        let pool = test_pool().await;
        let (root, cfg) = temp_vault();
        let path = root.join("A.md");
        std::fs::write(&path, "# A\n\nsame bytes\n").unwrap();

        let first = full_scan(&pool, &cfg).await.unwrap();
        assert_eq!(first.indexed, 1, "{first:?}");
        let before = crate::vault::index::get_note_by_path(&pool, "A.md")
            .await
            .unwrap()
            .unwrap();
        let log_before: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sync_log WHERE table_name = 'vault_notes'")
                .fetch_one(&pool)
                .await
                .unwrap();

        // Same bytes, deterministically different mtime — set explicitly rather
        // than relying on filesystem timestamp resolution.
        std::fs::write(&path, "# A\n\nsame bytes\n").unwrap();
        let f = std::fs::File::options().write(true).open(&path).unwrap();
        f.set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(30))
            .unwrap();
        drop(f);

        let second = full_scan(&pool, &cfg).await.unwrap();
        assert_eq!(second.unchanged, 1, "identical bytes must count as unchanged: {second:?}");
        assert_eq!(second.indexed, 0, "identical bytes must not re-index: {second:?}");
        assert_eq!(second.removed, 0);

        let after = crate::vault::index::get_note_by_path(&pool, "A.md")
            .await
            .unwrap()
            .unwrap();
        assert_ne!(after.mtime, before.mtime, "touch_stat must refresh the stat columns");
        assert_eq!(after.hash, before.hash);

        let log_after: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sync_log WHERE table_name = 'vault_notes'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(log_after, log_before, "a no-op edit must generate no sync traffic");

        std::fs::remove_dir_all(&root).ok();
    }

    /// A subtree that cannot be enumerated yields none of its files. Without a
    /// guard the reconcile loop reads that silence as "every note under it was
    /// deleted" and tombstones the lot — replicating the loss to every device.
    /// A mistyped vault path pointing at a real-but-wrong directory is the same
    /// failure with `scanned == 0`.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_walk_error_must_not_tombstone_the_vault() {
        use std::os::unix::fs::PermissionsExt;

        let pool = test_pool().await;
        let (root, cfg) = temp_vault();
        let locked = root.join("locked");
        std::fs::create_dir_all(&locked).unwrap();
        std::fs::write(locked.join("A.md"), "# A").unwrap();
        std::fs::write(locked.join("B.md"), "# B").unwrap();

        let first = full_scan(&pool, &cfg).await.unwrap();
        assert_eq!(first.indexed, 2, "{first:?}");

        // Make the subtree unenumerable.
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();

        // Guard against running as root (or any context where mode 0o000 is
        // still readable) — there the walk would succeed and the assertions
        // below would pass for the wrong reason. Same behavioural probe as
        // `cheap_path_precheck_skips_reading_stat_unchanged_files`.
        if std::fs::read_dir(&locked).is_ok() {
            std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
            std::fs::remove_dir_all(&root).ok();
            eprintln!(
                "a_walk_error_must_not_tombstone_the_vault: \
                 permissions are not enforced (likely running as root) — test is meaningless here, skipping"
            );
            return;
        }

        let second = full_scan(&pool, &cfg).await.unwrap();
        assert!(second.walk_errors > 0, "the failed subtree must be counted: {second:?}");
        assert_eq!(second.scanned, 0, "no file under the locked dir is visible: {second:?}");
        assert_eq!(
            second.removed, 0,
            "a walk that couldn't see the vault must tombstone nothing: {second:?}"
        );

        let live: Vec<String> = crate::vault::index::list_notes(&pool)
            .await
            .unwrap()
            .into_iter()
            .map(|n| n.path)
            .collect();
        assert_eq!(
            live,
            vec!["locked/A.md".to_string(), "locked/B.md".to_string()],
            "both notes must still be live"
        );

        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn hash_is_stable_and_content_sensitive() {
        assert_eq!(hash_content("abc"), hash_content("abc"));
        assert_ne!(hash_content("abc"), hash_content("abd"));
    }

    /// Pins the cheap-path invariant itself, not just its observable counts.
    /// `rescan_skips_unchanged_files_and_tombstones_deleted_ones` only proves
    /// the report says `unchanged`, which a broken pre-check could also
    /// produce (read the file anyway, hash-match, fall into the second
    /// `unchanged` branch). Here the file is made unreadable *without*
    /// touching its size or mtime, so a scan that still reports `unchanged`
    /// (and not `skipped`) proves the read was never attempted.
    #[cfg(unix)]
    #[tokio::test]
    async fn cheap_path_precheck_skips_reading_stat_unchanged_files() {
        use std::os::unix::fs::PermissionsExt;

        let pool = test_pool().await;
        let (root, cfg) = temp_vault();
        let path = root.join("Locked.md");
        std::fs::write(&path, "# Locked").unwrap();

        let report = full_scan(&pool, &cfg).await.unwrap();
        assert_eq!(report.indexed, 1, "{report:?}");

        // Revoke read permission without touching size/mtime.
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).unwrap();

        // Guard against running as root (or any context where mode 0o000 is
        // still readable, e.g. some CI containers) — there the read would
        // succeed regardless of the pre-check, and the assertions below would
        // pass for the wrong reason. libc::geteuid() would be the direct way
        // to check this, but libc is not a direct dependency of this crate,
        // so probe behaviorally instead.
        if std::fs::read_to_string(&path).is_ok() {
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
            std::fs::remove_dir_all(&root).ok();
            eprintln!(
                "cheap_path_precheck_skips_reading_stat_unchanged_files: \
                 permissions are not enforced (likely running as root) — test is meaningless here, skipping"
            );
            return;
        }

        let report = full_scan(&pool, &cfg).await.unwrap();
        assert_eq!(
            report.unchanged, 1,
            "cheap path must skip reading a stat-unchanged file, even if unreadable: {report:?}"
        );
        assert_eq!(
            report.skipped, 0,
            "a read attempt on the locked file would land here instead of unchanged: {report:?}"
        );

        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        std::fs::remove_dir_all(&root).ok();
    }
}
