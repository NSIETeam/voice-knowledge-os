import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ipc } from "../lib/ipc";

type Phase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "notConfigured" }
  | { kind: "current"; version: string }
  | { kind: "available"; currentVersion: string; latestVersion: string }
  | { kind: "error"; message: string };

export function Updater() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      setPhase({ kind: "checking" });
      try {
        const result = await ipc.updatesCheck();
        if (!mounted) return;
        if (!result.configured) {
          setPhase({ kind: "notConfigured" });
          return;
        }
        setPhase(
          result.updateAvailable
            ? {
                kind: "available",
                currentVersion: result.currentVersion,
                latestVersion: result.latestVersion ?? "",
              }
            : { kind: "current", version: result.currentVersion },
        );
      } catch (error) {
        if (mounted) {
          setPhase({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };

    const subscription = listen("menu://check-for-updates", () => void check());
    return () => {
      mounted = false;
      void subscription.then((unlisten) => unlisten());
    };
  }, []);

  if (phase.kind === "idle") return null;

  const title =
    phase.kind === "checking"
      ? "Checking for updates…"
      : phase.kind === "current"
        ? "HoneyVoice is up to date"
        : phase.kind === "notConfigured"
          ? "HoneyVoice releases are not configured yet"
        : phase.kind === "available"
          ? "A new version is available"
          : "Could not check for updates";

  const description =
    phase.kind === "checking"
      ? "Checking the latest public release."
      : phase.kind === "notConfigured"
        ? "HoneyVoice does not yet have an official update channel. Check back after its source and release repository are published."
      : phase.kind === "current"
        ? `You’re using version ${phase.version}.`
        : phase.kind === "available"
          ? `Version ${phase.latestVersion} is available (you have ${phase.currentVersion}). Download it from the release page.`
          : "Check your internet connection and try again later.";

  return (
    <div className="no-drag fixed bottom-6 right-6 z-[60] max-w-sm">
      <div className="px-4 py-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] shadow-md text-sm">
        <div className="font-medium mb-1">{title}</div>
        <div className="text-[var(--color-text-muted)] mb-3 break-words">{description}</div>
        {phase.kind !== "checking" && phase.kind !== "notConfigured" && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPhase({ kind: "idle" })}
              className="text-xs underline text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
