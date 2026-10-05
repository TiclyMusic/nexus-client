//! Archivio account cifrato.
//!
//! I token vengono serializzati e cifrati con AES-256-GCM in `accounts.enc`; la chiave a 256 bit
//! vive nel portachiavi di sistema (Windows Credential Manager / Secret Service su Linux).
//! Si cifra un file invece di salvare i token direttamente nel keyring perché Credential Manager
//! limita i segreti a 2560 byte, insufficienti per i token Microsoft + Minecraft.

use std::path::PathBuf;

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};

use crate::error::{msg, Result};

const KEYRING_SERVICE: &str = "dev.nexus.launcher";
const KEYRING_USER: &str = "accounts-master-key";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccountKind {
    Microsoft,
    /// Solo build di debug, per sviluppo senza client ID approvato.
    Offline,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub uuid: String,
    pub username: String,
    pub kind: AccountKind,
    #[serde(default)]
    pub ms_refresh_token: String,
    #[serde(default)]
    pub mc_access_token: String,
    /// Scadenza del token Minecraft (unix seconds).
    #[serde(default)]
    pub mc_expires_at: i64,
    #[serde(default)]
    pub xuid: Option<String>,
    #[serde(default)]
    pub skin_url: Option<String>,
    #[serde(default)]
    pub skin_variant: Option<String>,
    #[serde(default)]
    pub cape_url: Option<String>,
}

/// Vista "sicura" dell'account esposta alla UI (senza token).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub uuid: String,
    pub username: String,
    pub kind: AccountKind,
    pub skin_url: Option<String>,
    pub skin_variant: Option<String>,
    pub cape_url: Option<String>,
    pub expires_at: i64,
    pub active: bool,
}

impl Account {
    pub fn info(&self, active: bool) -> AccountInfo {
        AccountInfo {
            uuid: self.uuid.clone(),
            username: self.username.clone(),
            kind: self.kind,
            skin_url: self.skin_url.clone(),
            skin_variant: self.skin_variant.clone(),
            cape_url: self.cape_url.clone(),
            expires_at: self.mc_expires_at,
            active,
        }
    }
}

pub struct AccountStore {
    path: PathBuf,
    pub accounts: Vec<Account>,
}

fn key_fallback_path(accounts_path: &std::path::Path) -> PathBuf {
    accounts_path.with_file_name(".nexus-key")
}

/// Recupera (o genera) la chiave master dal portachiavi.
/// Se il portachiavi non è disponibile (es. Linux senza Secret Service) ripiega su un file locale 0600.
fn master_key(accounts_path: &std::path::Path) -> Result<Vec<u8>> {
    let from_keyring = (|| -> Result<Vec<u8>> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)?;
        match entry.get_password() {
            Ok(encoded) => Ok(B64.decode(encoded).map_err(|e| msg(e.to_string()))?),
            Err(keyring::Error::NoEntry) => {
                let key = Aes256Gcm::generate_key(OsRng).to_vec();
                entry.set_password(&B64.encode(&key))?;
                Ok(key)
            }
            Err(e) => Err(e.into()),
        }
    })();

    match from_keyring {
        Ok(key) if key.len() == 32 => Ok(key),
        Ok(_) => Err(msg("Chiave nel portachiavi corrotta")),
        Err(e) => {
            log::warn!("portachiavi non disponibile ({e}), uso chiave su file");
            let path = key_fallback_path(accounts_path);
            if let Ok(encoded) = std::fs::read_to_string(&path) {
                return B64.decode(encoded.trim()).map_err(|e| msg(e.to_string()));
            }
            let key = Aes256Gcm::generate_key(OsRng).to_vec();
            std::fs::write(&path, B64.encode(&key))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
            }
            Ok(key)
        }
    }
}

impl AccountStore {
    pub fn load(path: PathBuf) -> Self {
        let accounts = match Self::read(&path) {
            Ok(a) => a,
            Err(e) => {
                log::error!("impossibile leggere gli account: {e}");
                if path.exists() {
                    // Non sovrascrivere dati che non riusciamo a decifrare.
                    let _ = std::fs::rename(&path, path.with_extension("enc.bak"));
                }
                Vec::new()
            }
        };
        Self { path, accounts }
    }

    fn read(path: &std::path::Path) -> Result<Vec<Account>> {
        if !path.exists() {
            return Ok(Vec::new());
        }
        let data = std::fs::read(path)?;
        if data.len() < 13 {
            return Err(msg("file account troncato"));
        }
        let key = master_key(path)?;
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| msg(e.to_string()))?;
        let (nonce, ciphertext) = data.split_at(12);
        let plain = cipher
            .decrypt(Nonce::from_slice(nonce), ciphertext)
            .map_err(|_| msg("decifratura account fallita"))?;
        Ok(serde_json::from_slice(&plain)?)
    }

    pub fn save(&self) -> Result<()> {
        let key = master_key(&self.path)?;
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| msg(e.to_string()))?;
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let plain = serde_json::to_vec(&self.accounts)?;
        let ciphertext = cipher
            .encrypt(&nonce, plain.as_ref())
            .map_err(|_| msg("cifratura account fallita"))?;
        let mut out = nonce.to_vec();
        out.extend_from_slice(&ciphertext);
        let tmp = self.path.with_extension("enc.tmp");
        std::fs::write(&tmp, out)?;
        std::fs::rename(tmp, &self.path)?;
        Ok(())
    }

    pub fn get(&self, uuid: &str) -> Option<&Account> {
        self.accounts.iter().find(|a| a.uuid == uuid)
    }

    pub fn upsert(&mut self, account: Account) {
        match self.accounts.iter_mut().find(|a| a.uuid == account.uuid) {
            Some(existing) => *existing = account,
            None => self.accounts.push(account),
        }
    }

    pub fn remove(&mut self, uuid: &str) {
        self.accounts.retain(|a| a.uuid != uuid);
    }
}
