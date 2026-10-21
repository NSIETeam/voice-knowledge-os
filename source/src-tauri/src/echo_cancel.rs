//! Conservative, post-stop echo cancellation for the hybrid diarization pass.
//!
//! Capture and transcript paths always retain the original mic/system WAVs.
//! This module only creates a temporary derived mic WAV for diarization. When
//! alignment or cancellation quality is uncertain, callers use the raw mic.

use echo_probe::{
    aec::{self, AecConfig},
    delay::{self, DelayConfig, DelayMap},
    wav,
};
use std::path::{Path, PathBuf};

const MIN_DURATION_SECONDS: f64 = 12.0;
const MIN_VALID_WINDOWS: usize = 3;
const MIN_VALID_FRACTION: f64 = 0.40;
const MIN_ECHO_REDUCTION_DB: f64 = 6.0;
const MAX_NEAR_SPEECH_CHANGE_DB: f64 = 4.0;

pub struct CancelledMic {
    // Keeping the directory alive keeps the derived audio alive through the
    // asynchronous diarizer call. Drop removes only this generated temp file.
    _temp_dir: tempfile::TempDir,
    path: PathBuf,
}

impl CancelledMic {
    pub fn path(&self) -> &Path {
        &self.path
    }
}

/// Create a temporary AEC-cleaned mic WAV when alignment and quality gates
/// pass. `Ok(None)` means the raw mic is the safer diarization input.
pub fn prepare(mic_path: &Path, sys_path: &Path) -> Result<Option<CancelledMic>, String> {
    let mic = wav::read(mic_path)?;
    let sys = wav::read(sys_path)?;
    if mic.size_mismatch || sys.size_mismatch {
        return Err("input WAV is incomplete; using the original mic".into());
    }
    if mic.rate != sys.rate || mic.rate != 16_000 {
        return Err(format!(
            "AEC needs matching 16 kHz streams (mic {}, system {}); using the original mic",
            mic.rate, sys.rate
        ));
    }
    if mic.duration_s() < MIN_DURATION_SECONDS || sys.duration_s() < MIN_DURATION_SECONDS {
        return Ok(None);
    }

    let delay_config = DelayConfig::default();
    let points = delay::lag_track(&mic.samples, &sys.samples, mic.rate, &delay_config);
    let valid = points.iter().filter(|point| point.valid).count();
    if valid < MIN_VALID_WINDOWS
        || points.is_empty()
        || valid as f64 / (points.len() as f64) < MIN_VALID_FRACTION
    {
        eprintln!(
            "aec: alignment evidence insufficient ({valid}/{} valid windows); using raw mic",
            points.len()
        );
        return Ok(None);
    }

    let mut summary = delay::summarize(&points, &delay_config);
    delay::refine_steps(
        &mic.samples,
        &sys.samples,
        mic.rate,
        &mut summary,
        &delay_config,
    );
    let Some(map) = DelayMap::from_summary(&summary) else {
        eprintln!("aec: no stable delay map; using raw mic");
        return Ok(None);
    };
    let config = AecConfig::default();
    let reference = aec::align_reference(
        &sys.samples,
        mic.samples.len(),
        mic.rate,
        &map,
        config.margin_ms,
    );
    let output = aec::cancel(&mic.samples, &reference, mic.rate, &config);
    let report = &output.report;
    let echo_reduction = report.erle_db.unwrap_or(f64::NEG_INFINITY);
    let near_speech_safe = report
        .near_change_db
        .is_none_or(|change| change.abs() <= MAX_NEAR_SPEECH_CHANGE_DB);
    if report.echo_blocks < 3 || echo_reduction < MIN_ECHO_REDUCTION_DB || !near_speech_safe {
        eprintln!(
            "aec: quality gate failed (echo_blocks={}, ERLE={:.1} dB, near_change={:?}); using raw mic",
            report.echo_blocks, echo_reduction, report.near_change_db
        );
        return Ok(None);
    }

    let temp_dir = tempfile::Builder::new()
        .prefix("honeyvoice-aec-")
        .tempdir()
        .map_err(|e| format!("create temporary AEC directory: {e}"))?;
    let path = temp_dir.path().join("mic-aec.wav");
    wav::write_pcm16(&path, mic.rate, &output.cleaned)?;
    eprintln!(
        "aec: using derived mic for diarization (lag={:.1} ms, valid={valid}/{}, ERLE={echo_reduction:.1} dB, near_change={:?})",
        summary.median_ms.unwrap_or_default(),
        points.len(),
        report.near_change_db
    );
    Ok(Some(CancelledMic {
        _temp_dir: temp_dir,
        path,
    }))
}

/// Run the offline DSP away from Tokio's async executor. Long recordings can
/// take materially longer than a UI frame even when no network or diarizer is
/// involved.
pub async fn prepare_async(
    mic_path: PathBuf,
    sys_path: PathBuf,
) -> Result<Option<CancelledMic>, String> {
    tokio::task::spawn_blocking(move || prepare(&mic_path, &sys_path))
        .await
        .map_err(|error| format!("AEC worker failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use echo_probe::synth::{scenario, ScenarioConfig};
    use sha2::{Digest, Sha256};

    fn write_wav(path: &Path, rate: u32, samples: &[f32]) {
        wav::write_pcm16(path, rate, samples).unwrap();
    }

    #[test]
    fn hybrid_aec_uses_a_derived_file_and_never_mutates_original_streams() {
        let take = scenario(&ScenarioConfig {
            dur_s: 30.0,
            polarity: -1.0,
            ..Default::default()
        });
        let dir = tempfile::tempdir().unwrap();
        let mic_path = dir.path().join("mic.wav");
        let sys_path = dir.path().join("sys.wav");
        write_wav(&mic_path, take.rate, &take.mic);
        write_wav(&sys_path, take.rate, &take.sys);
        let before_mic = Sha256::digest(std::fs::read(&mic_path).unwrap());
        let before_sys = Sha256::digest(std::fs::read(&sys_path).unwrap());

        let derived = prepare(&mic_path, &sys_path)
            .unwrap()
            .expect("AEC should pass on the known-answer take");
        assert_ne!(derived.path(), mic_path);
        let cleaned = wav::read(derived.path()).unwrap();
        assert_eq!((cleaned.rate, cleaned.channels), (16_000, 1));
        assert_eq!(cleaned.samples.len(), take.mic.len());
        assert_eq!(
            Sha256::digest(std::fs::read(&mic_path).unwrap()),
            before_mic
        );
        assert_eq!(
            Sha256::digest(std::fs::read(&sys_path).unwrap()),
            before_sys
        );
        assert!(derived.path().exists());
        let derived_dir = derived.path().parent().unwrap().to_path_buf();
        drop(derived);
        assert!(!derived_dir.exists());
    }

    #[test]
    fn short_takes_fall_back_without_mutating_the_mic() {
        let dir = tempfile::tempdir().unwrap();
        let mic_path = dir.path().join("mic.wav");
        let sys_path = dir.path().join("sys.wav");
        let short = vec![0.1; 16_000 * 5];
        write_wav(&mic_path, 16_000, &short);
        write_wav(&sys_path, 16_000, &short);
        let before = Sha256::digest(std::fs::read(&mic_path).unwrap());
        assert!(prepare(&mic_path, &sys_path).unwrap().is_none());
        assert_eq!(Sha256::digest(std::fs::read(&mic_path).unwrap()), before);
    }

    #[test]
    fn mismatched_sample_rates_fail_closed_to_the_original_mic() {
        let dir = tempfile::tempdir().unwrap();
        let mic_path = dir.path().join("mic.wav");
        let sys_path = dir.path().join("sys.wav");
        let samples = vec![0.0; 16_000 * 15];
        write_wav(&mic_path, 16_000, &samples);
        write_wav(&sys_path, 48_000, &samples);
        match prepare(&mic_path, &sys_path) {
            Err(error) => assert!(error.contains("matching 16 kHz")),
            Ok(_) => panic!("sample-rate mismatch must fail closed"),
        }
    }

    #[test]
    fn silent_streams_do_not_produce_a_cancelled_input() {
        let dir = tempfile::tempdir().unwrap();
        let mic_path = dir.path().join("mic.wav");
        let sys_path = dir.path().join("sys.wav");
        let silence = vec![0.0; 16_000 * 15];
        write_wav(&mic_path, 16_000, &silence);
        write_wav(&sys_path, 16_000, &silence);
        assert!(prepare(&mic_path, &sys_path).unwrap().is_none());
    }
}
