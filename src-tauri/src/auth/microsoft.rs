//! Catena di autenticazione: Microsoft OAuth2 (Device Code) → Xbox Live → XSTS → Minecraft Services.

use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::error::{Error, Result};

const DEVICE_CODE_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const TOKEN_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const SCOPE: &str = "XboxLive.signin offline_access";
const XBL_URL: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_URL: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN_URL: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE_URL: &str = "https://api.minecraftservices.com/minecraft/profile";

fn auth_err(text: impl Into<String>) -> Error {
    Error::Auth(text.into())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    #[serde(alias = "user_code")]
    pub user_code: String,
    #[serde(alias = "device_code")]
    pub device_code: String,
    #[serde(alias = "verification_uri")]
    pub verification_uri: String,
    #[serde(alias = "expires_in")]
    pub expires_in: u64,
    pub interval: u64,
    #[serde(default)]
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct MsToken {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OAuthError {
    error: String,
    #[serde(default)]
    error_description: Option<String>,
}

pub async fn start_device_code(http: &reqwest::Client, client_id: &str) -> Result<DeviceCode> {
    if client_id.trim().is_empty() {
        return Err(auth_err(
            "Client ID Azure non configurato. Impostalo in Impostazioni → Account (vedi README).",
        ));
    }
    let resp = http
        .post(DEVICE_CODE_URL)
        .form(&[("client_id", client_id), ("scope", SCOPE)])
        .send()
        .await?;
    if !resp.status().is_success() {
        let err: OAuthError = resp.json().await?;
        return Err(auth_err(err.error_description.unwrap_or(err.error)));
    }
    Ok(resp.json().await?)
}

pub async fn poll_device_code(
    http: &reqwest::Client,
    client_id: &str,
    code: &DeviceCode,
    cancel: &AtomicBool,
) -> Result<MsToken> {
    let mut interval = code.interval.max(1);
    let deadline = Instant::now() + Duration::from_secs(code.expires_in);
    loop {
        tokio::time::sleep(Duration::from_secs(interval)).await;
        if cancel.load(Ordering::SeqCst) {
            return Err(auth_err("Login annullato"));
        }
        if Instant::now() > deadline {
            return Err(auth_err("Codice scaduto, riprova"));
        }
        let resp = http
            .post(TOKEN_URL)
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ("client_id", client_id),
                ("device_code", code.device_code.as_str()),
            ])
            .send()
            .await?;
        if resp.status().is_success() {
            return Ok(resp.json().await?);
        }
        let err: OAuthError = resp.json().await?;
        match err.error.as_str() {
            "authorization_pending" => continue,
            "slow_down" => interval += 5,
            "authorization_declined" => return Err(auth_err("Accesso rifiutato dall'utente")),
            "expired_token" => return Err(auth_err("Codice scaduto, riprova")),
            other => return Err(auth_err(err.error_description.unwrap_or_else(|| other.to_string()))),
        }
    }
}

pub async fn refresh_ms_token(http: &reqwest::Client, client_id: &str, refresh_token: &str) -> Result<MsToken> {
    let resp = http
        .post(TOKEN_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", client_id),
            ("refresh_token", refresh_token),
            ("scope", SCOPE),
        ])
        .send()
        .await?;
    if !resp.status().is_success() {
        let err: OAuthError = resp.json().await?;
        return Err(auth_err(format!(
            "Sessione Microsoft scaduta, effettua di nuovo il login ({})",
            err.error
        )));
    }
    Ok(resp.json().await?)
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct XboxResponse {
    token: String,
    display_claims: XboxClaims,
}

#[derive(Deserialize)]
struct XboxClaims {
    xui: Vec<XboxUser>,
}

#[derive(Deserialize)]
struct XboxUser {
    uhs: String,
    #[serde(default)]
    xid: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct XstsError {
    #[serde(default)]
    x_err: Option<u64>,
}

pub struct XboxAuth {
    pub uhs: String,
    pub xsts_token: String,
    pub xuid: Option<String>,
}

pub async fn xbox_authenticate(http: &reqwest::Client, ms_access_token: &str) -> Result<XboxAuth> {
    let xbl: XboxResponse = http
        .post(XBL_URL)
        .header("Accept", "application/json")
        .json(&json!({
            "Properties": {
                "AuthMethod": "RPS",
                "SiteName": "user.auth.xboxlive.com",
                "RpsTicket": format!("d={ms_access_token}")
            },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT"
        }))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let resp = http
        .post(XSTS_URL)
        .header("Accept", "application/json")
        .json(&json!({
            "Properties": { "SandboxId": "RETAIL", "UserTokens": [xbl.token] },
            "RelyingParty": "rp://api.minecraftservices.com/",
            "TokenType": "JWT"
        }))
        .send()
        .await?;

    if resp.status().as_u16() == 401 {
        let err: XstsError = resp.json().await.unwrap_or(XstsError { x_err: None });
        return Err(auth_err(match err.x_err {
            Some(2148916233) => "Questo account Microsoft non ha un profilo Xbox. Crealo su xbox.com e riprova.",
            Some(2148916235) => "Xbox Live non è disponibile nel tuo paese.",
            Some(2148916236) | Some(2148916237) => "L'account richiede la verifica dell'età (Corea del Sud).",
            Some(2148916238) => "Account minorenne: deve essere aggiunto a una Family da un adulto.",
            _ => "Autorizzazione XSTS negata.",
        }));
    }
    let xsts: XboxResponse = resp.error_for_status()?.json().await?;
    let user = xsts
        .display_claims
        .xui
        .into_iter()
        .next()
        .ok_or_else(|| auth_err("Risposta XSTS senza user hash"))?;
    Ok(XboxAuth {
        uhs: user.uhs,
        xsts_token: xsts.token,
        xuid: user.xid,
    })
}

#[derive(Deserialize)]
pub struct MinecraftToken {
    pub access_token: String,
    pub expires_in: i64,
}

pub async fn minecraft_login(http: &reqwest::Client, xbox: &XboxAuth) -> Result<MinecraftToken> {
    let resp = http
        .post(MC_LOGIN_URL)
        .json(&json!({ "identityToken": format!("XBL3.0 x={};{}", xbox.uhs, xbox.xsts_token) }))
        .send()
        .await?;
    match resp.status().as_u16() {
        200 => Ok(resp.json().await?),
        403 => Err(auth_err(
            "Minecraft Services ha rifiutato il Client ID: la tua app Azure deve essere approvata da Mojang \
             (https://aka.ms/mce-reviewappid).",
        )),
        code => Err(auth_err(format!("login_with_xbox ha risposto HTTP {code}"))),
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MinecraftProfile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub skins: Vec<Skin>,
    #[serde(default)]
    pub capes: Vec<Cape>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Skin {
    pub url: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub variant: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Cape {
    pub url: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub alias: String,
}

pub async fn minecraft_profile(http: &reqwest::Client, mc_token: &str) -> Result<MinecraftProfile> {
    let resp = http.get(MC_PROFILE_URL).bearer_auth(mc_token).send().await?;
    match resp.status().as_u16() {
        200 => Ok(resp.json().await?),
        404 => Err(auth_err("Questo account non possiede Minecraft: Java Edition.")),
        code => Err(auth_err(format!("Profilo Minecraft: HTTP {code}"))),
    }
}
