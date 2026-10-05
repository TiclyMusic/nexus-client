use std::path::Path;

use serde::de::DeserializeOwned;
use tokio::io::AsyncWriteExt;

use crate::error::{msg, Result};

pub const USER_AGENT: &str = concat!(
    "NexusLauncher/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/nexus-launcher/nexus-launcher)"
);

pub fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(std::time::Duration::from_secs(15))
        .pool_max_idle_per_host(32)
        .build()
        .expect("impossibile creare il client HTTP")
}

pub async fn get_json<T: DeserializeOwned>(http: &reqwest::Client, url: &str) -> Result<T> {
    let resp = http.get(url).send().await?;
    if !resp.status().is_success() {
        return Err(msg(format!("{} → HTTP {}", url, resp.status())));
    }
    Ok(resp.json::<T>().await?)
}

/// Scrittura atomica: file temporaneo + rename, così un crash non lascia JSON troncati.
pub async fn write_atomic(path: &Path, data: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let tmp = path.with_extension("tmp");
    let mut file = tokio::fs::File::create(&tmp).await?;
    file.write_all(data).await?;
    file.flush().await?;
    drop(file);
    tokio::fs::rename(&tmp, path).await?;
    Ok(())
}

pub async fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T> {
    let bytes = tokio::fs::read(path).await?;
    Ok(serde_json::from_slice(&bytes)?)
}

pub fn now_unix() -> i64 {
    chrono::Utc::now().timestamp()
}

pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Nasconde la finestra console dei processi figli su Windows.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn no_window(cmd: &mut tokio::process::Command) -> &mut tokio::process::Command {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}
