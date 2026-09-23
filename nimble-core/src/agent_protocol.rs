//! Local, bounded agent protocol. No task data or credentials travel in invalidations.
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io,
    os::unix::{
        fs::{MetadataExt, OpenOptionsExt},
        io::AsRawFd,
    },
    path::{Path, PathBuf},
};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, BufReader};

pub const VERSION: u32 = 1;
pub const MAX_FRAME: usize = 65_536;
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Domain {
    Tasks,
    Projects,
    Sections,
    Labels,
    Captures,
    Activity,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum AgentOperation {
    Invalidate {
        domains: Vec<Domain>,
        ids: Vec<String>,
    },
    BackupStatus,
    BackupNow,
    BackupVerify,
    /// Explicit activation of a restored profile by the running owner app.
    RestoreActivate,
    SyncStatus,
    SyncNow,
    /// A task write the running app executes through its one FocusService.
    /// `command.command_id` is the retry identity: a caller whose previous
    /// attempt had an uncertain outcome must resend the identical command.
    NativeTask {
        command: crate::db::focus::engine::NativeTaskCommand,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentRequest {
    pub version: u32,
    pub request_id: String,
    pub profile_id: String,
    pub operation: AgentOperation,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentResponse {
    pub version: u32,
    pub request_id: String,
    pub ok: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
pub struct DataChanged {
    pub version: u32,
    pub domains: Vec<Domain>,
    pub ids: Vec<String>,
}
#[derive(Debug, Clone)]
pub struct AgentProfile {
    pub database: PathBuf,
    pub socket: PathBuf,
    pub profile_id: String,
    pub test_mode: bool,
}
fn denied() -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "Unsafe profile or local endpoint",
    )
}
pub fn effective_uid() -> u32 {
    unsafe { libc::geteuid() }
}
fn user_temp() -> io::Result<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let size =
            unsafe { libc::confstr(libc::_CS_DARWIN_USER_TEMP_DIR, std::ptr::null_mut(), 0) };
        if size == 0 {
            return Err(io::Error::last_os_error());
        }
        let mut buf = vec![0u8; size];
        unsafe {
            libc::confstr(
                libc::_CS_DARWIN_USER_TEMP_DIR,
                buf.as_mut_ptr().cast(),
                size,
            )
        };
        buf.pop();
        use std::os::unix::ffi::OsStringExt;
        return PathBuf::from(std::ffi::OsString::from_vec(buf)).canonicalize();
    }
    #[cfg(not(target_os = "macos"))]
    {
        PathBuf::from("/tmp").canonicalize()
    }
}
impl AgentProfile {
    pub fn from_database(database: &Path, test_mode: bool) -> io::Result<Self> {
        let meta = fs::symlink_metadata(database)?;
        if !meta.is_file() || meta.uid() != effective_uid() || meta.nlink() != 1 {
            return Err(denied());
        }
        let database = database.canonicalize()?;
        if test_mode {
            let root = database.parent().ok_or_else(denied)?;
            let temp = user_temp()?;
            let common_tmp = PathBuf::from("/tmp").canonicalize()?;
            if !(root.starts_with(&temp) || root.starts_with(&common_tmp))
                || root == temp
                || root == common_tmp
            {
                return Err(denied());
            }
            let marker = root.join("synthetic-profile");
            let m = fs::symlink_metadata(&marker)?;
            if !m.is_file()
                || m.uid() != effective_uid()
                || m.nlink() != 1
                || fs::read(&marker)? != b"nimble-synthetic-only\n"
            {
                return Err(denied());
            }
        }
        let profile_id = blake3::hash(database.as_os_str().as_encoded_bytes())
            .to_hex()
            .to_string();
        let parent = user_temp()?.join(format!("nimble-{}-{}", effective_uid(), &profile_id[..12]));
        let socket = parent.join("agent.sock");
        if socket.as_os_str().as_encoded_bytes().len() >= 104 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Local endpoint path too long",
            ));
        }
        Ok(Self {
            database,
            socket,
            profile_id,
            test_mode,
        })
    }
    pub fn ensure_socket_directory(&self) -> io::Result<()> {
        let parent = self.socket.parent().ok_or_else(denied)?;
        match fs::DirBuilder::new().mode(0o700).create(parent) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e),
        }
        let m = fs::symlink_metadata(parent)?;
        if !m.is_dir() || m.uid() != effective_uid() || m.mode() & 0o777 != 0o700 {
            return Err(denied());
        }
        Ok(())
    }
    pub fn validate_socket(&self) -> io::Result<()> {
        self.ensure_socket_directory()?;
        let m = fs::symlink_metadata(&self.socket)?;
        use std::os::unix::fs::FileTypeExt;
        if !m.file_type().is_socket() || m.uid() != effective_uid() || m.mode() & 0o777 != 0o600 {
            return Err(denied());
        }
        Ok(())
    }
}
use std::os::unix::fs::DirBuilderExt;
/// Process-wide migration exclusion shared by app startup and each CLI operation.
#[derive(Debug)]
pub struct SchemaLock(File);
impl SchemaLock {
    pub fn acquire(database: &Path, exclusive: bool) -> io::Result<Self> {
        Self::at(
            &database
                .parent()
                .ok_or_else(denied)?
                .join(".nimble-schema.lock"),
            exclusive,
        )
    }
    pub fn at(path: &Path, exclusive: bool) -> io::Result<Self> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(path)?;
        let m = file.metadata()?;
        if !m.is_file() || m.uid() != effective_uid() || m.nlink() != 1 || m.mode() & 0o777 != 0o600
        {
            return Err(denied());
        }
        let op = if exclusive {
            libc::LOCK_EX
        } else {
            libc::LOCK_SH
        };
        if unsafe { libc::flock(file.as_raw_fd(), op | libc::LOCK_NB) } != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(Self(file))
    }
}
impl Drop for SchemaLock {
    fn drop(&mut self) {
        unsafe {
            libc::flock(self.0.as_raw_fd(), libc::LOCK_UN);
        }
    }
}
/// Process/profile ownership: the running desktop app holds an exclusive,
/// non-blocking `flock` on `<profile>/.nimble-owner.lock` for its whole
/// lifetime (the kernel drops it on any exit, including a crash or force
/// quit). A second app process on the same profile cannot become a focus
/// writer, and `dt` treats a held lock as "the app owns this profile" even
/// when the app's local listener is unreachable, so it never writes
/// directly behind a running owner.
#[derive(Debug)]
pub struct ProfileOwnerLock(#[allow(dead_code)] SchemaLock);
impl ProfileOwnerLock {
    fn path(database: &Path) -> io::Result<PathBuf> {
        Ok(database.parent().ok_or_else(denied)?.join(".nimble-owner.lock"))
    }
    /// Take ownership; fails with `WouldBlock` while another process owns it.
    pub fn acquire(database: &Path) -> io::Result<Self> {
        SchemaLock::at(&Self::path(database)?, true).map(Self)
    }
    /// True while some process holds the owner lock for this profile.
    pub fn is_held(database: &Path) -> io::Result<bool> {
        let path = Self::path(database)?;
        if !path.exists() {
            return Ok(false);
        }
        match SchemaLock::at(&path, false) {
            Ok(_probe) => Ok(false),
            Err(e) if e.kind() == io::ErrorKind::WouldBlock => Ok(true),
            Err(e) => Err(e),
        }
    }
}
pub async fn read_frame<R: AsyncRead + Unpin>(reader: R) -> io::Result<Vec<u8>> {
    let mut line = Vec::new();
    let mut limited = BufReader::new(reader).take((MAX_FRAME + 1) as u64);
    limited.read_until(b'\n', &mut line).await?;
    if line.len() > MAX_FRAME || line.last() != Some(&b'\n') {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "Invalid frame"));
    }
    Ok(line)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn framing_rejects_oversize_and_missing_terminator() {
        assert!(read_frame(&b"{}"[..]).await.is_err());
        let mut bytes = vec![b' '; MAX_FRAME];
        bytes.push(b'\n');
        assert!(read_frame(bytes.as_slice()).await.is_err());
        assert_eq!(read_frame(&b"{}\n"[..]).await.unwrap(), b"{}\n");
    }
    #[test]
    fn lock_excludes_migration_and_rejects_symlink() {
        let root = std::env::temp_dir().join(format!("nimble-lock-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let db = root.join("nimble.db");
        let shared = SchemaLock::acquire(&db, false).unwrap();
        assert!(SchemaLock::acquire(&db, true).is_err());
        drop(shared);
        assert!(SchemaLock::acquire(&db, true).is_ok());
        let link = root.join("bad");
        std::os::unix::fs::symlink(root.join(".nimble-schema.lock"), &link).unwrap();
        assert!(SchemaLock::at(&link, true).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn owner_lock_is_exclusive_and_visible_to_probes() {
        let root = std::env::temp_dir().join(format!("nimble-owner-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let db = root.join("nimble.db");
        assert!(!ProfileOwnerLock::is_held(&db).unwrap());
        let owner = ProfileOwnerLock::acquire(&db).unwrap();
        assert!(ProfileOwnerLock::is_held(&db).unwrap());
        let second = ProfileOwnerLock::acquire(&db).unwrap_err();
        assert_eq!(second.kind(), io::ErrorKind::WouldBlock);
        // A probe never steals or blocks ownership.
        assert!(ProfileOwnerLock::is_held(&db).unwrap());
        drop(owner);
        assert!(!ProfileOwnerLock::is_held(&db).unwrap());
        assert!(ProfileOwnerLock::acquire(&db).is_ok());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn native_task_operation_round_trips_its_command_id() {
        let json = r#"{"kind":"native_task","command":{"command_id":"c1","action":{"kind":"delete","id":"t1"}}}"#;
        let op: AgentOperation = serde_json::from_str(json).unwrap();
        match op {
            AgentOperation::NativeTask { command } => assert_eq!(command.command_id, "c1"),
            _ => panic!("wrong variant"),
        }
    }
    #[test]
    fn protocol_rejects_unknown_operations() {
        assert!(
            serde_json::from_str::<AgentOperation>(r#"{"kind":"execute","command":"x"}"#).is_err()
        );
    }
}
