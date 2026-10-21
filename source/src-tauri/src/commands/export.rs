//! Note export (issue #18). Assembles a note's selected content — summary,
//! transcript, typed notes — into a single Markdown or plain-text document
//! and writes it to a user-chosen path.
//!
//! The path is chosen on the frontend via the dialog plugin's native save
//! panel and passed in as `spec.path`; this command is a thin shell around
//! the pure [`build_export_document`] assembler (unit-tested below) plus a
//! filesystem write. Unlike `open_in_finder`, the write is intentionally NOT
//! constrained to the app data directory — the whole point is to let the user
//! save anywhere they picked in the panel.

use super::{err, note_sessions, note_timeline, TimelineEntry};
use crate::db;
use crate::html_text::html_to_text;
use crate::AppState;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

/// Output file format. Adding a new format is a matter of adding a variant
/// here plus a branch in [`heading`] / [`build_export_document`] — no change
/// to the command surface or the frontend invoke shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Markdown,
    Txt,
}

/// What to export and how. Mirrors the frontend `ExportSpec` type. `path` is
/// the destination chosen in the native save panel.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSpec {
    pub path: String,
    pub format: ExportFormat,
    pub include_summary: bool,
    pub include_transcript: bool,
    pub include_notes: bool,
    /// When false, the leading `Label: ` prefix is stripped from each
    /// transcript line so the export reads as plain prose.
    pub include_speaker_labels: bool,
}

/// The selected Vault root and sections to publish as an Obsidian record.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultExportSpec {
    pub vault_path: String,
    pub include_summary: bool,
    pub include_transcript: bool,
    pub include_notes: bool,
    pub include_speaker_labels: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultExportPreview {
    pub preview_id: String,
    pub path: String,
    pub before: Option<String>,
    pub after: String,
    pub is_new_file: bool,
}

struct PendingVaultExport {
    created_at: Instant,
    vault: PathBuf,
    target: PathBuf,
    before: Option<String>,
    after: String,
}

/// Stable knowledge metadata carried alongside the managed transcript block.
/// Keep this deliberately small: it is safe to expose in a user-selected Vault
/// and lets Obsidian queries distinguish processing intent from the content.
#[derive(Debug, Clone, Default)]
struct VaultRecordMetadata {
    processing_profile: String,
    client_name: Option<String>,
}

static PENDING_VAULT_EXPORTS: OnceLock<Mutex<HashMap<String, PendingVaultExport>>> =
    OnceLock::new();

fn pending_vault_exports() -> &'static Mutex<HashMap<String, PendingVaultExport>> {
    PENDING_VAULT_EXPORTS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Render a section heading for the given format and level (1 = document
/// title, 2 = section). Markdown uses ATX `#`/`##`; plain text underlines the
/// text with `=` (title) or `-` (section) so the structure survives without
/// markup.
fn heading(format: ExportFormat, level: u8, text: &str) -> String {
    match format {
        ExportFormat::Markdown => format!("{} {}", "#".repeat(level as usize), text),
        ExportFormat::Txt => {
            let bar = if level <= 1 { '=' } else { '-' };
            let underline: String = std::iter::repeat(bar)
                .take(text.chars().count().max(1))
                .collect();
            format!("{text}\n{underline}")
        }
    }
}

/// Strip a leading `Label: ` speaker prefix from a single transcript line.
///
/// Transcript turns are stored as `Label: text` (e.g. `Speaker 1: …`, `You: …`,
/// or a renamed name). We only remove a *short*, single-segment prefix anchored
/// at the line start so a colon inside spoken text (`So the plan is: ship it`)
/// is left alone unless it happens to sit within the first ~40 chars — an
/// acceptable v1 trade-off given the fixed `Label: ` storage shape.
fn strip_label(line: &str) -> &str {
    if let Some(idx) = line.find(": ") {
        // Prefix must be reasonably short and free of its own line breaks to
        // look like a speaker label rather than a mid-sentence colon.
        let prefix = &line[..idx];
        if !prefix.is_empty() && prefix.chars().count() <= 40 && !prefix.contains(['\n', '\r']) {
            return &line[idx + 2..];
        }
    }
    line
}

/// Assemble the export document from a note's fields and a spec. Pure — no I/O,
/// so the whole content contract is unit-testable without a database or a
/// filesystem. `body_html` is the raw Tiptap HTML; it's converted to plain
/// text via the shared [`html_to_text`] helper (richer HTML→Markdown is a
/// deliberate later refinement, per the issue).
pub(crate) fn build_export_document(
    title: &str,
    summary: &str,
    transcript: &str,
    body_html: &str,
    spec: &ExportSpec,
) -> String {
    let title = if title.trim().is_empty() {
        "Untitled note"
    } else {
        title.trim()
    };
    let mut sections: Vec<String> = Vec::new();

    if spec.include_summary {
        sections.push(section(spec.format, "Summary", summary.trim()));
    }
    if spec.include_transcript {
        let body = if spec.include_speaker_labels {
            transcript.trim().to_string()
        } else {
            transcript
                .lines()
                .map(strip_label)
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .to_string()
        };
        sections.push(section(spec.format, "Transcript", &body));
    }
    if spec.include_notes {
        let notes = html_to_text(body_html);
        sections.push(section(spec.format, "Notes", notes.trim()));
    }

    let mut doc = heading(spec.format, 1, title);
    if !sections.is_empty() {
        doc.push_str("\n\n");
        doc.push_str(&sections.join("\n\n"));
    }
    doc.push('\n');
    doc
}

/// Render one `## Heading` + body block. A checked-but-empty section still
/// emits its heading with an explicit empty marker so the user sees the
/// section was intentionally included but had no content.
fn section(format: ExportFormat, name: &str, body: &str) -> String {
    let head = heading(format, 2, name);
    if body.is_empty() {
        let placeholder = match format {
            ExportFormat::Markdown => "_(empty)_",
            ExportFormat::Txt => "(empty)",
        };
        format!("{head}\n\n{placeholder}")
    } else {
        format!("{head}\n\n{body}")
    }
}

/// Export a note to the path chosen in the native save panel. Fetches the
/// note, builds the document via [`build_export_document`], and writes it.
#[tauri::command]
pub fn export_note(app: AppHandle, note_id: String, spec: ExportSpec) -> Result<(), String> {
    let state: tauri::State<AppState> = app.state();
    let note = {
        let conn = state.db.lock();
        db::get_note(&conn, &note_id).map_err(err)?
    };
    let doc = build_export_document(
        &note.title,
        &note.summary,
        &note.transcript,
        &note.body,
        &spec,
    );
    std::fs::write(&spec.path, doc).map_err(|e| format!("write export file: {e}"))?;
    Ok(())
}

/// Prepare an Obsidian export without writing to the Vault. The frontend must
/// display the diff and obtain explicit confirmation before committing it.
#[tauri::command]
pub fn export_note_to_vault(
    app: AppHandle,
    note_id: String,
    spec: VaultExportSpec,
) -> Result<VaultExportPreview, String> {
    let state: tauri::State<AppState> = app.state();
    let (note, client_name) = {
        let conn = state.db.lock();
        let note = db::get_note(&conn, &note_id).map_err(err)?;
        let client_name = note
            .client_id
            .as_deref()
            .map(|id| db::client_name(&conn, id))
            .transpose()
            .map_err(err)?
            .flatten();
        (note, client_name)
    };
    let export_spec = ExportSpec {
        path: String::new(),
        format: ExportFormat::Markdown,
        include_summary: spec.include_summary,
        include_transcript: spec.include_transcript,
        include_notes: spec.include_notes,
        include_speaker_labels: spec.include_speaker_labels,
    };
    // Keep provenance in the Obsidian copy instead of flattening the
    // editable transcript into unattributed prose. Timeline times are local
    // to each recording session, so include a session heading and stable
    // block ID on every chunk. Older notes without a timeline retain their
    // plain-transcript export path.
    let transcript = if spec.include_transcript {
        let entries = note_timeline(app.clone(), note_id.clone())?;
        let sessions = note_sessions(app.clone(), note_id.clone())?;
        render_vault_transcript(
            &entries,
            &sessions,
            &note.id,
            &note.transcript,
            spec.include_speaker_labels,
        )
    } else {
        note.transcript.clone()
    };
    let document = build_export_document(
        &note.title,
        &note.summary,
        &transcript,
        &note.body,
        &export_spec,
    );
    let plan = plan_vault_record_with_metadata(
        Path::new(&spec.vault_path),
        &note.id,
        &note.title,
        &document,
        &VaultRecordMetadata {
            processing_profile: note.summary_preset.clone(),
            client_name,
        },
    )
    .map_err(|error| format!("Obsidian export preview failed: {error}"))?;
    let preview_id = uuid::Uuid::new_v4().to_string();
    let preview = VaultExportPreview {
        preview_id: preview_id.clone(),
        path: plan.target.display().to_string(),
        before: plan.before.clone(),
        after: plan.after.clone(),
        is_new_file: plan.before.is_none(),
    };
    let mut pending = pending_vault_exports().lock();
    pending.retain(|_, export| export.created_at.elapsed() < Duration::from_secs(600));
    pending.insert(
        preview_id,
        PendingVaultExport {
            created_at: Instant::now(),
            vault: plan.vault,
            target: plan.target,
            before: plan.before,
            after: plan.after,
        },
    );
    Ok(preview)
}

/// Commit only the exact preview that the user reviewed. Any external change
/// to the target file or its Vault path invalidates the confirmation.
#[tauri::command]
pub fn commit_export_note_to_vault(preview_id: String) -> Result<String, String> {
    let pending = pending_vault_exports()
        .lock()
        .remove(&preview_id)
        .ok_or_else(|| {
            "Obsidian preview expired or was already used; prepare it again".to_string()
        })?;
    if pending.created_at.elapsed() >= Duration::from_secs(600) {
        return Err("Obsidian preview expired; prepare it again".into());
    }
    persist_vault_plan(VaultRecordPlan {
        vault: pending.vault,
        target: pending.target.clone(),
        before: pending.before,
        after: pending.after,
    })
    .map(|path| path.display().to_string())
    .map_err(|error| format!("Obsidian export was not written: {error}"))
}

#[tauri::command]
pub fn cancel_export_note_to_vault(preview_id: String) {
    pending_vault_exports().lock().remove(&preview_id);
}

fn render_vault_transcript(
    entries: &[TimelineEntry],
    sessions: &[super::NoteSession],
    note_id: &str,
    fallback: &str,
    include_speaker_labels: bool,
) -> String {
    if entries.is_empty() {
        return if include_speaker_labels {
            fallback.trim().to_string()
        } else {
            fallback
                .lines()
                .map(strip_label)
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .to_string()
        };
    }

    let mut out = String::new();
    let mut active_session = None;
    for entry in entries {
        if active_session.as_deref() != Some(entry.session_id.as_str()) {
            if !out.is_empty() {
                out.push('\n');
            }
            let started_at = sessions
                .iter()
                .find(|session| session.id == entry.session_id)
                .map(|session| session.started_at.as_str())
                .unwrap_or("unknown start time");
            out.push_str(&format!(
                "**Recording {}** — {}\n\n",
                entry.session_index + 1,
                started_at
            ));
            active_session = Some(entry.session_id.clone());
        }
        let text = entry.text.split_whitespace().collect::<Vec<_>>().join(" ");
        if text.is_empty() {
            continue;
        }
        let timestamp = format_timestamp(entry.start_ms);
        let linked_timestamp = sessions
            .iter()
            .any(|session| session.id == entry.session_id && session.has_playback)
            .then(|| vault_recording_link(note_id, &entry.session_id, entry.start_ms))
            .flatten()
            .map(|url| format!("[{timestamp}]({url})"))
            .unwrap_or(timestamp);
        if include_speaker_labels && !entry.label.trim().is_empty() {
            out.push_str(&format!(
                "{linked_timestamp} {}: {text}",
                entry.label.trim()
            ));
        } else {
            out.push_str(&format!("{linked_timestamp} {text}"));
        }
        if entry.uncertain {
            out.push_str(" **[待核验]**");
        }
        if entry.overlap {
            out.push_str(" **[重叠发言]**");
        }
        out.push_str(&format!(
            " ^honeyvoice-{}-{}-{}\n",
            block_id_part(note_id),
            block_id_part(&entry.session_id),
            entry.chunk_idx
        ));
    }
    out.trim().to_string()
}

fn vault_recording_link(note_id: &str, session_id: &str, timestamp_ms: u64) -> Option<String> {
    fn is_safe_id(value: &str) -> bool {
        !value.is_empty()
            && value.len() <= 128
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    }
    if !is_safe_id(note_id) || !is_safe_id(session_id) || timestamp_ms > 9_007_199_254_740_991 {
        return None;
    }
    Some(format!(
        "honeyvoice://open?note={note_id}&session={session_id}&t={timestamp_ms}"
    ))
}

fn format_timestamp(milliseconds: u64) -> String {
    let total_seconds = milliseconds / 1_000;
    let hours = total_seconds / 3_600;
    let minutes = (total_seconds / 60) % 60;
    let seconds = total_seconds % 60;
    let millis = milliseconds % 1_000;
    format!("{hours:02}:{minutes:02}:{seconds:02}.{millis:03}")
}

fn block_id_part(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' {
                ch
            } else {
                '-'
            }
        })
        .collect()
}

const START_MARKER: &str = "<!-- honeyvoice:managed:start id=\"";
const END_MARKER: &str = "<!-- honeyvoice:managed:end id=\"";

fn vault_filename_slug(title: &str) -> String {
    let mut out = String::new();
    for ch in title.chars() {
        if ch.is_alphanumeric() {
            out.extend(ch.to_lowercase());
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    while out.len() > 100 {
        out.pop();
    }
    let slug = out.trim_matches('-');
    if slug.is_empty() {
        "recording".into()
    } else {
        slug.into()
    }
}

fn managed_block(note_id: &str, document: &str) -> String {
    format!(
        "{START_MARKER}{note_id}\" -->\n{}\n{END_MARKER}{note_id}\" -->",
        document.trim_end()
    )
}

fn document_fingerprint(document: &str) -> String {
    uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_OID, document.trim().as_bytes()).to_string()
}

fn frontmatter(
    note_id: &str,
    title: &str,
    document: &str,
    metadata: &VaultRecordMetadata,
) -> String {
    let id = serde_json::to_string(note_id).expect("string serialization cannot fail");
    let title = serde_json::to_string(title).expect("string serialization cannot fail");
    let fingerprint = serde_json::to_string(&document_fingerprint(document))
        .expect("string serialization cannot fail");
    let processing_profile = serde_json::to_string(&metadata.processing_profile)
        .expect("string serialization cannot fail");
    let client_name = metadata
        .client_name
        .as_ref()
        .map(|name| serde_json::to_string(name).expect("string serialization cannot fail"))
        .unwrap_or_else(|| "null".to_string());
    format!(
        "---\nhoneyvoice_record_id: {id}\nhoneyvoice_title: {title}\nhoneyvoice_content_hash: {fingerprint}\nhoneyvoice_processing_profile: {processing_profile}\nhoneyvoice_client: {client_name}\ntags:\n  - honeyvoice/recording\n---\n\n"
    )
}

fn update_frontmatter(
    existing: &str,
    note_id: &str,
    title: &str,
    next_document: &str,
    metadata: &VaultRecordMetadata,
) -> Result<String, String> {
    let header_end = existing
        .find("\n---\n")
        .ok_or_else(|| "existing Markdown has no valid frontmatter".to_string())?;
    let header = &existing[..header_end];
    let expected_id = format!(
        "honeyvoice_record_id: {}",
        serde_json::to_string(note_id).map_err(|e| e.to_string())?
    );
    if !header.lines().any(|line| line == expected_id) {
        return Err("target file is not owned by this HoneyVoice record".into());
    }
    let title_line = format!(
        "honeyvoice_title: {}",
        serde_json::to_string(title).map_err(|e| e.to_string())?
    );
    let old_hash = header
        .lines()
        .find_map(|line| line.strip_prefix("honeyvoice_content_hash: "))
        .ok_or_else(|| "existing HoneyVoice frontmatter has no content hash".to_string())?;
    let current_document = managed_document(existing, note_id)?;
    let actual_hash = serde_json::to_string(&document_fingerprint(current_document))
        .map_err(|e| e.to_string())?;
    if old_hash != actual_hash {
        return Err(
            "HoneyVoice content was edited in Obsidian; it was left untouched to protect those edits".into(),
        );
    }
    let next_hash_line = format!(
        "honeyvoice_content_hash: {}",
        serde_json::to_string(&document_fingerprint(next_document)).map_err(|e| e.to_string())?
    );
    let next_profile_line = format!(
        "honeyvoice_processing_profile: {}",
        serde_json::to_string(&metadata.processing_profile).map_err(|e| e.to_string())?
    );
    let next_client_line = format!(
        "honeyvoice_client: {}",
        metadata
            .client_name
            .as_ref()
            .map(|name| serde_json::to_string(name).map_err(|e| e.to_string()))
            .transpose()?
            .unwrap_or_else(|| "null".to_string())
    );
    let mut title_count = 0;
    let mut hash_count = 0;
    let mut profile_count = 0;
    let mut client_count = 0;
    let updated_header = header
        .lines()
        .map(|line| {
            if line.starts_with("honeyvoice_title:") {
                title_count += 1;
                title_line.as_str()
            } else if line.starts_with("honeyvoice_content_hash:") {
                hash_count += 1;
                next_hash_line.as_str()
            } else if line.starts_with("honeyvoice_processing_profile:") {
                profile_count += 1;
                next_profile_line.as_str()
            } else if line.starts_with("honeyvoice_client:") {
                client_count += 1;
                next_client_line.as_str()
            } else {
                line
            }
        })
        .collect::<Vec<_>>();
    if title_count != 1 || hash_count != 1 {
        return Err("existing HoneyVoice frontmatter is malformed".into());
    }
    if profile_count > 1 || client_count > 1 {
        return Err("existing HoneyVoice metadata is malformed".into());
    }
    let mut updated_header = updated_header.join("\n");
    if profile_count == 0 {
        updated_header.push('\n');
        updated_header.push_str(&next_profile_line);
    }
    if client_count == 0 {
        updated_header.push('\n');
        updated_header.push_str(&next_client_line);
    }
    Ok(format!("{updated_header}{}", &existing[header_end..]))
}

fn managed_document<'a>(existing: &'a str, note_id: &str) -> Result<&'a str, String> {
    let start_marker = format!("{START_MARKER}{note_id}\" -->");
    let end_marker = format!("{END_MARKER}{note_id}\" -->");
    if existing.match_indices(&start_marker).count() != 1
        || existing.match_indices(&end_marker).count() != 1
    {
        return Err(
            "target file has no unique HoneyVoice-managed block; it was left untouched".into(),
        );
    }
    let start = existing.find(&start_marker).expect("count checked") + start_marker.len();
    let end = existing.find(&end_marker).expect("count checked");
    if end < start {
        return Err("target file has malformed HoneyVoice-managed markers".into());
    }
    Ok(existing[start..end].trim())
}

fn merge_managed_block(existing: &str, note_id: &str, document: &str) -> Result<String, String> {
    let start_marker = format!("{START_MARKER}{note_id}\" -->");
    let end_marker = format!("{END_MARKER}{note_id}\" -->");
    let _ = managed_document(existing, note_id)?;
    let start = existing.find(&start_marker).expect("count checked") + start_marker.len();
    let end = existing.find(&end_marker).expect("count checked");
    if end < start {
        return Err("target file has malformed HoneyVoice-managed markers".into());
    }
    let mut merged = String::with_capacity(existing.len() + document.len());
    merged.push_str(&existing[..start]);
    merged.push('\n');
    merged.push_str(document.trim());
    merged.push('\n');
    merged.push_str(&existing[end..]);
    Ok(merged)
}

struct VaultRecordPlan {
    vault: PathBuf,
    target: PathBuf,
    before: Option<String>,
    after: String,
}

fn plan_vault_record(
    vault: &Path,
    note_id: &str,
    title: &str,
    document: &str,
) -> Result<VaultRecordPlan, String> {
    plan_vault_record_with_metadata(
        vault,
        note_id,
        title,
        document,
        &VaultRecordMetadata::default(),
    )
}

fn plan_vault_record_with_metadata(
    vault: &Path,
    note_id: &str,
    title: &str,
    document: &str,
    record_metadata: &VaultRecordMetadata,
) -> Result<VaultRecordPlan, String> {
    if note_id.is_empty()
        || note_id.len() > 128
        || !note_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err("record ID contains unsupported filename characters".into());
    }
    let vault = vault
        .canonicalize()
        .map_err(|e| format!("open Vault: {e}"))?;
    if !vault.is_dir() {
        return Err("selected Vault path is not a folder".into());
    }
    let recordings = vault.join("Recordings");
    let recordings = match std::fs::symlink_metadata(&recordings) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                let resolved = recordings
                    .canonicalize()
                    .map_err(|e| format!("resolve Recordings folder: {e}"))?;
                if !resolved.starts_with(&vault) {
                    return Err("Recordings folder resolves outside the selected Vault".into());
                }
                return Err("Recordings folder must not be a symlink".into());
            }
            if !metadata.is_dir() {
                return Err("Recordings path is not a regular folder".into());
            }
            let resolved = recordings
                .canonicalize()
                .map_err(|e| format!("resolve Recordings folder: {e}"))?;
            if !resolved.starts_with(&vault) {
                return Err("Recordings folder resolves outside the selected Vault".into());
            }
            resolved
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => recordings,
        Err(error) => return Err(format!("inspect Recordings folder: {error}")),
    };

    let filename = format!("{}-{note_id}.md", vault_filename_slug(title));
    let target = if recordings.is_dir() {
        existing_record_path(&recordings, note_id)?.unwrap_or_else(|| recordings.join(filename))
    } else {
        recordings.join(filename)
    };
    let block = managed_block(note_id, document);
    let (before, after) = match std::fs::symlink_metadata(&target) {
        Ok(file_metadata) => {
            if file_metadata.file_type().is_symlink() || !file_metadata.is_file() {
                return Err("target is not a regular file; it was left untouched".into());
            }
            let existing = std::fs::read_to_string(&target)
                .map_err(|e| format!("read existing Obsidian record: {e}"))?;
            let updated = update_frontmatter(&existing, note_id, title, document, record_metadata)?;
            let after = merge_managed_block(&updated, note_id, document)?;
            (Some(existing), after)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (
            None,
            format!(
                "{}{}\n",
                frontmatter(note_id, title, document, record_metadata),
                block
            ),
        ),
        Err(error) => return Err(format!("inspect export target: {error}")),
    };

    Ok(VaultRecordPlan {
        vault,
        target,
        before,
        after,
    })
}

fn write_vault_record(
    vault: &Path,
    note_id: &str,
    title: &str,
    document: &str,
) -> Result<PathBuf, String> {
    persist_vault_plan(plan_vault_record(vault, note_id, title, document)?)
}

fn persist_vault_plan(plan: VaultRecordPlan) -> Result<PathBuf, String> {
    let VaultRecordPlan {
        vault,
        target,
        before,
        after,
    } = plan;
    let recordings = target
        .parent()
        .ok_or_else(|| "target has no parent folder".to_string())?;
    std::fs::create_dir_all(recordings).map_err(|e| format!("create Recordings folder: {e}"))?;
    let resolved_recordings = recordings
        .canonicalize()
        .map_err(|e| format!("resolve Recordings folder: {e}"))?;
    if !resolved_recordings.starts_with(&vault) {
        return Err("Recordings folder resolves outside the selected Vault".into());
    }

    match (&before, std::fs::symlink_metadata(&target)) {
        (Some(expected), Ok(metadata))
            if metadata.is_file() && !metadata.file_type().is_symlink() =>
        {
            let actual = std::fs::read_to_string(&target)
                .map_err(|e| format!("recheck Obsidian record: {e}"))?;
            if &actual != expected {
                return Err(
                    "Vault file changed after preview; nothing was written. Prepare a new preview."
                        .into(),
                );
            }
        }
        (None, Err(error)) if error.kind() == std::io::ErrorKind::NotFound => {}
        (Some(_), _) => {
            return Err(
                "Vault file changed or is no longer a regular file; nothing was written".into(),
            )
        }
        (None, Ok(_)) => {
            return Err("Vault target appeared after preview; nothing was overwritten".into())
        }
        (None, Err(error)) => return Err(format!("recheck Vault target: {error}")),
    }

    let mut temp = tempfile::NamedTempFile::new_in(&recordings)
        .map_err(|e| format!("create temporary export: {e}"))?;
    temp.write_all(after.as_bytes())
        .map_err(|e| format!("write temporary export: {e}"))?;
    temp.as_file()
        .sync_all()
        .map_err(|e| format!("sync temporary export: {e}"))?;
    let save_result = if before.is_none() {
        persist_new_vault_file(temp, &target)
    } else {
        persist_vault_file(temp, &target)
    };
    save_result.map_err(|e| format!("save Obsidian record: {e}"))?;
    Ok(target)
}

/// Keep the original Vault path when a note title changes; renaming Markdown
/// files can break a user's existing Obsidian wikilinks.
fn existing_record_path(recordings: &Path, note_id: &str) -> Result<Option<PathBuf>, String> {
    let suffix = format!("-{note_id}.md");
    let mut found = None;
    for entry in
        std::fs::read_dir(recordings).map_err(|e| format!("scan Recordings folder: {e}"))?
    {
        let entry = entry.map_err(|e| format!("read Recordings entry: {e}"))?;
        let name = entry.file_name();
        if name.to_string_lossy().ends_with(&suffix) {
            let kind = entry
                .file_type()
                .map_err(|e| format!("inspect existing Obsidian record: {e}"))?;
            if kind.is_symlink() || !kind.is_file() {
                return Err("existing record path is not a regular file".into());
            }
            if found.is_some() {
                return Err("multiple Vault files match this HoneyVoice record ID".into());
            }
            found = Some(entry.path());
        }
    }
    Ok(found)
}

fn persist_vault_file(temp: tempfile::NamedTempFile, target: &Path) -> std::io::Result<()> {
    match temp.persist(target) {
        Ok(_) => Ok(()),
        Err(persist_error) if target.exists() => {
            // Some filesystems (notably Windows) refuse rename-over-existing.
            // Keep a recoverable sibling while swapping and restore it on error.
            let backup =
                target.with_extension(format!("md.honeyvoice-backup-{}", uuid::Uuid::new_v4()));
            std::fs::rename(target, &backup)?;
            match persist_error.file.persist(target) {
                Ok(_) => {
                    let _ = std::fs::remove_file(backup);
                    Ok(())
                }
                Err(retry_error) => {
                    let restore = std::fs::rename(&backup, target);
                    if let Err(restore_error) = restore {
                        return Err(std::io::Error::new(
                            restore_error.kind(),
                            format!(
                                "{}; original file is recoverable at {}",
                                retry_error.error,
                                backup.display()
                            ),
                        ));
                    }
                    Err(retry_error.error)
                }
            }
        }
        Err(persist_error) => Err(persist_error.error),
    }
}

/// Publish a newly-created file without replacing a path another process may
/// have created after our final existence check.
fn persist_new_vault_file(temp: tempfile::NamedTempFile, target: &Path) -> std::io::Result<()> {
    std::fs::hard_link(temp.path(), target)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn timeline_entry(
        session_id: &str,
        session_index: u32,
        chunk_idx: usize,
        start_ms: u64,
        label: &str,
        text: &str,
    ) -> TimelineEntry {
        TimelineEntry {
            start_ms,
            end_ms: start_ms + 1_000,
            label: label.into(),
            text: text.into(),
            uncertain: false,
            overlap: false,
            words: Vec::new(),
            session_id: session_id.into(),
            session_index,
            chunk_idx,
        }
    }

    #[test]
    fn vault_transcript_keeps_session_local_timestamps_speakers_and_stable_anchors() {
        let mut entries = vec![
            timeline_entry("take-1", 0, 0, 8_250, "Speaker 1", "  First   statement. "),
            timeline_entry("take-2", 1, 0, 3_000, "张三", "Second statement."),
        ];
        entries[0].uncertain = true;
        entries[1].overlap = true;
        let sessions = vec![
            super::super::NoteSession {
                id: "take-1".into(),
                index: 0,
                started_at: "2026-09-27T10:00:00Z".into(),
                duration_ms: 9_000,
                streams: vec!["mic".into()],
                has_playback: true,
                can_transcribe: false,
                can_retranscribe: true,
            },
            super::super::NoteSession {
                id: "take-2".into(),
                index: 1,
                started_at: "2026-09-27T11:00:00Z".into(),
                duration_ms: 4_000,
                streams: vec!["sys".into()],
                has_playback: true,
                can_transcribe: false,
                can_retranscribe: true,
            },
        ];
        let rendered = render_vault_transcript(&entries, &sessions, "note_1", "legacy", true);
        assert!(rendered.contains("**Recording 1** — 2026-09-27T10:00:00Z"));
        assert!(rendered
            .contains("[00:00:08.250](honeyvoice://open?note=note_1&session=take-1&t=8250) Speaker 1: First statement. **[待核验]** ^honeyvoice-note-1-take-1-0"));
        assert!(rendered.contains("**Recording 2** — 2026-09-27T11:00:00Z"));
        assert!(
            rendered.contains("[00:00:03.000](honeyvoice://open?note=note_1&session=take-2&t=3000) 张三: Second statement. **[重叠发言]** ^honeyvoice-note-1-take-2-0")
        );
    }

    #[test]
    fn vault_transcript_can_hide_speaker_labels_and_falls_back_for_legacy_notes() {
        let entry = timeline_entry("take 1", 0, 2, 3_600_001, "Speaker 1", "hello");
        let rendered = render_vault_transcript(&[entry], &[], "n", "You: hello", false);
        assert!(rendered.contains("01:00:00.001 hello ^honeyvoice-n-take-1-2"));
        assert!(!rendered.contains("Speaker 1"));

        let linked = render_vault_transcript(
            &[timeline_entry("take/1", 0, 0, 1_001, "", "safe fallback")],
            &[],
            "n",
            "legacy",
            false,
        );
        assert!(linked.contains("00:00:01.001 safe fallback"));
        assert!(!linked.contains("honeyvoice://"));

        let legacy = render_vault_transcript(&[], &[], "n", "You: hello\nSpeaker 1: hi", false);
        assert_eq!(legacy, "hello\nhi");
    }

    fn spec(format: ExportFormat) -> ExportSpec {
        ExportSpec {
            path: "/tmp/x".into(),
            format,
            include_summary: true,
            include_transcript: true,
            include_notes: false,
            include_speaker_labels: true,
        }
    }

    #[test]
    fn markdown_has_title_and_section_headers() {
        let s = spec(ExportFormat::Markdown);
        let out = build_export_document(
            "Weekly sync",
            "- Ship v1",
            "You: hello\nSpeaker 1: hi",
            "",
            &s,
        );
        assert!(out.starts_with("# Weekly sync\n"), "title heading: {out:?}");
        assert!(out.contains("## Summary\n\n- Ship v1"));
        assert!(out.contains("## Transcript\n\nYou: hello\nSpeaker 1: hi"));
        assert!(out.ends_with('\n'));
    }

    #[test]
    fn plain_text_underlines_headings() {
        let s = spec(ExportFormat::Txt);
        let out = build_export_document("Sync", "Done", "You: hey", "", &s);
        assert!(out.starts_with("Sync\n====\n"), "title underline: {out:?}");
        assert!(out.contains("Summary\n-------\n\nDone"));
    }

    #[test]
    fn labels_stripped_when_toggle_off() {
        let mut s = spec(ExportFormat::Markdown);
        s.include_summary = false;
        s.include_speaker_labels = false;
        let out = build_export_document(
            "T",
            "",
            "Speaker 1: hello there\nMichael: how are you",
            "",
            &s,
        );
        assert!(
            out.contains("## Transcript\n\nhello there\nhow are you"),
            "{out:?}"
        );
        assert!(!out.contains("Speaker 1:"));
        assert!(!out.contains("Michael:"));
    }

    #[test]
    fn labels_kept_when_toggle_on() {
        let mut s = spec(ExportFormat::Markdown);
        s.include_summary = false;
        s.include_speaker_labels = true;
        let out = build_export_document("T", "", "Speaker 1: hello", "", &s);
        assert!(out.contains("Speaker 1: hello"));
    }

    #[test]
    fn mid_sentence_colon_is_preserved_when_stripping() {
        // A spoken colon far into the line is not a label — leave the line intact
        // when it has no short leading `Label: ` segment... but our heuristic
        // strips the first short prefix. Guard the realistic case: a genuine
        // label followed by text containing a colon keeps the tail's colon.
        let mut s = spec(ExportFormat::Markdown);
        s.include_summary = false;
        s.include_speaker_labels = false;
        let out = build_export_document("T", "", "You: the plan is: ship it", "", &s);
        assert!(out.contains("the plan is: ship it"), "{out:?}");
    }

    #[test]
    fn notes_converted_from_html() {
        let mut s = spec(ExportFormat::Markdown);
        s.include_summary = false;
        s.include_transcript = false;
        s.include_notes = true;
        let out = build_export_document(
            "T",
            "",
            "",
            "<p>First para</p><ul><li>one</li><li>two</li></ul>",
            &s,
        );
        assert!(out.contains("## Notes"));
        assert!(out.contains("First para"));
        assert!(out.contains("- one"));
        assert!(out.contains("- two"));
        assert!(!out.contains("<p>"), "html should be stripped: {out:?}");
    }

    #[test]
    fn empty_checked_section_shows_placeholder() {
        let mut s = spec(ExportFormat::Markdown);
        s.include_transcript = false;
        // summary included but empty
        let out = build_export_document("T", "   ", "", "", &s);
        assert!(out.contains("## Summary\n\n_(empty)_"), "{out:?}");
    }

    #[test]
    fn empty_title_falls_back() {
        let s = spec(ExportFormat::Markdown);
        let out = build_export_document("", "s", "t", "", &s);
        assert!(out.starts_with("# Untitled note"));
    }

    #[test]
    fn nothing_selected_yields_just_the_title() {
        let mut s = spec(ExportFormat::Markdown);
        s.include_summary = false;
        s.include_transcript = false;
        s.include_notes = false;
        let out = build_export_document("Solo", "s", "t", "b", &s);
        assert_eq!(out, "# Solo\n");
    }

    #[test]
    fn format_deserializes_from_lowercase() {
        let f: ExportFormat = serde_json::from_str("\"markdown\"").unwrap();
        assert_eq!(f, ExportFormat::Markdown);
        let f: ExportFormat = serde_json::from_str("\"txt\"").unwrap();
        assert_eq!(f, ExportFormat::Txt);
    }

    #[test]
    fn vault_export_is_idempotent_and_preserves_user_authored_sections() {
        let vault = tempfile::tempdir().unwrap();
        let first =
            write_vault_record(vault.path(), "n1", "Weekly Sync", "# Weekly Sync\n\nold").unwrap();
        let mut contents = std::fs::read_to_string(&first).unwrap();
        contents.push_str("\n## My thoughts\nKeep this paragraph.\n");
        std::fs::write(&first, contents).unwrap();

        let second = write_vault_record(
            vault.path(),
            "n1",
            "Weekly Sync",
            "# Weekly Sync\n\nupdated",
        )
        .unwrap();
        assert_eq!(first, second);
        let contents = std::fs::read_to_string(second).unwrap();
        assert!(contents.contains("honeyvoice_record_id: \"n1\""));
        assert!(contents.contains("## My thoughts\nKeep this paragraph."));
        assert!(contents.contains("# Weekly Sync\n\nupdated"));
        assert!(!contents.contains("\n\nold\n"));
        assert_eq!(contents.matches(START_MARKER).count(), 1);
        assert_eq!(contents.matches(END_MARKER).count(), 1);
    }

    #[test]
    fn vault_export_publishes_processing_profile_and_escaped_client_metadata() {
        let vault = tempfile::tempdir().unwrap();
        let metadata = VaultRecordMetadata {
            processing_profile: "business_negotiation".into(),
            client_name: Some("客户: \"北区\"\n新项目".into()),
        };
        let plan = plan_vault_record_with_metadata(
            vault.path(),
            "n1",
            "谈判纪要",
            "# 谈判纪要",
            &metadata,
        )
        .unwrap();

        assert!(plan
            .after
            .contains(r#"honeyvoice_processing_profile: "business_negotiation""#));
        assert!(plan
            .after
            .contains(r#"honeyvoice_client: "客户: \"北区\"\n新项目""#));
        assert!(plan.after.contains("# 谈判纪要"));
    }

    #[test]
    fn vault_update_adds_or_refreshes_honeyvoice_metadata_without_touching_user_frontmatter() {
        let vault = tempfile::tempdir().unwrap();
        let original = write_vault_record(vault.path(), "n1", "Weekly Sync", "# Original").unwrap();
        let contents = std::fs::read_to_string(&original)
            .unwrap()
            .replace(
                "honeyvoice_content_hash:",
                "aliases: [\"My alias\"]\nhoneyvoice_content_hash:",
            )
            .replace("honeyvoice_processing_profile: \"\"\n", "");
        std::fs::write(&original, contents).unwrap();

        let metadata = VaultRecordMetadata {
            processing_profile: "knowledge_learning".into(),
            client_name: Some("Acme / North".into()),
        };
        let plan = plan_vault_record_with_metadata(
            vault.path(),
            "n1",
            "Weekly Sync",
            "# Updated",
            &metadata,
        )
        .unwrap();
        persist_vault_plan(plan).unwrap();
        let updated = std::fs::read_to_string(original).unwrap();

        assert!(updated.contains("aliases: [\"My alias\"]"));
        assert!(updated.contains(r#"honeyvoice_processing_profile: "knowledge_learning""#));
        assert!(updated.contains(r#"honeyvoice_client: "Acme / North""#));
    }

    #[test]
    fn vault_export_keeps_the_existing_wikilink_path_when_the_title_changes() {
        let vault = tempfile::tempdir().unwrap();
        let original =
            write_vault_record(vault.path(), "n1", "Weekly Sync", "# Weekly Sync").unwrap();
        let updated =
            write_vault_record(vault.path(), "n1", "Renamed Meeting", "# Renamed Meeting").unwrap();

        assert_eq!(updated, original);
        let contents = std::fs::read_to_string(updated).unwrap();
        assert!(contents.contains("honeyvoice_title: \"Renamed Meeting\""));
        assert!(contents.contains("# Renamed Meeting"));
        assert!(!vault
            .path()
            .join("Recordings/renamed-meeting-n1.md")
            .exists());
    }

    #[test]
    fn vault_export_refuses_to_replace_edits_inside_the_managed_block() {
        let vault = tempfile::tempdir().unwrap();
        let path = write_vault_record(
            vault.path(),
            "n1",
            "Weekly Sync",
            "# Weekly Sync\n\nOriginal",
        )
        .unwrap();
        let edited = std::fs::read_to_string(&path)
            .unwrap()
            .replace("Original", "User edit inside managed block");
        std::fs::write(&path, &edited).unwrap();

        let error = write_vault_record(vault.path(), "n1", "Weekly Sync", "# Weekly Sync\n\nNew")
            .unwrap_err();
        assert!(error.contains("edited in Obsidian"));
        assert_eq!(std::fs::read_to_string(path).unwrap(), edited);
    }

    #[test]
    fn vault_preview_does_not_create_or_write_anything_before_confirmation() {
        let vault = tempfile::tempdir().unwrap();
        let plan = plan_vault_record(vault.path(), "n1", "Weekly Sync", "# Weekly Sync").unwrap();
        assert!(!vault.path().join("Recordings").exists());
        assert!(plan.before.is_none());
        assert!(plan.after.contains("# Weekly Sync"));
        assert!(!plan.target.exists());
    }

    #[test]
    fn vault_preview_refuses_commit_if_the_existing_file_changed() {
        let vault = tempfile::tempdir().unwrap();
        let target = write_vault_record(vault.path(), "n1", "Weekly Sync", "# Original").unwrap();
        let plan = plan_vault_record(vault.path(), "n1", "Weekly Sync", "# Updated").unwrap();
        let before = std::fs::read_to_string(&target).unwrap();
        std::fs::write(
            &target,
            format!("{before}\n## Added while preview was open\n"),
        )
        .unwrap();

        let error = persist_vault_plan(plan).unwrap_err();
        assert!(error.contains("changed after preview"));
        assert!(std::fs::read_to_string(&target)
            .unwrap()
            .contains("Added while preview was open"));
    }

    #[test]
    fn vault_preview_refuses_to_overwrite_a_new_file_created_after_preview() {
        let vault = tempfile::tempdir().unwrap();
        let plan = plan_vault_record(vault.path(), "n1", "Weekly Sync", "# Generated").unwrap();
        let target = plan.target.clone();
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(&target, "User-created file\n").unwrap();

        let error = persist_vault_plan(plan).unwrap_err();
        assert!(error.contains("appeared after preview"));
        assert_eq!(
            std::fs::read_to_string(target).unwrap(),
            "User-created file\n"
        );
    }

    #[test]
    fn vault_export_refuses_to_overwrite_an_unmanaged_collision() {
        let vault = tempfile::tempdir().unwrap();
        let recordings = vault.path().join("Recordings");
        std::fs::create_dir_all(&recordings).unwrap();
        let target = recordings.join("weekly-sync-n1.md");
        std::fs::write(&target, "User-authored note\n").unwrap();

        let error =
            write_vault_record(vault.path(), "n1", "Weekly Sync", "# Generated").unwrap_err();
        assert!(error.contains("frontmatter"));
        assert_eq!(
            std::fs::read_to_string(target).unwrap(),
            "User-authored note\n"
        );
    }

    #[test]
    fn vault_export_sanitizes_record_ids_and_rejects_path_traversal() {
        let vault = tempfile::tempdir().unwrap();
        let error =
            write_vault_record(vault.path(), "../escape", "Title", "# Generated").unwrap_err();
        assert!(error.contains("unsupported filename characters"));
        assert!(!vault.path().join("escape.md").exists());
    }

    #[test]
    fn vault_export_rejects_a_recordings_symlink_outside_the_vault() {
        #[cfg(unix)]
        {
            let vault = tempfile::tempdir().unwrap();
            let outside = tempfile::tempdir().unwrap();
            std::os::unix::fs::symlink(outside.path(), vault.path().join("Recordings")).unwrap();

            let error = write_vault_record(vault.path(), "n1", "Title", "# Generated").unwrap_err();
            assert!(error.contains("outside the selected Vault"));
            assert!(std::fs::read_dir(outside.path()).unwrap().next().is_none());
        }
    }
}
