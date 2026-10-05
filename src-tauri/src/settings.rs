use serde::{Deserialize, Serialize};

use crate::{error::Result, paths::Paths};

/// Client ID dell'app Azure (Microsoft Entra) usata per il login.
/// Può essere impostato a build-time con `NEXUS_MS_CLIENT_ID=<guid> cargo tauri build`
/// oppure a runtime dalle Impostazioni.
// Una variabile d'ambiente vuota (es. secret CI non impostato) conta come assente.
pub const DEFAULT_MS_CLIENT_ID: &str = match option_env!("NEXUS_MS_CLIENT_ID") {
    Some(id) if !id.is_empty() => id,
    _ => "da75b6c4-4946-4202-9b90-06f39bb80605",
};

/// Client ID usati in passato come predefiniti: se salvati nelle impostazioni vengono
/// sostituiti con quello attuale (l'utente non li ha scelti lui).
const LEGACY_MS_CLIENT_IDS: &[&str] = &["00000000402b5328", "c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb"];

/// URL predefinito del server amici (Nexus Social). Sovrascrivibile dalle Impostazioni
/// o a build-time con `NEXUS_SOCIAL_URL=...`.
pub const DEFAULT_SOCIAL_URL: &str = match option_env!("NEXUS_SOCIAL_URL") {
    Some(u) if !u.is_empty() => u,
    _ => "https://nexus-social.matthias-peterlini.workers.dev",
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub ms_client_id: String,
    pub active_account: Option<String>,
    pub default_min_ram_mb: u32,
    pub default_max_ram_mb: u32,
    /// Path Java globale; se vuoto viene scelto/scaricato automaticamente.
    pub java_path: Option<String>,
    /// Scarica automaticamente il Java runtime ufficiale Mojang richiesto dalla versione.
    pub auto_java: bool,
    pub jvm_args: String,
    /// Usa i flag G1GC ottimizzati.
    pub optimized_gc: bool,
    pub download_concurrency: usize,
    /// URL del server amici & presenza (Cloudflare Worker). Vuoto = feature social disattivata.
    #[serde(default)]
    pub social_url: Option<String>,
    /// Preferenze di sola UI (tema, provider AI…), opache per il backend.
    pub ui: serde_json::Value,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            ms_client_id: DEFAULT_MS_CLIENT_ID.to_string(),
            active_account: None,
            default_min_ram_mb: 1024,
            default_max_ram_mb: 4096,
            java_path: None,
            auto_java: true,
            jvm_args: String::new(),
            optimized_gc: true,
            download_concurrency: 24,
            social_url: None,
            ui: serde_json::Value::Null,
        }
    }
}

impl Settings {
    pub fn load(paths: &Paths) -> Self {
        let mut settings: Settings = std::fs::read(paths.settings_file())
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        if settings.ms_client_id.trim().is_empty() || LEGACY_MS_CLIENT_IDS.contains(&settings.ms_client_id.trim()) {
            settings.ms_client_id = DEFAULT_MS_CLIENT_ID.to_string();
        }
        if settings.social_url.as_deref().map(str::trim).unwrap_or("").is_empty() {
            settings.social_url = Some(DEFAULT_SOCIAL_URL.to_string());
        }
        settings.download_concurrency = settings.download_concurrency.clamp(1, 64);
        settings
    }

    pub async fn save(&self, paths: &Paths) -> Result<()> {
        let data = serde_json::to_vec_pretty(self)?;
        crate::util::write_atomic(&paths.settings_file(), &data).await
    }
}
