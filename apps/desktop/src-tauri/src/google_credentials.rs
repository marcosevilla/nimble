//! Refresh tokens are isolated by app profile and never enter SQLite/export.
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
        match Self::entry(profile)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("credential_store_failed"),
        }
    }
    fn store(&self, profile: &str, refresh_token: &str) -> Result<(), &'static str> {
        Self::entry(profile)?.set_password(refresh_token).map_err(|_| "credential_store_failed")
    }
    fn delete(&self, profile: &str) -> Result<(), &'static str> {
        match Self::entry(profile)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("credential_store_failed"),
        }
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
