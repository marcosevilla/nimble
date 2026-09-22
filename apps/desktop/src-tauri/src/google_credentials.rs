//! Google credentials are isolated in Keychain and never enter SQLite/export.
use std::sync::Mutex;

pub trait GoogleCredentials: Send + Sync {
    fn load(&self, profile: &str) -> Result<Option<String>, &'static str>;
    fn store(&self, profile: &str, refresh_token: &str) -> Result<(), &'static str>;
    fn delete(&self, profile: &str) -> Result<(), &'static str>;
}

pub struct KeychainCredentials;
impl KeychainCredentials {
    fn entry(profile: &str) -> Result<keyring::Entry, &'static str> {
        keyring::Entry::new("com.marcosevilla.nimble.google-calendar", profile).map_err(|_| "credential_store_failed")
    }
}
impl GoogleCredentials for KeychainCredentials {
    fn load(&self, profile: &str) -> Result<Option<String>, &'static str> {
        read_entry(Self::entry(profile)?)
    }
    fn store(&self, profile: &str, refresh_token: &str) -> Result<(), &'static str> {
        Self::entry(profile)?.set_password(refresh_token).map_err(|_| "credential_store_failed")
    }
    fn delete(&self, profile: &str) -> Result<(), &'static str> {
        delete_entry(Self::entry(profile)?)
    }
}

#[derive(Default)]
pub struct MemoryCredentials(Mutex<std::collections::HashMap<String,String>>);
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

/// A separate Keychain service prevents client secrets from replacing refresh tokens.
pub struct KeychainClientCredentials;
impl KeychainClientCredentials {
    fn entry(account: &str) -> Result<keyring::Entry, &'static str> {
        keyring::Entry::new("com.marcosevilla.nimble.google-calendar-client", account)
            .map_err(|_| "credential_store_failed")
    }
}
impl GoogleCredentials for KeychainClientCredentials {
    fn load(&self, account: &str) -> Result<Option<String>, &'static str> {
        read_entry(Self::entry(account)?)
    }
    fn store(&self, account: &str, secret: &str) -> Result<(), &'static str> {
        Self::entry(account)?.set_password(secret).map_err(|_| "credential_store_failed")
    }
    fn delete(&self, account: &str) -> Result<(), &'static str> {
        delete_entry(Self::entry(account)?)
    }
}

fn read_entry(entry: keyring::Entry) -> Result<Option<String>, &'static str> {
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("credential_store_failed"),
    }
}
fn delete_entry(entry: keyring::Entry) -> Result<(), &'static str> {
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
