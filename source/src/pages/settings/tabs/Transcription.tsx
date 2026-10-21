import { useLocale, translate as uiText, formatMessage as uiMessage } from "../../../lib/locale";
import type { ReactNode } from "react";
import { DiarizeModelManager } from "../components/DiarizeModelManager";
import { EMPTY_DIARIZE_STATE } from "../types";
import { Disclosure } from "../components/Disclosure";
import { LocalModelManager } from "../components/LocalModelManager";
import { PerLanguageOverrides } from "../components/PerLanguageOverrides";
import { ProviderConfigForm } from "../components/ProviderConfigForm";
import { Row, Section } from "../components/Section";
import { RenameYouRow } from "../components/RenameYouRow";
import { Select } from "../../../components/ui/Select";
import { ProviderKeyCard, type KeyProvider } from "../../../components/provider/ProviderKeyCard";
import { KEY_PROVIDERS } from "../../../lib/providers";
import { LANGUAGES, languageOptionLabel } from "../../../lib/languages";
import { inputClass } from "../types";
import type { SettingsHook } from "../useSettings";

// The selected cloud provider's key card renders right under the picker;
// the others sit in Advanced so keys for override-only providers stay
// reachable. Copy comes from the card's per-provider defaults.

// Engine choice row: label + description left, pick-radio right, the
// download/status manager underneath. The radio is presence-gated — an
// engine can't be active until its models are on disk.
function EngineOption({
  label,
  description,
  checked,
  disabled,
  onPick,
  children,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    <div className="py-3.5">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="text-sm">{label}</div>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            {description}
          </p>
        </div>
        <input
          type="radio"
          name="diarize_model"
          checked={checked}
          disabled={disabled}
          onChange={onPick}
          aria-label={uiMessage("Use {engine} for new recordings", { engine: label })}
          className="mt-1 shrink-0"
        />
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

// Small right-aligned mono numeric field with the row model's label +
// description — the threshold knobs' shared shape.
function ThresholdRow({
  label,
  description,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <Row
      label={label}
      description={description}
      control={
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={label}
          className="w-24 text-sm text-right px-2.5 py-1.5 rounded-md border border-[var(--color-line-visible)] bg-[var(--color-surface)] focus:border-[var(--color-text-muted)] transition-colors"
          style={{ fontFamily: "var(--font-mono)" }}
        />
      }
    />
  );
}

export function TranscriptionTab({
  s,
  update,
  transcribeConfig,
  setDefaultConfig,
  setLanguageOverride,
  removeLanguageOverride,
  local,
  downloadModel,
  deleteModel,
  diarize,
  downloadDiarize,
  deleteDiarize,
  sortformer,
  downloadSortformer,
  deleteSortformer,
  nemotron3 = EMPTY_DIARIZE_STATE,
  downloadNemotron3 = async () => {},
  deleteNemotron3 = async () => {},
}: Pick<
  SettingsHook,
  | "s"
  | "update"
  | "transcribeConfig"
  | "setDefaultConfig"
  | "setLanguageOverride"
  | "removeLanguageOverride"
  | "local"
  | "downloadModel"
  | "deleteModel"
  | "diarize"
  | "downloadDiarize"
  | "deleteDiarize"
  | "sortformer"
  | "downloadSortformer"
  | "deleteSortformer"
  | "nemotron3"
  | "downloadNemotron3"
  | "deleteNemotron3"
>) {
  useLocale();
  const def = transcribeConfig.default;

  return (
    <>
      <Section title={uiText("Transcription")}>
        <ProviderConfigForm
          value={def}
          onChange={setDefaultConfig}
          localModels={local.models}
          language={s.language}
        />
        {def.provider === "local" && !local.models.some((m) => m.downloaded) && (
          <p className="text-xs text-[var(--color-danger)] py-3">
            {uiText(" No local model is downloaded. Download one under Advanced below before recording. ")}</p>
        )}
        {def.provider !== "local" && def.provider !== "apple_speech" && (
          <ProviderKeyCard provider={def.provider as KeyProvider} />
        )}
        <Row
          label={uiText("Transcription language")}
          description={uiText("Default for new notes. Each note has its own language chip in the header that overrides this.")}
          control={
            <Select
              value={s.language}
              onChange={(v) => update("language", v)}
              options={LANGUAGES.map((l) => ({
                value: l.value,
                label: languageOptionLabel(l),
              }))}
            />
          }
        />
        <Disclosure label={uiText("Advanced")}>
          <div>
            <div className="text-sm">{uiText("Per-language overrides")}</div>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5 mb-3">
              {uiText(" Route specific recording languages to a different provider than the default above — e.g. NB Whisper for Norwegian, Deepgram Nova-3 for English. ")}</p>
            <PerLanguageOverrides
              config={transcribeConfig}
              setLanguageOverride={setLanguageOverride}
              removeLanguageOverride={removeLanguageOverride}
              local={local}
            />
          </div>
          <div>
            <div className="text-sm">{uiText("Local models")}</div>
            <LocalModelManager
              state={local}
              activeId={def.provider === "local" ? def.model_id : ""}
              language={s.language}
              onDownload={downloadModel}
              onDelete={deleteModel}
              setLanguageOverride={setLanguageOverride}
              onSelect={(id) => {
                // Selecting a local model from the manager pins it as the
                // default's model_id. If currently on a non-local default,
                // switch them to Local with this model — matches the v0.23
                // implicit behaviour of the radio button.
                if (def.provider === "local") {
                  setDefaultConfig({ ...def, model_id: id });
                } else {
                  setDefaultConfig({
                    provider: "local",
                    model_id: id,
                    preset: "quality",
                    use_gpu: true,
                  });
                }
              }}
            />
          </div>
          <div>
            <div className="text-sm">{uiText("Other API keys")}</div>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              {uiText(" Keys for providers used only by per-language overrides. ")}</p>
            {KEY_PROVIDERS.filter((p) => p !== def.provider).map((p) => (
              <ProviderKeyCard key={p} provider={p} />
            ))}
          </div>
        </Disclosure>
      </Section>

      <Section title={uiText("Speaker labels")}>
        <p className="text-xs text-[var(--color-text-muted)] py-3">
          {uiText(" When downloaded and active, every recording is automatically tagged with ")}<code>{uiText("Speaker 1:")}</code> / <code>{uiText("Speaker 2:")}</code>
          {uiText(" labels after stop. Models run locally via CoreML / Apple Neural Engine. Engine quality varies by language and recording conditions; review speaker labels before relying on them. ")}</p>
        <EngineOption
          label={uiText("Community-1 (clustering)")}
          description={uiText("Pyannote community-1 segmentation + WeSpeaker embeddings + VBx clustering. Smaller 22 MB model; auto-detects speaker count. It did not pass our current pinned Mandarin speaker-turn controls.")}
          checked={s.diarize_model === "community1"}
          disabled={!diarize.status?.downloaded}
          onPick={() => update("diarize_model", "community1")}
        >
          <DiarizeModelManager
            state={diarize}
            onDownload={downloadDiarize}
            onDelete={deleteDiarize}
          />
        </EngineOption>
        <EngineOption
          label={uiText("Sortformer (end-to-end)")}
          description={uiText("NVIDIA Sortformer running locally over the saved WAV. About 255 MB to download; fixed 4-speaker cap. Mandarin accuracy is not yet established across public real-world evaluations.")}
          checked={s.diarize_model === "sortformer"}
          disabled={!sortformer.status?.downloaded}
          onPick={() => update("diarize_model", "sortformer")}
        >
          <DiarizeModelManager
            state={sortformer}
            onDownload={downloadSortformer}
            onDelete={deleteSortformer}
          />
        </EngineOption>
        <EngineOption
          label={uiText("Nemotron 3 (experimental)")}
          description={uiText("NVIDIA Nemotron 3 fast128 diarization running locally. Experimental; quality and device compatibility are still being evaluated. Not selected by default.")}
          checked={s.diarize_model === "nemotron3"}
          disabled={!nemotron3.status?.downloaded}
          onPick={() => update("diarize_model", "nemotron3")}
        >
          <DiarizeModelManager state={nemotron3} onDownload={downloadNemotron3} onDelete={deleteNemotron3} />
        </EngineOption>
        <Disclosure label={uiText("Advanced")}>
          <ThresholdRow
            label={uiText("Community-1 clustering threshold")}
            description={uiText("Higher = more merging (fewer speakers); lower = more separation. Final labels also depend on the audio. Default 0.5. Community-1 only.")}
            value={s.community1_threshold}
            placeholder="0.5"
            onChange={(v) => update("community1_threshold", v)}
          />
          <ThresholdRow
            label={uiText("Sortformer silence threshold")}
            description={uiText("Sum of speaker probabilities below which a frame is treated as silence. Default 0.5.")}
            value={s.sortformer_silence_threshold}
            placeholder="0.5"
            onChange={(v) => update("sortformer_silence_threshold", v)}
          />
          <ThresholdRow
            label={uiText("End-to-end prediction threshold")}
            description={uiText("Speaker-probability threshold used by Sortformer and Nemotron 3. Default 0.25 for Sortformer; Nemotron 3 uses its own default unless changed here.")}
            value={s.sortformer_pred_threshold}
            placeholder="0.25"
            onChange={(v) => update("sortformer_pred_threshold", v)}
          />
          <ThresholdRow
            label={uiText("Silence RMS threshold")}
            description={uiText("Chunks quieter than this are skipped before transcription. A high threshold may cut quiet speech. Default 0.005.")}
            value={s.silence_rms_threshold}
            placeholder="0.005"
            onChange={(v) => update("silence_rms_threshold", v)}
          />
          <p className="text-xs text-[var(--color-text-muted)]">
            {uiText(" Tweaks apply on the next recording or re-diarize. Diagnostic JSON is dumped per run — open the Note's diagnostics folder from its header to inspect where shifts landed. ")}</p>
        </Disclosure>

        {/* Count-gated, so it is absent for a new install and gone for good once
            used (#116 part 2). In Transcription rather than Chat because the row
            is about what transcripts say. */}
        <RenameYouRow />
      </Section>

      <Section title={uiText("Vocabulary")}>
        <Row label={uiText("Custom terms")}>
          <textarea
            value={s.custom_vocabulary}
            onChange={(e) => update("custom_vocabulary", e.target.value)}
            rows={3}
            placeholder={uiText("Tauri, Humla, ScreenCaptureKit, Granola")}
            className={inputClass + " leading-relaxed"}
            style={{ fontFamily: "var(--font-mono)" }}
          />
          <p className="text-xs text-[var(--color-text-muted)] mt-2">
            {uiText(" Comma- or newline-separated. Names, jargon, and uncommon spellings — biases the transcriber toward these tokens. ")}<code> {uiText(" gpt-4o-transcribe-diarize ")}</code> {uiText(" ignores it. ")}</p>
        </Row>
      </Section>
    </>
  );
}
