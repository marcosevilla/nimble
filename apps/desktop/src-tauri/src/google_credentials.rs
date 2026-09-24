//! Google credentials live in owner-only files under the app data directory and never
//! enter SQLite/export. They moved out of Keychain because a self-signed build has no team
//! ID, so macOS pins each "Always Allow" to one build's cdhash and re-prompts after every
//! install. Legacy Keychain items are migrated on first read, then deleted.
use std::collections::BTreeMap;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub trait GoogleCredentials: Send + Sync {
    fn load(&self, profile: &str) -> Result<Option<String>, &'static str>;
    fn store(&self, profile: &str, refresh_token: &str) -> Result<(), &'static str>;
    fn delete(&self, profile: &str) -> Result<(), &'static str>;
}

const TOKEN_SERVICE: &str = "com.marcosevilla.nimble.google-calendar";
/// A separate service prevents client secrets from replacing refresh tokens.
const CLIENT_SERVICE: &str = "com.marcosevilla.nimble.google-calendar-client";

/// Serializes read-modify-write across both stores; each file is small and rarely written.
static FILE_LOCK: Mutex<()> = Mutex::new(());

pub struct FileCredentials {
    path: PathBuf,
    legacy_service: Option<&'static str>,
}

impl FileCredentials {
    pub fn tokens(app_data_dir: &Path) -> Self {
        Self { path: app_data_dir.join("credentials").join("google-calendar.json"), legacy_service: Some(TOKEN_SERVICE) }
    }
    pub fn client_secrets(app_data_dir: &Path) -> Self {
        Self { path: app_data_dir.join("credentials").join("google-calendar-client.json"), legacy_service: Some(CLIENT_SERVICE) }
    }

    fn read_all(&self) -> Result<BTreeMap<String, String>, &'static str> {
        match std::fs::read(&self.path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "credential_store_failed"),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
            Err(_) => Err("credential_store_failed"),
        }
    }

    fn write_all(&self, values: &BTreeMap<String, String>) -> Result<(), &'static str> {
        use std::io::Write;
        let fail = |_| "credential_store_failed";
        let dir = self.path.parent().ok_or("credential_store_failed")?;
        std::fs::create_dir_all(dir).map_err(fail)?;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).map_err(fail)?;
        let tmp = self.path.with_extension("json.tmp");
        let _ = std::fs::remove_file(&tmp);
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&tmp).map_err(fail)?;
        file.write_all(&serde_json::to_vec(values).map_err(|_| "credential_store_failed")?).map_err(fail)?;
        file.sync_all().map_err(fail)?;
        std::fs::rename(&tmp, &self.path).map_err(fail)
    }

    fn legacy_entry(&self, account: &str) -> Option<keyring::Entry> {
        if cfg!(test) { return None }
        self.legacy_service.and_then(|service| keyring::Entry::new(service, account).ok())
    }
}

impl GoogleCredentials for FileCredentials {
    fn load(&self, account: &str) -> Result<Option<String>, &'static str> {
        let _guard = FILE_LOCK.lock().map_err(|_| "credential_store_failed")?;
        let mut values = self.read_all()?;
        if let Some(value) = values.get(account) { return Ok(Some(value.clone())) }
        // One-time migration: NoEntry never prompts, so accounts with no legacy item stay silent.
        let Some(entry) = self.legacy_entry(account) else { return Ok(None) };
        let Some(value) = read_entry(&entry)? else { return Ok(None) };
        values.insert(account.to_owned(), value.clone());
        self.write_all(&values)?;
        let _ = delete_entry(&entry);
        Ok(Some(value))
    }
    fn store(&self, account: &str, secret: &str) -> Result<(), &'static str> {
        let _guard = FILE_LOCK.lock().map_err(|_| "credential_store_failed")?;
        let mut values = self.read_all()?;
        values.insert(account.to_owned(), secret.to_owned());
        self.write_all(&values)
    }
    fn delete(&self, account: &str) -> Result<(), &'static str> {
        let _guard = FILE_LOCK.lock().map_err(|_| "credential_store_failed")?;
        let mut values = self.read_all()?;
        if values.remove(account).is_some() { self.write_all(&values)?; }
        if let Some(entry) = self.legacy_entry(account) { delete_entry(&entry)?; }
        Ok(())
    }
}

#[cfg(test)]
#[derive(Default)]
pub struct MemoryCredentials(Mutex<std::collections::HashMap<String,String>>);
#[cfg(test)]
impl GoogleCredentials for MemoryCredentials {
    fn load(&self, profile: &str) -> Result<Option<String>, &'static str> {
        Ok(self.0.lock().map_err(|_| "credential_store_failed")?.get(profile).cloned())
    }
    fn store(&self, profile: &str, refresh_token: &str) -> Result<(), &'static str> {
        self.0.lock().map_err(|_| "credential_store_failed")?.insert(profile.into(),refresh_token.into()); Ok(())
    }
    fn delete(&self, profile: &str) -> Result<(), &'static str> {
        self.0.lock().map_err(|_| "credential_store_failed")?.remove(profile); Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn profiles_are_isolated() {
        let store=MemoryCredentials::default();
        store.store("synthetic-a","secret-a").unwrap();
        assert_eq!(store.load("synthetic-b").unwrap(),None);
        store.delete("synthetic-b").unwrap();
        assert_eq!(store.load("synthetic-a").unwrap(),Some("secret-a".into()));
    }
}

/// Client-secret account identity must distinguish both device profile and OAuth client.
pub fn client_secret_account(profile: &str, client_id: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(client_id.as_bytes());
    format!("{profile}-client-{digest:x}")
}

fn read_entry(entry: &keyring::Entry) -> Result<Option<String>, &'static str> {
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("credential_store_failed"),
    }
}
fn delete_entry(entry: &keyring::Entry) -> Result<(), &'static str> {
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("credential_store_failed"),
    }
}

#[cfg(test)]
mod client_secret_tests {
    use super::*;
    #[test]
    fn client_secrets_do_not_cross_clients_or_profiles() {
        let store = MemoryCredentials::default();
        let account = client_secret_account("profile-a", "client-a.apps.googleusercontent.com");
        store.store(&account, "fake-client-secret").unwrap();
        assert_eq!(store.load(&client_secret_account("profile-a", "client-a.apps.googleusercontent.com")).unwrap().as_deref(), Some("fake-client-secret"));
        assert_eq!(store.load(&client_secret_account("profile-a", "client-b.apps.googleusercontent.com")).unwrap(), None);
        assert_eq!(store.load(&client_secret_account("profile-b", "client-a.apps.googleusercontent.com")).unwrap(), None);
    }
}

#[cfg(test)]
mod file_tests {
    use super::*;
    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nimble-cred-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn round_trips_and_isolates_accounts() {
        let dir = temp_dir("roundtrip");
        let store = FileCredentials::tokens(&dir);
        assert_eq!(store.load("synthetic-a").unwrap(), None);
        store.store("synthetic-a", "secret-a").unwrap();
        store.store("synthetic-b", "secret-b").unwrap();
        assert_eq!(FileCredentials::tokens(&dir).load("synthetic-a").unwrap().as_deref(), Some("secret-a"));
        store.delete("synthetic-b").unwrap();
        assert_eq!(store.load("synthetic-b").unwrap(), None);
        assert_eq!(store.load("synthetic-a").unwrap().as_deref(), Some("secret-a"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tokens_and_client_secrets_use_separate_files() {
        let dir = temp_dir("separate");
        FileCredentials::tokens(&dir).store("synthetic", "token").unwrap();
        FileCredentials::client_secrets(&dir).store("synthetic", "client-secret").unwrap();
        assert_eq!(FileCredentials::tokens(&dir).load("synthetic").unwrap().as_deref(), Some("token"));
        assert_eq!(FileCredentials::client_secrets(&dir).load("synthetic").unwrap().as_deref(), Some("client-secret"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn files_are_owner_only() {
        let dir = temp_dir("perms");
        FileCredentials::tokens(&dir).store("synthetic", "secret").unwrap();
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&dir.join("credentials")), 0o700);
        assert_eq!(mode(&dir.join("credentials/google-calendar.json")), 0o600);
        assert!(!dir.join("credentials/google-calendar.json.tmp").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
