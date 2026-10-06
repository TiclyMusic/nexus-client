//! Tunnel automatico per giocare con gli amici senza port forwarding.
//!
//! Non ci sono pulsanti: quando il gioco scrive nel log che un mondo è stato aperto in LAN,
//! il launcher apre subito il tunnel verso quella porta e aggiorna la presenza ("hosting" con
//! l'indirizzo per entrare). Quando il mondo viene chiuso o il gioco esce, il tunnel si chiude.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;

use crate::{
    error::{msg, Result},
    state::AppState,
};

const TUNNEL_SERVER: &str = "bore.pub";

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
    pub instance_id: String,
    pub local_port: u16,
    pub remote_port: u16,
    pub public_address: String,
    pub server_host: String,
    pub cancel: oneshot::Sender<()>,
}

impl ActiveTunnel {
    fn info(&self) -> TunnelInfo {
        TunnelInfo {
            active: true,
            local_port: self.local_port,
            remote_port: self.remote_port,
            public_address: self.public_address.clone(),
            server_host: self.server_host.clone(),
        }
    }
}

/// Porta LAN annunciata da una riga di log del gioco, se la riga è quella di "Apri in LAN".
///
/// Il server integrato scrive "Started serving on 51234" (versioni recenti) o "Started on 51234"
/// (vecchie); la chat riporta "Local game hosted on port 51234" nella lingua del gioco.
pub fn lan_port_from_log(line: &str) -> Option<u16> {
    // solo righe del server integrato o della chat: un mod che apre una sua porta non va esposto
    let server = line.contains("Server thread") && (line.contains("Started serving on") || line.contains("Started on "));
    let chat = line.contains("[CHAT]") && (line.contains("hosted on port") || line.contains("ospitata sulla porta"));
    if !(server || chat) {
        return None;
    }
    line.split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .last()
        .and_then(|p| p.parse::<u16>().ok())
        .filter(|p| *p >= 1024)
}

/// Il server integrato si ferma quando il giocatore esce dal mondo.
pub fn lan_closed_from_log(line: &str) -> bool {
    line.contains("Stopping server")
}

async fn open(app: &AppHandle, state: &AppState, instance_id: &str, port: u16) -> Result<TunnelInfo> {
    let mut current = state.active_tunnel.lock().await;
    if let Some(active) = current.as_ref() {
        if active.local_port == port {
            return Ok(active.info());
        }
    }
    if let Some(old) = current.take() {
        let _ = old.cancel.send(());
    }

    let client = bore_cli::client::Client::new("127.0.0.1", port, TUNNEL_SERVER, 0, None)
        .await
        .map_err(|e| msg(format!("Impossibile aprire il tunnel ({TUNNEL_SERVER}): {e}")))?;
    let remote_port = client.remote_port();
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();

    let active = ActiveTunnel {
        instance_id: instance_id.to_string(),
        local_port: port,
        remote_port,
        public_address: format!("{TUNNEL_SERVER}:{remote_port}"),
        server_host: TUNNEL_SERVER.to_string(),
        cancel: cancel_tx,
    };
    let info = active.info();
    *current = Some(active);
    drop(current);

    let handle = app.clone();
    tokio::spawn(async move {
        tokio::select! {
            _ = client.listen() => {},
            _ = cancel_rx => {},
        }
        // se il tunnel cade da solo, libera lo stato (solo se è ancora questo tunnel)
        let state = handle.state::<AppState>();
        let mut current = state.active_tunnel.lock().await;
        if current.as_ref().is_some_and(|t| t.remote_port == remote_port) {
            *current = None;
        }
        let _ = handle.emit("tunnel-status", false);
    });

    let _ = app.emit("tunnel-status", true);
    Ok(info)
}

async fn close(app: &AppHandle, state: &AppState, instance_id: Option<&str>) -> bool {
    let mut current = state.active_tunnel.lock().await;
    let matches = current.as_ref().is_some_and(|t| instance_id.map_or(true, |id| t.instance_id == id));
    if !matches {
        return false;
    }
    if let Some(active) = current.take() {
        let _ = active.cancel.send(());
    }
    let _ = app.emit("tunnel-status", false);
    true
}

/// Chiamata per ogni riga di log del gioco: apre o chiude il tunnel in background.
pub fn on_game_log(app: &AppHandle, instance_id: &str, line: &str) {
    if let Some(port) = lan_port_from_log(line) {
        let (app, id) = (app.clone(), instance_id.to_string());
        tauri::async_runtime::spawn(async move {
            let state = app.state::<AppState>();
            match open(&app, &state, &id, port).await {
                // presenza subito aggiornata: gli amici vedono "Entra" senza aspettare l'heartbeat
                Ok(_) => crate::friends::heartbeat(&app, &state).await,
                Err(e) => eprintln!("tunnel: {e}"),
            }
        });
    } else if lan_closed_from_log(line) {
        on_game_exit(app, instance_id);
    }
}

/// Il gioco (o il mondo) è stato chiuso: chiude il tunnel di quell'istanza.
pub fn on_game_exit(app: &AppHandle, instance_id: &str) {
    let (app, id) = (app.clone(), instance_id.to_string());
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        if close(&app, &state, Some(&id)).await {
            crate::friends::heartbeat(&app, &state).await;
        }
    });
}

#[tauri::command]
pub async fn get_tunnel_status(state: State<'_, AppState>) -> Result<Option<TunnelInfo>> {
    Ok(state.active_tunnel.lock().await.as_ref().map(ActiveTunnel::info))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_lan_port() {
        assert_eq!(lan_port_from_log("[12:00:01] [Server thread/INFO]: Started serving on 51234"), Some(51234));
        assert_eq!(lan_port_from_log("[Render thread/INFO]: [System] [CHAT] Local game hosted on port 49152"), Some(49152));
        assert_eq!(lan_port_from_log("[CHAT] Partita locale ospitata sulla porta 50000"), Some(50000));
        assert_eq!(lan_port_from_log("[Server thread/INFO]: Preparing spawn area: 83%"), None);
        assert!(lan_closed_from_log("[Server thread/INFO]: Stopping server"));
    }
}
