//! Client del server amici & presenza (Nexus Social).
//!
//! Identità: usa il token Minecraft dell'account attivo per autenticarsi al server, che lo
//! verifica sulle API Mojang e restituisce un token di sessione (messo in cache). La presenza
//! ("cosa sto facendo") viene inviata periodicamente da un heartbeat in `lib.rs`.

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;

use crate::{
    auth,
    error::{msg, Result},
    state::AppState,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendPresence {
    pub uuid: String,
    pub name: String,
    pub favorite: bool,
    pub online: bool,
    /// "online" | "playing" | "hosting" | "offline"
    pub status: String,
    pub detail: String,
    pub join_address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserRef {
    pub uuid: String,
    pub name: String,
    /// false = non ha ancora mai aperto Nexus (si può invitare).
    #[serde(default = "yes")]
    pub registered: bool,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendsData {
    pub configured: bool,
    pub friends: Vec<FriendPresence>,
    pub incoming: Vec<UserRef>,
    pub outgoing: Vec<UserRef>,
    /// Motivo per cui il server non ha risposto (rete, account, sessione…), da mostrare all'utente.
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchUser {
    pub uuid: String,
    pub name: String,
    #[serde(default = "yes")]
    pub registered: bool,
    /// "self" | "friend" | "outgoing" | "incoming" | "none"
    pub relation: String,
}

fn base_url(url: &Option<String>) -> Result<String> {
    let url = url.as_ref().map(|u| u.trim().trim_end_matches('/')).unwrap_or("");
    if url.is_empty() {
        return Err(msg("Server amici non configurato: incollalo in Impostazioni → Amici & presenza"));
    }
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(msg("URL del server amici non valido"));
    }
    Ok(url.to_string())
}

/// Ritorna un token di sessione valido, autenticandosi se necessario.
///
/// L'identità è provata con il protocollo ufficiale dei server Minecraft (join/hasJoined):
/// api.minecraftservices.com blocca gli IP dei datacenter (Cloudflare Worker → 403), quindi
/// il client fa il "join" dal PC dell'utente e il server verifica con `hasJoined`, che invece
/// è pensato per essere chiamato dai server ed è raggiungibile.
async fn session(state: &AppState) -> Result<(String, String)> {
    let base = base_url(&state.settings.read().await.social_url)?;
    if let Some(tok) = state.social_token.lock().await.clone() {
        return Ok((base, tok));
    }
    let account = auth::social_account(state).await?;

    // Passo 1: "join" sul session server Mojang, dal PC dell'utente (non bloccato).
    let server_id = uuid::Uuid::new_v4().simple().to_string();
    let join = state
        .http
        .post("https://sessionserver.mojang.com/session/minecraft/join")
        .json(&json!({
            "accessToken": account.mc_access_token,
            "selectedProfile": account.uuid,
            "serverId": server_id,
        }))
        .send()
        .await
        .map_err(|e| msg(format!("Verifica identità Minecraft non riuscita: {e}")))?;
    if !join.status().is_success() {
        return Err(msg("Verifica identità Minecraft fallita: riprova ad accedere con Microsoft"));
    }

    // Passo 2: il nostro server verifica con hasJoined e rilascia il token di sessione.
    let resp = state
        .http
        .post(format!("{base}/auth"))
        .json(&json!({ "uuid": account.uuid, "name": account.username, "serverId": server_id }))
        .send()
        .await
        .map_err(|e| msg(format!("Server amici non raggiungibile: {e}")))?;
    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(msg(format!("Autenticazione al server amici fallita: {text}")));
    }
    let value: serde_json::Value = resp.json().await?;
    let token = value["token"].as_str().ok_or_else(|| msg("Risposta /auth senza token"))?.to_string();
    *state.social_token.lock().await = Some(token.clone());
    Ok((base, token))
}

/// Esegue una chiamata autenticata; se la sessione è scaduta (401) riautentica una volta.
async fn call(
    state: &AppState,
    method: reqwest::Method,
    path: &str,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value> {
    for attempt in 0..2 {
        let (base, token) = session(state).await?;
        let mut req = state.http.request(method.clone(), format!("{base}{path}")).bearer_auth(&token);
        if let Some(b) = &body {
            req = req.json(b);
        }
        let resp = req.send().await.map_err(|e| msg(format!("Server amici non raggiungibile: {e}")))?;
        if resp.status().as_u16() == 401 && attempt == 0 {
            // sessione scaduta: invalida la cache e riprova
            *state.social_token.lock().await = None;
            continue;
        }
        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(msg(text.trim_matches('"').to_string()));
        }
        return Ok(resp.json().await.unwrap_or(serde_json::Value::Null));
    }
    Err(msg("Sessione amici non valida"))
}

// ---------------------------------------------------------------------------
// Presenza (usata dall'heartbeat)
// ---------------------------------------------------------------------------

/// Calcola la presenza corrente dallo stato del launcher (istanze in esecuzione, tunnel host).
pub async fn current_presence(state: &AppState) -> (String, String, String) {
    // Istanza in esecuzione?
    let running_id = state.running.lock().unwrap().keys().next().cloned();
    if let Some(id) = running_id {
        // hosting? (tunnel attivo)
        let tunnel = state.active_tunnel.lock().await;
        if let Some(t) = tunnel.as_ref() {
            let name = crate::instances::load(state, &id).await.map(|i| i.name).unwrap_or(id);
            return ("hosting".into(), format!("Sta hostando {name}"), t.public_address.clone());
        }
        drop(tunnel);
        match crate::instances::load(state, &id).await {
            Ok(i) => return ("playing".into(), format!("{} · {}", i.name, i.mc_version), String::new()),
            Err(_) => return ("playing".into(), "In gioco".into(), String::new()),
        }
    }
    ("online".into(), String::new(), String::new())
}

/// Invia un heartbeat di presenza. Silenzioso: gli errori non devono disturbare l'utente.
pub async fn heartbeat(state: &AppState) {
    if base_url(&state.settings.read().await.social_url).is_err() {
        return;
    }
    let (status, detail, join_address) = current_presence(state).await;
    let _ = call(
        state,
        reqwest::Method::POST,
        "/presence",
        Some(json!({ "status": status, "detail": detail, "joinAddress": join_address })),
    )
    .await;
}

// ---------------------------------------------------------------------------
// Comandi IPC
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn friends_configured(state: State<'_, AppState>) -> Result<bool> {
    Ok(base_url(&state.settings.read().await.social_url).is_ok())
}

#[tauri::command]
pub async fn get_friends(state: State<'_, AppState>) -> Result<FriendsData> {
    let empty = |configured, error| FriendsData {
        configured,
        friends: vec![],
        incoming: vec![],
        outgoing: vec![],
        error,
    };
    // URL mancante = feature davvero non configurata.
    if base_url(&state.settings.read().await.social_url).is_err() {
        return Ok(empty(false, None));
    }
    // URL presente: è "configurato". Se la chiamata fallisce (nessun account Microsoft attivo,
    // server irraggiungibile…) restituiamo configured=true con lista vuota e il motivo in `error`,
    // così non compare il banner ingannevole "non configurato" ma l'utente sa cosa non va.
    match call(state.inner(), reqwest::Method::GET, "/friends", None).await {
        Ok(value) => Ok(FriendsData {
            configured: true,
            friends: serde_json::from_value(value["friends"].clone()).unwrap_or_default(),
            incoming: serde_json::from_value(value["incoming"].clone()).unwrap_or_default(),
            outgoing: serde_json::from_value(value["outgoing"].clone()).unwrap_or_default(),
            error: None,
        }),
        Err(e) => Ok(empty(true, Some(e.to_string()))),
    }
}

#[tauri::command]
pub async fn search_friends(state: State<'_, AppState>, query: String) -> Result<Vec<SearchUser>> {
    let q = query.trim();
    if q.len() < 2 {
        return Ok(vec![]);
    }
    let value = call(state.inner(), reqwest::Method::GET, &format!("/search?q={}", urlencoding(q)), None).await?;
    Ok(serde_json::from_value(value["results"].clone()).unwrap_or_default())
}

#[tauri::command]
pub async fn send_friend_request(state: State<'_, AppState>, uuid: String, name: Option<String>) -> Result<String> {
    let value = call(
        state.inner(),
        reqwest::Method::POST,
        "/request",
        Some(json!({ "uuid": uuid, "name": name.unwrap_or_default() })),
    )
    .await?;
    Ok(value["status"].as_str().unwrap_or("sent").to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McProfile {
    pub uuid: String,
    pub name: String,
}

/// Risolve un nome Minecraft in {uuid, nome} tramite l'API pubblica Mojang.
/// Permette di aggiungere un amico per nome (e vederne la faccia) anche se non è ancora su Nexus.
#[tauri::command]
pub async fn resolve_mc_name(state: State<'_, AppState>, name: String) -> Result<Option<McProfile>> {
    let clean = name.trim();
    if clean.len() < 2 {
        return Ok(None);
    }
    let url = format!("https://api.mojang.com/users/profiles/minecraft/{clean}");
    let resp = match state.http.get(&url).send().await {
        Ok(r) if r.status().is_success() => r,
        _ => return Ok(None),
    };
    let value: serde_json::Value = resp.json().await.unwrap_or_default();
    match (value["id"].as_str(), value["name"].as_str()) {
        (Some(id), Some(n)) => Ok(Some(McProfile {
            uuid: id.to_string(),
            name: n.to_string(),
        })),
        _ => Ok(None),
    }
}

#[tauri::command]
pub async fn respond_friend_request(state: State<'_, AppState>, uuid: String, accept: bool) -> Result<()> {
    call(state.inner(), reqwest::Method::POST, "/respond", Some(json!({ "uuid": uuid, "accept": accept }))).await?;
    Ok(())
}

#[tauri::command]
pub async fn remove_friend(state: State<'_, AppState>, uuid: String) -> Result<()> {
    call(state.inner(), reqwest::Method::POST, "/remove", Some(json!({ "uuid": uuid }))).await?;
    Ok(())
}

#[tauri::command]
pub async fn set_friend_favorite(state: State<'_, AppState>, uuid: String, favorite: bool) -> Result<()> {
    call(state.inner(), reqwest::Method::POST, "/favorite", Some(json!({ "uuid": uuid, "favorite": favorite }))).await?;
    Ok(())
}

/// Encoding minimale per il parametro di ricerca.
fn urlencoding(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}
