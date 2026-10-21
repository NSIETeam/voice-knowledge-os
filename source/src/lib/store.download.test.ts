import { describe, expect, it } from "vitest";
import { emit } from "@tauri-apps/api/event";
import { mockTauri } from "../test/tauri";
import { bindBackendListeners, useDownloadStore } from "./store";
import { modelDownloadComplete } from "./ipc";

describe("verified model downloads", () => {
  it("only clears global progress after the installed completion event", async () => {
    mockTauri({}, { events: true });
    useDownloadStore.getState().clear();
    bindBackendListeners();
    // Let async event registration finish before the backend starts emitting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const p = { modelId: "medium-q5", received: 100, total: 100, source: "ModelScope" };
    await emit("local_whisper_progress", { ...p, phase: "downloading" });
    expect(useDownloadStore.getState().active?.phase).toBe("downloading");
    await emit("local_whisper_progress", { ...p, phase: "verifying" });
    expect(useDownloadStore.getState().active?.phase).toBe("verifying");
    await emit("local_whisper_download_error", { modelId: p.modelId, message: "SHA-256 mismatch" });
    expect(useDownloadStore.getState().active).toBeNull();
    expect(useDownloadStore.getState().error?.message).toBe("SHA-256 mismatch");
    await emit("local_whisper_progress", { ...p, received: 0, phase: "connecting" });
    expect(useDownloadStore.getState().error).toBeNull();
    await emit("local_whisper_progress", { ...p, phase: "complete" });
    expect(useDownloadStore.getState().active).toBeNull();
  });
  it("recognizes legacy completion but never treats modern byte completion as installation", () => {
    const p = { modelId: "medium-q5", received: 100, total: 100 };
    expect(modelDownloadComplete(p)).toBe(true);
    expect(modelDownloadComplete({ ...p, phase: "downloading" })).toBe(false);
    expect(modelDownloadComplete({ ...p, phase: "verifying" })).toBe(false);
    expect(modelDownloadComplete({ ...p, phase: "complete" })).toBe(true);
  });
});
