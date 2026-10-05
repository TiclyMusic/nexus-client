pub mod microsoft;
pub mod store;

use std::sync::atomic::Ordering;

use tauri::State;

use crate::{
    error::{msg, Result},
    state::AppState,
    util,
};
use store::{Account, AccountInfo, AccountKind};

async fn effective_client_id(state: &AppState) -> String {
    let id = state.settings.read().await.ms_client_id.clone();
    if id.trim().is_empty() || id == "00000000402b5328" {
        crate::settings::DEFAULT_MS_CLIENT_ID.to_string()
    } else {
        id
    }
}

/// Rinnova il token Minecraft se mancano meno di 5 minuti alla scadenza.
async fn refresh_if_needed(state: &AppState, account: Account, force: bool) -> Result<Account> {
    if account.kind == AccountKind::Offline {
        return Ok(account);
    }
    if !force && account.mc_expires_at - util::now_unix() > 300 {
        return Ok(account);
    }
    let client_id = effective_client_id(state).await;
    let ms = microsoft::refresh_ms_token(&state.http, &client_id, &account.ms_refresh_token).await?;
    let updated = complete_login(state, ms).await?;
    Ok(updated)
}

/// Da token Microsoft → account Minecraft completo, salvato nell'archivio cifrato.
async fn complete_login(state: &AppState, ms: microsoft::MsToken) -> Result<Account> {
    let xbox = microsoft::xbox_authenticate(&state.http, &ms.access_token).await?;
    let mc = microsoft::minecraft_login(&state.http, &xbox).await?;
    let profile = microsoft::minecraft_profile(&state.http, &mc.access_token).await?;
    let skin = profile.skins.iter().find(|s| s.state == "ACTIVE").or(profile.skins.first());
    // Solo il cape effettivamente indossato (state ACTIVE): niente cape "di default" fasulli.
    let cape = profile.capes.iter().find(|c| c.state == "ACTIVE");

    let mut store = state.accounts.lock().await;
    let previous_refresh = store.get(&profile.id).map(|a| a.ms_refresh_token.clone());
    let account = Account {
        uuid: profile.id.clone(),
        username: profile.name.clone(),
        kind: AccountKind::Microsoft,
        ms_refresh_token: ms.refresh_token.or(previous_refresh).unwrap_or_default(),
        mc_access_token: mc.access_token,
        mc_expires_at: util::now_unix() + mc.expires_in,
        xuid: xbox.xuid,
        skin_url: skin.map(|s| s.url.clone()),
        skin_variant: skin.map(|s| s.variant.clone()),
        cape_url: cape.map(|c| c.url.clone()),
    };
    store.upsert(account.clone());
    store.save()?;
    Ok(account)
}

async fn active_uuid(state: &AppState) -> Option<String> {
    let active = state.settings.read().await.active_account.clone();
    let store = state.accounts.lock().await;
    active
        .filter(|u| store.get(u).is_some())
        .or_else(|| store.accounts.first().map(|a| a.uuid.clone()))
}

/// Account attivo con token valido, pronto per il launch.
pub async fn launch_account(state: &AppState) -> Result<Account> {
    let uuid = active_uuid(state)
        .await
        .ok_or_else(|| msg("Nessun account: accedi con Microsoft dalla sezione Account"))?;
    let account = state
        .accounts
        .lock()
        .await
        .get(&uuid)
        .cloned()
        .ok_or_else(|| msg("Account non trovato"))?;
    refresh_if_needed(state, account, false).await
}

/// Account Microsoft (con token aggiornato) per la feature amici, che richiede un'identità verificata.
/// Preferisce l'account attivo se è Microsoft, altrimenti il primo account Microsoft disponibile.
/// Ignora gli account offline (il cui token non è valido lato server).
pub async fn social_account(state: &AppState) -> Result<Account> {
    let (active, accounts) = {
        let active = state.settings.read().await.active_account.clone();
        let store = state.accounts.lock().await;
        (active, store.accounts.clone())
    };
    let chosen = active
        .and_then(|u| accounts.iter().find(|a| a.uuid == u && a.kind == AccountKind::Microsoft).cloned())
        .or_else(|| accounts.iter().find(|a| a.kind == AccountKind::Microsoft).cloned())
        .ok_or_else(|| msg("Accedi con un account Microsoft per usare gli amici"))?;
    refresh_if_needed(state, chosen, false).await
}

/// Refresh all'avvio dell'app (errori ignorati: verranno mostrati al primo launch).
pub async fn refresh_active_on_startup(state: &AppState) {
    if let Err(e) = launch_account(state).await {
        log::info!("refresh account all'avvio: {e}");
    }
}

// ---------------------------------------------------------------------------
// Comandi IPC
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn auth_start(state: State<'_, AppState>) -> Result<microsoft::DeviceCode> {
    state.auth_cancel.store(false, Ordering::SeqCst);
    let client_id = effective_client_id(state.inner()).await;
    microsoft::start_device_code(&state.http, &client_id).await
}

#[tauri::command]
pub async fn auth_complete(state: State<'_, AppState>, code: microsoft::DeviceCode) -> Result<AccountInfo> {
    let client_id = effective_client_id(state.inner()).await;
    let ms = microsoft::poll_device_code(&state.http, &client_id, &code, &state.auth_cancel).await?;
    let account = complete_login(state.inner(), ms).await?;
    {
        let mut settings = state.settings.write().await;
        settings.active_account = Some(account.uuid.clone());
        settings.save(&state.paths).await?;
    }
    Ok(account.info(true))
}

#[tauri::command]
pub fn auth_cancel(state: State<'_, AppState>) {
    state.auth_cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn list_accounts(state: State<'_, AppState>) -> Result<Vec<AccountInfo>> {
    let active = active_uuid(state.inner()).await;
    let store = state.accounts.lock().await;
    Ok(store
        .accounts
        .iter()
        .map(|a| a.info(active.as_deref() == Some(a.uuid.as_str())))
        .collect())
}

#[tauri::command]
pub async fn set_active_account(state: State<'_, AppState>, uuid: String) -> Result<()> {
    if state.accounts.lock().await.get(&uuid).is_none() {
        return Err(msg("Account non trovato"));
    }
    let mut settings = state.settings.write().await;
    settings.active_account = Some(uuid);
    settings.save(&state.paths).await
}

#[tauri::command]
pub async fn remove_account(state: State<'_, AppState>, uuid: String) -> Result<()> {
    let mut store = state.accounts.lock().await;
    store.remove(&uuid);
    store.save()
}

#[tauri::command]
pub async fn refresh_account(state: State<'_, AppState>, uuid: String) -> Result<AccountInfo> {
    let account = state
        .accounts
        .lock()
        .await
        .get(&uuid)
        .cloned()
        .ok_or_else(|| msg("Account non trovato"))?;
    let refreshed = refresh_if_needed(state.inner(), account, true).await?;
    let active = active_uuid(state.inner()).await;
    Ok(refreshed.info(active.as_deref() == Some(refreshed.uuid.as_str())))
}

/// Account offline per sviluppo: disponibile solo nelle build di debug.
#[tauri::command]
pub async fn add_offline_account(state: State<'_, AppState>, username: String) -> Result<AccountInfo> {
    if !cfg!(debug_assertions) {
        return Err(msg("Gli account offline sono disponibili solo nelle build di sviluppo"));
    }
    let valid = (3..=16).contains(&username.len())
        && username.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if !valid {
        return Err(msg("Username non valido (3-16 caratteri, lettere, numeri, _)"));
    }
    let account = Account {
        uuid: uuid::Uuid::new_v4().simple().to_string(),
        username,
        kind: AccountKind::Offline,
        ms_refresh_token: String::new(),
        mc_access_token: "0".into(),
        mc_expires_at: i64::MAX,
        xuid: None,
        skin_url: None,
        skin_variant: None,
        cape_url: None,
    };
    let mut store = state.accounts.lock().await;
    store.upsert(account.clone());
    store.save()?;
    Ok(account.info(false))
}
