//! Nexus Companion: la mod client (cartella `mod/`) con il menu amici in gioco.
//!
//! Prima di ogni avvio, sulle versioni supportate, il launcher la copia nella cartella mods;
//! le istanze vanilla passano a Fabric (il gioco resta identico, in più c'è il menu amici).
//! La mod parla con il launcher tramite il ponte locale di `bridge.rs`.

use crate::{
    error::Result,
    instances::{self, Instance},
    minecraft::loaders::{self, Loader},
    state::AppState,
};

/// Jar compilato da `mod/` (`gradlew build`, poi copiato in src-tauri/resources).
const JAR: &[u8] = include_bytes!("../resources/nexus-companion.jar");
const JAR_NAME: &str = "nexus-companion.jar";

/// Versioni di Minecraft per cui esiste una build della mod.
pub const SUPPORTED: &[&str] = &["26.3"];

pub fn supported(instance: &Instance) -> bool {
    SUPPORTED.contains(&instance.mc_version.as_str()) && !matches!(instance.loader, Loader::Forge | Loader::NeoForge)
}

/// Prepara l'istanza per la mod: Fabric se è vanilla e il jar aggiornato nella cartella mods.
/// Ritorna false se la versione non è supportata (il gioco parte comunque, senza menu amici).
pub async fn ensure(state: &AppState, instance: &mut Instance) -> Result<bool> {
    if !supported(instance) {
        return Ok(false);
    }
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
    let current = tokio::fs::read(&target).await.unwrap_or_default();
    if current != JAR {
        tokio::fs::write(&target, JAR).await?;
    }
    Ok(true)
}
