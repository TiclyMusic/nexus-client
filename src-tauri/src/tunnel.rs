//! Tunnel P2P / reverse-proxy per hostare mondi Minecraft in locale via LAN e condividerli con amici senza port forwarding.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::oneshot;

use crate::{
    error::{msg, Result},
    state::AppState,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelInfo {
    pub active: bool,
    pub local_port: u16,
    pub remote_port: u16,
    pub public_address: String,
    pub server_host: String,
}

pub struct ActiveTunnel {
    pub local_port: u16,
    pub remote_port: u16,
    pub public_address: String,
    pub server_host: String,
    pub cancel: oneshot::Sender<()>,
}

#[tauri::command]
pub async fn start_tunnel(
    app: AppHandle,
    state: State<'_, AppState>,
    local_port: Option<u16>,
    server: Option<String>,
) -> Result<TunnelInfo> {
    let mut current = state.active_tunnel.lock().await;
    if let Some(active) = current.as_ref() {
        return Ok(TunnelInfo {
            active: true,
            local_port: active.local_port,
            remote_port: active.remote_port,
            public_address: active.public_address.clone(),
            server_host: active.server_host.clone(),
        });
    }

    let port = local_port.unwrap_or(25565);
    let srv = server.unwrap_or_else(|| "bore.pub".to_string());

    let client = bore_cli::client::Client::new("localhost", port, &srv, 0, None)
        .await
        .map_err(|e| msg(format!("Impossibile connettersi al server tunnel ({srv}): {e}")))?;

    let remote_port = client.remote_port();
    let public_address = format!("{srv}:{remote_port}");
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();

    let info = TunnelInfo {
        active: true,
        local_port: port,
        remote_port,
        public_address: public_address.clone(),
        server_host: srv.clone(),
    };

    let app_handle = app.clone();
    let info_clone = info.clone();
    tokio::spawn(async move {
        tokio::select! {
            _ = client.listen() => {},
            _ = cancel_rx => {},
        }
        let _ = app_handle.emit("tunnel-status", false);
    });

    *current = Some(ActiveTunnel {
        local_port: port,
        remote_port,
        public_address,
        server_host: srv,
        cancel: cancel_tx,
    });

    let _ = app.emit("tunnel-status", true);
    Ok(info_clone)
}

#[tauri::command]
pub async fn stop_tunnel(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    let mut current = state.active_tunnel.lock().await;
    if let Some(active) = current.take() {
        let _ = active.cancel.send(());
        let _ = app.emit("tunnel-status", false);
    }
    Ok(())
}

#[tauri::command]
pub async fn get_tunnel_status(state: State<'_, AppState>) -> Result<Option<TunnelInfo>> {
    let current = state.active_tunnel.lock().await;
    Ok(current.as_ref().map(|a| TunnelInfo {
        active: true,
        local_port: a.local_port,
        remote_port: a.remote_port,
        public_address: a.public_address.clone(),
        server_host: a.server_host.clone(),
    }))
}

/// Rileva eventuale porta LAN aperta analizzando gli ultimi log dei giochi in esecuzione.
#[tauri::command]
pub fn detect_lan_port(state: State<'_, AppState>) -> Option<u16> {
    let logs = state.logs.lock().unwrap();
    for (_, lines) in logs.iter() {
        for line in lines.iter().rev().take(100) {
            // "Started on 54321" o "Hosted world on port 54321"
            if let Some(idx) = line.find("Started on ") {
                let rest = &line[idx + 11..];
                if let Some(port_str) = rest.split_whitespace().next() {
                    let cleaned = port_str.trim_matches(|c: char| !c.is_ascii_digit());
                    if let Ok(p) = cleaned.parse::<u16>() {
                        return Some(p);
                    }
                }
            }
            if let Some(idx) = line.find("Hosted world on port ") {
                let rest = &line[idx + 21..];
                if let Some(port_str) = rest.split_whitespace().next() {
                    let cleaned = port_str.trim_matches(|c: char| !c.is_ascii_digit());
                    if let Ok(p) = cleaned.parse::<u16>() {
                        return Some(p);
                    }
                }
            }
        }
    }
    None
}
