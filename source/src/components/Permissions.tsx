import { useEffect, useRef, useState } from "react";
import { ipc, type PermissionKind, type PermissionStatus, type PermissionsStatus } from "../lib/ipc";
import { useT } from "../lib/locale";

const LABEL: Record<PermissionKind, string> = {
  microphone: "Microphone",
  screen: "Screen Recording",
};

const HELP: Record<PermissionKind, string> = {
  microphone: "Required to record your voice.",
  screen: "Lets ScreenCaptureKit capture meeting audio. HoneyVoice does not record video.",
};

function statusLabel(
  s: PermissionStatus,
  adHocSignature: boolean,
): { text: string; tone: "ok" | "bad" | "muted" } {
  switch (s) {
    case "granted": return { text: "Granted", tone: "ok" };
    case "denied": return { text: adHocSignature ? "No access for this build" : "Denied", tone: "bad" };
    case "restricted": return { text: "Restricted", tone: "bad" };
    case "not_determined": return { text: adHocSignature ? "Not requested by this build" : "Not requested", tone: "muted" };
    default: return { text: "Unknown", tone: "muted" };
  }
}

export function Permissions() {
  const t = useT();
  const [status, setStatus] = useState<PermissionsStatus | null>(null);
  const [busy, setBusy] = useState<PermissionKind | null>(null);
  const [restartToRecheck, setRestartToRecheck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestRead = useRef(0);
  const requesting = useRef(false);

  async function refresh() {
    if (requesting.current) return;
    const generation = ++latestRead.current;
    try {
      const s = await ipc.permissionsStatus();
      if (generation !== latestRead.current) return;
      setStatus(s);
      setError(null);
    } catch {
      if (generation !== latestRead.current) return;
      setStatus(null);
      setError("Could not check recording access. Try again.");
    }
  }

  useEffect(() => {
    // No interval polling. Status calls query the capture helper so the value
    // comes from the same native process that requests and uses access.
    // Re-query when the user returns from System Settings instead of polling.
    refresh();
    const onFocus = () => {
      // Settings may stay mounted while the user switches to System Settings.
      // A mount-only read leaves the old denied value visible indefinitely.
      void refresh();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      latestRead.current++;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  async function request(kind: PermissionKind) {
    requesting.current = true;
    latestRead.current++;
    setBusy(kind);
    setError(null);
    try {
      const s = await ipc.permissionsRequest(kind);
      setStatus(s);
      // Screen recording adds the app to the privacy list on request, but it
      // can't be granted programmatically — open System Settings so the user
      // can toggle the switch.
      if (kind === "screen" && s.screen !== "granted") {
        setRestartToRecheck(true);
        await ipc.permissionsOpenSettings("screen");
      }
    } catch {
      setError("Permission request did not finish. Try again.");
    } finally {
      requesting.current = false;
      setBusy(null);
    }
  }

  async function open(kind: PermissionKind) {
    setRestartToRecheck(true);
    await ipc.permissionsOpenSettings(kind);
  }

  async function restart() {
    try {
      await ipc.relaunchApp();
    } catch (e) {
      console.warn("[permissions] failed to relaunch:", e);
    }
  }

  if (!status) return (
    <div className="flex flex-col gap-3">
      <p role={error ? "alert" : "status"}>{t(error || "Checking recording access…")}</p>
      {error && <button className="nd-btn" onClick={() => void refresh()}>{t("Check permissions again")}</button>}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {error && <p role="alert" className="text-xs text-[var(--color-danger)]">{t(error)}</p>}
      {(["microphone", "screen"] as PermissionKind[]).map((kind) => {
        const s = statusLabel(status[kind], status.adHocSignature);
        // Microphone can be prompted only when it's "not_determined". Screen
        // Recording always reports "denied" until CGRequestScreenCaptureAccess
        // has been called once — which is the call that adds the app to the
        // System Settings list. So allow Request whenever screen isn't granted.
        const showRequest =
          status[kind] === "not_determined" ||
          (kind === "screen" && status[kind] !== "granted");
        const showOpen = status[kind] !== "granted";
        return (
          <div
            key={kind}
            className="flex items-start justify-between gap-4 px-4 py-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)]"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{t(LABEL[kind])}</span>
                <span
                  className="nd-chip"
                  style={{
                    color:
                      s.tone === "ok"
                        ? "var(--color-success)"
                        : s.tone === "bad"
                        ? "var(--color-danger)"
                        : "var(--color-text-muted)",
                    borderColor:
                      s.tone === "ok"
                        ? "var(--color-success)"
                        : s.tone === "bad"
                        ? "var(--color-danger)"
                        : "var(--color-line-visible)",
                  }}
                >
                  {t(s.text)}
                </span>
              </div>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">{t(HELP[kind])}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              {showRequest && (
                <button
                  onClick={() => request(kind)}
                  disabled={busy !== null}
                  className="px-3 py-1.5 rounded-md text-sm border border-[var(--color-line-visible)] bg-[var(--color-surface)] hover:border-[var(--color-text)] disabled:opacity-50 transition-colors"
                >
                  {t(busy === kind ? "Requesting…" : "Request")}
                </button>
              )}
              {showOpen && (
                <button
                  onClick={() => open(kind)}
                  className="px-3 py-1.5 rounded-md text-sm border border-[var(--color-line-visible)] bg-[var(--color-surface)] hover:border-[var(--color-text)] transition-colors"
                >
                  {t("Open System Settings")}
                </button>
              )}
            </div>
          </div>
        );
      })}
      {status.adHocSignature &&
        (status.microphone === "denied" || status.screen === "denied") && (
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            {t("macOS may still have permission saved for an older HoneyVoice build. Keep one installed copy. If its switch is already on, remove the old HoneyVoice entry in System Settings and add the app at the location below, then restart HoneyVoice.")}
          </p>
        )}
      {status.appPath && <p className="text-xs text-[var(--color-text-muted)] break-all">{t("Running from")}: {status.appPath}</p>}
      <button className="nd-btn self-start" disabled={busy !== null} onClick={() => void refresh()}>{t("Check permissions again")}</button>
      {restartToRecheck && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3">
          <p className="text-xs text-[var(--color-text-muted)]">
            {t("After changing a permission in System Settings, restart HoneyVoice so macOS can recheck it.")}
          </p>
          <button onClick={restart} className="nd-btn nd-btn-primary shrink-0">
            {t("Restart HoneyVoice")}
          </button>
        </div>
      )}
      <p className="text-xs text-[var(--color-text-muted)] mt-1">
        {t("After enabling Screen Recording in System Settings, you must restart the app for the change to take effect.")}
      </p>
    </div>
  );
}
