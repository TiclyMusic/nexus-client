use std::{
    collections::{HashMap, VecDeque},
    path::PathBuf,
    sync::{atomic::AtomicBool, Mutex as StdMutex},
};

use tokio::sync::{oneshot, Mutex, RwLock};

use crate::{auth::store::AccountStore, paths::Paths, settings::Settings, util};

pub const LOG_BUFFER_LINES: usize = 4000;

pub struct RunningGame {
    pub pid: u32,
    pub kill: Option<oneshot::Sender<()>>,
}

pub struct AppState {
    pub paths: Paths,
    pub http: reqwest::Client,
    pub settings: RwLock<Settings>,
    pub accounts: Mutex<AccountStore>,
    /// Processi di gioco attivi, per id istanza.
    pub running: StdMutex<HashMap<String, RunningGame>>,
    /// Ultime righe di log per istanza (usate dall'analizzatore crash).
    pub logs: StdMutex<HashMap<String, VecDeque<String>>>,
    /// Istanze con un'installazione in corso (evita doppi download concorrenti).
    pub installing: Mutex<std::collections::HashSet<String>>,
    pub auth_cancel: AtomicBool,
    pub active_tunnel: Mutex<Option<crate::tunnel::ActiveTunnel>>,
    /// Motore AI locale (Ollama portable) gestito da Nexus.
    pub local_ai: Mutex<crate::ai_local::LocalAi>,
    /// Token di sessione del server amici (cache).
    pub social_token: Mutex<Option<String>>,
    /// Ultimi id di messaggio (privati, di gruppo) già notificati.
    pub inbox_cursor: Mutex<Option<(i64, i64, i64)>>,
    /// Cosa sta facendo il giocatore in ogni istanza avviata (dal log del gioco).
    pub activity: StdMutex<HashMap<String, crate::tunnel::Activity>>,
}

impl AppState {
    pub fn new(root: PathBuf) -> Self {
        let paths = Paths::new(root);
        let settings = Settings::load(&paths);
        let accounts = AccountStore::load(paths.accounts_file());
        Self {
            http: util::http_client(),
            settings: RwLock::new(settings),
            accounts: Mutex::new(accounts),
            running: StdMutex::new(HashMap::new()),
            logs: StdMutex::new(HashMap::new()),
            installing: Mutex::new(Default::default()),
            auth_cancel: AtomicBool::new(false),
            active_tunnel: Mutex::new(None),
            local_ai: Mutex::new(Default::default()),
            social_token: Mutex::new(None),
            inbox_cursor: Mutex::new(None),
            activity: StdMutex::new(HashMap::new()),
            paths,
        }
    }

    pub fn push_log(&self, instance_id: &str, line: &str) {
        let mut logs = self.logs.lock().unwrap();
        let buf = logs.entry(instance_id.to_string()).or_default();
        if buf.len() >= LOG_BUFFER_LINES {
            buf.pop_front();
        }
        buf.push_back(line.to_string());
    }

    pub fn log_tail(&self, instance_id: &str) -> Vec<String> {
        self.logs
            .lock()
            .unwrap()
            .get(instance_id)
            .map(|b| b.iter().cloned().collect())
            .unwrap_or_default()
    }
}
