//! Motore AI locale "zero-config": scarica e gestisce una copia portable di Ollama dentro la
//! cartella dati dell'app e la avvia da solo al primo utilizzo. L'utente non deve installare
//! nulla a mano; di default usa un modello molto leggero (qwen2.5:0.5b, ~400 MB).
//!
//! Lo streaming della chat resta gestito da `ai::ollama_chat`, puntato al server locale che
//! avviamo qui: questo modulo si occupa solo di "far esistere" il motore e il modello.

use std::{path::PathBuf, process::Stdio, time::Duration};

use futures::StreamExt;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncWriteExt;

use crate::{
    error::{msg, Result},
    state::AppState,
    util,
};

/// Porta dedicata al server locale gestito da Nexus (separata dall'eventuale Ollama dell'utente su 11434).
const LOCAL_PORT: u16 = 11501;
const SETUP_TASK: &str = "local-ai-setup";
/// Modello di default: Llama 3.2 1B, buon compromesso qualità/leggerezza.
pub const DEFAULT_LOCAL_MODEL: &str = "llama3.2:1b";

/// Stato del processo del server locale.
#[derive(Default)]
pub struct LocalAi {
    pub child: Option<tokio::process::Child>,
    pub base_url: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiStatus {
    pub engine_installed: bool,
    pub server_running: bool,
    pub base_url: Option<String>,
    pub models: Vec<String>,
    pub default_model: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SetupProgress {
    task: String,
    stage: String,
    done: u64,
    total: Option<u64>,
}

fn base_url() -> String {
    format!("http://127.0.0.1:{LOCAL_PORT}")
}

fn exe_name() -> &'static str {
    if cfg!(windows) {
        "ollama.exe"
    } else {
        "ollama"
    }
}

fn managed_dir(state: &AppState) -> PathBuf {
    state.paths.root.join("engine").join("ollama")
}

fn models_dir(state: &AppState) -> PathBuf {
    state.paths.root.join("engine").join("models")
}

/// URL del pacchetto portable ufficiale per la piattaforma corrente.
fn portable_url() -> Result<&'static str> {
    Ok(match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", _) => "https://github.com/ollama/ollama/releases/latest/download/ollama-windows-amd64.zip",
        _ => {
            return Err(msg(
                "Su questo sistema installa Ollama manualmente da https://ollama.com/download, \
                 poi Nexus lo userà automaticamente.",
            ))
        }
    })
}

/// Cerca l'eseguibile: prima la copia gestita da Nexus, poi una eventuale installazione di sistema.
async fn find_binary(state: &AppState) -> Option<PathBuf> {
    let managed = managed_dir(state).join(exe_name());
    if managed.is_file() {
        return Some(managed);
    }
    // installazione di sistema nel PATH
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join(exe_name());
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn emit(app: &AppHandle, stage: &str, done: u64, total: Option<u64>) {
    let _ = app.emit(
        "task-progress",
        SetupProgress {
            task: SETUP_TASK.to_string(),
            stage: stage.to_string(),
            done,
            total,
        },
    );
}

/// Scarica ed estrae Ollama portable nella cartella dati. Solo Windows (altrove si usa quello di sistema).
async fn download_engine(app: &AppHandle, state: &AppState) -> Result<PathBuf> {
    let url = portable_url()?;
    let dir = managed_dir(state);
    tokio::fs::create_dir_all(&dir).await?;
    let archive = dir.join("ollama-portable.zip");

    emit(app, "Download del motore AI locale…", 0, None);
    let resp = state.http.get(url).send().await?.error_for_status()?;
    let total = resp.content_length();
    let mut file = tokio::fs::File::create(&archive).await?;
    let mut downloaded = 0u64;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        file.write_all(&chunk).await?;
        downloaded += chunk.len() as u64;
        emit(app, "Download del motore AI locale…", downloaded, total);
    }
    file.flush().await?;
    drop(file);

    emit(app, "Estrazione del motore…", 0, None);
    let dir_clone = dir.clone();
    let archive_clone = archive.clone();
    tokio::task::spawn_blocking(move || -> Result<()> {
        let f = std::fs::File::open(&archive_clone)?;
        let mut zip = zip::ZipArchive::new(f)?;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i)?;
            let Some(name) = entry.enclosed_name() else { continue };
            let out = dir_clone.join(name);
            if entry.is_dir() {
                std::fs::create_dir_all(&out)?;
                continue;
            }
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut writer = std::fs::File::create(&out)?;
            std::io::copy(&mut entry, &mut writer)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&out, std::fs::Permissions::from_mode(0o755));
            }
        }
        Ok(())
    })
    .await??;
    let _ = tokio::fs::remove_file(&archive).await;

    let exe = dir.join(exe_name());
    if !exe.is_file() {
        return Err(msg("Motore AI scaricato ma eseguibile non trovato nell'archivio"));
    }
    Ok(exe)
}

async fn server_reachable(http: &reqwest::Client, base: &str) -> bool {
    http.get(format!("{base}/api/version"))
        .timeout(Duration::from_secs(2))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// Avvia il server locale (se non già attivo) e ne restituisce l'URL, atteso pronto.
async fn ensure_server(app: &AppHandle, state: &AppState, exe: &PathBuf) -> Result<String> {
    let base = base_url();
    if server_reachable(&state.http, &base).await {
        state.local_ai.lock().await.base_url = Some(base.clone());
        return Ok(base);
    }

    emit(app, "Avvio del motore AI…", 0, None);
    let models = models_dir(state);
    tokio::fs::create_dir_all(&models).await?;

    let mut cmd = tokio::process::Command::new(exe);
    cmd.arg("serve")
        .env("OLLAMA_HOST", format!("127.0.0.1:{LOCAL_PORT}"))
        .env("OLLAMA_MODELS", &models)
        // niente keep-alive infinito: libera la RAM quando l'utente non chatta
        .env("OLLAMA_KEEP_ALIVE", "5m")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    util::no_window(&mut cmd);
    let child = cmd
        .spawn()
        .map_err(|e| msg(format!("Impossibile avviare il motore AI locale: {e}")))?;

    {
        let mut guard = state.local_ai.lock().await;
        // se c'era un vecchio processo lo terminiamo
        if let Some(mut old) = guard.child.take() {
            let _ = old.kill().await;
        }
        guard.child = Some(child);
        guard.base_url = Some(base.clone());
    }

    // attesa che il server risponda (fino a ~40s: il primo avvio inizializza il runtime)
    for _ in 0..80 {
        if server_reachable(&state.http, &base).await {
            return Ok(base);
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    Err(msg("Il motore AI locale non ha risposto in tempo"))
}

async fn model_present(http: &reqwest::Client, base: &str, model: &str) -> bool {
    let Ok(resp) = http.get(format!("{base}/api/tags")).send().await else {
        return false;
    };
    let Ok(json) = resp.json::<serde_json::Value>().await else {
        return false;
    };
    json["models"]
        .as_array()
        .map(|arr| {
            arr.iter().any(|m| {
                m["name"]
                    .as_str()
                    .map(|n| n == model || n.split(':').next() == Some(model.split(':').next().unwrap_or(model)))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

/// Scarica il modello se assente, mostrando il progresso.
async fn ensure_model(app: &AppHandle, state: &AppState, base: &str, model: &str) -> Result<()> {
    if model_present(&state.http, base, model).await {
        return Ok(());
    }
    emit(app, &format!("Download del modello {model}…"), 0, None);
    let resp = state
        .http
        .post(format!("{base}/api/pull"))
        .json(&json!({ "model": model, "stream": true }))
        .send()
        .await
        .map_err(|e| msg(format!("Download modello non avviato: {e}")))?;
    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(msg(format!("Download modello fallito: {text}")));
    }

    let mut pending = Vec::<u8>::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        pending.extend_from_slice(&chunk?);
        while let Some(pos) = pending.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = pending.drain(..=pos).collect();
            if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&line) {
                if let Some(err) = val["error"].as_str() {
                    return Err(msg(format!("Ollama: {err}")));
                }
                let status = val["status"].as_str().unwrap_or("Download…");
                let done = val["completed"].as_u64().unwrap_or(0);
                let total = val["total"].as_u64();
                emit(app, &format!("{model}: {status}"), done, total);
            }
        }
    }
    Ok(())
}

/// Garantisce motore + server + modello pronti e restituisce l'URL base del server locale.
pub async fn ensure_ready(app: &AppHandle, state: &AppState, model: &str) -> Result<String> {
    let exe = match find_binary(state).await {
        Some(e) => e,
        None => download_engine(app, state).await?,
    };
    let base = ensure_server(app, state, &exe).await?;
    ensure_model(app, state, &base, model).await?;
    let _ = app.emit("task-finished", SETUP_TASK);
    Ok(base)
}

// ---------------------------------------------------------------------------
// Comandi IPC
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn local_ai_status(state: State<'_, AppState>) -> Result<LocalAiStatus> {
    let base = base_url();
    let server_running = server_reachable(&state.http, &base).await;
    let mut models = Vec::new();
    if server_running {
        if let Ok(resp) = state.http.get(format!("{base}/api/tags")).send().await {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                if let Some(arr) = json["models"].as_array() {
                    models = arr.iter().filter_map(|m| m["name"].as_str().map(str::to_string)).collect();
                }
            }
        }
    }
    Ok(LocalAiStatus {
        engine_installed: find_binary(state.inner()).await.is_some(),
        server_running,
        base_url: server_running.then(|| base.clone()),
        models,
        default_model: DEFAULT_LOCAL_MODEL.to_string(),
    })
}

/// Prepara il motore locale (download + avvio + modello) e restituisce l'URL su cui chattare.
#[tauri::command]
pub async fn local_ai_prepare(app: AppHandle, state: State<'_, AppState>, model: Option<String>) -> Result<String> {
    let model = model.filter(|m| !m.trim().is_empty()).unwrap_or_else(|| DEFAULT_LOCAL_MODEL.to_string());
    let result = ensure_ready(&app, state.inner(), &model).await;
    if result.is_err() {
        let _ = app.emit("task-finished", SETUP_TASK);
    }
    result
}
