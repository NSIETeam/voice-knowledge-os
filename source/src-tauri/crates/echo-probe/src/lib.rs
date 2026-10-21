//! Measures how a Humla take's mic and system-audio streams line up, and
//! cancels the system audio's echo out of the mic, offline.
//!
//! Shared DSP for offline measurement and hybrid-call diarization. The app
//! uses its delay tracker and AEC only on a temporary derived mic WAV; the
//! original mic/system WAVs remain untouched. See
//! `docs/research/stream-alignment-and-echo.md` for the measured design.
//!
//! - [`delay`] — GCC-PHAT lag of the mic behind the system stream, per window,
//!   with drift and steps.
//! - [`autocorr`] — the same lag from a mixed `playback.wav` alone.
//! - [`aec`] — reference-based echo cancellation for the diarize input.
//! - [`timing`] — the app's `capture-<session>.json`, to split a lag into the
//!   capture's start offset and the output path.

pub mod aec;
pub mod autocorr;
pub mod delay;
pub mod fft;
pub mod stats;
pub mod synth;
pub mod timing;
pub mod wav;
