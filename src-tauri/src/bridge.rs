//! Ponte locale launcher ↔ mod Nexus Companion.
//!
//! Piccolo server HTTP su 127.0.0.1 (porta casuale) protetto da un token: porta e token
//! arrivano al gioco come proprietà JVM (`-Dnexus.bridge=porta:token`). La mod legge amici e
//! richieste (`GET /state`) e chiede al launcher di inviare richieste, inviti e messaggi;
//! il launcher ci mette la sessione del server amici, così la mod non gestisce credenziali.

use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

use crate::{friends, state::AppState};

const MAX_EVENTS: usize = 50;
const FRIENDS_CACHE: Duration = Duration::from_secs(12);
static SEQ: AtomicU64 = AtomicU64::new(0);

/// Proprietà JVM da passare al gioco, se il ponte è attivo.
pub fn jvm_arg(state: &AppState) -> Option<String> {
    state.bridge.get().map(|(port, token)| format!("-Dnexus.bridge={port}:{token}"))
}

/// Evento da consegnare alla mod (richiesta di entrare, invito, messaggio).
pub fn push_event(state: &AppState, event: &friends::InboxMessage) {
    let seq = SEQ.fetch_add(1, Ordering::Relaxed) + 1;
    let mut value = serde_json::to_value(event).unwrap_or(Value::Null);
    value["seq"] = json!(seq);
    let mut events = state.bridge_events.lock().unwrap();
    events.push_back(value);
    while events.len() > MAX_EVENTS {
        events.pop_front();
    }
}

pub async fn start(app: AppHandle) {
    let Ok(listener) = TcpListener::bind("127.0.0.1:0").await else { return };
    let Ok(addr) = listener.local_addr() else { return };
    let token = uuid::Uuid::new_v4().simple().to_string();
    let state = app.state::<AppState>();
    let _ = state.bridge.set((addr.port(), token));
    loop {
        let Ok((stream, _)) = listener.accept().await else { continue };
        let app = app.clone();
        tokio::spawn(async move {
            let _ = tokio::time::timeout(Duration::from_secs(20), handle(app, stream)).await;
        });
    }
}

async fn handle(app: AppHandle, mut stream: TcpStream) -> std::io::Result<()> {
    // richiesta minima: intestazioni + corpo (Content-Length), al massimo 64 KB
    let mut buf = Vec::with_capacity(2048);
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            return Ok(());
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
        }
        if buf.len() > 65536 {
            return Ok(());
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let mut lines = head.lines();
    let mut first = lines.next().unwrap_or("").split_whitespace();
    let (method, target) = (first.next().unwrap_or("").to_string(), first.next().unwrap_or("").to_string());
    let header = |name: &str| {
        head.lines()
            .skip(1)
            .find_map(|l| l.split_once(':').filter(|(k, _)| k.trim().eq_ignore_ascii_case(name)).map(|(_, v)| v.trim().to_string()))
    };
    let length: usize = header("content-length").and_then(|v| v.parse().ok()).unwrap_or(0).min(65536);
    while buf.len() < head_end + length {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let body: Value = serde_json::from_slice(&buf[head_end..(head_end + length).min(buf.len())]).unwrap_or(Value::Null);

    let state = app.state::<AppState>();
    let authorized = state.bridge.get().is_some_and(|(_, t)| header("x-nexus-token").as_deref() == Some(t.as_str()));
    let (status, reply) = if !authorized {
        (401, json!({ "error": "token non valido" }))
    } else {
        route(&state, &method, &target, body).await
    };

    let text = reply.to_string();
    let response = format!(
        "HTTP/1.1 {status} {}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}",
        if status == 200 { "OK" } else { "Error" },
        text.len()
    );
    stream.write_all(response.as_bytes()).await?;
    stream.shutdown().await
}

async fn route(state: &AppState, method: &str, target: &str, body: Value) -> (u16, Value) {
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let uuid = body["uuid"].as_str().unwrap_or("").to_string();
    let result = match (method, path) {
        ("GET", "/state") => {
            let since: u64 = query
                .split('&')
                .find_map(|kv| kv.strip_prefix("since="))
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            return (200, snapshot(state, since).await);
        }
        ("POST", "/join-request") => friends::request_join_inner(state, &uuid).await,
        ("POST", "/invite") => friends::invite_inner(state, &uuid).await,
        ("POST", "/message") => friends::send_message_inner(state, &uuid, body["text"].as_str().unwrap_or("")).await,
        _ => return (404, json!({ "error": "non trovato" })),
    };
    // dopo un'azione la presenza degli amici può cambiare: niente cache
    *state.bridge_friends.lock().await = None;
    match result {
        Ok(()) => (200, json!({ "status": "ok" })),
        Err(e) => (400, json!({ "error": e.to_string() })),
    }
}

async fn snapshot(state: &AppState, since: u64) -> Value {
    let friends = {
        let mut cache = state.bridge_friends.lock().await;
        match cache.as_ref() {
            Some((at, list)) if at.elapsed() < FRIENDS_CACHE => list.clone(),
            _ => {
                let list = friends::fetch_friends(state).await.unwrap_or_default();
                *cache = Some((Instant::now(), list.clone()));
                list
            }
        }
    };
    let events: Vec<Value> = state
        .bridge_events
        .lock()
        .unwrap()
        .iter()
        .filter(|e| e["seq"].as_u64().unwrap_or(0) > since)
        .cloned()
        .collect();
    let hosting = state.active_tunnel.lock().await.as_ref().map(|t| t.public_address.clone());
    json!({
        "seq": SEQ.load(Ordering::Relaxed),
        "friends": friends,
        "events": events,
        "hosting": hosting,
    })
}
