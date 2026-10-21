import { useEffect, useState } from "react";
import type { AppleSpeechStatus, ProviderConfig } from "../../../lib/ipc";
import { ipc } from "../../../lib/ipc";
import {
  DEEPGRAM_MODELS,
  GROQ_MODELS,
  APPLE_SPEECH_PROVIDER,
  LOCAL_PROVIDER,
  PROVIDERS_BASE,
  TRANSCRIBE_MODELS,
  WHISPER_PRESETS,
  type Provider,
} from "../types";
import type { TranscribeProvider } from "../../../lib/providers";
import { Row } from "./Section";
import { Select } from "../../../components/ui/Select";
import { Toggle } from "./Toggle";
import { useT } from "../../../lib/locale";

type LocalModelSummary = {
  id: string;
  label: string;
  kind: "multilingual" | "language_specific";
  specificLanguage: string | null;
  downloaded: boolean;
};

// Model-row description per provider: each picker explains what it selects
// and how it relates to the provider chosen above (design-review amendment).
const MODEL_DESCRIPTIONS: Record<TranscribeProvider, string> = {
  openai:
    "whisper-1 is the safe default; gpt-4o-transcribe-diarize labels speakers but treats language as a hint and ignores vocabulary biasing.",
  deepgram:
    "nova-3 is the current best for English and falls back gracefully to other languages.",
  groq: "Whisper Large v3 Turbo at OpenAI-compatible endpoints — same Whisper quality, ~10× cheaper and faster than OpenAI's hosted version.",
  local:
    "Only downloaded models are offered — manage them under Local models below.",
  apple_speech:
    "Uses the macOS 26 on-device SpeechTranscriber. Apple manages its language model; no Whisper model download or API key is needed.",
};

// Reusable provider+model picker rendered as self-describing rows. Used by
// the Default provider section and the per-language override editor. Keeps
// the four provider variants' divergent fields (OpenAI: model, Local:
// model_id+preset+gpu, Deepgram: model, Groq: model) in one place so the
// two callers stay in lockstep.
//
// Returns a fragment of Rows so the parent Section's divide-y hairlines
// apply between them.
//
// `localModels` is the live list of downloaded local models (from
// `useSettings.local.models`). Used to:
//   1. Keep Local visible even before the first model download.
//   2. Pre-select the first downloaded multilingual model when
//      switching to Local.
//   3. Filter the model_id picker to actually-downloaded files.
//
// `filterLocalToLanguage` (when set) restricts the local model picker to
// `LanguageSpecific` models matching the language PLUS multilingual
// fallbacks. Used by the per-language override form so "Norwegian → Local
// → ?" only offers NB Whisper or multilingual options.
export function ProviderConfigForm({
  value,
  onChange,
  localModels,
  filterLocalToLanguage,
  language,
  hideLocal = false,
}: {
  value: ProviderConfig;
  onChange: (next: ProviderConfig) => void;
  localModels: LocalModelSummary[];
  filterLocalToLanguage?: string;
  language?: string;
  hideLocal?: boolean;
}) {
  const t = useT();
  const provider = value.provider;
  const localAvailable = !hideLocal;
  const [appleStatus, setAppleStatus] = useState<AppleSpeechStatus | null>(null);
  const [applePreparing, setApplePreparing] = useState(false);
  const [appleError, setAppleError] = useState<string | null>(null);
  const speechLanguage = language ?? filterLocalToLanguage ?? "zh";

  useEffect(() => {
    let cancelled = false;
    ipc.appleSpeechStatus(speechLanguage)
      .then((status) => { if (!cancelled) setAppleStatus(status); })
      .catch(() => { if (!cancelled) setAppleStatus(null); });
    return () => { cancelled = true; };
  }, [speechLanguage]);

  const appleAvailable = appleStatus?.available === true && appleStatus.supported;

  const localModelOptions = localModels
    .filter((m) => m.downloaded)
    .filter((m) => {
      if (!filterLocalToLanguage) return true;
      // Multilingual models always usable; language-specific must match.
      return (
        m.kind === "multilingual" || m.specificLanguage === filterLocalToLanguage
      );
    })
    .map((m) => ({ value: m.id, label: t(m.label) }));
  // Show the actual selection even if another model is available; never
  // leave a raw id or pretend a different downloaded model was selected.
  if (value.provider === "local" && !localModelOptions.some((m) => m.value === value.model_id)) {
    const selected = localModels.find((m) => m.id === value.model_id);
    localModelOptions.unshift({ value: value.model_id, label: t("{model} (not downloaded)", { model: t(selected?.label ?? value.model_id) }) });
  }

  const modelSelect =
    value.provider === "openai" ? (
      <Select
        value={value.model}
        onChange={(v) => onChange({ provider: "openai", model: v })}
        options={TRANSCRIBE_MODELS.map((m) => ({ value: m, label: m }))}
      />
    ) : value.provider === "deepgram" ? (
      <Select
        value={value.model}
        onChange={(v) => onChange({ provider: "deepgram", model: v })}
        options={DEEPGRAM_MODELS.map((m) => ({ value: m, label: m }))}
      />
    ) : value.provider === "groq" ? (
      <Select
        value={value.model}
        onChange={(v) => onChange({ provider: "groq", model: v })}
        options={GROQ_MODELS.map((m) => ({ value: m, label: m }))}
      />
    ) : value.provider === "apple_speech" ? (
      <div className="text-sm text-[var(--color-text-muted)]">{t("Apple manages the on-device speech model")}</div>
    ) : (
      <Select
        value={value.model_id}
        onChange={(v) => onChange({ ...value, model_id: v })}
        options={localModelOptions}
      />
    );

  return (
    <>
      <Row
        label="Provider"
        description="Where audio is transcribed — on this Mac or a cloud API."
        control={
          <Select
            value={provider}
            onChange={(v) => {
              const p = v as Provider;
              if (p === "openai") {
                onChange({ provider: "openai", model: "whisper-1" });
              } else if (p === "local") {
                const first = localModels.find(
                  (m) =>
                    m.downloaded &&
                    (filterLocalToLanguage
                      ? m.kind === "multilingual" ||
                        m.specificLanguage === filterLocalToLanguage
                      : m.kind === "multilingual"),
                );
                onChange({
                  provider: "local",
                  model_id: first?.id ?? "large-v3-turbo-q5",
                  preset: "quality",
                  use_gpu: true,
                });
              } else if (p === "deepgram") {
                onChange({ provider: "deepgram", model: "nova-3" });
              } else if (p === "groq") {
                onChange({ provider: "groq", model: "whisper-large-v3-turbo" });
              } else if (p === "apple_speech") {
                onChange({ provider: "apple_speech" });
              }
            }}
            options={(localAvailable ? [...PROVIDERS_BASE, LOCAL_PROVIDER] : PROVIDERS_BASE)
              .concat(appleAvailable || provider === "apple_speech" ? [APPLE_SPEECH_PROVIDER] : [])
              .map((p) => ({ ...p, label: t(p.label) }))}
          />
        }
      />

      {value.provider === "apple_speech" && (
        <Row
          label={t("Apple Speech language model")}
          description={appleStatus?.installed
            ? t("Ready on this Mac. Audio is processed on-device.")
            : appleStatus?.supported && appleStatus.available
              ? t("Apple will download and manage this language model for the Mac.")
              : t("Apple SpeechTranscriber is unavailable for this macOS version or language.")}
          control={
            appleStatus?.installed ? (
              <span className="text-xs text-[var(--color-success)]">{t("Ready")}</span>
            ) : (
              <button
                type="button"
                className="nd-btn"
                disabled={!appleStatus?.supported || !appleStatus.available || applePreparing}
                onClick={async () => {
                  setApplePreparing(true);
                  setAppleError(null);
                  try {
                    setAppleStatus(await ipc.appleSpeechPrepare(speechLanguage));
                  } catch (e) {
                    setAppleError(String(e));
                  } finally {
                    setApplePreparing(false);
                  }
                }}
              >
                {applePreparing ? t("Preparing…") : t("Prepare language")}
              </button>
            )
          }
        />
      )}
      {value.provider === "apple_speech" && appleError && (
        <p role="alert" className="text-xs text-[var(--color-danger)]">{appleError}</p>
      )}

      <Row
        label="Model"
        description={MODEL_DESCRIPTIONS[provider]}
        control={modelSelect}
      />

      {value.provider === "local" && (
        <>
          <Row
            label="Quality"
            description="Speed vs accuracy for on-device Whisper — Quality uses beam search and catches more borderline words."
            control={
              <Select
                value={value.preset}
                onChange={(v) => onChange({ ...value, preset: v })}
                options={WHISPER_PRESETS.map((p) => ({ ...p, label: t(p.label) }))}
              />
            }
          />
          <Row
            label="Use Metal (Apple GPU)"
            description="Runs Whisper inference on the GPU — much faster on Apple Silicon."
            control={
              <Toggle
                label="Use Metal (Apple GPU) for Whisper inference"
                checked={value.use_gpu}
                onChange={(on) => onChange({ ...value, use_gpu: on })}
              />
            }
          />
        </>
      )}
    </>
  );
}
