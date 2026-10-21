//! Model lifecycle commands — local Whisper model files + speaker
//! diarization engine models. Download / status / delete, surfaced to
//! the frontend via `commands::*` (re-exported from the parent module).
//! `local_model_path` is also called by the recording / transcribe paths
//! that stay in the parent module, hence `pub(crate)`.

use super::err;
use crate::diarize;
use crate::local_whisper;
use crate::model_download::{self, Source};
use crate::AppState;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, State};

// ---- Speaker diarization model management ---------------------------------

fn parse_engine(engine: Option<String>) -> diarize::Engine {
    engine
        .as_deref()
        .map(diarize::Engine::from_setting)
        .unwrap_or(diarize::Engine::Community1)
}

#[tauri::command]
pub async fn diarize_status(
    app: AppHandle,
    engine: Option<String>,
) -> Result<diarize::ModelStatus, String> {
    diarize::status(&app, parse_engine(engine))
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn diarize_download(
    app: AppHandle,
    engine: Option<String>,
    source: Option<Source>,
) -> Result<(), String> {
    diarize::download_with_source(&app, parse_engine(engine), source.unwrap_or_default())
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn diarize_delete(app: AppHandle, engine: Option<String>) -> Result<(), String> {
    diarize::delete(&app, parse_engine(engine))
        .await
        .map_err(err)
}

// ---- Local Whisper model management ----------------------------------------

fn local_model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(err)?.join("models");
    Ok(dir)
}

fn model_path_for(app: &AppHandle, info: &local_whisper::ModelInfo) -> Result<PathBuf, String> {
    Ok(local_model_dir(app)?.join(info.filename))
}

/// Resolve exactly the selected model; a missing file must never silently
/// substitute a different model. Callers surface the missing-file error.
pub(crate) fn local_model_path(
    app: &AppHandle,
    _language: &str,
    model_id: &str,
) -> Result<PathBuf, String> {
    selected_model_path(&local_model_dir(app)?, model_id)
}

fn selected_model_path(dir: &std::path::Path, model_id: &str) -> Result<PathBuf, String> {
    let info = local_whisper::find_model(model_id).ok_or_else(|| {
        format!("Unknown local model: {model_id}. Select a model in Settings → Transcription.")
    })?;
    Ok(dir.join(info.filename))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalWhisperModelStatus {
    id: String,
    label: String,
    description: String,
    filename: String,
    size_bytes_hint: u64,
    /// "multilingual" — selectable as the default transcription model.
    /// "language_specific" — usable only as the model behind a per-
    /// language override in `transcribe_config.per_language`. Never the
    /// default.
    kind: &'static str,
    /// Set for `kind == "language_specific"`. The ISO 639-1 code this
    /// model is tuned for. None for multilingual models.
    specific_language: Option<String>,
    downloaded: bool,
    integrity_error: Option<String>,
    size_bytes: Option<u64>,
    path: Option<String>,
}

#[tauri::command]
pub async fn local_whisper_models(app: AppHandle) -> Result<Vec<LocalWhisperModelStatus>, String> {
    let dir = local_model_dir(&app)?;
    tokio::task::spawn_blocking(move || model_statuses(&dir))
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn apple_speech_status(
    language: String,
) -> Result<crate::stt::apple_speech::Status, String> {
    let helper = crate::stt::apple_speech::helper_path().map_err(err)?;
    crate::stt::apple_speech::request(&helper, "status", &language, None)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn apple_speech_prepare(
    language: String,
) -> Result<crate::stt::apple_speech::Status, String> {
    let helper = crate::stt::apple_speech::helper_path().map_err(err)?;
    crate::stt::apple_speech::request(&helper, "prepare", &language, None)
        .await
        .map_err(err)
}

fn model_statuses(dir: &std::path::Path) -> Vec<LocalWhisperModelStatus> {
    let mut out = Vec::with_capacity(local_whisper::models().len());
    for info in local_whisper::models() {
        let path = dir.join(info.filename);
        let size_bytes = std::fs::metadata(&path).ok().map(|m| m.len());
        let verification = size_bytes
            .map(|_| model_download::verify_file(&path, info.size_bytes_hint, info.sha256));
        let downloaded = matches!(verification, Some(Ok(())));
        let integrity_error = verification.and_then(Result::err).map(|e| e.to_string());
        let (kind, specific_language) = match info.kind {
            local_whisper::ModelKind::Multilingual => ("multilingual", None),
            local_whisper::ModelKind::LanguageSpecific { language } => {
                ("language_specific", Some(language.to_string()))
            }
        };
        out.push(LocalWhisperModelStatus {
            id: info.id.to_string(),
            label: info.label.to_string(),
            description: info.description.to_string(),
            filename: info.filename.to_string(),
            size_bytes_hint: info.size_bytes_hint,
            kind,
            specific_language,
            downloaded,
            integrity_error,
            size_bytes,
            path: if downloaded {
                path.to_str().map(|s| s.to_string())
            } else {
                None
            },
        });
    }
    out
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadError {
    model_id: String,
    message: String,
}

#[tauri::command]
pub async fn local_whisper_download(
    app: AppHandle,
    model_id: String,
    source: Option<Source>,
) -> Result<(), String> {
    // Reject competing requests BEFORE emitting terminal events; a rejected
    // second request must not clear the first download's global progress.
    let _guard = model_download::MODEL_WRITE.try_lock().map_err(|_| {
        "Another model operation is in progress. Try again when it finishes.".to_string()
    })?;
    let result = async {
        let info = local_whisper::find_model(&model_id)
            .ok_or_else(|| format!("Unknown model: {model_id}"))?;
        let dir = local_model_dir(&app)?;
        model_download::download(info, &dir, source.unwrap_or_default(), |progress| {
            let _ = app.emit("local_whisper_progress", progress);
        })
        .await
        .map_err(|e| format!("{e:#}"))
    }
    .await;
    if let Err(ref message) = result {
        let _ = app.emit(
            "local_whisper_download_error",
            DownloadError {
                model_id,
                message: message.clone(),
            },
        );
    }
    result
}

#[tauri::command]
pub async fn local_whisper_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    model_id: String,
) -> Result<(), String> {
    let _guard = model_download::MODEL_WRITE.try_lock().map_err(|_| {
        "A model download is in progress. Wait before deleting a model.".to_string()
    })?;
    let info = local_whisper::find_model(&model_id)
        .ok_or_else(|| format!("unknown model id: {model_id}"))?;
    let path = model_path_for(&app, info)?;
    // Drop the loaded model from RAM first when it's the one being deleted,
    // so we're not holding the file. SharedContext keys by path, so it's
    // safe to call unconditionally; worst case the next transcribe reloads
    // a model that didn't actually need to be evicted.
    local_whisper::unload(&state.whisper);
    if path.exists() {
        tokio::fs::remove_file(&path)
            .await
            .map_err(|e| format!("remove: {e}"))?;
    }
    Ok(())
}

/// The Anthropic models this key can reach (#183). Settings offers the live
/// list; a failure there falls back to the shipped ids on the client.
#[tauri::command]
pub async fn anthropic_list_models(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let key = super::read_provider_api_key(&state, "anthropic")?
        .ok_or_else(|| "No Anthropic API key stored".to_string())?;
    crate::anthropic::list_models(&key).await.map_err(err)
}

/// The chat-capable OpenAI models this key can reach. Narrowed by
/// `openai::chat_capable_models`: a raw listing is mostly embedders,
/// transcribers and dated snapshots.
#[tauri::command]
pub async fn openai_list_models(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let key = super::read_provider_api_key(&state, "openai")?
        .ok_or_else(|| "No OpenAI API key stored".to_string())?;
    let ids = crate::openai::list_models_with_key(crate::openai::BASE, Some(&key))
        .await
        .map_err(err)?;
    Ok(crate::openai::chat_capable_models(ids))
}

/// MiMo model ids exposed by the currently configured API or Token Plan
/// endpoint. The setting is HTTPS-validated before the user's key is sent.
#[tauri::command]
pub async fn mimo_list_models(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let key = super::read_provider_api_key(&state, "mimo")?
        .ok_or_else(|| "No MiMo API key stored".to_string())?;
    let base_url = {
        let conn = state.db.lock();
        crate::providers::resolve_mimo_base_url(
            crate::db::get_setting(&conn, "mimo_base_url").map_err(err)?,
        )?
    };
    let ids = crate::openai::list_models_with_key(&base_url, Some(&key))
        .await
        .map_err(err)?;
    Ok(mimo_chat_models(ids))
}

fn mimo_chat_models(ids: Vec<String>) -> Vec<String> {
    ids.into_iter()
        .filter(|id| {
            id.starts_with("mimo-")
                && !["asr", "tts", "audio", "embedding"]
                    .iter()
                    .any(|m| id.contains(m))
        })
        .collect()
}

#[cfg(test)]
mod mimo_model_tests {
    use super::mimo_chat_models;

    #[test]
    fn filters_non_chat_models_from_the_custom_endpoint_listing() {
        let models = mimo_chat_models(
            [
                "mimo-v2.5-pro",
                "mimo-v2.5-asr",
                "mimo-v2.5-tts-voiceclone",
                "mimo-embedding-v1",
                "unrelated-model",
            ]
            .map(str::to_string)
            .to_vec(),
        );
        assert_eq!(models, vec!["mimo-v2.5-pro"]);
    }
}

#[cfg(test)]
mod model_lifecycle_tests {
    use super::*;
    #[test]
    fn missing_selection_never_falls_back_to_an_existing_default() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join(local_whisper::default_model().filename),
            b"placeholder",
        )
        .unwrap();
        let chosen = selected_model_path(dir.path(), "medium-q5").unwrap();
        assert_eq!(chosen.file_name().unwrap(), "ggml-medium-q5_0.bin");
        assert!(!chosen.exists());
        assert!(selected_model_path(dir.path(), "unknown").is_err());
    }
    #[test]
    fn status_rejects_existing_but_corrupt_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join(local_whisper::default_model().filename),
            b"not a model",
        )
        .unwrap();
        let statuses = model_statuses(dir.path());
        assert!(statuses.iter().all(|s| !s.downloaded));
        assert!(statuses[0]
            .integrity_error
            .as_ref()
            .unwrap()
            .contains("size mismatch"));
        assert!(statuses[1].integrity_error.is_none());
    }
}
