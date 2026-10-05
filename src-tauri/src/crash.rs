//! Analizzatore di crash euristico: riconosce i problemi più comuni prima di coinvolgere l'AI
//! e prepara un estratto compatto del log da passare al modello.

use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;
use tauri::State;

use crate::{error::Result, instances, state::AppState};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    /// `error` | `warning`
    pub severity: &'static str,
    pub title: String,
    pub detail: String,
    pub suggestion: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashAnalysis {
    pub findings: Vec<Finding>,
    pub excerpt: String,
    pub crash_report_file: Option<String>,
}

static CLASS_VERSION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"class file version (\d+)\.\d+\), this version of the Java Runtime only recognizes class file versions up to (\d+)").unwrap());
static FABRIC_MISSING: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"Mod '([^']+)' \(([^)]+)\) \S+ requires (?:version \S+ |any version |version \S+ or later )?of (?:mod )?'?([^'(]+?)'? \(([^)]+)\), which is missing").unwrap()
});
static FABRIC_BREAKS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Mod '([^']+)' \(([^)]+)\) \S+ is incompatible with (.+)").unwrap());
static FORGE_MISSING: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Mod ID: '([^']+)', Requested by: '([^']+)', Expected range: '([^']+)'").unwrap());
static MIXIN_FAIL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Mixin apply(?: for mod (\S+))? failed ([^\s:]+)").unwrap());
static BAD_VM_OPTION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Unrecognized VM option '([^']+)'").unwrap());

fn analyze_text(text: &str) -> Vec<Finding> {
    let mut out = Vec::new();
    let mut push = |severity, title: &str, detail: String, suggestion: &str| {
        if !out.iter().any(|f: &Finding| f.title == title && f.detail == detail) {
            out.push(Finding {
                severity,
                title: title.to_string(),
                detail,
                suggestion: suggestion.to_string(),
            });
        }
    };

    if let Some(c) = CLASS_VERSION.captures(text) {
        let needed: u32 = c[1].parse().unwrap_or(0);
        let have: u32 = c[2].parse().unwrap_or(0);
        push(
            "error",
            "Versione di Java errata",
            format!("Serve Java {} ma è in uso Java {}.", needed.saturating_sub(44), have.saturating_sub(44)),
            "Rimuovi il path Java personalizzato dell'istanza o abilita il download automatico di Java.",
        );
    }
    for c in FABRIC_MISSING.captures_iter(text) {
        push(
            "error",
            "Dipendenza mancante",
            format!("{} richiede {} ({}).", &c[1], c[3].trim(), &c[4]),
            "Installa la dipendenza indicata dal browser Modrinth (es. Fabric API).",
        );
    }
    for c in FABRIC_BREAKS.captures_iter(text) {
        push(
            "error",
            "Mod incompatibili",
            format!("{} è incompatibile con {}", &c[1], c[3].trim()),
            "Disattiva una delle due mod oppure aggiorna alla versione compatibile.",
        );
    }
    for c in FORGE_MISSING.captures_iter(text) {
        push(
            "error",
            "Dipendenza mancante (Forge/NeoForge)",
            format!("'{}' richiede '{}' versione {}", &c[2], &c[1], &c[3]),
            "Installa o aggiorna la mod richiesta.",
        );
    }
    for c in MIXIN_FAIL.captures_iter(text) {
        let owner = c.get(1).map(|m| m.as_str()).unwrap_or("sconosciuta");
        push(
            "error",
            "Conflitto Mixin",
            format!("Mixin fallito ({}) della mod {}", &c[2], owner),
            "Aggiorna la mod indicata o disattivala: spesso è incompatibile con un'altra mod di rendering/ottimizzazione.",
        );
    }
    if let Some(c) = BAD_VM_OPTION.captures(text) {
        push(
            "error",
            "Argomento JVM non valido",
            format!("La JVM non riconosce {}", &c[1]),
            "Rimuovi l'argomento dalle impostazioni JVM dell'istanza.",
        );
    }
    if text.contains("java.lang.OutOfMemoryError") {
        push(
            "error",
            "Memoria esaurita",
            "Il gioco ha finito la RAM assegnata.".into(),
            "Aumenta la RAM massima dell'istanza (6-8 GB per modpack grandi).",
        );
    }
    if text.contains("Could not reserve enough space") || text.contains("Invalid maximum heap size") {
        push(
            "error",
            "RAM non disponibile",
            "La JVM non riesce ad allocare la memoria richiesta.".into(),
            "Riduci la RAM massima o usa un Java a 64 bit.",
        );
    }
    if text.contains("DuplicateModsFoundException") || text.contains("Duplicate mods found") || text.contains("duplicate mod") {
        push(
            "error",
            "Mod duplicate",
            "Nella cartella mods sono presenti due copie della stessa mod.".into(),
            "Elimina le versioni duplicate dalla scheda Mod.",
        );
    }
    if text.contains("Pixel format not accelerated")
        || text.contains("WGL: The driver does not appear to support OpenGL")
        || text.contains("GLFW error 65542")
    {
        push(
            "error",
            "Driver grafici",
            "OpenGL non disponibile o driver non aggiornati.".into(),
            "Aggiorna i driver della GPU; sui portatili forza la GPU dedicata.",
        );
    }
    if text.contains("EXCEPTION_ACCESS_VIOLATION") {
        push(
            "warning",
            "Crash nativo",
            "La JVM è crashata in codice nativo (spesso driver grafici o mod di rendering).".into(),
            "Aggiorna i driver GPU e prova a disattivare Sodium/Iris o gli shader.",
        );
    }
    if text.contains("NoSuchMethodError") || text.contains("NoClassDefFoundError") {
        push(
            "warning",
            "Versioni delle mod non allineate",
            "Una mod chiama codice che non esiste nella versione installata di un'altra mod o del gioco.".into(),
            "Verifica che tutte le mod siano per la stessa versione di Minecraft e del loader.",
        );
    }
    out
}

/// Estrae le righe più rilevanti: contesto attorno a errori + coda del log (max ~12 KB).
fn excerpt(lines: &[String]) -> String {
    const MAX: usize = 12_000;
    let mut picked = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if line.contains("Exception") || line.contains("ERROR") || line.contains("FATAL") || line.contains("Caused by") {
            let from = i.saturating_sub(2);
            let to = (i + 6).min(lines.len());
            picked.push(lines[from..to].join("\n"));
        }
    }
    let tail_from = lines.len().saturating_sub(80);
    picked.push(format!("--- ultime righe ---\n{}", lines[tail_from..].join("\n")));

    let mut out = String::new();
    for block in picked.iter().rev() {
        if out.len() + block.len() > MAX {
            break;
        }
        out = format!("{block}\n…\n{out}");
    }
    out
}

pub async fn analyze(state: &AppState, instance_id: &str) -> Result<CrashAnalysis> {
    instances::load(state, instance_id).await?;
    let game_dir = state.paths.game_dir(instance_id);

    let mut lines = state.log_tail(instance_id);
    if lines.is_empty() {
        if let Ok(text) = tokio::fs::read_to_string(game_dir.join("logs").join("latest.log")).await {
            lines = text.lines().map(str::to_string).collect();
        }
    }

    // Crash report più recente
    let mut crash_report = None;
    if let Ok(mut entries) = tokio::fs::read_dir(game_dir.join("crash-reports")).await {
        let mut newest: Option<(std::time::SystemTime, std::path::PathBuf)> = None;
        while let Ok(Some(e)) = entries.next_entry().await {
            if let Ok(modified) = e.metadata().await.and_then(|m| m.modified()) {
                if newest.as_ref().map(|(t, _)| modified > *t).unwrap_or(true) {
                    newest = Some((modified, e.path()));
                }
            }
        }
        if let Some((_, path)) = newest {
            if let Ok(text) = tokio::fs::read_to_string(&path).await {
                crash_report = Some((path.file_name().unwrap_or_default().to_string_lossy().to_string(), text));
            }
        }
    }

    let mut full = lines.join("\n");
    if let Some((_, text)) = &crash_report {
        full.push('\n');
        full.push_str(text);
    }
    let findings = analyze_text(&full);

    let mut ex = excerpt(&lines);
    if let Some((_, text)) = &crash_report {
        let head: String = text.chars().take(4000).collect();
        ex = format!("=== crash report ===\n{head}\n\n=== log ===\n{ex}");
    }

    Ok(CrashAnalysis {
        findings,
        excerpt: ex,
        crash_report_file: crash_report.map(|(name, _)| name),
    })
}

#[tauri::command]
pub async fn analyze_crash(state: State<'_, AppState>, instance_id: String) -> Result<CrashAnalysis> {
    analyze(state.inner(), &instance_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_java_version() {
        let log = "java.lang.UnsupportedClassVersionError: net/minecraft/client/main/Main has been compiled by a more recent version of the Java Runtime (class file version 65.0), this version of the Java Runtime only recognizes class file versions up to 52.0";
        let f = analyze_text(log);
        assert_eq!(f[0].title, "Versione di Java errata");
        assert!(f[0].detail.contains("Java 21"));
    }

    #[test]
    fn detects_fabric_missing_dependency() {
        let log = "- Mod 'Sodium' (sodium) 0.5.8 requires any version of mod 'Fabric API' (fabric-api), which is missing!";
        let f = analyze_text(log);
        assert_eq!(f[0].title, "Dipendenza mancante");
    }
}
