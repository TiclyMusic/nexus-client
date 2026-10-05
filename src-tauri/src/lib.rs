//! Nexus Launcher — backend Tauri v2.

mod ai;
mod ai_local;
mod auth;
mod crash;
mod download;
mod error;
mod friends;
mod instances;
mod minecraft;
mod modrinth;
mod paths;
mod settings;
mod state;
mod tunnel;
mod util;

use tauri::{Manager, State};

use error::Result;
use settings::Settings;
use state::AppState;

#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Result<Settings> {
    Ok(state.settings.read().await.clone())
}

#[tauri::command]
async fn save_settings(state: State<'_, AppState>, settings: Settings) -> Result<Settings> {
    let mut current = state.settings.write().await;
    let mut next = settings;
    next.download_concurrency = next.download_concurrency.clamp(1, 64);
    next.default_min_ram_mb = next.default_min_ram_mb.clamp(512, next.default_max_ram_mb.max(512));
    *current = next;
    current.save(&state.paths).await?;
    Ok(current.clone())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            std::fs::create_dir_all(&root)?;
            app.manage(AppState::new(root));

            // Refresh automatico del token dell'account attivo.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = handle.state::<AppState>();
                auth::refresh_active_on_startup(&state).await;
            });

            // Heartbeat di presenza per il tab Amici (ogni 30s, se il server è configurato).
            let hb = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                    let state = hb.state::<AppState>();
                    friends::heartbeat(&state).await;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            // auth
            auth::auth_start,
            auth::auth_complete,
            auth::auth_cancel,
            auth::list_accounts,
            auth::set_active_account,
            auth::remove_account,
            auth::refresh_account,
            auth::add_offline_account,
            // versioni / sistema
            minecraft::get_minecraft_versions,
            minecraft::get_loader_versions,
            minecraft::detect_java,
            minecraft::system_info,
            minecraft::fetch_texture,
            // istanze
            instances::list_instances,
            instances::get_instance,
            instances::create_instance,
            instances::update_instance,
            instances::clone_instance,
            instances::delete_instance,
            instances::open_instance_folder,
            // install & launch
            minecraft::launch::install_instance,
            minecraft::launch::launch_instance,
            minecraft::launch::kill_instance,
            minecraft::launch::running_instances,
            // contenuti
            modrinth::modrinth_search,
            modrinth::modrinth_install,
            modrinth::modrinth_install_modpack,
            modrinth::list_content,
            modrinth::toggle_content,
            modrinth::delete_content,
            // AI
            crash::analyze_crash,
            ai::ollama_models,
            ai::ollama_pull,
            ai::ollama_chat,
            ai::custom_api_chat,
            ai_local::local_ai_status,
            ai_local::local_ai_prepare,
            // Tunnel & Host
            tunnel::start_tunnel,
            tunnel::stop_tunnel,
            tunnel::get_tunnel_status,
            tunnel::detect_lan_port,
            // Amici & Presenza
            friends::friends_configured,
            friends::get_friends,
            friends::search_friends,
            friends::send_friend_request,
            friends::resolve_mc_name,
            friends::respond_friend_request,
            friends::remove_friend,
            friends::set_friend_favorite,
            // Tema Minecraft Material 3
            minecraft::theme::apply_material3_theme,
            minecraft::theme::is_material3_theme_enabled,
        ])
        .run(tauri::generate_context!())
        .expect("errore durante l'avvio di Nexus Launcher");
}
