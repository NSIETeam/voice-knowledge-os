//! Local provenance for the immutable source streams of a Conversation Record.
//!
//! This ledger deliberately is not a cloud session asset: it records hashes,
//! not audio, and remains on this device even when source-audio retention is
//! disabled or the retained WAVs are later removed.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::Path;

pub const LEDGER_FILE: &str = "source-audio.json";
const LEDGER_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AudioLedger {
    pub version: u32,
    pub session_id: String,
    pub captured_at: String,
    pub streams: Vec<SourceStream>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceStream {
    pub source: String,
    pub file_name: String,
    pub sha256: String,
    pub bytes: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum Verification {
    Match,
    Missing,
    Mismatch {
        expected_sha256: String,
        actual_sha256: String,
        expected_bytes: u64,
        actual_bytes: u64,
    },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamVerification {
    pub source: String,
    pub file_name: String,
    pub integrity: Verification,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioIntegrityReport {
    pub ledger_present: bool,
    pub streams: Vec<StreamVerification>,
}

/// Hash source WAVs without loading an entire recording into memory.
pub fn build(
    session_id: &str,
    captured_at: &str,
    mic_path: Option<&Path>,
    sys_path: Option<&Path>,
) -> io::Result<AudioLedger> {
    let mut streams = Vec::new();
    for (source, file_name, path) in [
        ("mic", "mic.wav", mic_path),
        ("sys", "sys.wav", sys_path),
    ] {
        if let Some(path) = path {
            let (sha256, bytes) = hash_file(path)?;
            streams.push(SourceStream {
                source: source.to_string(),
                file_name: file_name.to_string(),
                sha256,
                bytes,
            });
        }
    }
    Ok(AudioLedger {
        version: LEDGER_VERSION,
        session_id: session_id.to_string(),
        captured_at: captured_at.to_string(),
        streams,
    })
}

/// Write-once, atomic local provenance. Repeating the same capture is
/// idempotent; a different ledger at the same session path is rejected.
pub fn write_once(directory: &Path, ledger: &AudioLedger) -> io::Result<()> {
    let path = directory.join(LEDGER_FILE);
    if path.exists() {
        let existing: AudioLedger = serde_json::from_slice(&fs::read(&path)?)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        return if existing == *ledger {
            Ok(())
        } else {
            Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "source audio ledger is immutable and already exists",
            ))
        };
    }

    let temporary = directory.join(format!(".{LEDGER_FILE}.{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        serde_json::to_writer_pretty(&mut file, ledger)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        match fs::hard_link(&temporary, &path) {
            Ok(()) => {
                fs::remove_file(&temporary)?;
                Ok(())
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                let existing: AudioLedger = serde_json::from_slice(&fs::read(&path)?)
                    .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
                if existing == *ledger {
                    Ok(())
                } else {
                    Err(io::Error::new(
                        io::ErrorKind::AlreadyExists,
                        "source audio ledger is immutable and already exists",
                    ))
                }
            }
            Err(error) => Err(error),
        }
    })();
    let _ = fs::remove_file(&temporary);
    result
}

pub fn read(directory: &Path) -> io::Result<AudioLedger> {
    serde_json::from_slice(&fs::read(directory.join(LEDGER_FILE))?)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

pub fn report(directory: &Path) -> io::Result<AudioIntegrityReport> {
    let ledger = match read(directory) {
        Ok(ledger) => ledger,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(AudioIntegrityReport {
                ledger_present: false,
                streams: Vec::new(),
            });
        }
        Err(error) => return Err(error),
    };
    let streams = ledger
        .streams
        .iter()
        .map(|stream| {
            Ok(StreamVerification {
                source: stream.source.clone(),
                file_name: stream.file_name.clone(),
                integrity: verify(directory, stream)?,
            })
        })
        .collect::<io::Result<Vec<_>>>()?;
    Ok(AudioIntegrityReport {
        ledger_present: true,
        streams,
    })
}

pub fn verify(directory: &Path, stream: &SourceStream) -> io::Result<Verification> {
    let path = directory.join(&stream.file_name);
    if !path.exists() {
        return Ok(Verification::Missing);
    }
    let (actual, bytes) = hash_file(&path)?;
    if bytes == stream.bytes && actual == stream.sha256 {
        Ok(Verification::Match)
    } else {
        Ok(Verification::Mismatch {
            expected_sha256: stream.sha256.clone(),
            actual_sha256: actual,
            expected_bytes: stream.bytes,
            actual_bytes: bytes,
        })
    }
}

fn hash_file(path: &Path) -> io::Result<(String, u64)> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut bytes = 0_u64;
    let mut buffer = [0_u8; 256 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
        bytes += count as u64;
    }
    Ok((format!("{:x}", hasher.finalize()), bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ledger_hashes_both_original_streams_and_verifies_them() {
        let directory = tempfile::tempdir().unwrap();
        let mic = directory.path().join("capture-mic.wav");
        let sys = directory.path().join("capture-sys.wav");
        fs::write(&mic, b"immutable mic source").unwrap();
        fs::write(&sys, b"immutable system source").unwrap();

        let ledger = build("take-a", "2026-09-27T10:00:00Z", Some(&mic), Some(&sys)).unwrap();
        assert_eq!(ledger.streams.len(), 2);
        write_once(directory.path(), &ledger).unwrap();
        assert_eq!(read(directory.path()).unwrap(), ledger);
        fs::copy(&mic, directory.path().join("mic.wav")).unwrap();
        fs::copy(&sys, directory.path().join("sys.wav")).unwrap();
        assert_eq!(verify(directory.path(), &ledger.streams[0]).unwrap(), Verification::Match);
        assert_eq!(verify(directory.path(), &ledger.streams[1]).unwrap(), Verification::Match);
        write_once(directory.path(), &ledger).unwrap();
    }

    #[test]
    fn ledger_detects_changed_or_deleted_retained_audio() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("capture-mic.wav");
        fs::write(&source, b"original").unwrap();
        let ledger = build("take-a", "", Some(&source), None).unwrap();
        write_once(directory.path(), &ledger).unwrap();
        let stream = &ledger.streams[0];

        fs::write(directory.path().join("mic.wav"), b"modified").unwrap();
        assert!(matches!(verify(directory.path(), stream).unwrap(), Verification::Mismatch { .. }));
        fs::write(&source, b"new capture value").unwrap();
        assert!(write_once(
            directory.path(),
            &build("take-a", "", Some(&source), None).unwrap()
        )
        .is_err());
        fs::remove_file(directory.path().join("mic.wav")).unwrap();
        assert_eq!(verify(directory.path(), stream).unwrap(), Verification::Missing);
    }

    #[test]
    fn no_audio_produces_an_empty_but_valid_provenance_record() {
        let ledger = build("take-empty", "", None, None).unwrap();
        assert_eq!(ledger.version, LEDGER_VERSION);
        assert!(ledger.streams.is_empty());
    }
}
