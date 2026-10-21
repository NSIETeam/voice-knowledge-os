import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Row, Section } from "../components/Section";
import { Select } from "../../../components/ui/Select";
import { Toggle } from "../components/Toggle";
import { SummaryPromptsManager } from "../components/SummaryPromptsManager";
import { OllamaConnect } from "../../../components/provider/OllamaConnect";
import { ProviderKeyCard } from "../../../components/provider/ProviderKeyCard";
import { MimoEndpointField } from "../../../components/provider/MimoEndpointField";
import { CommandSnippet } from "../../../components/CommandSnippet";
import { RECOMMENDED_OLLAMA_MODEL, RECOMMENDED_OLLAMA_MODEL_16GB } from "../../../lib/localModels";
import { SUMMARY_PRESETS, presetLabel } from "../../../lib/presets";
import { useCloudModels } from "../../../components/provider/useCloudModels";
import { useProviderKey } from "../../../components/provider/useProviderKey";
import { DEEPSEEK_MODELS, MIMO_MODELS, SUMMARY_MODELS, SUMMARY_PROVIDERS } from "../types";
import type { KeyProvider } from "../../../lib/providers";
import type { SettingsHook } from "../useSettings";
import { useT, formatMessage } from "../../../lib/locale";

export function SummaryTab({
  s,
  update,
}: Pick<SettingsHook, "s" | "update">) {
  const t = useT();
  const isLocal = s.summary_provider === "local";
  const isAnthropic = s.summary_provider === "anthropic";
  const cloudProvider: Extract<KeyProvider, "openai" | "deepseek" | "mimo"> =
    s.summary_provider === "deepseek" || s.summary_provider === "mimo"
      ? s.summary_provider
      : "openai";
  const isCloud = !isLocal && !isAnthropic;
  // Called unconditionally (rules of hooks) and inert until that provider is
  // the chosen one — neither the Keychain slot nor the model listing is
  // touched otherwise.
  const cloudKey = useProviderKey(cloudProvider, { enabled: isCloud });
  const cloudModels = useCloudModels(cloudProvider, cloudKey.hasKey, s.summary_model, {
    enabled: isCloud,
  });
  const anthropicKey = useProviderKey("anthropic", { enabled: isAnthropic });
  const anthropicModels = useCloudModels("anthropic", anthropicKey.hasKey, s.anthropic_model, {
    enabled: isAnthropic,
  });

  return (
    <>
      <Section title="Summaries">
        <Row
          label="Provider"
          description="Local keeps the transcript on your Mac. Cloud providers such as OpenAI, DeepSeek, MiMo, and Anthropic send it to the provider you choose."
          control={
            <Select
              value={s.summary_provider}
              onChange={(v) => {
                void update("summary_provider", v);
                const compatible =
                  (v === "deepseek" && s.summary_model.startsWith("deepseek-")) ||
                  (v === "mimo" && s.summary_model.startsWith("mimo-")) ||
                  (v === "openai" && !s.summary_model.startsWith("deepseek-") && !s.summary_model.startsWith("mimo-"));
                if (!compatible) {
                  const fallback =
                    v === "deepseek" ? DEEPSEEK_MODELS[0] : v === "mimo" ? MIMO_MODELS[0] : SUMMARY_MODELS[0];
                  void update("summary_model", fallback);
                }
              }}
              options={SUMMARY_PROVIDERS.map((provider) => ({ ...provider, label: t(provider.label) }))}
            />
          }
        />

        {isCloud && (
          <>
            <Row
              label="Model"
              description={formatMessage("Choose a model supported by {provider}.", { provider: cloudProvider === "openai" ? "OpenAI" : cloudProvider === "deepseek" ? "DeepSeek" : "MiMo" })}
              control={
                <Select
                  value={s.summary_model}
                  onChange={(v) => update("summary_model", v)}
                  options={cloudModels}
                />
              }
            />
            {cloudProvider === "mimo" && (
              <MimoEndpointField value={s.mimo_base_url} onSave={(value) => update("mimo_base_url", value)} />
            )}
            <ProviderKeyCard provider={cloudProvider} />
          </>
        )}

        {isAnthropic && (
          <>
            <Row
              label="Model"
              description="Claude models. Each model's own adaptive thinking decides how much it reasons."
              control={
                <Select
                  value={s.anthropic_model}
                  onChange={(v) => update("anthropic_model", v)}
                  options={anthropicModels}
                />
              }
            />
            <ProviderKeyCard provider="anthropic" />
          </>
        )}

        {isLocal && (
          <>
            <OllamaConnect
              baseUrl={s.local_llm_base_url}
              onBaseUrlChange={(v) => update("local_llm_base_url", v)}
              model={s.local_llm_model}
              onModelChange={(v) => update("local_llm_model", v)}
            />
            <div className="py-3 space-y-2">
              <p className="text-xs text-[var(--color-text-muted)]">
                {t("Works with Ollama, LM Studio (")}<code>http://localhost:1234/v1</code>{t("), llama-server, and vLLM. Don't have one yet?")}{" "}
                <button
                  type="button"
                  onClick={() => openExternal("https://ollama.com/download")}
                  className="underline hover:text-[var(--color-text)]"
                >
                  {t("Install Ollama")}
                </button>
                {t(", then pull the recommended model:")}
              </p>
              <CommandSnippet
                command={`ollama pull ${RECOMMENDED_OLLAMA_MODEL}`}
                ariaLabel={t("Copy Ollama pull command")}
              />
              <p className="text-xs text-[var(--color-text-muted)]">
                {t("For a smaller model, use ")}<code>ollama pull {RECOMMENDED_OLLAMA_MODEL_16GB}</code>{t(". Choose a model that fits your available memory; long recordings need more headroom.")}
              </p>
            </div>
            <Row
              label="Thinking mode"
              description="Qwen 3+ reasons internally before answering — sometimes higher quality, but can take many minutes on a long meeting. Ollama only; other servers ignore it."
              control={
                <Toggle
                  label={t("Enable thinking mode")}
                  checked={s.local_llm_think === "true"}
                  onChange={(on) =>
                    update("local_llm_think", on ? "true" : "false")
                  }
                />
              }
            />
          </>
        )}

        <Row
          label="Default preset"
          description='Which preset new notes start with. Each note can switch to a different preset (or "Custom") from its own header.'
          control={
            <Select
              value={s.default_summary_preset}
              onChange={(v) => update("default_summary_preset", v)}
              options={SUMMARY_PRESETS.map((p) => ({
                value: p.value,
                label: presetLabel(p),
              }))}
            />
          }
        />
      </Section>

      <Section title="Summary prompts">
        <SummaryPromptsManager language={s.language} />
      </Section>
    </>
  );
}
