//! Apple SpeechTranscriber adapter. The helper wraps macOS 26's on-device
//! SpeechAnalyzer and is shipped as a signed native sidecar.
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::process::Command;

use crate::stt::adapter::{BatchSttAdapter, TranscribeCtx, TranscribeResult};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub ok: bool,
    pub available: bool,
    pub supported: bool,
    pub installed: bool,
    pub locale: String,
    pub text: Option<String>,
    #[serde(default)]
    pub words: Vec<AppleWord>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleWord {
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
}

pub fn helper_path() -> Result<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in [
                "macos-speech",
                "macos-speech-aarch64-apple-darwin",
                "macos-speech-x86_64-apple-darwin",
            ] {
                let path = dir.join(name);
                if path.is_file() {
                    return Ok(path);
                }
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        for triple in ["aarch64-apple-darwin", "x86_64-apple-darwin"] {
            for path in [
                cwd.join(format!("src-tauri/binaries/macos-speech-{triple}")),
                cwd.join(format!("binaries/macos-speech-{triple}")),
            ] {
                if path.is_file() {
                    return Ok(path);
                }
            }
        }
    }
    Err(anyhow!(
        "Apple Speech helper is missing. Rebuild the macOS app with scripts/build-native.sh."
    ))
}

pub async fn request(
    helper: &Path,
    action: &str,
    language: &str,
    audio: Option<&Path>,
) -> Result<Status> {
    let mut command = Command::new(helper);
    command.arg(action).arg(language);
    if let Some(audio) = audio {
        command.arg(audio);
    }
    let output = tokio::time::timeout(std::time::Duration::from_secs(300), command.output())
        .await
        .context("Apple Speech request timed out")??;
    let status: Status = serde_json::from_slice(&output.stdout).with_context(|| {
        format!(
            "Apple Speech helper returned invalid output: {}",
            String::from_utf8_lossy(&output.stderr)
        )
    })?;
    if !status.ok && action != "status" {
        return Err(anyhow!(status
            .error
            .clone()
            .unwrap_or_else(|| "Apple Speech request failed".into())));
    }
    Ok(status)
}

pub struct AppleSpeechAdapter;

#[async_trait]
impl BatchSttAdapter for AppleSpeechAdapter {
    fn supports_word_timestamps(&self, _model: &str) -> bool {
        true
    }

    async fn transcribe(&self, ctx: TranscribeCtx<'_>, audio: &Path) -> Result<TranscribeResult> {
        let helper = helper_path()?;
        let response = request(&helper, "transcribe", ctx.language, Some(audio)).await?;
        Ok(TranscribeResult {
            text: response.text.unwrap_or_default(),
            words: response
                .words
                .into_iter()
                .map(|word| crate::stt::Word {
                    text: word.text,
                    start_ms: word.start_ms,
                    end_ms: word.end_ms,
                })
                .collect(),
            detected_language: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helper_response_preserves_native_audio_time_ranges() {
        let response: Status = serde_json::from_str(
            r#"{"ok":true,"available":true,"supported":true,"installed":true,"locale":"zh-CN","text":"你好。","words":[{"text":"你好","startMs":240,"endMs":680},{"text":"。","startMs":680,"endMs":760}]}"#,
        ).unwrap();
        assert_eq!(response.words.len(), 2);
        assert_eq!(response.words[0].start_ms, 240);
        assert_eq!(response.words[0].end_ms, 680);
        assert_eq!(response.words[1].text, "。");
        assert_eq!(response.words[1].end_ms, 760);
    }

    #[test]
    fn old_helper_responses_without_word_ranges_remain_compatible() {
        let response: Status = serde_json::from_str(
            r#"{"ok":true,"available":true,"supported":true,"installed":true,"locale":"zh-CN","text":"你好。"}"#,
        ).unwrap();
        assert!(response.words.is_empty());
    }

    #[test]
    fn apple_speech_advertises_native_audio_timing() {
        assert!(AppleSpeechAdapter.supports_word_timestamps("speech-transcriber"));
    }
}
