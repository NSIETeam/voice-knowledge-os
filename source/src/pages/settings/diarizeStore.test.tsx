import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockTauri } from "../../test/tauri";
import { setLocale } from "../../lib/locale";
import { useSettings } from "./useSettings";
import { useDiarizeStore } from "./diarizeStore";
import { EMPTY_DIARIZE_STATE } from "./types";
import { DiarizeModelManager } from "./components/DiarizeModelManager";

const absent = { downloaded: false, sizeBytes: 0, path: null };
const ready = { downloaded: true, sizeBytes: 1000, path: "/model-test" };
beforeEach(() => {
  setLocale("en-US");
  useDiarizeStore.setState({ models: { community1: { ...EMPTY_DIARIZE_STATE }, sortformer: { ...EMPTY_DIARIZE_STATE }, nemotron3: { ...EMPTY_DIARIZE_STATE } }, revisions: { community1: 0, sortformer: 0, nemotron3: 0 } });
});

describe("speaker model lifecycle across Settings visits", () => {
  it("retains progress on remount, prevents a second writer, then shows completion", async () => {
    let finish!: (value: null) => void;
    let downloaded = false;
    const request = vi.fn(() => new Promise<null>((resolve) => { finish = resolve; }));
    mockTauri({ diarize_download: request, diarize_status: () => downloaded ? ready : absent });
    const first = renderHook(() => useSettings());
    let operation!: Promise<void>;
    act(() => { operation = first.result.current.downloadDiarize("mirror"); });
    await waitFor(() => expect(request).toHaveBeenCalledWith({ engine: "community1", source: "mirror" }));
    first.unmount();
    const second = renderHook(() => useSettings());
    expect(second.result.current.diarize.downloading).toBe(true);
    await act(async () => { await second.result.current.downloadDiarize("official"); });
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => { downloaded = true; finish(null); await operation; });
    expect(second.result.current.diarize.downloading).toBe(false);
    expect(second.result.current.diarize.status).toEqual(ready);
    expect(second.result.current.diarize.flash).toBe("Community-1 model downloaded");
  });

  it("keeps failure and retry available after the initiating view is gone", async () => {
    let fail!: (reason: Error) => void;
    mockTauri({ diarize_download: () => new Promise((_, reject) => { fail = reject; }), diarize_status: () => absent });
    const first = renderHook(() => useSettings());
    let operation!: Promise<void>;
    act(() => { operation = first.result.current.downloadSortformer(); });
    await waitFor(() => expect(fail).toBeDefined());
    first.unmount();
    const second = renderHook(() => useSettings());
    await act(async () => { fail(new Error("mirror unavailable")); await operation; });
    expect(second.result.current.sortformer.downloading).toBe(false);
    expect(second.result.current.sortformer.error).toContain("mirror unavailable");
    expect(second.result.current.diarize.error).toBeNull();
  });

  it("downloads Nemotron through its own engine channel and retains the existing engine states", async () => {
    const request = vi.fn();
    mockTauri({
      diarize_download: request,
      diarize_status: (args) => (args as { engine: string }).engine === "nemotron3" ? ready : absent,
    });
    const hook = renderHook(() => useSettings());
    await waitFor(() => expect(hook.result.current.nemotron3.status).toEqual(ready));

    await act(async () => { await hook.result.current.downloadNemotron3("mirror"); });

    expect(request).toHaveBeenCalledWith({ engine: "nemotron3", source: "mirror" });
    expect(hook.result.current.nemotron3.status).toEqual(ready);
    expect(hook.result.current.nemotron3.flash).toBe("Nemotron 3 model downloaded");
    expect(hook.result.current.diarize.status).toEqual(absent);
    expect(hook.result.current.sortformer.status).toEqual(absent);
  });

  it("rejects a stale initial status response after a successful download", async () => {
    let initial!: (value: typeof absent) => void;
    let reads = 0;
    mockTauri({
      diarize_download: () => null,
      diarize_status: (args) => {
        if ((args as { engine: string }).engine !== "community1") return absent;
        return ++reads === 1 ? new Promise((resolve) => { initial = resolve; }) : ready;
      },
    });
    const hook = renderHook(() => useSettings());
    await waitFor(() => expect(initial).toBeDefined());
    await act(async () => { await hook.result.current.downloadDiarize(); });
    expect(hook.result.current.diarize.status).toEqual(ready);
    await act(async () => { initial(absent); });
    expect(hook.result.current.diarize.status).toEqual(ready);
  });

  it("prevents deletion during an in-flight download", async () => {
    let finish!: (value: null) => void;
    const remove = vi.fn();
    mockTauri({ diarize_download: () => new Promise<null>((resolve) => { finish = resolve; }), diarize_delete: remove, diarize_status: () => ready });
    const hook = renderHook(() => useSettings());
    let operation!: Promise<void>;
    act(() => { operation = hook.result.current.downloadDiarize(); });
    await waitFor(() => expect(finish).toBeDefined());
    await act(async () => { await hook.result.current.deleteDiarize(); });
    expect(remove).not.toHaveBeenCalled();
    await act(async () => { finish(null); await operation; });
  });
});

describe("speaker model source controls", () => {
  it("passes the selected mirror source with Chinese labels", async () => {
    setLocale("zh-CN");
    const download = vi.fn();
    render(<DiarizeModelManager state={EMPTY_DIARIZE_STATE} onDownload={download} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByRole("combobox", { name: "下载来源" }));
    await userEvent.click(screen.getByRole("option", { name: "仅使用镜像" }));
    await userEvent.click(screen.getByRole("button", { name: "下载模型" }));
    expect(download).toHaveBeenCalledWith("mirror");
  });
  it("does not call a 100-percent compilation tick complete", () => {
    render(<DiarizeModelManager state={{ ...EMPTY_DIARIZE_STATE, downloading: true, fraction: 1, phase: "compiling" }} onDownload={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/Compiling for Apple Neural Engine/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download model" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Downloaded —/)).not.toBeInTheDocument();
  });
});
