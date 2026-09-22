//! Restricted filesystem primitives shared by the backup writer and verifier.
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

pub(crate) fn invalid(code: &str) -> crate::Error {
    crate::Error::Other(format!("backup_{code}"))
}

/// Require a literal absolute path; reject symlinks in every existing component.
/// In particular, canonicalizing first would silently adopt a symlinked backup root.
pub(crate) fn checked_path(path: &Path) -> crate::Result<PathBuf> {
    if !path.is_absolute() {
        return Err(invalid("absolute_path_required"));
    }
    let mut cursor = PathBuf::new();
    for component in path.components() {
        match component {
            Component::RootDir | Component::Normal(_) => cursor.push(component.as_os_str()),
            _ => return Err(invalid("unsafe_path")),
        }
        match fs::symlink_metadata(&cursor) {
            Ok(meta) if meta.file_type().is_symlink() => return Err(invalid("symlink")),
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(cursor)
}

pub(crate) fn private_dir(path: &Path) -> crate::Result<()> {
    checked_path(path)?;
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    builder.mode(0o700);
    match builder.create(path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            if !fs::symlink_metadata(path)?.is_dir() {
                return Err(invalid("not_directory"));
            }
        }
        Err(e) => return Err(e.into()),
    }
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

pub(crate) fn open_file(path: &Path, write: bool, new: bool) -> crate::Result<File> {
    checked_path(path)?;
    let mut options = OpenOptions::new();
    options.read(true).write(write).create_new(new);
    #[cfg(unix)]
    options
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    let file = options.open(path)?;
    let meta = file.metadata()?;
    if !meta.is_file() {
        return Err(invalid("not_regular_file"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if meta.nlink() != 1 {
            return Err(invalid("hard_link"));
        }
        if write {
            file.set_permissions(fs::Permissions::from_mode(0o600))?;
        }
    }
    Ok(file)
}

pub(crate) fn write_new(path: &Path, bytes: &[u8]) -> crate::Result<()> {
    let mut file = open_file(path, true, true)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}
pub(crate) fn read(path: &Path) -> crate::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    open_file(path, false, false)?.read_to_end(&mut bytes)?;
    Ok(bytes)
}
pub(crate) fn hash(path: &Path) -> crate::Result<String> {
    let mut file = open_file(path, false, false)?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}
pub(crate) fn flush_dir(path: &Path) -> crate::Result<()> {
    checked_path(path)?;
    File::open(path)?.sync_all()?;
    Ok(())
}

/// Rename without replacing an existing target, including an empty directory.
#[cfg(target_os = "macos")]
pub(crate) fn publish_directory(source: &Path, destination: &Path) -> crate::Result<()> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    checked_path(source)?;
    checked_path(destination)?;
    let a = CString::new(source.as_os_str().as_bytes()).map_err(|_| invalid("unsafe_path"))?;
    let b = CString::new(destination.as_os_str().as_bytes()).map_err(|_| invalid("unsafe_path"))?;
    // RENAME_EXCL atomically refuses destination races.
    if unsafe { libc::renamex_np(a.as_ptr(), b.as_ptr(), libc::RENAME_EXCL) } != 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}
#[cfg(target_os = "linux")]
pub(crate) fn publish_directory(source: &Path, destination: &Path) -> crate::Result<()> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    checked_path(source)?;
    checked_path(destination)?;
    let a = CString::new(source.as_os_str().as_bytes()).map_err(|_| invalid("unsafe_path"))?;
    let b = CString::new(destination.as_os_str().as_bytes()).map_err(|_| invalid("unsafe_path"))?;
    if unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            a.as_ptr(),
            libc::AT_FDCWD,
            b.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    } != 0
    {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub(crate) fn publish_directory(_: &Path, _: &Path) -> crate::Result<()> {
    Err(invalid("platform_unsupported"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn atomic_publication_refuses_even_an_empty_existing_destination() {
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("nimble-publish-test-{}", uuid::Uuid::new_v4()));
        private_dir(&root).unwrap();
        let source = root.join("source");
        let destination = root.join("destination");
        private_dir(&source).unwrap();
        private_dir(&destination).unwrap();
        write_new(&source.join("sentinel"), b"preserved").unwrap();
        assert!(publish_directory(&source, &destination).is_err());
        assert_eq!(read(&source.join("sentinel")).unwrap(), b"preserved");
        assert!(destination.is_dir());
        fs::remove_dir_all(root).unwrap();
    }
}
