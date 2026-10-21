import { useEffect, useRef, useState } from "react";
import { ipc, type LocalWhisperModelStatus, type ModelDownloadSource } from "../../lib/ipc";
import { useDownloadStore } from "../../lib/store";
import { useT } from "../../lib/locale";
import { formatBytes } from "../../pages/settings/components/format";
import { Btn } from "../../pages/settings/components/Btn";
import { Select } from "../ui/Select";

// The global event stream outlives this card. A byte count of 100% is NOT
// completion; the backend verifies and atomically installs before clearing it.
export function ModelDownloadCard({
  model, onChanged, tag, selected, onSelect, warning, onDownload, onDelete,
}: {
  model: LocalWhisperModelStatus;
  onChanged?: () => void;
  tag?: string;
  selected?: boolean;
  onSelect?: () => void;
  warning?: string;
  onDownload?: (modelId: string, source: ModelDownloadSource) => void | Promise<void>;
  onDelete?: (modelId: string) => void | Promise<void>;
}) {
  const t = useT();
  const [source, setSource] = useState<ModelDownloadSource>("auto");
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const active = useDownloadStore((s) => s.active);
  const error = useDownloadStore((s) => s.error);
  const mine = active?.modelId === model.id ? active : null;
  const failure = error?.modelId === model.id ? error.message : null;
  const wasMine = useRef(false);
  useEffect(() => {
    if (mine) {
      wasMine.current = true;
    } else if (wasMine.current) {
      wasMine.current = false;
      onChanged?.();
    }
  }, [mine, onChanged]);

  async function download() {
    // Claim immediately, before the first network event, so two cards/clicks
    // cannot race. The backend has its own lock for non-UI callers as well.
    if (useDownloadStore.getState().active) return;
    setActionError(null);
    useDownloadStore.getState().setProgress({
      modelId: model.id, received: 0, total: model.sizeBytesHint, phase: "connecting",
    });
    try {
      if (onDownload) await onDownload(model.id, source);
      else await ipc.localWhisperDownload(model.id, source);
    } catch (e) {
      if (useDownloadStore.getState().active?.modelId === model.id) {
        useDownloadStore.getState().fail({ modelId: model.id, message: String(e) });
      } else {
        setActionError(String(e));
      }
    }
  }

  async function deleteModel() {
    if (deleting || useDownloadStore.getState().active) return;
    setDeleting(true);
    setActionError(null);
    try {
      if (onDelete) await onDelete(model.id);
      else {
        await ipc.localWhisperDelete(model.id);
        onChanged?.();
      }
    } catch (e) {
      setActionError(String(e));
    } finally {
      setDeleting(false);
    }
  }

  const pct = mine && mine.total ? Math.min(100, Math.round((mine.received / mine.total) * 100)) : null;
  const progressLabel = mine?.phase === "connecting" ? t("Connecting…")
    : mine?.phase === "verifying" ? t("Verifying…")
    : t("Downloading — {progress}", { progress: pct !== null ? `${pct}%` : formatBytes(mine?.received ?? 0) });

  return (
    <div className="py-3.5 flex items-start gap-3">
      {onSelect && (
        <input type="radio" checked={!!selected} disabled={!model.downloaded}
          onChange={onSelect} className="mt-1 shrink-0"
          aria-label={t("Use {model}", { model: t(model.label) })} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span>{t(model.label)}</span>
          {tag && <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-pill-hover)] text-[var(--color-text-muted)]">{t(tag)}</span>}
          {selected && model.downloaded && <span className="text-xs text-[var(--color-text-muted)]">{t("· active")}</span>}
        </div>
        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{t(model.description)}</p>
        <p className="text-xs text-[var(--color-text-muted)] mt-1" aria-live="polite">
          {mine ? progressLabel
            : model.downloaded ? t("Downloaded · {size}", { size: formatBytes(model.sizeBytes ?? model.sizeBytesHint) })
              : t("Not downloaded · ~{size}", { size: formatBytes(model.sizeBytesHint) })}
          {mine?.source && ` · ${mine.source}`}
        </p>
        {!model.downloaded && (
          <div className="mt-2">
            <label className="text-xs text-[var(--color-text-muted)]">
              {t("Download source")}
              <Select value={source} onChange={(value) => setSource(value as ModelDownloadSource)}
                ariaLabel={t("Download source")} disabled={active !== null} className="ml-2 text-xs"
                options={[
                  { value: "auto", label: t("Automatic (mirrors first)") },
                  { value: "official", label: t("Official (Hugging Face)") },
                  { value: "mirror", label: t("Mirrors only") },
                ]} />
            </label>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              {t("Automatic uses matching mirrors first; every source must pass SHA-256 verification.")}
            </p>
          </div>
        )}
        {warning && !mine && <p className="text-xs text-[var(--color-warning)] mt-1">{t(warning)}</p>}
        {model.integrityError && !mine && (
          <p className="text-xs text-[var(--color-warning)] mt-1">{t("Model file failed verification. Download again to repair it.")}</p>
        )}
        {(failure || actionError) && !mine && (
          <div role="alert" className="text-xs text-[var(--color-danger)] mt-2 break-words">
            {failure && <p>{t("Download failed. Change the source or retry.")}</p>}
            <p>{actionError ?? failure}</p>
          </div>
        )}
        {mine && (
          <div role="progressbar" aria-label={progressLabel} aria-valuenow={pct ?? undefined}
            aria-valuemin={0} aria-valuemax={100}
            className="mt-2 h-1 w-48 rounded-full bg-[var(--color-pill-hover)] overflow-hidden">
            <div className="h-full bg-[var(--color-accent)] transition-[width]" style={{ width: `${pct ?? 0}%` }} />
          </div>
        )}
      </div>
      <div className="shrink-0">
        {model.downloaded ? (
          <Btn onClick={deleteModel} disabled={deleting || active !== null}>{t(deleting ? "Deleting…" : "Delete")}</Btn>
        ) : (
          <Btn onClick={download} disabled={active !== null}>
            {t(mine ? (mine.phase === "verifying" ? "Verifying…" : "Downloading…") : failure ? "Retry" : "Download")}
          </Btn>
        )}
      </div>
    </div>
  );
}
