import { useState } from "react";
import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useLocale, translate as uiText } from "../lib/locale";
import type { AudioIntegrityReport, NoteSession } from "../lib/ipc";
import { formatSessionCaption } from "../lib/sessions";

// Compact numbered-pill carousel for a note's recording sessions (#16),
// shown under a "Recording sessions" eyebrow above the transcript. Read-only
// in v1 — clicking a pill switches the player to that take (the parent
// handles scroll + seek-and-keep-playing). Matches the speaker-chip family
// (nd-label eyebrow + monospace pills). Hidden for single-session notes so
// the common case looks exactly as it did before this feature.
export function RecordingSessions({
  sessions,
  activeId,
  onSelect,
  onVerify,
}: {
  sessions: NoteSession[];
  activeId: string | null;
  onSelect: (sessionId: string) => void;
  onVerify: (sessionId: string) => Promise<AudioIntegrityReport>;
}) {
  useLocale();
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [result, setResult] = useState<{ sessionId: string; report: AudioIntegrityReport } | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  if (sessions.length === 0) return null;
  async function verify(sessionId: string) {
    setCheckingId(sessionId);
    setErrorId(null);
    try {
      setResult({ sessionId, report: await onVerify(sessionId) });
    } catch {
      setResult(null);
      setErrorId(sessionId);
    } finally {
      setCheckingId(null);
    }
  }
  const activeResult = result?.report ?? null;
  const resultSession = sessions.find((session) => session.id === result?.sessionId);
  const summary = activeResult
    ? !activeResult.ledgerPresent
      ? uiText("No source-audio ledger for this recording")
      : activeResult.streams.length === 0
        ? uiText("No source audio was captured")
        : activeResult.streams.every((stream) => stream.integrity.status === "match")
          ? uiText("Source audio integrity verified")
          : activeResult.streams.some((stream) => stream.integrity.status === "mismatch")
            ? uiText("Source audio differs from its capture record")
            : uiText("Source audio is not retained on this device")
      : errorId
      ? uiText("Could not verify source audio")
      : null;
  return (
    <div className="mb-4">
      <div className="nd-label mb-2">{uiText("Recording sessions")}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {sessions.map((s) => {
          const active = s.id === activeId;
          const reportForSession = result?.sessionId === s.id ? result.report : null;
          const hasMismatch = reportForSession?.streams.some((stream) => stream.integrity.status === "mismatch");
          return (
            <div key={s.id} className="inline-flex items-center gap-0.5">
              <button
                type="button"
                aria-label={`Recording session ${s.index}`}
                aria-pressed={active}
                title={formatSessionCaption(s)}
                onClick={() => onSelect(s.id)}
                className={
                  "inline-flex h-7 min-w-7 items-center justify-center rounded-md px-2 " +
                  "font-[family-name:var(--font-mono)] text-[12px] tracking-[0.04em] " +
                  "border transition-colors cursor-pointer " +
                  (active
                    ? "border-[color:var(--color-interactive)] bg-[color:var(--color-pill-hover)] text-[color:var(--color-interactive)]"
                    : "border-[color:var(--color-line-visible)] text-[color:var(--color-text-muted)] hover:bg-[var(--color-pill-hover)] hover:text-[var(--color-text)]")
                }
              >
                {s.index}
              </button>
              <button
                type="button"
                aria-label={`${uiText("Verify source-audio integrity")}: ${uiText("Recording")} ${s.index}`}
                title={uiText("Verify source-audio integrity")}
                disabled={checkingId !== null}
                onClick={() => void verify(s.id)}
                className="nd-bare inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-pill-hover)] hover:text-[var(--color-text)] disabled:opacity-50"
              >
                {checkingId === s.id ? (
                  <span className="text-[10px]">…</span>
                ) : hasMismatch ? (
                  <ShieldAlert size={14} strokeWidth={1.6} />
                ) : reportForSession?.ledgerPresent ? (
                  <ShieldCheck size={14} strokeWidth={1.6} />
                ) : (
                  <ShieldQuestion size={14} strokeWidth={1.6} />
                )}
              </button>
            </div>
          );
        })}
      </div>
      {summary && (
        <p role="status" className="mt-2 text-xs text-[var(--color-text-muted)]">
          {resultSession ? `${uiText("Recording sessions")} ${resultSession.index}: ` : ""}{summary}
        </p>
      )}
      {activeResult?.streams.some((stream) => stream.integrity.status === "mismatch") && (
        <details className="mt-1 text-xs text-[var(--color-text-muted)]">
          <summary className="cursor-pointer">{uiText("Show audio integrity details")}</summary>
          <ul className="mt-1 space-y-1 pl-4">
            {activeResult.streams.map((stream) => (
              <li key={stream.source} className="break-all">
                {uiText(stream.source === "mic" ? "Microphone" : "System audio")}: {uiText(
                  stream.integrity.status === "match"
                    ? "Verified"
                    : stream.integrity.status === "missing"
                      ? "File unavailable"
                      : "Mismatch",
                )}
                {stream.integrity.status === "mismatch" && (
                  <div className="font-[family-name:var(--font-mono)]">
                    {uiText("Expected")}: {stream.integrity.expectedSha256}<br />
                    {uiText("Current")}: {stream.integrity.actualSha256}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
