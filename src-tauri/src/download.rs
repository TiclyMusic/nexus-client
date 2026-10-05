//! Download parallelo con verifica SHA1, retry e progress events verso la UI.

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use futures::{stream, StreamExt};
use serde::Serialize;
use sha1::{Digest, Sha1};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::error::{msg, Error, Result};

#[derive(Debug, Clone)]
pub struct DownloadJob {
    pub url: String,
    pub path: PathBuf,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub executable: bool,
}

impl DownloadJob {
    pub fn new(url: impl Into<String>, path: PathBuf) -> Self {
        Self {
            url: url.into(),
            path,
            sha1: None,
            size: None,
            executable: false,
        }
    }
    pub fn sha1(mut self, sha1: Option<String>) -> Self {
        self.sha1 = sha1.filter(|s| !s.is_empty());
        self
    }
    pub fn size(mut self, size: Option<u64>) -> Self {
        self.size = size;
        self
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// Id del task (di solito l'id dell'istanza).
    pub task: String,
    /// Fase leggibile: "Librerie", "Asset", "Java runtime"…
    pub stage: String,
    pub done: u64,
    pub total: u64,
    pub bytes: u64,
}

pub fn emit_progress(app: &AppHandle, task: &str, stage: &str, done: u64, total: u64, bytes: u64) {
    let _ = app.emit(
        "task-progress",
        Progress {
            task: task.to_string(),
            stage: stage.to_string(),
            done,
            total,
            bytes,
        },
    );
}

pub async fn sha1_file(path: &Path) -> Result<String> {
    let mut file = tokio::fs::File::open(path).await?;
    let mut hasher = Sha1::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// `verify = false` controlla solo esistenza e dimensione (veloce, usato ad ogni avvio);
/// `verify = true` ricalcola anche lo SHA1 (usato da "Ripara istanza").
async fn needs_download(job: &DownloadJob, verify: bool) -> bool {
    let Ok(meta) = tokio::fs::metadata(&job.path).await else {
        return true;
    };
    if let Some(size) = job.size {
        if meta.len() != size {
            return true;
        }
    }
    if verify {
        if let Some(expected) = &job.sha1 {
            return match sha1_file(&job.path).await {
                Ok(actual) => !actual.eq_ignore_ascii_case(expected),
                Err(_) => true,
            };
        }
    }
    false
}

async fn download_one(http: &reqwest::Client, job: &DownloadJob) -> Result<u64> {
    let mut last_err: Option<Error> = None;
    for attempt in 0..4u32 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(400 * 2u64.pow(attempt))).await;
        }
        match try_download(http, job).await {
            Ok(bytes) => return Ok(bytes),
            // Un hash sbagliato può essere un trasferimento corrotto: riproviamo comunque.
            Err(e) => last_err = Some(e),
        }
    }
    Err(last_err.unwrap_or_else(|| msg("download fallito")))
}

async fn try_download(http: &reqwest::Client, job: &DownloadJob) -> Result<u64> {
    if let Some(parent) = job.path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let resp = http.get(&job.url).send().await?;
    if !resp.status().is_success() {
        return Err(msg(format!("{} → HTTP {}", job.url, resp.status())));
    }

    let mut tmp_name = job.path.as_os_str().to_owned();
    tmp_name.push(".part");
    let tmp = PathBuf::from(tmp_name);

    let mut file = tokio::fs::File::create(&tmp).await?;
    let mut hasher = Sha1::new();
    let mut written = 0u64;
    let mut body = resp.bytes_stream();
    while let Some(chunk) = body.next().await {
        let chunk = chunk?;
        hasher.update(&chunk);
        file.write_all(&chunk).await?;
        written += chunk.len() as u64;
    }
    file.flush().await?;
    drop(file);

    if let Some(expected) = &job.sha1 {
        let actual = hex::encode(hasher.finalize());
        if !actual.eq_ignore_ascii_case(expected) {
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err(Error::HashMismatch {
                path: job.path.display().to_string(),
                expected: expected.clone(),
                actual,
            });
        }
    }

    tokio::fs::rename(&tmp, &job.path).await?;

    #[cfg(unix)]
    if job.executable {
        use std::os::unix::fs::PermissionsExt;
        let _ = tokio::fs::set_permissions(&job.path, std::fs::Permissions::from_mode(0o755)).await;
    }

    Ok(written)
}

/// Scarica tutti i job in parallelo (max `concurrency` alla volta), saltando i file già validi.
pub async fn download_all(
    app: &AppHandle,
    http: &reqwest::Client,
    jobs: Vec<DownloadJob>,
    concurrency: usize,
    verify: bool,
    task: &str,
    stage: &str,
) -> Result<()> {
    // Deduplica per path (gli asset condividono spesso lo stesso hash).
    let mut seen = HashSet::new();
    let jobs: Vec<DownloadJob> = jobs
        .into_iter()
        .filter(|j| !j.url.is_empty() && seen.insert(j.path.clone()))
        .collect();

    // Controllo concorrente di cosa manca davvero.
    let pending: Vec<DownloadJob> = stream::iter(jobs)
        .map(|job| async move {
            let missing = needs_download(&job, verify).await;
            missing.then_some(job)
        })
        .buffer_unordered(64)
        .filter_map(|j| async move { j })
        .collect()
        .await;

    let total = pending.len() as u64;
    if total == 0 {
        return Ok(());
    }
    emit_progress(app, task, stage, 0, total, 0);

    let mut results = stream::iter(pending)
        .map(|job| {
            let http = http.clone();
            async move {
                download_one(&http, &job)
                    .await
                    .map_err(|e| msg(format!("{} ({})", e, job.url)))
            }
        })
        .buffer_unordered(concurrency.max(1));

    let mut done = 0u64;
    let mut bytes = 0u64;
    let mut last_emit = Instant::now();
    while let Some(res) = results.next().await {
        bytes += res?;
        done += 1;
        if done == total || last_emit.elapsed() > Duration::from_millis(80) {
            emit_progress(app, task, stage, done, total, bytes);
            last_emit = Instant::now();
        }
    }
    Ok(())
}
