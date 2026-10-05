//! Preparazione dell'istanza, costruzione della riga di comando e avvio del processo Java.

use std::{collections::HashMap, path::PathBuf, process::Stdio, time::Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, BufReader},
    sync::oneshot,
};

use super::{
    install::{extract_natives, install_version, resolve_version, PreparedVersion},
    java, loaders,
    version::{rules_allow, Argument, Features},
};
use crate::{
    auth::{self, store::Account},
    error::{msg, Result},
    instances::{self, Instance},
    state::{AppState, RunningGame},
    util,
};

const LAUNCHER_NAME: &str = "NexusLauncher";

/// Flag G1GC ottimizzati per il client (derivati dai flag di Aikar, senza opzioni obsolete su Java 21+).
const OPTIMIZED_GC_FLAGS: &[&str] = &[
    "-XX:+UseG1GC",
    "-XX:+ParallelRefProcEnabled",
    "-XX:MaxGCPauseMillis=200",
    "-XX:+UnlockExperimentalVMOptions",
    "-XX:+DisableExplicitGC",
    "-XX:+AlwaysPreTouch",
    "-XX:G1NewSizePercent=30",
    "-XX:G1MaxNewSizePercent=40",
    "-XX:G1HeapRegionSize=8M",
    "-XX:G1ReservePercent=20",
    "-XX:G1HeapWastePercent=5",
    "-XX:G1MixedGCCountTarget=4",
    "-XX:InitiatingHeapOccupancyPercent=15",
    "-XX:G1MixedGCLiveThresholdPercent=90",
    "-XX:SurvivorRatio=32",
    "-XX:+PerfDisableSharedMem",
    "-XX:MaxTenuringThreshold=1",
];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameLog<'a> {
    pub instance_id: &'a str,
    /// `info` | `warn` | `error` | `launcher`
    pub level: &'a str,
    pub line: &'a str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GameStarted {
    instance_id: String,
    pid: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GameExit {
    instance_id: String,
    code: Option<i32>,
    crashed: bool,
    duration_secs: u64,
}

pub fn emit_log(app: &AppHandle, instance_id: &str, level: &str, line: &str) {
    app.state::<AppState>().push_log(instance_id, line);
    let _ = app.emit("game-log", GameLog { instance_id, level, line });
}

fn classify(line: &str) -> &'static str {
    if line.contains("/ERROR]") || line.contains("[ERROR]") || line.contains("Exception") || line.contains("FATAL") {
        "error"
    } else if line.contains("/WARN]") || line.contains("[WARN]") {
        "warn"
    } else {
        "info"
    }
}

fn emit_finished(app: &AppHandle, task: &str) {
    let _ = app.emit("task-finished", task);
}

/// Garantisce che loader, librerie, asset e Java siano presenti. Idempotente.
pub async fn prepare(
    app: &AppHandle,
    state: &AppState,
    instance: &mut Instance,
    verify: bool,
) -> Result<(PreparedVersion, PathBuf)> {
    let task = instance.id.clone();
    {
        let mut installing = state.installing.lock().await;
        if !installing.insert(task.clone()) {
            return Err(msg("Installazione già in corso per questa istanza"));
        }
    }
    let result = prepare_inner(app, state, instance, verify).await;
    state.installing.lock().await.remove(&task);
    emit_finished(app, &task);
    result
}

async fn prepare_inner(
    app: &AppHandle,
    state: &AppState,
    instance: &mut Instance,
    verify: bool,
) -> Result<(PreparedVersion, PathBuf)> {
    let task = instance.id.clone();
    let game_dir = state.paths.game_dir(&instance.id);
    tokio::fs::create_dir_all(&game_dir).await?;

    emit_log(app, &task, "launcher", &format!("Risoluzione di Minecraft {}…", instance.mc_version));
    let (vanilla, _) = resolve_version(state, &instance.mc_version).await?;
    let (component, major) = vanilla
        .java_version
        .as_ref()
        .map(|j| (j.component.clone(), j.major_version))
        .unwrap_or((None, 8));

    let java = java::select_java(app, state, instance.java_path.as_deref(), component.as_deref(), major, &task).await?;
    emit_log(app, &task, "launcher", &format!("Java: {}", java.display()));

    if instance.version_id.is_none() {
        let version_id = match (instance.loader, instance.loader_version.clone()) {
            (loaders::Loader::Vanilla, _) => instance.mc_version.clone(),
            (loader, Some(lv)) => {
                emit_log(app, &task, "launcher", &format!("Installazione {loader:?} {lv}…"));
                // Gli installer Forge/NeoForge richiedono il client vanilla già presente.
                if matches!(loader, loaders::Loader::Forge | loaders::Loader::NeoForge) {
                    install_version(app, state, &instance.mc_version, &game_dir, false, &task).await?;
                }
                loaders::install(app, state, loader, &instance.mc_version, &lv, Some(java.as_path()), &task).await?
            }
            (loader, None) => return Err(msg(format!("Versione di {loader:?} non specificata"))),
        };
        instance.version_id = Some(version_id);
        instances::save(state, instance).await?;
    }

    let version_id = instance.version_id.clone().unwrap_or_default();
    emit_log(app, &task, "launcher", &format!("Verifica file per {version_id}…"));
    let prepared = install_version(app, state, &version_id, &game_dir, verify, &task).await?;
    Ok((prepared, java))
}

fn substitute(arg: &str, vars: &HashMap<&'static str, String>) -> String {
    let mut out = arg.to_string();
    // Sostituzione iterativa di ${chiave}
    let mut start = 0;
    while let Some(pos) = out[start..].find("${") {
        let abs = start + pos;
        let Some(end_rel) = out[abs..].find('}') else { break };
        let key = &out[abs + 2..abs + end_rel];
        if let Some(value) = vars.get(key) {
            let value = value.clone();
            out.replace_range(abs..abs + end_rel + 1, &value);
            start = abs + value.len();
        } else {
            start = abs + end_rel + 1;
        }
    }
    out
}

fn collect_args(args: &[Argument], features: &Features, vars: &HashMap<&'static str, String>) -> Vec<String> {
    let mut out = Vec::new();
    for arg in args {
        match arg {
            Argument::Plain(s) => out.push(substitute(s, vars)),
            Argument::Conditional { rules, value } => {
                if rules_allow(Some(rules), features) {
                    out.extend(value.values().iter().map(|v| substitute(v, vars)));
                }
            }
        }
    }
    out
}

fn build_command(
    state: &AppState,
    instance: &Instance,
    prepared: &PreparedVersion,
    account: &Account,
    settings_jvm: &str,
    optimized_gc: bool,
) -> Result<(Vec<String>, PathBuf)> {
    let version = &prepared.version;
    let sep = if cfg!(windows) { ";" } else { ":" };
    let game_dir = state.paths.game_dir(&instance.id);
    let natives = state.paths.natives(&instance.id);
    let classpath = prepared
        .classpath
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(sep);

    let assets_dir = if prepared.assets_index_name == "legacy" || prepared.assets_index_name == "pre-1.6" {
        prepared.assets_root.join("virtual").join(&prepared.assets_index_name)
    } else {
        prepared.assets_root.clone()
    };

    let mut vars: HashMap<&'static str, String> = HashMap::new();
    vars.insert("auth_player_name", account.username.clone());
    vars.insert("version_name", instance.version_id.clone().unwrap_or_default());
    vars.insert("game_directory", game_dir.to_string_lossy().to_string());
    vars.insert("assets_root", prepared.assets_root.to_string_lossy().to_string());
    vars.insert("game_assets", assets_dir.to_string_lossy().to_string());
    vars.insert("assets_index_name", prepared.assets_index_name.clone());
    vars.insert("auth_uuid", account.uuid.replace('-', ""));
    vars.insert("auth_access_token", account.mc_access_token.clone());
    vars.insert("auth_session", format!("token:{}", account.mc_access_token));
    vars.insert("auth_xuid", account.xuid.clone().unwrap_or_default());
    vars.insert("clientid", String::new());
    vars.insert("user_type", "msa".into());
    vars.insert("user_properties", "{}".into());
    vars.insert("version_type", version.kind.clone().unwrap_or_else(|| "release".into()));
    vars.insert("natives_directory", natives.to_string_lossy().to_string());
    vars.insert("launcher_name", LAUNCHER_NAME.into());
    vars.insert("launcher_version", env!("CARGO_PKG_VERSION").into());
    vars.insert("classpath", classpath.clone());
    vars.insert("classpath_separator", sep.into());
    vars.insert("library_directory", state.paths.libraries().to_string_lossy().to_string());
    vars.insert("resolution_width", instance.window_width.unwrap_or(1280).to_string());
    vars.insert("resolution_height", instance.window_height.unwrap_or(720).to_string());

    let features = Features {
        custom_resolution: instance.window_width.is_some() && instance.window_height.is_some(),
    };

    let mut args: Vec<String> = vec![
        format!("-Xms{}M", instance.min_ram_mb.min(instance.max_ram_mb)),
        format!("-Xmx{}M", instance.max_ram_mb),
    ];
    if optimized_gc {
        args.extend(OPTIMIZED_GC_FLAGS.iter().map(|s| s.to_string()));
    }
    args.extend(settings_jvm.split_whitespace().map(str::to_string));
    args.extend(instance.jvm_args.split_whitespace().map(str::to_string));

    match &version.arguments {
        Some(a) if !a.jvm.is_empty() => args.extend(collect_args(&a.jvm, &features, &vars)),
        _ => {
            args.push(format!("-Djava.library.path={}", natives.to_string_lossy()));
            args.push("-cp".into());
            args.push(classpath);
        }
    }

    args.push(
        version
            .main_class
            .clone()
            .ok_or_else(|| msg("mainClass mancante nella version JSON"))?,
    );

    if let Some(legacy) = &version.minecraft_arguments {
        args.extend(legacy.split_whitespace().map(|a| substitute(a, &vars)));
        if features.custom_resolution {
            args.extend(["--width".into(), vars["resolution_width"].clone()]);
            args.extend(["--height".into(), vars["resolution_height"].clone()]);
        }
    } else if let Some(a) = &version.arguments {
        args.extend(collect_args(&a.game, &features, &vars));
    }

    Ok((args, game_dir))
}

fn spawn_reader<R: AsyncRead + Unpin + Send + 'static>(app: AppHandle, id: String, reader: R) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(reader);
        let mut buf = Vec::with_capacity(512);
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    // from_utf8_lossy: su Windows l'output può non essere UTF-8.
                    let line = String::from_utf8_lossy(&buf);
                    let line = line.trim_end_matches(['\r', '\n']);
                    emit_log(&app, &id, classify(line), line);
                }
            }
        }
    });
}

pub async fn launch(app: &AppHandle, state: &AppState, id: &str) -> Result<u32> {
    if state.running.lock().unwrap().contains_key(id) {
        return Err(msg("Questa istanza è già in esecuzione"));
    }
    let mut instance = instances::load(state, id).await?;
    state.logs.lock().unwrap().remove(id);

    let account = auth::launch_account(state).await?;
    let (prepared, java) = prepare(app, state, &mut instance, false).await?;

    let natives_dir = state.paths.natives(id);
    extract_natives(prepared.natives_jars.clone(), natives_dir).await?;

    let (jvm_global, gc) = {
        let s = state.settings.read().await;
        (s.jvm_args.clone(), s.optimized_gc)
    };
    let (args, game_dir) = build_command(state, &instance, &prepared, &account, &jvm_global, gc)?;

    let shown = args
        .iter()
        .map(|a| a.replace(&account.mc_access_token, "••••"))
        .collect::<Vec<_>>()
        .join(" ");
    emit_log(app, id, "launcher", &format!("Avvio: {} {}", java.display(), shown));

    let mut cmd = tokio::process::Command::new(&java);
    cmd.args(&args)
        .current_dir(&game_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    util::no_window(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| msg(format!("Impossibile avviare Java ({}): {e}", java.display())))?;
    let pid = child.id().unwrap_or(0);

    if let Some(out) = child.stdout.take() {
        spawn_reader(app.clone(), id.to_string(), out);
    }
    if let Some(err) = child.stderr.take() {
        spawn_reader(app.clone(), id.to_string(), err);
    }

    let (kill_tx, kill_rx) = oneshot::channel::<()>();
    state.running.lock().unwrap().insert(
        id.to_string(),
        RunningGame {
            pid,
            kill: Some(kill_tx),
        },
    );
    instance.last_played = Some(util::now_rfc3339());
    instances::save(state, &instance).await?;
    let _ = app.emit(
        "game-started",
        GameStarted {
            instance_id: id.to_string(),
            pid,
        },
    );

    let app2 = app.clone();
    let id2 = id.to_string();
    tokio::spawn(async move {
        let started = Instant::now();
        let waited = tokio::select! {
            s = child.wait() => Some(s),
            _ = kill_rx => None,
        };
        let status = match waited {
            Some(s) => s.ok(),
            None => {
                let _ = child.kill().await;
                child.wait().await.ok()
            }
        };
        let state = app2.state::<AppState>();
        state.running.lock().unwrap().remove(&id2);
        let code = status.and_then(|s| s.code());
        let duration = started.elapsed().as_secs();
        if let Ok(mut inst) = instances::load(&state, &id2).await {
            inst.play_time_secs += duration;
            let _ = instances::save(&state, &inst).await;
        }
        emit_log(&app2, &id2, "launcher", &format!("Processo terminato (codice {code:?})"));
        let _ = app2.emit(
            "game-exit",
            GameExit {
                instance_id: id2.clone(),
                code,
                crashed: !matches!(code, Some(0)),
                duration_secs: duration,
            },
        );
    });

    Ok(pid)
}

// ---------------------------------------------------------------------------
// Comandi IPC
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn install_instance(app: AppHandle, state: State<'_, AppState>, id: String, verify: bool) -> Result<Instance> {
    let mut instance = instances::load(state.inner(), &id).await?;
    if verify {
        // "Ripara": forza anche la re-installazione del loader.
        instance.version_id = None;
    }
    prepare(&app, state.inner(), &mut instance, verify).await?;
    emit_log(&app, &id, "launcher", "Istanza pronta ✔");
    Ok(instance)
}

#[tauri::command]
pub async fn launch_instance(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<u32> {
    match launch(&app, state.inner(), &id).await {
        Ok(pid) => Ok(pid),
        Err(e) => {
            emit_log(&app, &id, "error", &format!("Avvio fallito: {e}"));
            Err(e)
        }
    }
}

#[tauri::command]
pub fn kill_instance(state: State<'_, AppState>, id: String) -> Result<()> {
    let mut running = state.running.lock().unwrap();
    let game = running.get_mut(&id).ok_or_else(|| msg("Istanza non in esecuzione"))?;
    if let Some(tx) = game.kill.take() {
        let _ = tx.send(());
    }
    Ok(())
}

#[tauri::command]
pub fn running_instances(state: State<'_, AppState>) -> HashMap<String, u32> {
    state
        .running
        .lock()
        .unwrap()
        .iter()
        .map(|(k, v)| (k.clone(), v.pid))
        .collect()
}
