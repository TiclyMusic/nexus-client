//! Client del server amici & presenza (Nexus Social).
//!
//! Identità: usa il token Minecraft dell'account attivo per autenticarsi al server, che lo
//! verifica sulle API Mojang e restituisce un token di sessione (messo in cache). La presenza
//! ("cosa sto facendo") viene inviata periodicamente da un heartbeat in `lib.rs`.

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

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
    /// Versione di Minecraft dell'istanza che sta usando (per entrare con la stessa).
    #[serde(default)]
    pub mc_version: String,
    /// Messaggi di chat non ancora letti da questo amico.
    #[serde(default)]
    pub unread: u32,
}

/// Messaggio della chat tra amici. `created` è in millisecondi (Unix).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectMessage {
    pub id: i64,
    pub from: String,
    pub to: String,
    pub text: String,
    pub created: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupMember {
    pub uuid: String,
    pub name: String,
    #[serde(default)]
    pub online: bool,
}

/// Gruppo di amici con chat condivisa.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: i64,
    pub name: String,
    pub owner: String,
    pub members: Vec<GroupMember>,
    #[serde(default)]
    pub unread: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupMessage {
    pub id: i64,
    pub group_id: i64,
    pub from: String,
    #[serde(default)]
    pub name: String,
    pub text: String,
    pub created: i64,
}

/// Messaggio appena ricevuto (privato o di gruppo), per le notifiche.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxMessage {
    /// "direct" | "group" | "join" (richiesta di entrare nel mondo)
    pub kind: String,
    pub id: i64,
    #[serde(default)]
    pub group_id: Option<i64>,
    #[serde(default)]
    pub group_name: Option<String>,
    pub from: String,
    #[serde(default)]
    pub name: String,
    pub text: String,
    pub created: i64,
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
            // il server risponde {"error": "..."}: mostriamo solo il messaggio
            let text = resp.text().await.unwrap_or_default();
            let reason = serde_json::from_str::<serde_json::Value>(&text)
                .ok()
                .and_then(|v| v["error"].as_str().map(str::to_string))
                .unwrap_or_else(|| text.trim_matches('"').to_string());
            return Err(msg(reason));
        }
        return Ok(resp.json().await.unwrap_or(serde_json::Value::Null));
    }
    Err(msg("Sessione amici non valida"))
}

// ---------------------------------------------------------------------------
// Presenza (usata dall'heartbeat)
// ---------------------------------------------------------------------------

/// Calcola la presenza corrente dallo stato del launcher (istanze in esecuzione, tunnel host).
/// Presenza da inviare al server: stato, descrizione, indirizzo per entrare e versione del gioco.
pub struct Presence {
    pub status: String,
    pub detail: String,
    pub join_address: String,
    pub mc_version: String,
}

pub async fn current_presence(state: &AppState) -> Presence {
    use crate::tunnel::{is_private_address, Activity};
    let presence = |status: &str, detail: String, join_address: String, mc_version: String| Presence {
        status: status.into(),
        detail,
        join_address,
        mc_version,
    };
    // Mondo aperto agli amici? (tunnel aperto in automatico da "Apri in LAN")
    let hosting = state.active_tunnel.lock().await.as_ref().map(|t| (t.instance_id.clone(), t.public_address.clone()));
    if let Some((id, address)) = hosting {
        let (name, version) = crate::instances::load(state, &id).await.map(|i| (i.name, i.mc_version)).unwrap_or((id, String::new()));
        return presence("hosting", format!("Ha aperto un mondo · {name}"), address, version);
    }
    // Istanza in esecuzione?
    let running_id = state.running.lock().unwrap().keys().next().cloned();
    if let Some(id) = running_id {
        let (name, version) = crate::instances::load(state, &id)
            .await
            .map(|i| (i.name, i.mc_version))
            .unwrap_or(("In gioco".into(), String::new()));
        let activity = state.activity.lock().unwrap().get(&id).cloned();
        return match activity {
            Some(Activity::Server(address)) if address.starts_with("bore.pub") => {
                presence("server", format!("Nel mondo di un amico · {version}"), address, version)
            }
            Some(Activity::Server(address)) if is_private_address(&address) => {
                presence("server", format!("Su un server in rete locale · {version}"), String::new(), version)
            }
            Some(Activity::Server(address)) => presence("server", format!("Su {address} · {version}"), address, version),
            Some(Activity::Singleplayer) => presence("playing", format!("In singleplayer · {name} · {version}"), String::new(), version),
            None => presence("playing", format!("{name} · {version}"), String::new(), version),
        };
    }
    presence("online", String::new(), String::new(), String::new())
}

/// Invia un heartbeat di presenza. Silenzioso: gli errori non devono disturbare l'utente.
pub async fn heartbeat(app: &AppHandle, state: &AppState) {
    if base_url(&state.settings.read().await.social_url).is_err() {
        return;
    }
    let p = current_presence(state).await;
    let reply = call(
        state,
        reqwest::Method::POST,
        "/presence",
        Some(json!({ "status": p.status, "detail": p.detail, "joinAddress": p.join_address, "mcVersion": p.mc_version })),
    )
    .await;
    // Il server risponde con il totale dei messaggi non letti: lo passiamo all'interfaccia.
    if let Ok(value) = reply {
        if let Some(n) = value["unread"].as_u64() {
            let _ = app.emit("social-unread", n);
        }
    }
}

/// Controlla i nuovi messaggi e li passa all'interfaccia per le notifiche ("social-message").
/// Parte solo quando c'è già una sessione (la apre l'heartbeat), così non riprova l'accesso
/// ogni pochi secondi se l'utente non ha un account Microsoft.
pub async fn poll_inbox(app: &AppHandle, state: &AppState) {
    if state.social_token.lock().await.is_none() {
        return;
    }
    let cursor = *state.inbox_cursor.lock().await;
    let path = match cursor {
        Some((dm, gm, jr)) => format!("/inbox?dm={dm}&gm={gm}&jr={jr}"),
        None => "/inbox".to_string(),
    };
    let Ok(value) = call(state, reqwest::Method::GET, &path, None).await else {
        return;
    };
    let next = (
        value["cursor"]["dm"].as_i64().unwrap_or(0),
        value["cursor"]["gm"].as_i64().unwrap_or(0),
        value["cursor"]["jr"].as_i64().unwrap_or(0),
    );
    let messages: Vec<InboxMessage> = serde_json::from_value(value["messages"].clone()).unwrap_or_default();
    // se arrivano più di 20 messaggi in pochi secondi notifichiamo solo i primi: il badge li conta comunque
    *state.inbox_cursor.lock().await = Some(next);
    // Notifica di sistema quando il launcher non è in primo piano (di solito si è in gioco):
    // sempre per le richieste di entrare, per la chat solo se la finestra non ha il focus.
    let focused = app.get_webview_window("main").and_then(|w| w.is_focused().ok()).unwrap_or(false);
    // con la mod in gioco gli avvisi compaiono dentro Minecraft: niente notifica di Windows
    let in_game_menu = !state.running.lock().unwrap().is_empty() && state.bridge.get().is_some();
    for m in messages {
        crate::bridge::push_event(state, &m);
        let system = match m.kind.as_str() {
            _ if in_game_menu && m.kind != "direct" && m.kind != "group" => None,
            "join" => Some((
                format!("{} vuole entrare nel tuo mondo", m.name),
                "Per farlo entrare: Esc → Apri in LAN → Avvia mondo LAN. Al resto pensa Nexus.".to_string(),
            )),
            "invite" => Some((format!("{} ti invita nel suo mondo", m.name), "Apri Nexus e premi Entra.".to_string())),
            "group" if !focused => Some((format!("{} · {}", m.name, m.group_name.clone().unwrap_or_default()), m.text.clone())),
            "direct" if !focused => Some((m.name.clone(), m.text.clone())),
            _ => None,
        };
        if let Some((title, body)) = system {
            let _ = app.notification().builder().title(title).body(body).show();
        }
        let _ = app.emit("social-message", m);
    }
    if let Some(n) = value["unread"].as_u64() {
        let _ = app.emit("social-unread", n);
    }
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

/// Chiede a un amico in singleplayer di entrare nel suo mondo: gli arriva una notifica e,
/// quando apre il mondo in LAN, il tunnel parte da solo e chi ha chiesto entra.
#[tauri::command]
pub async fn request_join(state: State<'_, AppState>, uuid: String) -> Result<()> {
    request_join_inner(state.inner(), &uuid).await
}

pub async fn request_join_inner(state: &AppState, uuid: &str) -> Result<()> {
    call(state, reqwest::Method::POST, "/join", Some(json!({ "to": uuid }))).await?;
    Ok(())
}

/// Invita un amico nel mondo che stai ospitando.
pub async fn invite_inner(state: &AppState, uuid: &str) -> Result<()> {
    call(state, reqwest::Method::POST, "/invite", Some(json!({ "to": uuid }))).await?;
    Ok(())
}

pub async fn send_message_inner(state: &AppState, uuid: &str, text: &str) -> Result<()> {
    call(state, reqwest::Method::POST, "/messages", Some(json!({ "to": uuid, "text": text }))).await?;
    Ok(())
}

/// Lista amici con presenza (per la mod in gioco).
pub async fn fetch_friends(state: &AppState) -> Result<Vec<FriendPresence>> {
    let value = call(state, reqwest::Method::GET, "/friends", None).await?;
    Ok(serde_json::from_value(value["friends"].clone()).unwrap_or_default())
}

/// Messaggi con un amico: gli ultimi 50, oppure solo quelli con id > `after` (per l'aggiornamento).
/// Il server segna come letti quelli ricevuti.
#[tauri::command]
pub async fn get_chat_messages(state: State<'_, AppState>, uuid: String, after: Option<i64>) -> Result<Vec<DirectMessage>> {
    let path = format!("/messages?with={}&after={}", urlencoding(&uuid), after.unwrap_or(0).max(0));
    let value = call(state.inner(), reqwest::Method::GET, &path, None).await?;
    Ok(serde_json::from_value(value["messages"].clone()).unwrap_or_default())
}

#[tauri::command]
pub async fn send_chat_message(state: State<'_, AppState>, uuid: String, text: String) -> Result<DirectMessage> {
    let value = call(state.inner(), reqwest::Method::POST, "/messages", Some(json!({ "to": uuid, "text": text }))).await?;
    serde_json::from_value(value["message"].clone()).map_err(|_| msg("Risposta del server non valida"))
}

// --- Gruppi ---------------------------------------------------------------

#[tauri::command]
pub async fn get_groups(state: State<'_, AppState>) -> Result<Vec<Group>> {
    let value = call(state.inner(), reqwest::Method::GET, "/groups", None).await?;
    Ok(serde_json::from_value(value["groups"].clone()).unwrap_or_default())
}

#[tauri::command]
pub async fn create_group(state: State<'_, AppState>, name: String, members: Vec<String>) -> Result<i64> {
    let value = call(state.inner(), reqwest::Method::POST, "/groups/create", Some(json!({ "name": name, "members": members }))).await?;
    value["id"].as_i64().ok_or_else(|| msg("Risposta del server non valida"))
}

#[tauri::command]
pub async fn add_group_members(state: State<'_, AppState>, id: i64, members: Vec<String>) -> Result<()> {
    call(state.inner(), reqwest::Method::POST, "/groups/add", Some(json!({ "id": id, "members": members }))).await?;
    Ok(())
}

#[tauri::command]
pub async fn rename_group(state: State<'_, AppState>, id: i64, name: String) -> Result<()> {
    call(state.inner(), reqwest::Method::POST, "/groups/rename", Some(json!({ "id": id, "name": name }))).await?;
    Ok(())
}

#[tauri::command]
pub async fn kick_group_member(state: State<'_, AppState>, id: i64, uuid: String) -> Result<()> {
    call(state.inner(), reqwest::Method::POST, "/groups/kick", Some(json!({ "id": id, "uuid": uuid }))).await?;
    Ok(())
}

#[tauri::command]
pub async fn leave_group(state: State<'_, AppState>, id: i64) -> Result<()> {
    call(state.inner(), reqwest::Method::POST, "/groups/leave", Some(json!({ "id": id }))).await?;
    Ok(())
}

#[tauri::command]
pub async fn get_group_messages(state: State<'_, AppState>, id: i64, after: Option<i64>) -> Result<Vec<GroupMessage>> {
    let path = format!("/groups/messages?id={id}&after={}", after.unwrap_or(0).max(0));
    let value = call(state.inner(), reqwest::Method::GET, &path, None).await?;
    Ok(serde_json::from_value(value["messages"].clone()).unwrap_or_default())
}

#[tauri::command]
pub async fn send_group_message(state: State<'_, AppState>, id: i64, text: String) -> Result<GroupMessage> {
    let value = call(state.inner(), reqwest::Method::POST, "/groups/messages", Some(json!({ "id": id, "text": text }))).await?;
    serde_json::from_value(value["message"].clone()).map_err(|_| msg("Risposta del server non valida"))
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
