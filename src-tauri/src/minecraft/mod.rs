pub mod install;
pub mod java;
pub mod launch;
pub mod loaders;
pub mod theme;
pub mod version;

use base64::Engine;
use serde::Serialize;
use tauri::State;

use crate::{
    error::{msg, Result},
    state::AppState,
};

/// Scarica una texture ufficiale (skin/cape) da textures.minecraft.net e la restituisce come
/// data URL base64. Serve a renderla in-app (skinview3d) senza incappare in problemi CORS
/// della webview e senza dipendere da servizi di terze parti.
#[tauri::command]
pub async fn fetch_texture(state: State<'_, AppState>, url: String) -> Result<String> {
    // Whitelist rigorosa degli host ufficiali Mojang.
    let allowed = ["https://textures.minecraft.net/", "http://textures.minecraft.net/"];
    if !allowed.iter().any(|p| url.starts_with(p)) {
        return Err(msg("URL texture non consentito"));
    }
    let resp = state.http.get(&url).send().await?.error_for_status()?;
    let bytes = resp.bytes().await?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{b64}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameVersion {
    pub id: String,
    pub kind: String,
    pub release_time: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameVersions {
    pub latest_release: String,
    pub latest_snapshot: String,
    pub versions: Vec<GameVersion>,
}

#[tauri::command]
pub async fn get_minecraft_versions(state: State<'_, AppState>) -> Result<GameVersions> {
    let manifest = install::version_manifest(state.inner()).await?;
    Ok(GameVersions {
        latest_release: manifest.latest.release,
        latest_snapshot: manifest.latest.snapshot,
        versions: manifest
            .versions
            .into_iter()
            .map(|v| GameVersion {
                id: v.id,
                kind: v.kind,
                release_time: v.release_time,
            })
            .collect(),
    })
}

#[tauri::command]
pub async fn get_loader_versions(
    state: State<'_, AppState>,
    loader: loaders::Loader,
    mc_version: String,
) -> Result<Vec<loaders::LoaderVersion>> {
    loaders::list_versions(state.inner(), loader, &mc_version).await
}

#[tauri::command]
pub async fn detect_java(state: State<'_, AppState>) -> Result<Vec<java::JavaInstall>> {
    Ok(java::detect_all(state.inner()).await)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub total_memory_mb: u64,
    pub os: String,
    pub arch: String,
    pub cpu_count: usize,
    pub data_dir: String,
}

#[tauri::command]
pub fn system_info(state: State<'_, AppState>) -> SystemInfo {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    SystemInfo {
        total_memory_mb: sys.total_memory() / 1024 / 1024,
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        cpu_count: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4),
        data_dir: state.paths.root.to_string_lossy().to_string(),
    }
}
