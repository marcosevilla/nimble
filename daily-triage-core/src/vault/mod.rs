use sqlx::SqlitePool;
use std::path::{Path, PathBuf};

pub mod index;
pub mod parser;
pub mod scanner;
pub mod watcher;
pub mod writer;

/// Directories skipped by default. Matched against any path segment, so
/// `.obsidian` is excluded wherever it appears in the tree.
pub const DEFAULT_EXCLUDES: [&str; 3] = [".obsidian/", ".trash/", "templates/"];

#[derive(Debug, Clone)]
pub struct VaultConfig {
    /// Absolute, tilde-expanded vault root.
    pub root: PathBuf,
    /// Raw exclude entries as configured (trailing slashes tolerated).
    pub excludes: Vec<String>,
}

/// Read the vault configuration from settings. Returns `Ok(None)` when
/// `obsidian_vault_path` is unset — an unconfigured vault is a normal state,
/// not an error, and every caller degrades to a no-op.
pub async fn load_config(pool: &SqlitePool) -> crate::Result<Option<VaultConfig>> {
    let Some(raw_path) = crate::db::settings::get_setting(pool, "obsidian_vault_path").await? else {
        return Ok(None);
    };
    if raw_path.trim().is_empty() {
        return Ok(None);
    }

    let expanded = if let Some(stripped) = raw_path.strip_prefix('~') {
        let home = dirs::home_dir()
            .ok_or_else(|| crate::Error::Other("Cannot determine home directory".into()))?;
        home.join(stripped.trim_start_matches('/'))
    } else {
        PathBuf::from(&raw_path)
    };

    let excludes = match crate::db::settings::get_setting(pool, "vault_exclude_globs").await? {
        Some(json) => serde_json::from_str::<Vec<String>>(&json)
            .unwrap_or_else(|_| DEFAULT_EXCLUDES.iter().map(|s| s.to_string()).collect()),
        None => DEFAULT_EXCLUDES.iter().map(|s| s.to_string()).collect(),
    };

    Ok(Some(VaultConfig { root: expanded, excludes }))
}

/// True when any exclude entry matches the whole relative path or one of its
/// path segments. Deliberately segment matching, not glob matching: it covers
/// every real case (`.obsidian/`, `templates/`) without a glob dependency, and
/// never accidentally matches a note whose *name* contains the word.
pub fn is_excluded(rel_path: &str, excludes: &[String]) -> bool {
    for raw in excludes {
        let ex = raw.trim_end_matches('/');
        if ex.is_empty() {
            continue;
        }
        if rel_path == ex {
            return true;
        }
        if rel_path.split('/').any(|segment| segment == ex) {
            return true;
        }
    }
    false
}

/// Only markdown files are indexed; everything else (attachments, binaries,
/// `.canvas`, images) is ignored outright.
pub fn is_indexable(rel_path: &str, excludes: &[String]) -> bool {
    if is_excluded(rel_path, excludes) {
        return false;
    }
    Path::new(rel_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("md"))
        .unwrap_or(false)
}

/// Vault-relative, forward-slashed path for an absolute file path. Returns
/// `None` when the path escapes the vault root — synced rows must never carry
/// an absolute path.
pub fn rel_path(root: &Path, abs: &Path) -> Option<String> {
    let rel = abs.strip_prefix(root).ok()?;
    let s = rel.to_string_lossy().replace('\\', "/");
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

#[cfg(test)]
mod config_tests {
    use super::*;
    use crate::test_util::test_pool;

    #[test]
    fn excludes_match_directory_segments_at_any_depth() {
        let ex: Vec<String> = DEFAULT_EXCLUDES.iter().map(|s| s.to_string()).collect();
        assert!(is_excluded(".obsidian/workspace.json", &ex));
        assert!(is_excluded("journal/.obsidian/cache", &ex));
        assert!(is_excluded("templates/Daily.md", &ex));
        assert!(!is_excluded("journal/briefs/Brief 2026-08-04.md", &ex));
        assert!(!is_excluded("my templates note.md", &ex));
    }

    #[test]
    fn only_markdown_files_are_indexable() {
        let ex: Vec<String> = DEFAULT_EXCLUDES.iter().map(|s| s.to_string()).collect();
        assert!(is_indexable("inbox/Quick Captures.md", &ex));
        assert!(!is_indexable("attachments/photo.png", &ex));
        assert!(!is_indexable("notes/archive.MD.zip", &ex));
        assert!(!is_indexable("templates/Daily.md", &ex));
    }

    #[test]
    fn rel_path_is_forward_slashed_and_rejects_outside_paths() {
        let root = std::path::Path::new("/Users/marco/Obsidian/marcowits");
        assert_eq!(
            rel_path(root, std::path::Path::new("/Users/marco/Obsidian/marcowits/journal/a.md")).as_deref(),
            Some("journal/a.md")
        );
        assert_eq!(rel_path(root, std::path::Path::new("/etc/passwd")), None);
    }

    #[tokio::test]
    async fn load_config_expands_tilde_and_defaults_excludes() {
        let pool = test_pool().await;
        assert!(load_config(&pool).await.unwrap().is_none(), "unset vault path yields None");

        crate::db::settings::set_setting(&pool, "obsidian_vault_path", "~/Obsidian/marcowits")
            .await
            .unwrap();
        let cfg = load_config(&pool).await.unwrap().expect("config");
        assert!(cfg.root.is_absolute(), "~ must be expanded: {:?}", cfg.root);
        assert!(!cfg.root.to_string_lossy().contains('~'));
        assert_eq!(cfg.excludes.len(), DEFAULT_EXCLUDES.len());

        crate::db::settings::set_setting(&pool, "vault_exclude_globs", r#"["archive","x/"]"#)
            .await
            .unwrap();
        let cfg = load_config(&pool).await.unwrap().expect("config");
        assert_eq!(cfg.excludes, vec!["archive".to_string(), "x/".to_string()]);
    }
}
