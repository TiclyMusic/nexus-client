//! Modloader: Fabric, Quilt (profili JSON dai meta server), Forge e NeoForge (installer ufficiale).

use std::{io::Read, process::Stdio};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::{
    download::{download_all, DownloadJob},
    error::{msg, Result},
    state::AppState,
    util,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Loader {
    Vanilla,
    Fabric,
    Quilt,
    Forge,
    NeoForge,
}

impl Loader {
    /// Nome del loader usato da Modrinth nei filtri.
    pub fn modrinth_names(self) -> Vec<&'static str> {
        match self {
            Loader::Vanilla => vec![],
            Loader::Fabric => vec!["fabric"],
            // Quilt carica anche le mod Fabric.
            Loader::Quilt => vec!["quilt", "fabric"],
            Loader::Forge => vec!["forge"],
            Loader::NeoForge => vec!["neoforge"],
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoaderVersion {
    pub id: String,
    pub stable: bool,
}

#[derive(Deserialize)]
struct FabricLoaderEntry {
    loader: FabricLoaderInfo,
}

#[derive(Deserialize)]
struct FabricLoaderInfo {
    version: String,
    #[serde(default)]
    stable: Option<bool>,
}

/// Prefisso delle versioni NeoForge per una versione MC (`1.21.1` → `21.1.`, `26.1` → `26.1.0.`).
fn neoforge_prefix(mc: &str) -> String {
    let parts: Vec<&str> = mc.split('.').collect();
    if parts.first() == Some(&"1") {
        let minor = parts.get(1).copied().unwrap_or("0");
        let patch = parts.get(2).copied().unwrap_or("0");
        format!("{minor}.{patch}.")
    } else if parts.len() == 2 {
        format!("{mc}.0.")
    } else {
        format!("{mc}.")
    }
}

pub async fn list_versions(state: &AppState, loader: Loader, mc: &str) -> Result<Vec<LoaderVersion>> {
    let http = &state.http;
    Ok(match loader {
        Loader::Vanilla => vec![],
        Loader::Fabric => {
            let url = format!("https://meta.fabricmc.net/v2/versions/loader/{mc}");
            let entries: Vec<FabricLoaderEntry> = util::get_json(http, &url).await?;
            entries
                .into_iter()
                .map(|e| LoaderVersion {
                    stable: e.loader.stable.unwrap_or(true),
                    id: e.loader.version,
                })
                .collect()
        }
        Loader::Quilt => {
            let url = format!("https://meta.quiltmc.org/v3/versions/loader/{mc}");
            let entries: Vec<FabricLoaderEntry> = util::get_json(http, &url).await?;
            entries
                .into_iter()
                .map(|e| LoaderVersion {
                    stable: !e.loader.version.contains("beta") && !e.loader.version.contains("pre"),
                    id: e.loader.version,
                })
                .collect()
        }
        Loader::Forge => {
            let all: std::collections::HashMap<String, Vec<String>> = util::get_json(
                http,
                "https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json",
            )
            .await?;
            let mut list = all.get(mc).cloned().unwrap_or_default();
            list.reverse();
            list.into_iter().map(|id| LoaderVersion { id, stable: true }).collect()
        }
        Loader::NeoForge => {
            #[derive(Deserialize)]
            struct NeoVersions {
                versions: Vec<String>,
            }
            let all: NeoVersions = util::get_json(
                http,
                "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge",
            )
            .await?;
            let prefix = neoforge_prefix(mc);
            let mut list: Vec<LoaderVersion> = all
                .versions
                .into_iter()
                .filter(|v| v.starts_with(&prefix))
                .map(|id| LoaderVersion {
                    stable: !id.contains("beta") && !id.contains("alpha"),
                    id,
                })
                .collect();
            list.reverse();
            list
        }
    })
}

/// Sceglie la versione consigliata del loader (prima stabile).
pub async fn recommended_version(state: &AppState, loader: Loader, mc: &str) -> Result<Option<String>> {
    let versions = list_versions(state, loader, mc).await?;
    Ok(versions
        .iter()
        .find(|v| v.stable)
        .or(versions.first())
        .map(|v| v.id.clone()))
}

/// Installa il loader e restituisce l'id della version JSON risultante.
pub async fn install(
    app: &AppHandle,
    state: &AppState,
    loader: Loader,
    mc: &str,
    loader_version: &str,
    java: Option<&std::path::Path>,
    task: &str,
) -> Result<String> {
    match loader {
        Loader::Vanilla => Ok(mc.to_string()),
        Loader::Fabric | Loader::Quilt => {
            let url = if loader == Loader::Fabric {
                format!("https://meta.fabricmc.net/v2/versions/loader/{mc}/{loader_version}/profile/json")
            } else {
                format!("https://meta.quiltmc.org/v3/versions/loader/{mc}/{loader_version}/profile/json")
            };
            let profile: serde_json::Value = util::get_json(&state.http, &url).await?;
            let id = profile["id"]
                .as_str()
                .ok_or_else(|| msg("Profilo loader senza id"))?
                .to_string();
            util::write_atomic(&state.paths.version_json(&id), &serde_json::to_vec_pretty(&profile)?).await?;
            Ok(id)
        }
        Loader::Forge | Loader::NeoForge => {
            let java = java.ok_or_else(|| msg("Java necessario per eseguire l'installer"))?;
            install_with_installer(app, state, loader, loader_version, java, task).await
        }
    }
}

async fn install_with_installer(
    app: &AppHandle,
    state: &AppState,
    loader: Loader,
    loader_version: &str,
    java: &std::path::Path,
    task: &str,
) -> Result<String> {
    let url = match loader {
        Loader::Forge => format!(
            "https://maven.minecraftforge.net/net/minecraftforge/forge/{v}/forge-{v}-installer.jar",
            v = loader_version
        ),
        _ => format!(
            "https://maven.neoforged.net/releases/net/neoforged/neoforge/{v}/neoforge-{v}-installer.jar",
            v = loader_version
        ),
    };
    let installer = state.paths.cache().join("installers").join(format!(
        "{}-{}-installer.jar",
        if loader == Loader::Forge { "forge" } else { "neoforge" },
        loader_version
    ));
    download_all(app, &state.http, vec![DownloadJob::new(url, installer.clone())], 1, false, task, "Installer loader")
        .await?;

    // L'id della versione è dentro version.json nell'installer.
    let installer_clone = installer.clone();
    let version_id = tokio::task::spawn_blocking(move || -> Result<String> {
        let mut zip = zip::ZipArchive::new(std::fs::File::open(&installer_clone)?)?;
        let mut text = String::new();
        zip.by_name("version.json")?.read_to_string(&mut text)?;
        let json: serde_json::Value = serde_json::from_str(&text)?;
        json["id"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| msg("version.json dell'installer senza id"))
    })
    .await??;

    if state.paths.version_json(&version_id).is_file() {
        return Ok(version_id);
    }

    // Gli installer richiedono un launcher_profiles.json nella directory target.
    let meta = state.paths.meta();
    let profiles = meta.join("launcher_profiles.json");
    if !profiles.is_file() {
        util::write_atomic(&profiles, br#"{"profiles":{},"selectedProfile":null}"#).await?;
    }

    let mut cmd = tokio::process::Command::new(java);
    cmd.arg("-jar")
        .arg(&installer)
        .arg("--installClient")
        .arg(&meta)
        .current_dir(state.paths.cache())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    util::no_window(&mut cmd);
    let mut child = cmd.spawn()?;

    crate::minecraft::launch::emit_log(app, task, "launcher", "Esecuzione installer del modloader…");
    let stdout = child.stdout.take();
    let app2 = app.clone();
    let task2 = task.to_string();
    let reader = tokio::spawn(async move {
        if let Some(out) = stdout {
            let mut lines = BufReader::new(out).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                crate::minecraft::launch::emit_log(&app2, &task2, "info", &line);
            }
        }
    });
    let status = child.wait().await?;
    let _ = reader.await;
    if !status.success() {
        return Err(msg(format!(
            "L'installer {} è terminato con codice {:?}. Controlla la console per i dettagli.",
            loader_version,
            status.code()
        )));
    }
    if !state.paths.version_json(&version_id).is_file() {
        return Err(msg("Installer completato ma version JSON non trovato"));
    }
    Ok(version_id)
}
