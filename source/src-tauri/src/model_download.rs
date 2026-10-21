//! Model bootstrap: fixed-content mirrors, verified atomic installation, and
//! explicit completion AFTER installation. No credentials or user audio leave
//! this module. A mirror can never select a different model or weaken TLS.
use crate::local_whisper::ModelInfo;
use anyhow::{anyhow, bail, Context, Result};
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::Read,
    path::{Path, PathBuf},
    sync::LazyLock,
    time::{Duration, SystemTime},
};
use tokio::io::AsyncWriteExt;

pub static MODEL_WRITE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Clone, Copy, Default, Debug, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    #[default]
    Auto,
    Official,
    Mirror,
}

#[derive(Clone, Copy, Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Connecting,
    Downloading,
    Verifying,
    Complete,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub model_id: String,
    pub received: u64,
    pub total: Option<u64>,
    pub phase: Phase,
    pub source: String,
}

#[derive(Clone, Debug)]
struct Endpoint {
    label: &'static str,
    url: String,
}

fn endpoints(info: &ModelInfo, source: Source) -> Vec<Endpoint> {
    let mut out = Vec::new();
    if source != Source::Official {
        if info.modelscope {
            out.push(Endpoint {
                label: "ModelScope",
                url: format!(
                    "https://modelscope.cn/models/cjc1887415157/whisper.cpp/resolve/master/{}",
                    info.filename
                ),
            });
        }
        out.push(Endpoint {
            label: "HF Mirror",
            url: info
                .url
                .replacen("https://huggingface.co/", "https://hf-mirror.com/", 1),
        });
    }
    if source != Source::Mirror {
        out.push(Endpoint {
            label: "Hugging Face",
            url: info.url.into(),
        });
    }
    out
}

// Hash existing/imported files once per file identity, not on every settings
// rerender. Never cache failures. Size alone does NOT mean a usable model.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Stamp {
    size: u64,
    modified: Option<SystemTime>,
    created: Option<SystemTime>,
    #[cfg(unix)]
    ino: u64,
    #[cfg(unix)]
    ctime: (i64, i64),
}
fn stamp(meta: &std::fs::Metadata) -> Stamp {
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    Stamp {
        size: meta.len(),
        modified: meta.modified().ok(),
        created: meta.created().ok(),
        #[cfg(unix)]
        ino: meta.ino(),
        #[cfg(unix)]
        ctime: (meta.ctime(), meta.ctime_nsec()),
    }
}
static VERIFIED: LazyLock<parking_lot::Mutex<HashMap<PathBuf, (Stamp, String)>>> =
    LazyLock::new(Default::default);

pub fn verify_file(path: &Path, expected_size: u64, expected_sha: &str) -> Result<()> {
    let mut file = std::fs::File::open(path).context("Cannot open model")?;
    let before = stamp(&file.metadata()?);
    if before.size != expected_size {
        bail!(
            "Model size mismatch: expected {expected_size} bytes, found {}. Download it again.",
            before.size
        );
    }
    if VERIFIED
        .lock()
        .get(path)
        .is_some_and(|(s, hash)| s == &before && hash == expected_sha)
    {
        return Ok(());
    }
    let mut hash = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    if format!("{:x}", hash.finalize()) != expected_sha {
        bail!("Model SHA-256 mismatch. Download it again.");
    }
    if before != stamp(&file.metadata()?) || before != stamp(&std::fs::metadata(path)?) {
        bail!("Model changed during verification. Try again.");
    }
    VERIFIED
        .lock()
        .insert(path.to_owned(), (before, expected_sha.to_owned()));
    Ok(())
}

pub async fn download(
    info: &'static ModelInfo,
    dir: &Path,
    source: Source,
    emit: impl Fn(Progress),
) -> Result<()> {
    tokio::fs::create_dir_all(dir)
        .await
        .context("Cannot create model directory")?;
    let client = reqwest::Client::builder()
        .user_agent(concat!("HoneyVoice/", env!("CARGO_PKG_VERSION")))
        .https_only(true)
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(30 * 60))
        .build()?;
    download_from(&client, info, dir, &endpoints(info, source), &emit).await
}

async fn download_from(
    client: &reqwest::Client,
    info: &ModelInfo,
    dir: &Path,
    sources: &[Endpoint],
    emit: &impl Fn(Progress),
) -> Result<()> {
    let mut errors = Vec::new();
    for endpoint in sources {
        match attempt(client, info, dir, endpoint, emit).await {
            Ok(()) => return Ok(()),
            Err(e) => errors.push(format!("{}: {e:#}", endpoint.label)),
        }
    }
    bail!(
        "Model download failed; no model was installed. Existing files were preserved. {}",
        errors.join("; ")
    )
}

async fn attempt(
    client: &reqwest::Client,
    info: &ModelInfo,
    dir: &Path,
    endpoint: &Endpoint,
    emit: &impl Fn(Progress),
) -> Result<()> {
    let progress = |phase, received| {
        emit(Progress {
            model_id: info.id.into(),
            received,
            total: Some(info.size_bytes_hint),
            phase,
            source: endpoint.label.into(),
        })
    };
    progress(Phase::Connecting, 0);
    // Header/connect failures must fall through to the next source promptly,
    // independently of the long timeout allowed for the model body.
    let response = tokio::time::timeout(Duration::from_secs(30), client.get(&endpoint.url).send())
        .await
        .context("Connection timed out")?
        .map_err(|e| anyhow!(e.without_url()))?;
    if !response.status().is_success() {
        bail!("HTTP {}", response.status());
    }
    if response
        .content_length()
        .is_some_and(|n| n != info.size_bytes_hint)
    {
        bail!("Content length does not match the pinned model");
    }
    // Unique temporary path, RAII cleanup on errors, cancellation, and retries.
    // Same directory means persist/rename cannot cross a filesystem boundary.
    let temp = tempfile::Builder::new()
        .prefix(".honeyvoice-model-")
        .suffix(".partial")
        .tempfile_in(dir)?;
    let (file, temp_path) = temp.into_parts();
    let mut file = tokio::fs::File::from_std(file);
    let mut hash = Sha256::new();
    let mut received = 0u64;
    let mut last_emit = std::time::Instant::now();
    let mut stream = response.bytes_stream();
    progress(Phase::Downloading, 0);
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| anyhow!(e.without_url()))?;
        received += bytes.len() as u64;
        if received > info.size_bytes_hint {
            bail!("Download exceeds the pinned model size");
        }
        hash.update(&bytes);
        file.write_all(&bytes).await.context("Cannot write model")?;
        if last_emit.elapsed() >= Duration::from_millis(100) {
            progress(Phase::Downloading, received);
            last_emit = std::time::Instant::now();
        }
    }
    progress(Phase::Verifying, received);
    if received != info.size_bytes_hint {
        bail!(
            "Incomplete download: expected {} bytes, received {received}",
            info.size_bytes_hint
        );
    }
    if format!("{:x}", hash.finalize()) != info.sha256 {
        bail!("SHA-256 mismatch; rejected untrusted model content");
    }
    file.flush().await?;
    file.sync_all().await?;
    drop(file);
    let final_path = dir.join(info.filename);
    temp_path
        .persist(&final_path)
        .context("Cannot install verified model")?;
    VERIFIED.lock().insert(
        final_path.clone(),
        (stamp(&std::fs::metadata(&final_path)?), info.sha256.into()),
    );
    progress(Phase::Complete, received);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_whisper::{find_model, ModelKind};
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    const GOOD: &[u8] = b"verified model fixture";
    fn fixture() -> ModelInfo {
        ModelInfo {
            id: "fixture",
            label: "Fixture",
            filename: "fixture.bin",
            url: "https://example.invalid/fixture.bin",
            size_bytes_hint: GOOD.len() as u64,
            sha256: "unused",
            modelscope: false,
            description: "test",
            kind: ModelKind::Multilingual,
        }
    }
    fn pinned_fixture() -> ModelInfo {
        ModelInfo {
            sha256: Box::leak(format!("{:x}", Sha256::digest(GOOD)).into_boxed_str()),
            ..fixture()
        }
    }
    async fn server(body: &[u8], length: Option<usize>, status: u16) -> Endpoint {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let body = body.to_vec();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = [0; 4096];
            let _ = socket.read(&mut buf).await;
            let length = length
                .map(|n| format!("Content-Length: {n}\r\n"))
                .unwrap_or_default();
            let header = format!("HTTP/1.1 {status} Test\r\n{length}Connection: close\r\n\r\n");
            let _ = socket.write_all(header.as_bytes()).await;
            let _ = socket.write_all(&body).await;
        });
        Endpoint {
            label: "Fixture",
            url,
        }
    }
    #[test]
    fn sources_preserve_identity_and_explicit_choice() {
        let medium = find_model("medium-q5").unwrap();
        assert_eq!(
            endpoints(medium, Source::Auto)
                .iter()
                .map(|s| s.label)
                .collect::<Vec<_>>(),
            ["ModelScope", "HF Mirror", "Hugging Face"]
        );
        assert_eq!(endpoints(medium, Source::Official).len(), 1);
        assert!(endpoints(medium, Source::Mirror)
            .iter()
            .all(|s| s.label != "Hugging Face" && s.url.starts_with("https://")));
        let turbo = endpoints(find_model("large-v3-turbo-q5").unwrap(), Source::Auto);
        assert_eq!(turbo.len(), 2);
        assert!(turbo
            .iter()
            .all(|s| s.url.ends_with("ggml-large-v3-turbo-q5_0.bin")));
    }
    #[test]
    fn existing_files_require_hash_and_cache_invalidates_on_change() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model");
        let info = pinned_fixture();
        std::fs::write(&path, GOOD).unwrap();
        verify_file(&path, info.size_bytes_hint, info.sha256).unwrap();
        verify_file(&path, info.size_bytes_hint, info.sha256).unwrap();
        let replacement = dir.path().join("replacement");
        std::fs::write(&replacement, vec![b'x'; GOOD.len()]).unwrap();
        std::fs::rename(replacement, &path).unwrap();
        assert!(verify_file(&path, info.size_bytes_hint, info.sha256)
            .unwrap_err()
            .to_string()
            .contains("SHA-256"));
        std::fs::write(&path, b"short").unwrap();
        assert!(verify_file(&path, info.size_bytes_hint, info.sha256)
            .unwrap_err()
            .to_string()
            .contains("size mismatch"));
    }
    #[tokio::test]
    async fn successful_download_installs_before_complete_without_content_length() {
        let dir = tempfile::tempdir().unwrap();
        let info = pinned_fixture();
        let endpoint = server(GOOD, None, 200).await;
        let events = Mutex::new(Vec::new());
        download_from(
            &reqwest::Client::new(),
            &info,
            dir.path(),
            &[endpoint],
            &|p| {
                if p.phase == Phase::Complete {
                    assert_eq!(std::fs::read(dir.path().join(info.filename)).unwrap(), GOOD);
                }
                events.lock().unwrap().push(p.phase);
            },
        )
        .await
        .unwrap();
        assert_eq!(
            *events.lock().unwrap(),
            [
                Phase::Connecting,
                Phase::Downloading,
                Phase::Verifying,
                Phase::Complete
            ]
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[tokio::test]
    async fn corrupt_mirror_falls_back_to_identical_pinned_artifact() {
        let dir = tempfile::tempdir().unwrap();
        let info = pinned_fixture();
        let bad = server(&vec![b'x'; GOOD.len()], Some(GOOD.len()), 200).await;
        let good = server(GOOD, Some(GOOD.len()), 200).await;
        download_from(
            &reqwest::Client::new(),
            &info,
            dir.path(),
            &[bad, good],
            &|_| {},
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(dir.path().join(info.filename)).unwrap(), GOOD);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[tokio::test]
    async fn failures_preserve_previous_model_and_remove_partial_files() {
        for (body, length, status) in [
            (b"short".to_vec(), None, 200),
            (vec![b'x'; GOOD.len()], Some(GOOD.len()), 200),
            (vec![b'x'; GOOD.len() + 1], None, 200),
            (b"short".to_vec(), Some(GOOD.len()), 200),
            (vec![], Some(0), 503),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let info = pinned_fixture();
            std::fs::write(dir.path().join(info.filename), GOOD).unwrap();
            let endpoint = server(&body, length, status).await;
            let events = Mutex::new(Vec::new());
            assert!(download_from(
                &reqwest::Client::new(),
                &info,
                dir.path(),
                &[endpoint],
                &|p| events.lock().unwrap().push(p.phase)
            )
            .await
            .is_err());
            assert!(!events.lock().unwrap().contains(&Phase::Complete));
            assert_eq!(std::fs::read(dir.path().join(info.filename)).unwrap(), GOOD);
            assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        }
    }
    #[tokio::test]
    async fn cancelling_an_inflight_download_cleans_partial() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = Endpoint {
            label: "Fixture",
            url: format!("http://{}", listener.local_addr().unwrap()),
        };
        let (release, wait) = tokio::sync::oneshot::channel::<()>();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = [0; 4096];
            let _ = socket.read(&mut buf).await;
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nx")
                .await
                .unwrap();
            let _ = wait.await;
        });
        let dir = Arc::new(tempfile::tempdir().unwrap());
        let owned_dir = dir.clone();
        let started = Arc::new(tokio::sync::Notify::new());
        let notify = started.clone();
        let task = tokio::spawn(async move {
            download_from(
                &reqwest::Client::new(),
                &pinned_fixture(),
                owned_dir.path(),
                &[endpoint],
                &|p| {
                    if p.phase == Phase::Downloading {
                        notify.notify_one();
                    }
                },
            )
            .await
        });
        tokio::time::timeout(Duration::from_secs(3), started.notified())
            .await
            .unwrap();
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        let _ = release.send(());
        server.await.unwrap();
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }
    #[tokio::test]
    async fn lifecycle_lock_rejects_concurrent_mutations() {
        let guard = MODEL_WRITE.try_lock().unwrap();
        assert!(MODEL_WRITE.try_lock().is_err());
        drop(guard);
        assert!(MODEL_WRITE.try_lock().is_ok());
    }

    #[tokio::test]
    #[ignore = "Live network acceptance: downloads 539 MB into an isolated temporary directory"]
    async fn live_medium_mirror_download_is_verified() {
        let dir = tempfile::tempdir().unwrap();
        let info = find_model("medium-q5").unwrap();
        let phase = Mutex::new(None);
        download(info, dir.path(), Source::Mirror, |p| {
            let mut previous = phase.lock().unwrap();
            if *previous != Some(p.phase) {
                eprintln!(
                    "{} {:?}: {}/{}",
                    p.source,
                    p.phase,
                    p.received,
                    p.total.unwrap_or_default()
                );
                *previous = Some(p.phase);
            }
        })
        .await
        .unwrap();
        assert_eq!(*phase.lock().unwrap(), Some(Phase::Complete));
        // Independently re-read the installed bytes instead of using the
        // downloader's successful in-memory digest/cache.
        VERIFIED.lock().clear();
        verify_file(
            &dir.path().join(info.filename),
            info.size_bytes_hint,
            info.sha256,
        )
        .unwrap();
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
