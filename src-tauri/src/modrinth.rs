//! Integrazione Modrinth v2: ricerca, installazione con risoluzione dipendenze, modpack .mrpack
//! e gestione dei contenuti locali (toggle `.disabled`, rimozione).

use std::{
    collections::{HashMap, HashSet, VecDeque},
    io::Read,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::{
    download::{download_all, DownloadJob},
    error::{msg, Result},
    instances::{self, CreateInstanceRequest, Instance},
    minecraft::{launch::emit_log, loaders::Loader},
    paths::safe_join,
    state::AppState,
    util,
};

const API: &str = "https://api.modrinth.com/v2";

// ---------------------------------------------------------------------------
// Tipi API
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResponse {
    pub hits: Vec<SearchHit>,
    pub offset: u32,
    pub limit: u32,
    pub total_hits: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub project_id: String,
    pub project_type: String,
    pub slug: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub display_categories: Vec<String>,
    #[serde(default)]
    pub downloads: u64,
    #[serde(default)]
    pub follows: u64,
    #[serde(default)]
    pub icon_url: Option<String>,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub versions: Vec<String>,
    #[serde(default)]
    pub date_modified: String,
    #[serde(default)]
    pub gallery: Vec<String>,
    #[serde(default)]
    pub color: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Project {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub project_type: String,
    #[serde(default)]
    pub icon_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Version {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub version_number: String,
    #[serde(default)]
    pub game_versions: Vec<String>,
    #[serde(default)]
    pub loaders: Vec<String>,
    #[serde(default)]
    pub version_type: String,
    pub files: Vec<VersionFile>,
    #[serde(default)]
    pub dependencies: Vec<Dependency>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionFile {
    pub url: String,
    pub filename: String,
    #[serde(default)]
    pub primary: bool,
    #[serde(default)]
    pub hashes: HashMap<String, String>,
    #[serde(default)]
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dependency {
    #[serde(default)]
    pub version_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    pub dependency_type: String,
}

// ---------------------------------------------------------------------------
// Manifest locale dei contenuti installati
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentEntry {
    pub project_id: String,
    pub version_id: String,
    pub version_number: String,
    pub title: String,
    pub project_type: String,
    pub file_name: String,
    pub dir: String,
    pub icon_url: Option<String>,
    /// Installata automaticamente come dipendenza.
    #[serde(default)]
    pub dependency: bool,
}

type ContentManifest = HashMap<String, ContentEntry>;

async fn load_manifest(state: &AppState, id: &str) -> ContentManifest {
    util::read_json(&state.paths.content_manifest(id)).await.unwrap_or_default()
}

async fn save_manifest(state: &AppState, id: &str, manifest: &ContentManifest) -> Result<()> {
    util::write_atomic(&state.paths.content_manifest(id), &serde_json::to_vec_pretty(manifest)?).await
}

fn dir_for(project_type: &str) -> Option<&'static str> {
    match project_type {
        "mod" => Some("mods"),
        "shader" => Some("shaderpacks"),
        "resourcepack" => Some("resourcepacks"),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async fn get_project(state: &AppState, id: &str) -> Result<Project> {
    util::get_json(&state.http, &format!("{API}/project/{id}")).await
}

async fn get_version(state: &AppState, id: &str) -> Result<Version> {
    util::get_json(&state.http, &format!("{API}/version/{id}")).await
}

async fn project_versions(
    state: &AppState,
    id: &str,
    loaders: &[&str],
    game_version: Option<&str>,
) -> Result<Vec<Version>> {
    let mut query: Vec<(&str, String)> = Vec::new();
    if !loaders.is_empty() {
        query.push(("loaders", serde_json::to_string(loaders)?));
    }
    if let Some(gv) = game_version {
        query.push(("game_versions", serde_json::to_string(&[gv])?));
    }
    let resp = state
        .http
        .get(format!("{API}/project/{id}/version"))
        .query(&query)
        .send()
        .await?
        .error_for_status()?;
    Ok(resp.json().await?)
}

fn pick_version(versions: Vec<Version>) -> Option<Version> {
    let release = versions.iter().position(|v| v.version_type == "release");
    match release {
        Some(i) => versions.into_iter().nth(i),
        None => versions.into_iter().next(),
    }
}

fn primary_file(version: &Version) -> Option<&VersionFile> {
    version.files.iter().find(|f| f.primary).or(version.files.first())
}

/// Risolve un identificatore (slug/id/nome, spesso proposto dall'AI) nel vero project id Modrinth.
/// Prima prova il match esatto; se fallisce, cerca su Modrinth e prende il risultato più pertinente
/// compatibile con la versione di gioco. Così l'AI non deve indovinare lo slug preciso.
async fn resolve_project_id(state: &AppState, query: &str, mc_version: &str) -> Result<String> {
    let clean = query.trim();
    if clean.is_empty() {
        return Err(msg("Nome del contenuto vuoto"));
    }
    // 1) match esatto per slug o id
    if let Ok(p) = get_project(state, clean).await {
        return Ok(p.id);
    }
    // 2) fallback: ricerca Modrinth
    let facets = serde_json::to_string(&vec![vec![format!("versions:{mc_version}")]])?;
    let params: Vec<(&str, String)> = vec![
        ("query", clean.to_string()),
        ("limit", "5".to_string()),
        ("facets", facets),
        ("index", "relevance".to_string()),
    ];
    let resp = state.http.get(format!("{API}/search")).query(&params).send().await?.error_for_status()?;
    let sr: SearchResponse = resp.json().await?;
    sr.hits
        .into_iter()
        .next()
        .map(|h| h.project_id)
        .ok_or_else(|| msg(format!("Nessun contenuto Modrinth trovato per '{clean}'")))
}

/// Installa un progetto e ricorsivamente le sue dipendenze obbligatorie.
pub async fn install_project(
    app: &AppHandle,
    state: &AppState,
    instance: &Instance,
    project: &str,
    version_id: Option<String>,
) -> Result<Vec<ContentEntry>> {
    let mut manifest = load_manifest(state, &instance.id).await;
    let installed_ids: HashSet<String> = manifest.keys().cloned().collect();
    let game_dir = state.paths.game_dir(&instance.id);
    let mod_loaders = instance.loader.modrinth_names();

    // Risolve lo slug proposto (anche dall'AI) nel vero project id prima di installare.
    let root_id = resolve_project_id(state, project, &instance.mc_version).await?;
    let mut queue: VecDeque<(String, Option<String>, bool)> = VecDeque::new();
    queue.push_back((root_id, version_id, false));
    let mut visited = HashSet::new();
    let mut jobs = Vec::new();
    let mut added = Vec::new();

    while let Some((pid, vid, is_dep)) = queue.pop_front() {
        if !visited.insert(pid.clone()) {
            continue;
        }
        let proj = get_project(state, &pid).await?;
        // Salta una dipendenza già installata SOLO se non ne è appuntata una versione precisa.
        // Se una mod (es. Iris) richiede una versione esatta di un'altra (es. Sodium), quella
        // versione deve vincere e sostituire quella eventualmente già presente: altrimenti si
        // creano conflitti di versione (Sodium/Iris incompatibili).
        if is_dep && vid.is_none() && installed_ids.contains(&proj.id) {
            continue;
        }
        if proj.project_type == "modpack" {
            return Err(msg("I modpack si installano come nuova istanza"));
        }
        let dir = dir_for(&proj.project_type)
            .ok_or_else(|| msg(format!("Tipo di contenuto non supportato: {}", proj.project_type)))?;

        let loaders: Vec<&str> = match proj.project_type.as_str() {
            "mod" => {
                if mod_loaders.is_empty() {
                    return Err(msg(format!(
                        "'{}' è una mod: crea un'istanza con un modloader (Fabric, Quilt, Forge, NeoForge)",
                        proj.title
                    )));
                }
                mod_loaders.clone()
            }
            _ => vec![],
        };

        let version = match vid {
            Some(v) => get_version(state, &v).await?,
            None => pick_version(project_versions(state, &proj.id, &loaders, Some(instance.mc_version.as_str())).await?)
                .ok_or_else(|| {
                    msg(format!(
                        "Nessuna versione di '{}' compatibile con {} {:?}",
                        proj.title, instance.mc_version, instance.loader
                    ))
                })?,
        };
        let file = primary_file(&version).ok_or_else(|| msg("Versione senza file"))?;

        // Rimuovi la versione precedente (aggiornamento).
        if let Some(old) = manifest.get(&proj.id) {
            let old_path = game_dir.join(&old.dir).join(&old.file_name);
            let _ = tokio::fs::remove_file(&old_path).await;
            let mut disabled = old_path.into_os_string();
            disabled.push(".disabled");
            let _ = tokio::fs::remove_file(disabled).await;
        }

        let target = game_dir.join(dir).join(&file.filename);
        jobs.push(
            DownloadJob::new(file.url.clone(), target)
                .sha1(file.hashes.get("sha1").cloned())
                .size(Some(file.size)),
        );
        let entry = ContentEntry {
            project_id: proj.id.clone(),
            version_id: version.id.clone(),
            version_number: version.version_number.clone(),
            title: proj.title.clone(),
            project_type: proj.project_type.clone(),
            file_name: file.filename.clone(),
            dir: dir.to_string(),
            icon_url: proj.icon_url.clone(),
            dependency: is_dep,
        };
        emit_log(app, &instance.id, "launcher", &format!("+ {} {}", entry.title, entry.version_number));
        manifest.insert(proj.id.clone(), entry.clone());
        added.push(entry);

        for dep in version.dependencies.iter().filter(|d| d.dependency_type == "required") {
            match (&dep.project_id, &dep.version_id) {
                (Some(p), v) => queue.push_back((p.clone(), v.clone(), true)),
                (None, Some(v)) => {
                    let dv = get_version(state, v).await?;
                    queue.push_back((dv.project_id, Some(dv.id), true));
                }
                _ => {}
            }
        }
    }

    let concurrency = state.settings.read().await.download_concurrency;
    download_all(app, &state.http, jobs, concurrency, false, &instance.id, "Contenuti").await?;
    save_manifest(state, &instance.id, &manifest).await?;
    Ok(added)
}

// ---------------------------------------------------------------------------
// Modpack .mrpack
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MrIndex {
    name: String,
    files: Vec<MrFile>,
    dependencies: HashMap<String, String>,
}

#[derive(Deserialize)]
struct MrFile {
    path: String,
    hashes: HashMap<String, String>,
    downloads: Vec<String>,
    #[serde(default, rename = "fileSize")]
    file_size: Option<u64>,
    #[serde(default)]
    env: Option<HashMap<String, String>>,
}

pub async fn install_modpack(
    app: &AppHandle,
    state: &AppState,
    project: &str,
    version_id: Option<String>,
    name: Option<String>,
) -> Result<Instance> {
    let proj = get_project(state, project).await?;
    let version = match version_id {
        Some(v) => get_version(state, &v).await?,
        None => pick_version(project_versions(state, &proj.id, &[], None).await?)
            .ok_or_else(|| msg("Modpack senza versioni"))?,
    };
    let file = primary_file(&version).ok_or_else(|| msg("Versione senza file"))?.clone();
    let pack_path = state.paths.cache().join("modpacks").join(&file.filename);
    download_all(
        app,
        &state.http,
        vec![DownloadJob::new(file.url.clone(), pack_path.clone()).sha1(file.hashes.get("sha1").cloned())],
        1,
        false,
        "modpack",
        "Modpack",
    )
    .await?;

    let pack_clone = pack_path.clone();
    let index: MrIndex = tokio::task::spawn_blocking(move || -> Result<MrIndex> {
        let mut zip = zip::ZipArchive::new(std::fs::File::open(&pack_clone)?)?;
        let mut text = String::new();
        zip.by_name("modrinth.index.json")?.read_to_string(&mut text)?;
        Ok(serde_json::from_str(&text)?)
    })
    .await??;

    let mc = index
        .dependencies
        .get("minecraft")
        .cloned()
        .ok_or_else(|| msg("mrpack senza versione di Minecraft"))?;
    let (loader, loader_version) = if let Some(v) = index.dependencies.get("fabric-loader") {
        (Loader::Fabric, Some(v.clone()))
    } else if let Some(v) = index.dependencies.get("quilt-loader") {
        (Loader::Quilt, Some(v.clone()))
    } else if let Some(v) = index.dependencies.get("neoforge") {
        (Loader::NeoForge, Some(v.clone()))
    } else if let Some(v) = index.dependencies.get("forge") {
        (Loader::Forge, Some(format!("{mc}-{v}")))
    } else {
        (Loader::Vanilla, None)
    };

    let instance = instances::create(
        state,
        CreateInstanceRequest {
            name: name.unwrap_or_else(|| index.name.clone()),
            mc_version: mc,
            loader,
            loader_version,
            min_ram_mb: None,
            max_ram_mb: None,
            icon: proj.icon_url.clone(),
        },
    )
    .await?;
    let game_dir = state.paths.game_dir(&instance.id);

    let jobs: Vec<DownloadJob> = index
        .files
        .iter()
        .filter(|f| {
            f.env
                .as_ref()
                .and_then(|e| e.get("client"))
                .map(|c| c != "unsupported")
                .unwrap_or(true)
        })
        .filter_map(|f| {
            let target = safe_join(&game_dir, &f.path)?;
            let url = f.downloads.first()?.clone();
            Some(DownloadJob::new(url, target).sha1(f.hashes.get("sha1").cloned()).size(f.file_size))
        })
        .collect();

    // Overrides
    let (pack, dest) = (pack_path.clone(), game_dir.clone());
    tokio::task::spawn_blocking(move || -> Result<()> {
        let mut zip = zip::ZipArchive::new(std::fs::File::open(&pack)?)?;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i)?;
            let Some(name) = entry.enclosed_name() else { continue };
            let name = name.to_string_lossy().replace('\\', "/");
            let rel = name
                .strip_prefix("client-overrides/")
                .or_else(|| name.strip_prefix("overrides/"));
            let Some(rel) = rel else { continue };
            let Some(target) = safe_join(&dest, rel) else { continue };
            if entry.is_dir() {
                std::fs::create_dir_all(&target)?;
                continue;
            }
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf)?;
            std::fs::write(target, buf)?;
        }
        Ok(())
    })
    .await??;

    let concurrency = state.settings.read().await.download_concurrency;
    download_all(app, &state.http, jobs, concurrency, false, &instance.id, "File modpack").await?;
    emit_log(app, &instance.id, "launcher", &format!("Modpack {} installato", index.name));
    Ok(instance)
}

// ---------------------------------------------------------------------------
// Contenuti locali
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalContent {
    pub file_name: String,
    pub enabled: bool,
    pub size: u64,
    pub title: String,
    pub version_number: Option<String>,
    pub project_id: Option<String>,
    pub icon_url: Option<String>,
    pub dependency: bool,
}

fn validate_dir(dir: &str) -> Result<()> {
    match dir {
        "mods" | "shaderpacks" | "resourcepacks" => Ok(()),
        _ => Err(msg("Cartella non valida")),
    }
}

fn validate_file_name(name: &str) -> Result<()> {
    if name.is_empty() || name.contains(['/', '\\']) || name.contains("..") {
        return Err(msg("Nome file non valido"));
    }
    Ok(())
}

pub async fn list_local(state: &AppState, instance_id: &str, dir: &str) -> Result<Vec<LocalContent>> {
    validate_dir(dir)?;
    let manifest = load_manifest(state, instance_id).await;
    let by_file: HashMap<&str, &ContentEntry> =
        manifest.values().map(|e| (e.file_name.as_str(), e)).collect();
    let folder = state.paths.game_dir(instance_id).join(dir);
    let mut out = Vec::new();
    let Ok(mut entries) = tokio::fs::read_dir(&folder).await else {
        return Ok(out);
    };
    while let Some(entry) = entries.next_entry().await? {
        let meta = entry.metadata().await?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        if meta.is_dir() && dir != "resourcepacks" && dir != "shaderpacks" {
            continue;
        }
        let enabled = !file_name.ends_with(".disabled");
        let base = file_name.trim_end_matches(".disabled");
        let known = by_file.get(base);
        out.push(LocalContent {
            title: known.map(|e| e.title.clone()).unwrap_or_else(|| base.to_string()),
            version_number: known.map(|e| e.version_number.clone()),
            project_id: known.map(|e| e.project_id.clone()),
            icon_url: known.and_then(|e| e.icon_url.clone()),
            dependency: known.map(|e| e.dependency).unwrap_or(false),
            size: meta.len(),
            enabled,
            file_name,
        });
    }
    out.sort_by_key(|c| c.title.to_lowercase());
    Ok(out)
}

// ---------------------------------------------------------------------------
// Comandi IPC
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn modrinth_search(
    state: State<'_, AppState>,
    query: String,
    project_type: String,
    game_version: Option<String>,
    loader: Option<String>,
    offset: Option<u32>,
    sort: Option<String>,
) -> Result<SearchResponse> {
    let mut facets: Vec<Vec<String>> = vec![vec![format!("project_type:{project_type}")]];
    if let Some(gv) = game_version.filter(|v| !v.is_empty()) {
        facets.push(vec![format!("versions:{gv}")]);
    }
    if let Some(l) = loader.filter(|l| !l.is_empty() && l != "vanilla") {
        if project_type == "mod" || project_type == "modpack" {
            let mut group = vec![format!("categories:{l}")];
            if l == "quilt" {
                group.push("categories:fabric".into());
            }
            facets.push(group);
        }
    }
    let resp = state
        .http
        .get(format!("{API}/search"))
        .query(&[
            ("query", query),
            ("facets", serde_json::to_string(&facets)?),
            ("offset", offset.unwrap_or(0).to_string()),
            ("limit", "24".to_string()),
            ("index", sort.unwrap_or_else(|| "relevance".into())),
        ])
        .send()
        .await?
        .error_for_status()?;
    Ok(resp.json().await?)
}

#[tauri::command]
pub async fn modrinth_install(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: String,
    project: String,
    version_id: Option<String>,
) -> Result<Vec<ContentEntry>> {
    let instance = instances::load(state.inner(), &instance_id).await?;
    let result = install_project(&app, state.inner(), &instance, &project, version_id).await;
    let _ = tauri::Emitter::emit(&app, "task-finished", &instance_id);
    result
}

#[tauri::command]
pub async fn modrinth_install_modpack(
    app: AppHandle,
    state: State<'_, AppState>,
    project: String,
    version_id: Option<String>,
    name: Option<String>,
) -> Result<Instance> {
    let result = install_modpack(&app, state.inner(), &project, version_id, name).await;
    let _ = tauri::Emitter::emit(&app, "task-finished", "modpack");
    if let Ok(inst) = &result {
        let _ = tauri::Emitter::emit(&app, "task-finished", &inst.id);
    }
    result
}

#[tauri::command]
pub async fn list_content(state: State<'_, AppState>, instance_id: String, dir: String) -> Result<Vec<LocalContent>> {
    list_local(state.inner(), &instance_id, &dir).await
}

#[tauri::command]
pub async fn toggle_content(
    state: State<'_, AppState>,
    instance_id: String,
    dir: String,
    file_name: String,
    enabled: bool,
) -> Result<String> {
    validate_dir(&dir)?;
    validate_file_name(&file_name)?;
    let folder = state.paths.game_dir(&instance_id).join(&dir);
    let base = file_name.trim_end_matches(".disabled").to_string();
    let new_name = if enabled { base.clone() } else { format!("{base}.disabled") };
    if new_name != file_name {
        tokio::fs::rename(folder.join(&file_name), folder.join(&new_name)).await?;
    }
    Ok(new_name)
}

#[tauri::command]
pub async fn delete_content(
    state: State<'_, AppState>,
    instance_id: String,
    dir: String,
    file_name: String,
) -> Result<()> {
    validate_dir(&dir)?;
    validate_file_name(&file_name)?;
    let path = state.paths.game_dir(&instance_id).join(&dir).join(&file_name);
    if path.is_dir() {
        tokio::fs::remove_dir_all(&path).await?;
    } else {
        tokio::fs::remove_file(&path).await?;
    }
    let base = file_name.trim_end_matches(".disabled");
    let mut manifest = load_manifest(state.inner(), &instance_id).await;
    manifest.retain(|_, e| e.file_name != base);
    save_manifest(state.inner(), &instance_id, &manifest).await
}
