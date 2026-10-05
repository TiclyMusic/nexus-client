use serde::{Serialize, Serializer};

/// Errore unico del backend. Viene serializzato come stringa leggibile verso il frontend.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Errore I/O: {0}")]
    Io(#[from] std::io::Error),
    #[error("Errore di rete: {0}")]
    Http(#[from] reqwest::Error),
    #[error("JSON non valido: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Archivio zip non valido: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("Portachiavi di sistema: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("Tauri: {0}")]
    Tauri(#[from] tauri::Error),
    #[error("Task interrotto: {0}")]
    Join(#[from] tokio::task::JoinError),
    #[error("Hash non valido per {path}: atteso {expected}, ottenuto {actual}")]
    HashMismatch {
        path: String,
        expected: String,
        actual: String,
    },
    #[error("Autenticazione: {0}")]
    Auth(String),
    #[error("{0}")]
    Msg(String),
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

pub fn msg(text: impl Into<String>) -> Error {
    Error::Msg(text.into())
}
