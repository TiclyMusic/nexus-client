//! Istanze isolate: ciascuna ha la propria game directory, RAM, Java e contenuti.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::{
    error::{msg, Result},
    minecraft::{self, loaders::Loader},
    state::AppState,
    util,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub mc_version: String,
    pub loader: Loader,
    #[serde(default)]
    pub loader_version: Option<String>,
    /// Id della version JSON effettiva (es. `fabric-loader-0.16.10-1.21.4`), valorizzato dopo l'installazione.
    #[serde(default)]
    pub version_id: Option<String>,
    pub min_ram_mb: u32,
    pub max_ram_mb: u32,
    #[serde(default)]
    pub java_path: Option<String>,
    #[serde(default)]
    pub jvm_args: String,
    #[serde(default)]
    pub window_width: Option<u32>,
    #[serde(default)]
    pub window_height: Option<u32>,
    /// Icona Material Symbols o emoji.
    #[serde(default)]
    pub icon: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub last_played: Option<String>,
    #[serde(default)]
    pub play_time_secs: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInstanceRequest {
    pub name: String,
    pub mc_version: String,
    pub loader: Loader,
    #[serde(default)]
    pub loader_version: Option<String>,
    #[serde(default)]
    pub min_ram_mb: Option<u32>,
    #[serde(default)]
    pub max_ram_mb: Option<u32>,
    #[serde(default)]
    pub icon: Option<String>,
}

fn slugify(name: &str) -> String {
    let mut slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }
    let slug = slug.trim_matches('-');
    let slug = if slug.is_empty() { "istanza" } else { slug };
    let short = &uuid::Uuid::new_v4().simple().to_string()[..6];
    format!("{}-{}", &slug[..slug.len().min(32)], short)
}

fn validate_id(id: &str) -> Result<()> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(msg("Id istanza non valido"));
    }
    Ok(())
}

pub async fn load(state: &AppState, id: &str) -> Result<Instance> {
    validate_id(id)?;
    util::read_json(&state.paths.instance_json(id))
        .await
        .map_err(|_| msg(format!("Istanza '{id}' non trovata")))
}

pub async fn save(state: &AppState, instance: &Instance) -> Result<()> {
    validate_id(&instance.id)?;
    let data = serde_json::to_vec_pretty(instance)?;
    util::write_atomic(&state.paths.instance_json(&instance.id), &data).await
}

pub async fn list(state: &AppState) -> Result<Vec<Instance>> {
    let dir = state.paths.instances();
    tokio::fs::create_dir_all(&dir).await?;
    let mut out = Vec::new();
    let mut entries = tokio::fs::read_dir(&dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path().join("instance.json");
        if let Ok(inst) = util::read_json::<Instance>(&path).await {
            out.push(inst);
        }
    }
    out.sort_by(|a, b| {
        b.last_played
            .cmp(&a.last_played)
            .then_with(|| b.created_at.cmp(&a.created_at))
    });
    Ok(out)
}

pub async fn create(state: &AppState, req: CreateInstanceRequest) -> Result<Instance> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(msg("Il nome dell'istanza è obbligatorio"));
    }
    let loader_version = match (req.loader, req.loader_version.filter(|v| !v.is_empty())) {
        (Loader::Vanilla, _) => None,
        (_, Some(v)) => Some(v),
        (loader, None) => Some(
            minecraft::loaders::recommended_version(state, loader, &req.mc_version)
                .await?
                .ok_or_else(|| msg(format!("Nessuna versione di {loader:?} per Minecraft {}", req.mc_version)))?,
        ),
    };
    let (def_min, def_max) = {
        let s = state.settings.read().await;
        (s.default_min_ram_mb, s.default_max_ram_mb)
    };
    let instance = Instance {
        id: slugify(name),
        name: name.to_string(),
        mc_version: req.mc_version,
        loader: req.loader,
        loader_version,
        version_id: None,
        min_ram_mb: req.min_ram_mb.unwrap_or(def_min),
        max_ram_mb: req.max_ram_mb.unwrap_or(def_max),
        java_path: None,
        jvm_args: String::new(),
        window_width: None,
        window_height: None,
        icon: req.icon,
        created_at: util::now_rfc3339(),
        last_played: None,
        play_time_secs: 0,
    };
    tokio::fs::create_dir_all(state.paths.game_dir(&instance.id)).await?;
    save(state, &instance).await?;
    Ok(instance)
}

fn copy_dir(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    for entry in walkdir::WalkDir::new(src) {
        let entry = entry.map_err(std::io::Error::other)?;
        let rel = entry.path().strip_prefix(src).unwrap();
        if rel.starts_with("natives") {
            continue;
        }
        let target = dst.join(rel);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&target)?;
        } else {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Comandi IPC
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_instances(state: State<'_, AppState>) -> Result<Vec<Instance>> {
    list(state.inner()).await
}

#[tauri::command]
pub async fn get_instance(state: State<'_, AppState>, id: String) -> Result<Instance> {
    load(state.inner(), &id).await
}

#[tauri::command]
pub async fn create_instance(state: State<'_, AppState>, request: CreateInstanceRequest) -> Result<Instance> {
    create(state.inner(), request).await
}

#[tauri::command]
pub async fn update_instance(state: State<'_, AppState>, instance: Instance) -> Result<Instance> {
    let current = load(state.inner(), &instance.id).await?;
    let mut updated = instance;
    // Se cambiano versione o loader, la version JSON va ri-risolta.
    if updated.mc_version != current.mc_version
        || updated.loader != current.loader
        || updated.loader_version != current.loader_version
    {
        updated.version_id = None;
        if updated.loader != Loader::Vanilla && updated.loader_version.as_deref().unwrap_or("").is_empty() {
            updated.loader_version =
                minecraft::loaders::recommended_version(state.inner(), updated.loader, &updated.mc_version).await?;
        }
    }
    updated.min_ram_mb = updated.min_ram_mb.clamp(512, updated.max_ram_mb.max(512));
    save(state.inner(), &updated).await?;
    Ok(updated)
}

#[tauri::command]
pub async fn clone_instance(state: State<'_, AppState>, id: String, name: String) -> Result<Instance> {
    let source = load(state.inner(), &id).await?;
    let mut copy = source.clone();
    copy.id = slugify(&name);
    copy.name = name;
    copy.created_at = util::now_rfc3339();
    copy.last_played = None;
    copy.play_time_secs = 0;
    let (src, dst) = (state.paths.instance(&id), state.paths.instance(&copy.id));
    tokio::task::spawn_blocking(move || copy_dir(&src, &dst)).await??;
    save(state.inner(), &copy).await?;
    Ok(copy)
}

#[tauri::command]
pub async fn delete_instance(state: State<'_, AppState>, id: String) -> Result<()> {
    validate_id(&id)?;
    if state.running.lock().unwrap().contains_key(&id) {
        return Err(msg("Chiudi il gioco prima di eliminare l'istanza"));
    }
    tokio::fs::remove_dir_all(state.paths.instance(&id)).await?;
    Ok(())
}

#[tauri::command]
pub async fn open_instance_folder(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    validate_id(&id)?;
    let dir = state.paths.game_dir(&id);
    tokio::fs::create_dir_all(&dir).await?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| msg(e.to_string()))
}
