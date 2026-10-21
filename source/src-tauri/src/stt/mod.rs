//! STT provider abstraction. See docs/design/stt-adapter.md for rationale.

mod adapter;
pub(crate) mod apple_speech;
mod config;
mod deepgram;
mod groq;
mod keychain;
mod local;
mod openai;
mod openai_compat;

use std::path::PathBuf;

pub use adapter::{BatchSttAdapter, TranscribeCtx, TranscribeResult, Word};
pub use apple_speech::AppleSpeechAdapter;
pub use config::{
    from_legacy_settings, DeepgramConfig, GroqConfig, LocalWhisperConfig, OpenAiConfig,
    ProviderConfig, TranscribeConfig,
};
pub use deepgram::DeepgramAdapter;
pub use groq::GroqAdapter;
pub use keychain::{keychain_account_for, new_cache, ApiKeyCache, KEYCHAIN_SERVICE};
pub use local::LocalWhisperAdapter;
pub use openai::OpenAiAdapter;

use crate::local_whisper;

/// Local-Whisper-specific dispatch dependencies. The adapter needs the
/// shared model context, the resolved model file path, and the GPU flag —
/// none of which can live inside `ProviderConfig` (they're runtime state,
/// not user settings). The caller resolves these at dispatch time and
/// passes them in.
pub struct LocalDeps {
    pub shared: local_whisper::SharedContext,
    pub model_path: PathBuf,
    pub use_gpu: bool,
}

/// Build the right adapter for the given config. Boxed because the trait is
/// dyn-dispatched; allocation cost is irrelevant next to network or
/// inference latency.
///
/// `local_deps` is required for `ProviderConfig::Local` and unused for
/// other variants. Constructed by the caller because `ProviderConfig`
/// can't carry runtime state.
pub fn build_adapter(
    cfg: &ProviderConfig,
    local_deps: Option<LocalDeps>,
) -> Box<dyn BatchSttAdapter> {
    match cfg {
        ProviderConfig::OpenAi(_) => Box::new(OpenAiAdapter::new()),
        ProviderConfig::Local(local_cfg) => {
            let deps = local_deps.expect("LocalDeps required for ProviderConfig::Local");
            Box::new(LocalWhisperAdapter::new(
                deps.shared,
                deps.model_path,
                deps.use_gpu,
                local_whisper::Preset::from_setting(&local_cfg.preset),
            ))
        }
        ProviderConfig::AppleSpeech(_) => Box::new(AppleSpeechAdapter),
        ProviderConfig::Groq(_) => Box::new(GroqAdapter::new()),
        ProviderConfig::Deepgram(_) => Box::new(DeepgramAdapter::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_openai_adapter_returns_openai() {
        let cfg = ProviderConfig::OpenAi(OpenAiConfig {
            model: "whisper-1".to_string(),
            base_url: None,
        });
        let adapter = build_adapter(&cfg, None);
        assert!(adapter.supports_word_timestamps("whisper-1"));
    }

    #[test]
    fn build_local_adapter_returns_local() {
        use parking_lot::Mutex;
        use std::sync::Arc;

        let cfg = ProviderConfig::Local(LocalWhisperConfig {
            model_id: "large-v3-turbo-q5".to_string(),
            preset: "quality".to_string(),
            use_gpu: true,
        });
        let deps = LocalDeps {
            shared: Arc::new(Mutex::new(None)),
            model_path: PathBuf::from("/tmp/test.bin"),
            use_gpu: true,
        };
        let adapter = build_adapter(&cfg, Some(deps));
        assert!(adapter.supports_word_timestamps("large-v3-turbo-q5"));
    }

    #[test]
    #[should_panic(expected = "LocalDeps required")]
    fn build_local_without_deps_panics() {
        let cfg = ProviderConfig::Local(LocalWhisperConfig {
            model_id: "any".to_string(),
            preset: "quality".to_string(),
            use_gpu: true,
        });
        let _ = build_adapter(&cfg, None);
    }
}
