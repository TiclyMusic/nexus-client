//! Nexus Companion: la mod client (cartella `mod/`) con il menu amici in gioco.
//!
//! Il workflow `companion` la compila per ogni versione di Minecraft e la pubblica nella
//! release "companion" con l'indice `companion.json`. Prima di ogni avvio il launcher scarica
//! (una volta, con controllo SHA-1) il jar per la versione dell'istanza e lo copia nella
//! cartella mods; le istanze vanilla passano a Fabric. La mod parla con il launcher tramite il
//! ponte locale di `bridge.rs`.

use std::time::{Duration, SystemTime};

use sha1::{Digest, Sha1};

use crate::{
    error::{msg, Result},
    instances::{self, Instance},
    minecraft::loaders::{self, Loader},
    state::AppState,
};

const INDEX_URL: &str = "https://github.com/TiclyMusic/nexus-client/releases/download/companion/companion.json";
const RELEASE_URL: &str = "https://github.com/TiclyMusic/nexus-client/releases/download/companion";
const INDEX_MAX_AGE: Duration = Duration::from_secs(6 * 3600);
const JAR_NAME: &str = "nexus-companion.jar";

/// Copia di riserva (26.3) inclusa nel launcher, per il primo avvio senza rete.
const BUNDLED: &[u8] = include_bytes!("../resources/nexus-companion.jar");
const BUNDLED_FOR: &str = "26.3";

/// Indice in cache (scaricato al massimo ogni 6 ore; se la rete manca si usa quello vecchio).
async fn index(state: &AppState) -> Option<serde_json::Value> {
    let path = state.paths.meta().join("companion.json");
    let fresh = tokio::fs::metadata(&path)
        .await
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .is_some_and(|age| age < INDEX_MAX_AGE);
    if !fresh {
        if let Ok(resp) = state.http.get(INDEX_URL).send().await {
            if resp.status().is_success() {
                if let Ok(bytes) = resp.bytes().await {
                    if serde_json::from_slice::<serde_json::Value>(&bytes).is_ok() {
                        let _ = tokio::fs::create_dir_all(state.paths.meta()).await;
                        let _ = tokio::fs::write(&path, &bytes).await;
                    }
                }
            }
        }
    }
    let bytes = tokio::fs::read(&path).await.ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Jar della mod per questa versione di Minecraft, se esiste.
async fn jar_for(state: &AppState, mc: &str) -> Result<Option<Vec<u8>>> {
    let entry = index(state).await.and_then(|i| i["versions"][mc].as_object().cloned());
    let Some(entry) = entry else {
        return Ok((mc == BUNDLED_FOR).then(|| BUNDLED.to_vec()));
    };
    let sha1 = entry.get("sha1").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    let file = entry.get("file").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    if sha1.is_empty() || file.is_empty() || file.contains('/') || file.contains("..") {
        return Ok(None);
    }
    let cached = state.paths.meta().join("companion").join(format!("{mc}-{sha1}.jar"));
    if let Ok(bytes) = tokio::fs::read(&cached).await {
        return Ok(Some(bytes));
    }
    let bytes = match state.http.get(format!("{RELEASE_URL}/{file}")).send().await {
        Ok(r) if r.status().is_success() => r.bytes().await?.to_vec(),
        _ => return Ok((mc == BUNDLED_FOR).then(|| BUNDLED.to_vec())),
    };
    if hex::encode(Sha1::digest(&bytes)) != sha1 {
        return Err(msg("Nexus Companion scaricata ma danneggiata (SHA-1 diverso)"));
    }
    tokio::fs::create_dir_all(cached.parent().unwrap()).await?;
    tokio::fs::write(&cached, &bytes).await?;
    Ok(Some(bytes))
}

/// Prepara l'istanza per la mod: Fabric se è vanilla e il jar aggiornato nella cartella mods.
/// Ritorna false se la versione non è supportata (il gioco parte comunque, senza menu amici).
pub async fn ensure(state: &AppState, instance: &mut Instance) -> Result<bool> {
    if matches!(instance.loader, Loader::Forge | Loader::NeoForge) {
        return Ok(false);
    }
    let Some(jar) = jar_for(state, &instance.mc_version).await? else {
        return Ok(false);
    };
    if instance.loader == Loader::Vanilla {
        let Some(version) = loaders::recommended_version(state, Loader::Fabric, &instance.mc_version).await? else {
            return Ok(false);
        };
        instance.loader = Loader::Fabric;
        instance.loader_version = Some(version);
        instance.version_id = None; // prepare() installa il loader
        instances::save(state, instance).await?;
    }
    let mods = state.paths.game_dir(&instance.id).join("mods");
    tokio::fs::create_dir_all(&mods).await?;
    let target = mods.join(JAR_NAME);
    if tokio::fs::read(&target).await.unwrap_or_default() != jar {
        tokio::fs::write(&target, &jar).await?;
    }
    Ok(true)
}
