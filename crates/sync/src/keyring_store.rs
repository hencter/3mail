use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use keyring::Entry;
use three_mail_core::{Error, Result};

fn secret_cache() -> &'static Mutex<HashMap<String, String>> {
    static CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub const KEYRING_SERVICE: &str = "com.threemail.app";

pub fn keyring_user_for_email(email: &str) -> String {
    format!("email:{}", email.trim().to_ascii_lowercase())
}

pub fn store_secret(user: &str, secret: &str) -> Result<()> {
    let entry = Entry::new(KEYRING_SERVICE, user).map_err(|e| Error::Keyring(e.to_string()))?;
    entry
        .set_password(secret)
        .map_err(|e| Error::Keyring(e.to_string()))?;
    // Confirm it actually landed in the platform store (catches misconfigured backends).
    let roundtrip = entry
        .get_password()
        .map_err(|e| Error::Keyring(format!("stored but cannot read back: {e}")))?;
    if roundtrip != secret {
        return Err(Error::Keyring("stored password mismatch on read-back".into()));
    }
    if let Ok(mut cache) = secret_cache().lock() {
        cache.insert(user.to_string(), secret.to_string());
    }
    Ok(())
}

pub fn load_secret(user: &str) -> Result<String> {
    if let Ok(cache) = secret_cache().lock() {
        if let Some(secret) = cache.get(user) {
            return Ok(secret.clone());
        }
    }
    let entry = Entry::new(KEYRING_SERVICE, user).map_err(|e| Error::Keyring(e.to_string()))?;
    match entry.get_password() {
        Ok(s) => {
            if let Ok(mut cache) = secret_cache().lock() {
                cache.insert(user.to_string(), s.clone());
            }
            Ok(s)
        }
        Err(keyring::Error::NoEntry) => Err(Error::Keyring(
            "password not found in Keychain — open Add account and Save again with your app password"
                .into(),
        )),
        Err(e) => Err(Error::Keyring(e.to_string())),
    }
}

pub fn delete_secret(user: &str) -> Result<()> {
    let entry = Entry::new(KEYRING_SERVICE, user).map_err(|e| Error::Keyring(e.to_string()))?;
    match entry.delete_credential() {
        Ok(()) => {
            if let Ok(mut cache) = secret_cache().lock() {
                cache.remove(user);
            }
            Ok(())
        }
        Err(keyring::Error::NoEntry) => {
            if let Ok(mut cache) = secret_cache().lock() {
                cache.remove(user);
            }
            Ok(())
        }
        Err(e) => Err(Error::Keyring(e.to_string())),
    }
}
