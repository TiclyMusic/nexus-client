//! Proxy AI per provider locali (Ollama con download modelli integrato)
//! e API esterne personalizzate dell'utente (OpenAI / Groq / OpenRouter / NVIDIA / compatibili).

use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use crate::{
    error::{msg, Result},
    state::AppState,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamDelta {
    request_id: String,
    delta: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskProgress {
    task: String,
    stage: String,
    done: u64,
    total: Option<u64>,
}

fn check_url(url: &str) -> Result<String> {
    let clean = url.trim_end_matches('/').to_string();
    if !(clean.starts_with("http://") || clean.starts_with("https://")) {
        return Err(msg("URL endpoint non valido"));
    }
    Ok(clean)
}

#[tauri::command]
pub async fn ollama_models(state: State<'_, AppState>, base_url: String) -> Result<Vec<String>> {
    let base = check_url(&base_url)?;
    let json: serde_json::Value = state
        .http
        .get(format!("{base}/api/tags"))
        .send()
        .await
        .map_err(|_| msg("Ollama non raggiungibile: avvia Ollama con 'ollama serve'"))?
        .json()
        .await?;
    Ok(json["models"]
        .as_array()
        .map(|models| {
            models
                .iter()
                .filter_map(|m| m["name"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default())
}

#[tauri::command]
pub async fn ollama_pull(
    app: AppHandle,
    state: State<'_, AppState>,
    base_url: String,
    model: String,
) -> Result<()> {
    let base = check_url(&base_url)?;
    let resp = state
        .http
        .post(format!("{base}/api/pull"))
        .json(&json!({ "model": model, "stream": true }))
        .send()
        .await
        .map_err(|e| msg(format!("Impossibile avviare il download del modello: {e}")))?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(msg(format!("Errore download Ollama: {text}")));
    }

    let mut pending = Vec::<u8>::new();
    let mut stream = resp.bytes_stream();
    let task_name = format!("ollama-pull-{model}");

    while let Some(chunk) = stream.next().await {
        pending.extend_from_slice(&chunk?);
        while let Some(pos) = pending.iter().position(|b| *b == b'\n') {
            let line_bytes: Vec<u8> = pending.drain(..=pos).collect();
            if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&line_bytes) {
                let status = val["status"].as_str().unwrap_or("Scaricamento...");
                let done = val["completed"].as_u64().unwrap_or(0);
                let total = val["total"].as_u64();

                let _ = app.emit(
                    "task-progress",
                    TaskProgress {
                        task: task_name.clone(),
                        stage: format!("{model}: {status}"),
                        done,
                        total,
                    },
                );
            }
        }
    }

    let _ = app.emit("task-finished", task_name);
    Ok(())
}

#[tauri::command]
pub async fn ollama_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    request_id: String,
    base_url: String,
    model: String,
    messages: Vec<ChatMessage>,
) -> Result<String> {
    let base = check_url(&base_url)?;
    let resp = state
        .http
        .post(format!("{base}/api/chat"))
        .json(&json!({
            "model": model,
            "messages": messages,
            "stream": true,
            // num_predict: i modelli piccoli a volte entrano in loop; 1024 token bastano per ogni risposta
            "options": { "temperature": 0.4, "num_predict": 1024 }
        }))
        .send()
        .await
        .map_err(|_| msg("Ollama non raggiungibile: è in esecuzione? (ollama serve)"))?;
    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(msg(format!("Ollama: {text}")));
    }

    let mut full = String::new();
    let mut pending = Vec::<u8>::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        pending.extend_from_slice(&chunk?);
        while let Some(pos) = pending.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = pending.drain(..=pos).collect();
            let Ok(value) = serde_json::from_slice::<serde_json::Value>(&line) else { continue };
            if let Some(err) = value["error"].as_str() {
                return Err(msg(format!("Ollama: {err}")));
            }
            if let Some(delta) = value["message"]["content"].as_str() {
                if !delta.is_empty() {
                    full.push_str(delta);
                    let _ = app.emit(
                        "ai-stream",
                        StreamDelta {
                            request_id: request_id.clone(),
                            delta: delta.to_string(),
                        },
                    );
                }
            }
        }
    }
    Ok(full)
}

/// Chat completion verso qualsiasi API compatibile OpenAI (Groq, OpenAI, OpenRouter, NVIDIA, ecc.)
#[tauri::command]
pub async fn custom_api_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    request_id: String,
    endpoint: String,
    api_key: String,
    model: String,
    messages: Vec<ChatMessage>,
) -> Result<String> {
    if api_key.trim().is_empty() {
        return Err(msg("Nessuna API Key inserita. Inserisci la tua API key nelle Impostazioni Copilot."));
    }
    let base = check_url(&endpoint)?;
    let url = if base.ends_with("/chat/completions") {
        base
    } else if base.ends_with("/v1") {
        format!("{base}/chat/completions")
    } else {
        format!("{base}/v1/chat/completions")
    };

    let req = state
        .http
        .post(&url)
        .bearer_auth(api_key.trim())
        .json(&json!({
            "model": model.trim(),
            "messages": messages,
            "stream": true,
            "temperature": 0.4,
            "max_tokens": 1500
        }));

    let resp = req
        .send()
        .await
        .map_err(|e| msg(format!("Errore connessione all'API ({url}): {e}")))?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(msg(format!("Errore API ({url}): {text}")));
    }

    let mut full = String::new();
    let mut pending = Vec::<u8>::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        pending.extend_from_slice(&chunk?);
        while let Some(pos) = pending.iter().position(|b| *b == b'\n') {
            let line_bytes: Vec<u8> = pending.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes);
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Some(data) = trimmed.strip_prefix("data: ") {
                let data = data.trim();
                if data == "[DONE]" {
                    break;
                }
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(delta) = value["choices"][0]["delta"]["content"].as_str() {
                        if !delta.is_empty() {
                            full.push_str(delta);
                            let _ = app.emit(
                                "ai-stream",
                                StreamDelta {
                                    request_id: request_id.clone(),
                                    delta: delta.to_string(),
                                },
                            );
                        }
                    }
                }
            }
        }
    }
    Ok(full)
}
