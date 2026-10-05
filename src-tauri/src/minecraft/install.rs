//! Download e verifica di client.jar, librerie, natives e asset.

use std::{io::Read, path::PathBuf};

use tauri::AppHandle;

use super::version::{
    maven_path, merge, os_name, rules_allow, AssetIndex, Features, ManifestEntry, VersionJson, VersionManifest,
    LIBRARIES_URL, RESOURCES_URL, VERSION_MANIFEST_URL,
};
use crate::{
    download::{download_all, DownloadJob},
    error::{msg, Result},
    state::AppState,
    util,
};

/// Risultato della risoluzione di una versione, pronto per il launch.
pub struct PreparedVersion {
    pub version: VersionJson,
    /// Id della versione vanilla alla radice della catena `inheritsFrom`.
    pub base_id: String,
    pub classpath: Vec<PathBuf>,
    pub natives_jars: Vec<PathBuf>,
    pub assets_index_name: String,
    pub assets_root: PathBuf,
}

/// Manifest Mojang con cache su disco (fallback offline).
pub async fn version_manifest(state: &AppState) -> Result<VersionManifest> {
    let cache = state.paths.meta().join("version_manifest_v2.json");
    match util::get_json::<VersionManifest>(&state.http, VERSION_MANIFEST_URL).await {
        Ok(manifest) => {
            let _ = util::write_atomic(&cache, &serde_json::to_vec(&manifest)?).await;
            Ok(manifest)
        }
        Err(e) => util::read_json(&cache).await.map_err(|_| e),
    }
}

async fn manifest_entry(state: &AppState, id: &str) -> Result<ManifestEntry> {
    version_manifest(state)
        .await?
        .versions
        .into_iter()
        .find(|v| v.id == id)
        .ok_or_else(|| msg(format!("Versione Minecraft sconosciuta: {id}")))
}

/// Legge il version JSON da disco o lo scarica dal manifest Mojang.
async fn ensure_version_json(state: &AppState, id: &str) -> Result<VersionJson> {
    let path = state.paths.version_json(id);
    if path.is_file() {
        return util::read_json(&path).await;
    }
    let entry = manifest_entry(state, id).await?;
    let bytes = state.http.get(&entry.url).send().await?.error_for_status()?.bytes().await?;
    let json: VersionJson = serde_json::from_slice(&bytes)?;
    util::write_atomic(&path, &bytes).await?;
    Ok(json)
}

/// Risolve la catena `inheritsFrom` e restituisce (json unito, id vanilla di base).
pub async fn resolve_version(state: &AppState, id: &str) -> Result<(VersionJson, String)> {
    let mut chain = Vec::new();
    let mut next = Some(id.to_string());
    while let Some(current) = next {
        if chain.len() > 8 {
            return Err(msg("Catena inheritsFrom troppo profonda"));
        }
        let json = ensure_version_json(state, &current).await?;
        next = json.inherits_from.clone();
        chain.push(json);
    }
    let mut merged = chain.pop().ok_or_else(|| msg("versione vuota"))?;
    let base_id = merged.id.clone();
    while let Some(child) = chain.pop() {
        merged = merge(child, merged);
    }
    Ok((merged, base_id))
}

/// Installa (o verifica, se `verify`) tutti i file necessari per avviare `version_id`.
pub async fn install_version(
    app: &AppHandle,
    state: &AppState,
    version_id: &str,
    game_dir: &std::path::Path,
    verify: bool,
    task: &str,
) -> Result<PreparedVersion> {
    let (version, base_id) = resolve_version(state, version_id).await?;
    let libs_dir = state.paths.libraries();
    let features = Features::default();
    let concurrency = state.settings.read().await.download_concurrency;

    let mut jobs = Vec::new();
    let mut classpath: Vec<PathBuf> = Vec::new();
    let mut natives_jars = Vec::new();

    for lib in &version.libraries {
        if !rules_allow(lib.rules.as_ref(), &features) {
            continue;
        }
        let downloads = lib.downloads.as_ref();

        // --- artifact principale ---
        let artifact = downloads.and_then(|d| d.artifact.as_ref());
        let old_style_natives_only = lib.natives.is_some() && artifact.is_none();
        if !old_style_natives_only {
            let (rel, url, sha1, size) = match artifact {
                Some(a) => {
                    let rel = a.path.clone().or_else(|| maven_path(&lib.name)).unwrap_or_default();
                    (rel, a.url.clone(), a.sha1.clone(), a.size)
                }
                None => {
                    let rel = maven_path(&lib.name).unwrap_or_default();
                    let base = lib.url.clone().unwrap_or_else(|| LIBRARIES_URL.to_string());
                    let url = format!("{}/{}", base.trim_end_matches('/'), rel);
                    (rel, url, lib.sha1.clone(), lib.size)
                }
            };
            if !rel.is_empty() {
                let path = libs_dir.join(&rel);
                // URL vuoto = file generato localmente dall'installer Forge/NeoForge.
                if !url.is_empty() {
                    jobs.push(DownloadJob::new(url, path.clone()).sha1(sha1).size(size));
                }
                if lib.name.contains(":natives-") {
                    natives_jars.push(path.clone());
                }
                if !classpath.contains(&path) {
                    classpath.push(path);
                }
            }
        }

        // --- natives vecchio stile (classifiers) ---
        if let Some(natives) = &lib.natives {
            if let Some(classifier) = natives.get(os_name()) {
                let arch_bits = if cfg!(target_pointer_width = "64") { "64" } else { "32" };
                let classifier = classifier.replace("${arch}", arch_bits);
                if let Some(a) = downloads
                    .and_then(|d| d.classifiers.as_ref())
                    .and_then(|c| c.get(&classifier))
                {
                    let rel = a
                        .path
                        .clone()
                        .or_else(|| maven_path(&format!("{}:{}", lib.name, classifier)))
                        .unwrap_or_default();
                    let path = libs_dir.join(rel);
                    jobs.push(DownloadJob::new(a.url.clone(), path.clone()).sha1(a.sha1.clone()).size(a.size));
                    natives_jars.push(path);
                }
            }
        }
    }

    // --- client.jar ---
    let client_jar = state.paths.version_jar(&base_id);
    if let Some(client) = version.downloads.as_ref().and_then(|d| d.client.as_ref()) {
        jobs.push(
            DownloadJob::new(client.url.clone(), client_jar.clone())
                .sha1(client.sha1.clone())
                .size(client.size),
        );
    }
    classpath.push(client_jar);

    download_all(app, &state.http, jobs, concurrency, verify, task, "Librerie").await?;

    // --- asset ---
    let assets_root = state.paths.assets();
    let mut assets_index_name = version.assets.clone().unwrap_or_else(|| "legacy".into());
    if let Some(index_ref) = &version.asset_index {
        assets_index_name = index_ref.id.clone();
        let index_path = assets_root.join("indexes").join(format!("{}.json", index_ref.id));
        download_all(
            app,
            &state.http,
            vec![DownloadJob::new(index_ref.url.clone(), index_path.clone()).sha1(index_ref.sha1.clone())],
            1,
            verify,
            task,
            "Indice asset",
        )
        .await?;
        let index: AssetIndex = util::read_json(&index_path).await?;

        let objects_dir = assets_root.join("objects");
        let asset_jobs: Vec<DownloadJob> = index
            .objects
            .values()
            .map(|obj| {
                let prefix = &obj.hash[..2];
                DownloadJob::new(
                    format!("{RESOURCES_URL}/{prefix}/{}", obj.hash),
                    objects_dir.join(prefix).join(&obj.hash),
                )
                .sha1(Some(obj.hash.clone()))
                .size(Some(obj.size))
            })
            .collect();
        download_all(app, &state.http, asset_jobs, concurrency, verify, task, "Asset").await?;

        // Versioni pre-1.7: asset copiati in una struttura "virtuale".
        if index.is_virtual || index.map_to_resources {
            let target_root = if index.map_to_resources {
                game_dir.join("resources")
            } else {
                assets_root.join("virtual").join(&index_ref.id)
            };
            for (name, obj) in &index.objects {
                let Some(dest) = crate::paths::safe_join(&target_root, name) else { continue };
                if dest.is_file() {
                    continue;
                }
                if let Some(parent) = dest.parent() {
                    tokio::fs::create_dir_all(parent).await?;
                }
                let src = objects_dir.join(&obj.hash[..2]).join(&obj.hash);
                tokio::fs::copy(&src, &dest).await?;
            }
        }
    }

    Ok(PreparedVersion {
        version,
        base_id,
        classpath,
        natives_jars,
        assets_index_name,
        assets_root,
    })
}

/// Estrae i natives (dll/so/dylib) nella cartella dell'istanza.
pub async fn extract_natives(jars: Vec<PathBuf>, dest: PathBuf) -> Result<()> {
    tokio::task::spawn_blocking(move || -> Result<()> {
        let _ = std::fs::remove_dir_all(&dest);
        std::fs::create_dir_all(&dest)?;
        for jar in jars {
            let Ok(file) = std::fs::File::open(&jar) else { continue };
            let mut zip = zip::ZipArchive::new(file)?;
            for i in 0..zip.len() {
                let mut entry = zip.by_index(i)?;
                if entry.is_dir() {
                    continue;
                }
                let Some(name) = entry.enclosed_name() else { continue };
                if name.starts_with("META-INF") {
                    continue;
                }
                let file_name = match name.file_name() {
                    Some(f) => f.to_owned(),
                    None => continue,
                };
                let lower = file_name.to_string_lossy().to_lowercase();
                if !(lower.ends_with(".dll")
                    || lower.ends_with(".so")
                    || lower.ends_with(".dylib")
                    || lower.ends_with(".jnilib"))
                {
                    continue;
                }
                let mut buf = Vec::with_capacity(entry.size() as usize);
                entry.read_to_end(&mut buf)?;
                std::fs::write(dest.join(file_name), buf)?;
            }
        }
        Ok(())
    })
    .await?
}
