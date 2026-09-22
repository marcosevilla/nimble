//! Device-local backup progress. Never included in SQLite snapshots or Git.
use nimble_core::{Error, Result};
use serde::{Deserialize, Serialize};
use std::os::unix::fs::OpenOptionsExt;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RemoteConfig {
    pub owner_repo: String,
    pub repository_id: String,
    pub root: PathBuf,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct BackupState {
    pub last_local_success_at: Option<String>,
    pub last_local_slot: Option<String>,
    pub generation_id: Option<String>,
    pub export_commit: Option<String>,
    pub pushed_commit: Option<String>,
    pub last_push_at: Option<String>,
    pub next_publish_attempt_at: Option<String>,
    pub publish_failures: u32,
    pub next_local_attempt_at: Option<String>,
    pub pending_generation_id: Option<String>,
    pub cleanup_generation_id: Option<String>,
    pub remote: Option<RemoteConfig>,
    pub stage_error: Option<StageError>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StageError {
    pub stage: String,
    pub code: String,
    pub at: String,
}

pub fn load_state(app_data: &Path) -> Result<BackupState> {
    let path = app_data.join("backup-state.json");
    if !path.try_exists().map_err(|_| error("state_read_failed"))? {
        return Ok(BackupState::default());
    }
    plain_file(&path)?;
    let bytes = fs::read(path).map_err(|_| error("state_read_failed"))?;
    serde_json::from_slice(&bytes).map_err(|_| error("state_corrupt_reconciliation_required"))
}
pub fn save_state(app_data: &Path, state: &BackupState) -> Result<()> {
    let bytes = serde_json::to_vec(state).map_err(|_| error("state_encode_failed"))?;
    atomic_private_write(&app_data.join("backup-state.json"), &bytes)
}
pub(crate) fn error(code: &str) -> Error {
    Error::Other(code.into())
}
pub(crate) fn plain_file(path: &Path) -> Result<()> {
    let meta = fs::symlink_metadata(path).map_err(|_| error("file_unavailable"))?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err(error("unsafe_file"));
    }
    Ok(())
}
pub(crate) fn atomic_private_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or_else(|| error("invalid_state_path"))?;
    if fs::symlink_metadata(parent)
        .map_err(|_| error("state_directory_unavailable"))?
        .file_type()
        .is_symlink()
    {
        return Err(error("unsafe_state_directory"));
    }
    if path.symlink_metadata().is_ok() {
        plain_file(path)?;
    }
    let temp = parent.join(format!(".nimble-write-{}", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temp)
            .map_err(|_| error("state_write_failed"))?;
        file.write_all(bytes)
            .map_err(|_| error("state_write_failed"))?;
        file.sync_all().map_err(|_| error("state_flush_failed"))?;
        fs::rename(&temp, path).map_err(|_| error("state_publish_failed"))?;
        fs::File::open(parent)
            .and_then(|f| f.sync_all())
            .map_err(|_| error("state_flush_failed"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    #[test]
    fn backup_state_atomic_private_and_corruption_fails_closed() {
        let root = std::env::temp_dir().join(format!("nimble-state-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        assert!(load_state(&root).unwrap().remote.is_none());
        let mut state = BackupState::default();
        state.generation_id = Some("first".into());
        save_state(&root, &state).unwrap();
        state.generation_id = Some("second".into());
        save_state(&root, &state).unwrap();
        assert_eq!(
            load_state(&root).unwrap().generation_id.as_deref(),
            Some("second")
        );
        assert_eq!(
            fs::metadata(root.join("backup-state.json"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::write(root.join("backup-state.json"), "broken").unwrap();
        assert!(load_state(&root).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn backup_state_rejects_symlink() {
        let root = std::env::temp_dir().join(format!("nimble-state-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        fs::write(root.join("target"), "{}").unwrap();
        std::os::unix::fs::symlink(root.join("target"), root.join("backup-state.json")).unwrap();
        assert!(save_state(&root, &BackupState::default()).is_err());
        assert!(load_state(&root).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
