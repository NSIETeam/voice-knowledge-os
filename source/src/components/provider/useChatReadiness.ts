import { useEffect, useState } from "react";
import { ipc } from "../../lib/ipc";
import { DEFAULTS } from "../../pages/settings/types";
import { isEmbeddingModel, isOllamaUrl } from "../../lib/localModels";
import { useOllamaProbe } from "./useOllamaProbe";
import { useProviderKey } from "./useProviderKey";
import { translate as t, formatMessage, useLocale } from "../../lib/locale";
import { subscribeSettingChanges } from "../../lib/settingsBus";

/** What still stands between a local chat provider and a working chat, or `""`
 *  when nothing does. Shared by the Settings tab and the Note pane so the two
 *  can't answer the same question differently; `where` is the only thing that
 *  varies, since one reader has the controls in front of them and the other
 *  does not.
 *
 *  Off Ollama's port the runtime is LM Studio, llama-server, vLLM or mlx, so
 *  the advice names the server the user actually runs (#179) — `ollama pull` is
 *  not a command they have. */
export function localChatHint({
  reachable,
  installed,
  model,
  baseUrl,
  where,
}: {
  reachable: boolean | null;
  installed: string[] | null;
  model: string;
  baseUrl: string;
  where: "above" | "settings";
}): string {
  const at = t(where === "above" ? "above" : "in Settings → Chat");
  if (reachable === false)
    return isOllamaUrl(baseUrl)
      ? t("Start or install Ollama — it's detected automatically.")
      : formatMessage("Couldn't reach the local server at {url} — start it, or check the URL {where}.", { url: baseUrl, where: at });
  if (!model) return formatMessage("Choose a chat model {where}.", { where: at });
  if (isEmbeddingModel(model)) return formatMessage("“{model}” is an embedding model — pick a chat model {where}.", { model, where: at });
  if (installed && !installed.includes(model))
    return isOllamaUrl(baseUrl)
      ? formatMessage("“{model}” isn't installed on the server — run ollama pull {model}.", { model })
      : formatMessage("“{model}” isn't one of the models the local server lists — pick another {where}.", { model, where: at });
  if (reachable === null) return t("Checking the local server…");
  return "";
}

/** The same ladder for a cloud provider: a key, then a model. One copy, so the
 *  Settings tab and the Note pane can't answer differently.
 *
 *  `requireModel` is off for the pane: both cloud resolvers fall back to a
 *  default model, so an unset one is not something the reader has to fix —
 *  and the pane has no picker to fix it with. */
export function cloudChatHint({
  hasKey,
  model,
  providerLabel,
  where,
  requireModel = true,
}: {
  hasKey: boolean;
  model: string;
  providerLabel: string;
  where: "above" | "settings";
  requireModel?: boolean;
}): string {
  const at = t(where === "above" ? "above" : "in Settings → Chat");
  if (!hasKey) return formatMessage("Add your {provider} key {where} to use chat.", { provider: providerLabel, where: at });
  if (requireModel && !model) return formatMessage("Choose a chat model {where}.", { where: at });
  return "";
}

// Chat readiness for the Note's Chat tab (issue #44): what's still missing
// before a chat can run, so the panel shows a setup prompt instead of a dead
// input. Settings opens over a pinned Note view, so its committed changes
// must reach this hook without a remount. Every provider hook runs
// unconditionally (rules of hooks); the local probe parks itself on cloud chat.
export function useChatReadiness() {
  useLocale();
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState(DEFAULTS.chat_provider);
  const [model, setModel] = useState(DEFAULTS.chat_model);
  const [baseUrl, setBaseUrl] = useState(DEFAULTS.local_llm_base_url);

  useEffect(() => {
    let cancelled = false;
    const changed = new Set<string>();
    const unsubscribe = subscribeSettingChanges(({ key, value }) => {
      changed.add(key);
      if (key === "chat_provider") setProvider(value || DEFAULTS.chat_provider);
      if (key === "chat_model") setModel(value);
      if (key === "local_llm_base_url") setBaseUrl(value || DEFAULTS.local_llm_base_url);
    });
    Promise.all([
      ipc.getSetting("chat_provider"),
      ipc.getSetting("chat_model"),
      ipc.getSetting("local_llm_base_url"),
    ])
      .then(([p, m, b]) => {
        if (cancelled) return;
        // A late initial snapshot must not overwrite a newer committed setting.
        if (!changed.has("chat_provider")) setProvider(p || DEFAULTS.chat_provider);
        if (!changed.has("chat_model")) setModel(m ?? DEFAULTS.chat_model);
        if (!changed.has("local_llm_base_url")) setBaseUrl(b || DEFAULTS.local_llm_base_url);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const isOllama = provider === "ollama";
  const isAnthropic = provider === "anthropic";
  const cloudProvider = provider === "deepseek" || provider === "mimo" ? provider : "openai";
  const key = useProviderKey(cloudProvider, { enabled: !loading && !isOllama && !isAnthropic });
  const anthropicKey = useProviderKey("anthropic", { enabled: !loading && isAnthropic });
  const { reachable, installed } = useOllamaProbe(baseUrl, { enabled: !loading && isOllama });
  // "Still reading Keychain" is not "no key". Keep the composer mounted while
  // this resolves; otherwise a transient setup pane discards focus/DOM state.
  const pending = loading || (!isOllama && (isAnthropic ? anthropicKey.loading : key.loading));

  let ready = false;
  let hint = "";
  if (pending) {
    hint = "";
  } else if (isOllama) {
    hint = localChatHint({ reachable, installed, model, baseUrl, where: "settings" });
    ready = hint === "";
  } else {
    hint = cloudChatHint({
      hasKey: isAnthropic ? anthropicKey.hasKey : key.hasKey,
      model,
      providerLabel: isAnthropic ? "Anthropic" : cloudProvider === "openai" ? "OpenAI" : cloudProvider === "deepseek" ? "DeepSeek" : "MiMo",
      where: "settings",
      requireModel: false,
    });
    ready = hint === "";
  }

  return { loading: pending, ready, hint, provider, model, baseUrl };
}
