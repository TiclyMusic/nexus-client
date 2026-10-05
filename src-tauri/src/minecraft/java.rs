//! Rilevamento delle installazioni Java e download del runtime ufficiale Mojang.

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    process::Stdio,
};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{
    download::{download_all, DownloadJob},
    error::{msg, Result},
    state::AppState,
    util,
};

const RUNTIME_INDEX: &str = "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaInstall {
    pub path: String,
    pub version: String,
    pub major: u32,
    pub managed: bool,
}

pub fn java_exe() -> &'static str {
    if cfg!(windows) {
        "java.exe"
    } else {
        "java"
    }
}

fn parse_major(version: &str) -> u32 {
    let mut parts = version.split(['.', '_', '-', '+']);
    let first: u32 = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    if first == 1 {
        parts.next().and_then(|p| p.parse().ok()).unwrap_or(0)
    } else {
        first
    }
}

/// Esegue `java -version` e ne interpreta l'output (stampato su stderr).
pub async fn probe(path: &Path) -> Option<JavaInstall> {
    let mut cmd = tokio::process::Command::new(path);
    cmd.arg("-version").stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
    util::no_window(&mut cmd);
    let out = tokio::time::timeout(std::time::Duration::from_secs(8), cmd.output())
        .await
        .ok()?
        .ok()?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stderr),
        String::from_utf8_lossy(&out.stdout)
    );
    let version = text.split('"').nth(1)?.to_string();
    Some(JavaInstall {
        major: parse_major(&version),
        path: path.to_string_lossy().to_string(),
        version,
        managed: false,
    })
}

fn candidate_paths(state: &AppState) -> Vec<PathBuf> {
    let exe = java_exe();
    let mut out = Vec::new();

    if let Ok(home) = std::env::var("JAVA_HOME") {
        out.push(PathBuf::from(home).join("bin").join(exe));
    }
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            out.push(dir.join(exe));
        }
    }

    let mut roots: Vec<PathBuf> = vec![state.paths.runtimes()];
    if cfg!(windows) {
        for base in [
            r"C:\Program Files\Java",
            r"C:\Program Files\Eclipse Adoptium",
            r"C:\Program Files\Microsoft",
            r"C:\Program Files\Zulu",
            r"C:\Program Files\BellSoft",
            r"C:\Program Files\Amazon Corretto",
            r"C:\Program Files (x86)\Java",
        ] {
            roots.push(PathBuf::from(base));
        }
    } else {
        for base in ["/usr/lib/jvm", "/usr/java", "/opt/java", "/opt"] {
            roots.push(PathBuf::from(base));
        }
        if let Ok(home) = std::env::var("HOME") {
            roots.push(PathBuf::from(&home).join(".sdkman/candidates/java"));
            roots.push(PathBuf::from(&home).join(".jdks"));
        }
    }

    for root in roots {
        if let Ok(entries) = std::fs::read_dir(&root) {
            for entry in entries.flatten() {
                out.push(entry.path().join("bin").join(exe));
            }
        }
    }
    out
}

pub async fn detect_all(state: &AppState) -> Vec<JavaInstall> {
    let runtimes = state.paths.runtimes();
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for path in candidate_paths(state) {
        if !path.is_file() {
            continue;
        }
        let canonical = std::fs::canonicalize(&path).unwrap_or(path.clone());
        if !seen.insert(canonical) {
            continue;
        }
        if let Some(mut install) = probe(&path).await {
            install.managed = path.starts_with(&runtimes);
            result.push(install);
        }
    }
    result.sort_by(|a, b| b.major.cmp(&a.major));
    result
}

fn platform_key() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => "windows-x64",
        ("windows", "aarch64") => "windows-arm64",
        ("windows", _) => "windows-x86",
        ("macos", "aarch64") => "mac-os-arm64",
        ("macos", _) => "mac-os",
        ("linux", "x86") => "linux-i386",
        _ => "linux",
    }
}

#[derive(Deserialize)]
struct RuntimeManifest {
    files: std::collections::HashMap<String, RuntimeFile>,
}

#[derive(Deserialize)]
struct RuntimeFile {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    executable: bool,
    #[serde(default)]
    downloads: Option<RuntimeDownloads>,
}

#[derive(Deserialize)]
struct RuntimeDownloads {
    raw: RuntimeRaw,
}

#[derive(Deserialize)]
struct RuntimeRaw {
    url: String,
    sha1: String,
    size: u64,
}

/// Scarica (se necessario) il runtime Java Mojang `component` (es. `java-runtime-delta`)
/// e restituisce il path dell'eseguibile.
pub async fn ensure_runtime(app: &AppHandle, state: &AppState, component: &str, task: &str) -> Result<PathBuf> {
    let dir = state.paths.runtimes().join(component);
    let exe = dir.join("bin").join(java_exe());
    let marker = dir.join(".nexus-installed");
    if exe.is_file() && marker.is_file() {
        return Ok(exe);
    }

    let index: serde_json::Value = util::get_json(&state.http, RUNTIME_INDEX).await?;
    let manifest_url = index[platform_key()][component][0]["manifest"]["url"]
        .as_str()
        .ok_or_else(|| msg(format!("Runtime Java '{component}' non disponibile per {}", platform_key())))?
        .to_string();
    let manifest: RuntimeManifest = util::get_json(&state.http, &manifest_url).await?;

    let mut jobs = Vec::new();
    for (rel, file) in &manifest.files {
        let Some(target) = crate::paths::safe_join(&dir, rel) else { continue };
        match file.kind.as_str() {
            "directory" => tokio::fs::create_dir_all(&target).await?,
            "file" => {
                if let Some(dl) = &file.downloads {
                    let mut job = DownloadJob::new(dl.raw.url.clone(), target)
                        .sha1(Some(dl.raw.sha1.clone()))
                        .size(Some(dl.raw.size));
                    job.executable = file.executable;
                    jobs.push(job);
                }
            }
            // I symlink servono solo su macOS (bundle .app); ignorati su Windows/Linux.
            _ => {}
        }
    }

    let concurrency = state.settings.read().await.download_concurrency;
    download_all(app, &state.http, jobs, concurrency, false, task, "Java runtime").await?;

    if !exe.is_file() {
        return Err(msg("Runtime Java scaricato ma eseguibile non trovato"));
    }
    tokio::fs::write(&marker, component).await?;
    Ok(exe)
}

/// Sceglie il Java per una versione: override istanza → globale → runtime Mojang → Java di sistema.
pub async fn select_java(
    app: &AppHandle,
    state: &AppState,
    instance_override: Option<&str>,
    component: Option<&str>,
    major: u32,
    task: &str,
) -> Result<PathBuf> {
    let (global, auto_java) = {
        let s = state.settings.read().await;
        (s.java_path.clone(), s.auto_java)
    };

    // Un path Java esplicito (dell'istanza o globale) viene usato solo se la sua versione
    // coincide con quella richiesta dalla versione di Minecraft: altrimenti l'avvio andrebbe
    // in UnsupportedClassVersionError (es. Java 17 con Minecraft 1.21, che richiede Java 21).
    for candidate in [instance_override.map(str::to_string), global].into_iter().flatten() {
        let candidate = candidate.trim().to_string();
        if candidate.is_empty() {
            continue;
        }
        let path = PathBuf::from(&candidate);
        match probe(&path).await {
            Some(info) if info.major == major => return Ok(path),
            Some(info) => log::warn!(
                "Java {} in '{candidate}' non è compatibile con questa versione (serve Java {major}): lo ignoro",
                info.major
            ),
            None => log::warn!("'{candidate}' non è un eseguibile Java valido: lo ignoro"),
        }
    }

    if auto_java {
        let component = component.unwrap_or(if major <= 8 { "jre-legacy" } else { "java-runtime-gamma" });
        match ensure_runtime(app, state, component, task).await {
            Ok(exe) => return Ok(exe),
            Err(e) => log::warn!("runtime Mojang non disponibile: {e}"),
        }
    }
    detect_all(state)
        .await
        .into_iter()
        .find(|j| j.major == major)
        .map(|j| PathBuf::from(j.path))
        .ok_or_else(|| {
            msg(format!(
                "Java {major} non trovato. Installa Java {major} oppure abilita il download automatico nelle Impostazioni."
            ))
        })
}

#[cfg(test)]
mod tests {
    #[test]
    fn majors() {
        assert_eq!(super::parse_major("1.8.0_392"), 8);
        assert_eq!(super::parse_major("17.0.10"), 17);
        assert_eq!(super::parse_major("21"), 21);
    }
}
