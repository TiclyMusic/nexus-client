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
    /// Indirizzi per la connessione diretta (rete locale, porta aperta con UPnP), separati da
    /// spazi: chi entra li prova prima del tunnel, che passa dagli USA ed è lento.
    pub direct: String,
    pub mapping: Option<crate::direct::Mapping>,
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
    // 26.x: "[Render thread/INFO]: Published LAN server on port 51234" (IntegratedServer.publishServer)
    let published = line.contains("Published LAN server on port");
    // fino alla 26.1: "Started serving on 51234" (vecchie: "Started on"), dal Render thread quando
    // lo apre il giocatore o dal Server thread con /publish
    let thread = line.contains("Server thread") || line.contains("Render thread");
    let server = published || (thread && (line.contains("Started serving on") || line.contains("Started on ")));
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

/// Dove si trova il giocatore, ricavato dal log del client.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Activity {
    /// In un mondo singleplayer (non ancora aperto in LAN).
    Singleplayer,
    /// Connesso a un server: indirizzo "host" o "host:porta".
    Server(String),
}

/// Server a cui il client si sta connettendo: "[Render thread/INFO]: Connecting to mc.example.net, 25565".
pub fn server_from_log(line: &str) -> Option<String> {
    if !(line.contains("Render thread") || line.contains("Client thread") || line.contains("main/")) {
        return None;
    }
    let rest = &line[line.find("Connecting to ")? + 14..];
    let (host, port) = rest.trim().split_once(", ")?;
    let port = port.trim().parse::<u16>().ok()?;
    let host = host.trim();
    if host.is_empty() || host.contains(' ') {
        return None;
    }
    Some(if port == 25565 { host.to_string() } else { format!("{host}:{port}") })
}

/// Indirizzi raggiungibili solo dalla rete locale di chi gioca: agli amici non servono.
pub fn is_private_address(address: &str) -> bool {
    let host = address.rsplit_once(':').map_or(address, |(h, _)| h).to_ascii_lowercase();
    host == "localhost"
        || host.starts_with("127.")
        || host.starts_with("10.")
        || host.starts_with("192.168.")
        || (host.starts_with("172.") && host.split('.').nth(1).and_then(|n| n.parse::<u8>().ok()).is_some_and(|n| (16..=31).contains(&n)))
        || host == "0.0.0.0"
}

fn set_activity(app: &AppHandle, instance_id: &str, activity: Option<Activity>) {
    let state = app.state::<AppState>();
    let changed = {
        let mut map = state.activity.lock().unwrap();
        let before = map.get(instance_id).cloned();
        match activity.clone() {
            Some(a) => map.insert(instance_id.to_string(), a),
            None => map.remove(instance_id),
        };
        before != activity
    };
    if changed {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let state = app.state::<AppState>();
            crate::friends::heartbeat(&app, &state).await;
        });
    }
}

/// Il server integrato si ferma quando il giocatore esce dal mondo.
pub fn lan_closed_from_log(line: &str) -> bool {
    line.contains("Stopping server") || line.contains("Unpublishing integrated server")
}

async fn open(app: &AppHandle, state: &AppState, instance_id: &str, port: u16) -> Result<TunnelInfo> {
    let mut current = state.active_tunnel.lock().await;
    if let Some(active) = current.as_ref() {
        if active.local_port == port {
            return Ok(active.info());
        }
    }
    if let Some(mut old) = current.take() {
        let _ = old.cancel.send(());
        if let Some(mapping) = old.mapping.take() {
            tokio::spawn(crate::direct::close_mapping(mapping));
        }
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
        direct: crate::direct::lan_candidate(port).unwrap_or_default(),
        mapping: None,
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

    // porta aperta sul router (se il router lo permette): connessione diretta anche da fuori casa
    let handle = app.clone();
    tokio::spawn(async move {
        let Some(mapping) = crate::direct::open_mapping(port).await else { return };
        let state = handle.state::<AppState>();
        let mut current = state.active_tunnel.lock().await;
        match current.as_mut().filter(|t| t.remote_port == remote_port) {
            Some(active) => {
                active.direct = format!("{} {}", active.direct, mapping.address).trim().to_string();
                active.mapping = Some(mapping);
                drop(current);
                crate::friends::heartbeat(&handle, &state).await;
            }
            // il mondo è già stato chiuso nel frattempo
            None => crate::direct::close_mapping(mapping).await,
        }
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
    if let Some(mut active) = current.take() {
        let _ = active.cancel.send(());
        if let Some(mapping) = active.mapping.take() {
            tokio::spawn(crate::direct::close_mapping(mapping));
        }
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
    } else if line.contains("Starting integrated minecraft server") {
        set_activity(app, instance_id, Some(Activity::Singleplayer));
    } else if let Some(address) = server_from_log(line) {
        set_activity(app, instance_id, Some(Activity::Server(address)));
    }
}

/// Il gioco (o il mondo) è stato chiuso: chiude il tunnel di quell'istanza.
pub fn on_game_exit(app: &AppHandle, instance_id: &str) {
    let (app, id) = (app.clone(), instance_id.to_string());
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let was_active = state.activity.lock().unwrap().remove(&id).is_some();
        if close(&app, &state, Some(&id)).await || was_active {
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
        assert_eq!(lan_port_from_log("[19:02:11] [Render thread/INFO]: Published LAN server on port 50432"), Some(50432));
        assert_eq!(lan_port_from_log("[19:02:11] [Render thread/INFO]: Started serving on 50433"), Some(50433));
        assert_eq!(lan_port_from_log("[19:02:11] [Worker/INFO]: Started serving on 8080"), None);
        assert!(lan_closed_from_log("[Render thread/INFO]: Unpublishing integrated server (was on port 50432)"));
        assert_eq!(server_from_log("[18:30:01] [Render thread/INFO]: Connecting to mc.hypixel.net, 25565"), Some("mc.hypixel.net".into()));
        assert_eq!(server_from_log("[Render thread/INFO]: Connecting to bore.pub, 41234"), Some("bore.pub:41234".into()));
        assert!(is_private_address("192.168.1.20:25565") && is_private_address("localhost") && !is_private_address("bore.pub:4123"));
    }
}
