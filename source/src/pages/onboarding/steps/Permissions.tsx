// Step 2 — Permissions (design/ONBOARDING.md § 2. Permissions).
//
// Deliberately the FIRST real step: microphone access is required before
// recording. System-audio permission is checked by macOS at capture time.
// One screen, two rows:
//
//   - Microphone (required)   — native prompt via permissions_request. The
//     Continue button is gated on this; the wizard can't record without it.
//   - Screen Recording access (skippable) — ScreenCaptureKit uses this grant
//     for HoneyVoice's audio-only meeting stream. This status is specifically
//     CGPreflightScreenCaptureAccess, not the separate Core Audio AudioCapture
//     permission used by Core Audio process taps (which HoneyVoice does not use).
import { useEffect, useRef, useState } from "react";
import { ShieldCheck, Mic, MonitorSpeaker, RotateCw, ArrowRight } from "lucide-react";
import { ipc, type PermissionStatus, type PermissionsStatus } from "../../../lib/ipc";
import type { StepContext } from "../types";
import { StepShell } from "../StepShell";
import { useT } from "../../../lib/locale";

type Tone = "ok" | "bad" | "muted";

function pill(status: PermissionStatus, adHocSignature: boolean): { text: string; tone: Tone } {
  switch (status) {
    case "granted":
      return { text: "Granted", tone: "ok" };
    case "denied":
      return { text: adHocSignature ? "No access for this build" : "Denied", tone: "bad" };
    case "restricted":
      return { text: "Restricted", tone: "bad" };
    case "not_determined":
      return { text: "Not requested", tone: "muted" };
    default:
      return { text: "Unknown", tone: "muted" };
  }
}

function pillColors(tone: Tone): { color: string; borderColor: string } {
  switch (tone) {
    case "ok":
      return { color: "var(--color-success)", borderColor: "var(--color-success)" };
    case "bad":
      return { color: "var(--color-danger)", borderColor: "var(--color-danger)" };
    default:
      return {
        color: "var(--color-text-muted)",
        borderColor: "var(--color-line-visible)",
      };
  }
}

function StatusPill({ status, adHocSignature }: { status: PermissionStatus; adHocSignature: boolean }) {
  const t = useT();
  const p = pill(status, adHocSignature);
  return (
    <span className="nd-chip" style={pillColors(p.tone)}>
      {t(p.text)}
    </span>
  );
}

export function PermissionsStep({ ctx }: { ctx: StepContext }) {
  const t = useT();
  const [status, setStatus] = useState<PermissionsStatus | null>(null);
  const [busy, setBusy] = useState<"microphone" | "screen" | null>(null);
  const [restartToRecheck, setRestartToRecheck] = useState(false);

  // The restart heuristic's memory. `screenGrantedAtMount` is captured from the
  // FIRST status read; if screen was already granted when we arrived, no restart
  // is ever needed (it took effect on a previous run / relaunch). If it wasn't,
  // and it later flips to granted, `needsRestart` latches true.
  const screenGrantedAtMount = useRef<boolean | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);

  async function refresh() {
    try {
      const s = await ipc.permissionsStatus();
      // Record the mount-time screen state exactly once, on the first read.
      if (screenGrantedAtMount.current === null) {
        screenGrantedAtMount.current = s.screen === "granted";
      }
      // Latch the restart requirement: not-granted at mount, granted now.
      if (screenGrantedAtMount.current === false && s.screen === "granted") {
        setNeedsRestart(true);
      }
      setStatus(s);
    } catch {
      // Sidecar may be absent in some build configs — leave prior state intact.
    }
  }

  useEffect(() => {
    // Persist the resume cursor immediately so a relaunch (either our button or
    // System Settings' own "Quit & Reopen") lands back on this step showing the
    // granted state. The shell already writes the cursor when navigating here,
    // but the spec requires the step itself to guarantee it *before* any restart
    // affordance can be reached — so we write through defensively on mount.
    ipc.setSetting("onboarding_step", "permissions").catch((e) => {
      console.warn("[onboarding] failed to persist step:", e);
    });

    // No interval polling — every status call re-spawns the audio-capture
    // sidecar (shared binary, `status` subcommand). macOS only changes TCC
    // state via a trip through System Settings, and returning from there fires
    // the focus event. Mirrors src/components/Permissions.tsx.
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  async function requestMic() {
    setBusy("microphone");
    try {
      const s = await ipc.permissionsRequest("microphone");
      setStatus(s);
    } catch {
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function enableScreen() {
    setBusy("screen");
    // ScreenCaptureKit/TCC can keep reporting the pre-Settings result until
    // this process is relaunched. Remember that the user visited Settings so
    // we can offer a recheck even when the stale preflight stays denied.
    setRestartToRecheck(true);
    try {
      // Requesting registers the app in the Screen Recording list (it can't be
      // granted programmatically), then we open System Settings so the user can
      // flip the switch. Returning fires the focus re-poll above.
      const s = await ipc.permissionsRequest("screen");
      setStatus(s);
      if (s.screen !== "granted") {
        await ipc.permissionsOpenSettings("screen");
      }
    } catch {
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function openMicSettings() {
    setRestartToRecheck(true);
    try {
      await ipc.permissionsOpenSettings("microphone");
    } catch (e) {
      console.warn("[onboarding] failed to open settings:", e);
    }
  }

  async function doRestart() {
    try {
      await ipc.relaunchApp();
    } catch (e) {
      console.warn("[onboarding] relaunch failed:", e);
    }
  }

  // First status read still in flight — keep the shell chrome stable.
  if (!status) {
    return (
      <StepShell
        icon={<ShieldCheck size={26} strokeWidth={1.6} />}
        title={t("Grant recording permissions")}
        subtitle={t("HoneyVoice needs microphone access to record. System audio is optional.")}
      />
    );
  }

  const micGranted = status.microphone === "granted";
  const micBlocked =
    status.microphone === "denied" || status.microphone === "restricted";
  const screenGranted = status.screen === "granted";

  return (
    <StepShell
      icon={<ShieldCheck size={26} strokeWidth={1.6} />}
      title={t("Grant recording permissions")}
      subtitle={t("HoneyVoice needs microphone access to record. System audio is optional — grant it only if you record remote calls.")}
    >
      <div className="w-full max-w-md flex flex-col gap-3 text-left">
        {/* Microphone — required */}
        <div className="rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3.5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Mic
                  size={16}
                  strokeWidth={1.8}
                  className="shrink-0 text-[var(--color-text-muted)]"
                />
                <span className="text-sm font-semibold text-[var(--color-text)]">
                  {t("Microphone")}
                </span>
                <StatusPill status={status.microphone} adHocSignature={status.adHocSignature} />
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-text-muted)]">
                {t("Required — captures your voice. HoneyVoice can't record without it.")}
              </p>
              {status.adHocSignature && status.microphone !== "granted" && (
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-warning-text)]">
                  {t("macOS may show enabled permission switches for a different app build. This build has a temporary signature, so it may not inherit those grants. A stable signed HoneyVoice release keeps the same app identity across updates.")}
                </p>
              )}
              {micBlocked && (
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-danger)]">
                  {t(status.adHocSignature
                    ? "This temporary build cannot use a permission grant associated with another app build. A stable signed HoneyVoice build is needed to preserve access."
                    : "Microphone access was declined. Enable it in System Settings, then return here.")}
                </p>
              )}
            </div>
            <div className="shrink-0">
              {micGranted ? null : micBlocked ? (
                <button
                  type="button"
                  onClick={openMicSettings}
                  className="nd-btn"
                >
                  {t("Open System Settings")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={requestMic}
                  disabled={busy !== null}
                  className="nd-btn nd-btn-primary"
                >
                  {t(busy === "microphone" ? "Requesting…" : "Allow microphone")}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Screen Recording — skippable for mic-only / in-person use */}
        <div className="rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3.5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <MonitorSpeaker
                  size={16}
                  strokeWidth={1.8}
                  className="shrink-0 text-[var(--color-text-muted)]"
                />
                <span className="text-sm font-semibold text-[var(--color-text)]">
                  {t("Screen Recording")}
                </span>
                <StatusPill status={status.screen} adHocSignature={status.adHocSignature} />
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-text-muted)]">
                {t("macOS asks for Screen Recording access to capture system audio. HoneyVoice never records screen video.")}
              </p>
              {status.adHocSignature && status.screen === "denied" && (
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-warning-text)]">
                  {t("macOS may show enabled permission switches for a different app build. This build has a temporary signature, so it may not inherit those grants. A stable signed HoneyVoice release keeps the same app identity across updates.")}
                </p>
              )}
            </div>
            <div className="shrink-0">
              {!screenGranted && (
                <button
                  type="button"
                  onClick={enableScreen}
                  disabled={busy !== null}
                  className="nd-btn"
                >
                  {t(busy === "screen" ? "Opening…" : "Enable Screen Recording")}
                </button>
              )}
          </div>
        </div>
        {status.adHocSignature &&
          (status.microphone !== "granted" || status.screen !== "granted") && (
            <p className="px-1 text-xs leading-relaxed text-[var(--color-warning-text)]">
              {t("macOS may still have permission saved for an older HoneyVoice build. Keep one installed copy. If its switch is already on, remove the old HoneyVoice entry in System Settings and add the app at the location below, then restart HoneyVoice.")}
            </p>
          )}
        {status.appPath && <p className="px-1 text-xs break-all">{t("Running from")}: {status.appPath}</p>}

          {/* Restart affordance — only when a grant during this run needs a
              relaunch to take effect. */}
          {(needsRestart || restartToRecheck) && (
            <div
              className="mt-3 rounded-[var(--radius)] px-3 py-3 flex items-start justify-between gap-4"
              style={{ background: "var(--color-accent-soft)" }}
            >
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[var(--color-warning-text)]">
                  {t("Restart required")}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
                  {t(needsRestart
                    ? "Screen Recording access was just enabled. HoneyVoice needs to restart for it to take effect — you'll return right here."
                    : "After changing a permission in System Settings, restart HoneyVoice so macOS can recheck it.")}
                </p>
              </div>
              <button
                type="button"
                onClick={doRestart}
                className="nd-btn nd-btn-primary shrink-0"
              >
                <RotateCw size={14} strokeWidth={2} />
                {t("Restart HoneyVoice")}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Continue — gated on microphone, and on a pending restart: letting the
          user walk past the restart would ship them into their first meeting
          with system audio silently broken for this run. */}
      <div className="mt-8 w-full max-w-md flex flex-col items-center gap-3">
        <button
          type="button"
          className="nd-btn nd-btn-primary"
          disabled={!micGranted || needsRestart || restartToRecheck}
          onClick={ctx.goNext}
        >
          {t("Continue")}
          <ArrowRight size={15} strokeWidth={2} />
        </button>

        {!micGranted && (
          <p className="text-xs text-[var(--color-text-muted)] text-center max-w-xs">
            {t("Allow microphone access to continue — HoneyVoice can't record without it.")}
          </p>
        )}

        {/* Escape hatch: for the impatient, and for the case where relaunch()
            itself fails. Carries its consequence. */}
        {micGranted && (needsRestart || restartToRecheck) && (
          <button
            type="button"
            onClick={ctx.goNext}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors text-center max-w-sm leading-relaxed"
          >
            {t("Continue without restarting")}
            <span className="block text-[var(--color-text-disabled)]">
              {t(needsRestart
                ? "System audio won't work until you quit and reopen HoneyVoice."
                : "You can continue without restarting, but HoneyVoice may keep showing the old permission status until the next launch.")}
            </span>
          </button>
        )}

        {/* System-audio skip — carries its consequence. Advances; never blocks. */}
        {micGranted && !screenGranted && (
          <button
            type="button"
            onClick={ctx.goNext}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors text-center max-w-sm leading-relaxed"
          >
            {t("Skip — I only record in-person meetings.")}
            <span className="block text-[var(--color-text-disabled)]">
              {t("Remote call audio won't be captured. You can enable it later in Settings.")}
            </span>
          </button>
        )}
      </div>
    </StepShell>
  );
}
