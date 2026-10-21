import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { renderApp } from "../test/app";
import { makeNote } from "../test/fixtures";
import { mockLayoutBox } from "../test/layout";
import { mockTauri } from "../test/tauri";
import { setLocale } from "../lib/locale";
import { useRecordingStore } from "../lib/store";
import { TranscriptEditor } from "./Note";
import { RecordingBar, CaptureIndicator, noAudioWarning } from "../components/RecordingBar";
import { Toaster } from "../components/Toaster";

beforeAll(() => mockLayoutBox());
beforeEach(() => {
  setLocale("zh-CN");
  useRecordingStore.setState({ status: { noteId: null, phase: "idle" }, errors: [], flashes: [], summarizing: {}, transcribing: {}, diarizing: {}, diag: null });
});

describe("HoneyVoice Chinese workflows", () => {
  it("keeps the audio deletion confirmation explicit and does not delete before confirmation", async () => {
    const remove = vi.fn(() => null);
    renderApp("/settings?tab=recording", { stored_audio_stats: () => ({ notes: 2, files: 3, bytes: 1048576, noteIds: [] }), delete_stored_audio: remove });
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    expect(await within(dialog).findByRole("switch", { name: "保留录音音频" })).toBeInTheDocument();
    expect(within(dialog).getByText(/仅删除音频，保留全部转录/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "删除已保存的音频…" }));
    expect(within(dialog).getByRole("button", { name: "删除 3 个文件" })).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(remove).not.toHaveBeenCalled();
  });
  it("distinguishes transcription language from interface language and keeps vocabulary untouched", async () => {
    renderApp("/settings?tab=transcription", {
      settings_get: (args) => ({ onboarding_completed: "true", language: "zh", custom_vocabulary: "Home, Settings, DeepSeek" }[(args as { key: string }).key] ?? null),
      get_transcribe_config: () => ({ default: { provider: "local", model_id: "medium-q5", preset: "quality", use_gpu: true }, per_language: {} }),
    });
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    expect(await within(dialog).findByText("转录语言")).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "中文" })).toBeInTheDocument();
    expect(await within(dialog).findByDisplayValue("Home, Settings, DeepSeek")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("button", { name: "高级" })).toHaveLength(2);
    await userEvent.click(within(dialog).getAllByRole("button", { name: "高级" })[1]);
    expect(within(dialog).getByText(/越高越倾向合并为较少的说话人/)).toBeInTheDocument();
  });
  it("translates note controls without translating the note title", async () => {
    const note = makeNote({ id: "cn-note", title: "Summary", summary: "", transcript: "" });
    renderApp("/note/cn-note", { notes_list: () => [note], notes_get: () => note });
    expect(await screen.findByRole("button", { name: "生成摘要" })).toBeInTheDocument();
    expect(screen.getAllByText("Summary").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "转录" }));
    expect(await screen.findByText("还没有转录。从工具栏开始录音即可采集并转录音频。")).toBeInTheDocument();
  });
  it("preserves transcript text when changing UI language during editing", async () => {
    const text = "Speaker 1: Home\nSpeaker 2: Settings";
    const changed = vi.fn();
    render(<TranscriptEditor value={text} onChange={changed} disabled={false} bottomAligned={false} />);
    await userEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByRole("textbox")).toHaveValue(text);
    act(() => setLocale("en-US"));
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue(text);
    expect(changed).not.toHaveBeenCalled();
  });
  it("keeps recording commands and device names unchanged under Chinese labels", async () => {
    const pause = vi.fn(() => null);
    mockTauri({ recording_pause: pause });
    useRecordingStore.setState({ status: { noteId: "n1", phase: "recording" }, micHeard: true, activeSince: null, activeAccumMs: 0 });
    render(<RecordingBar noteId="n1" />);
    await userEvent.click(screen.getByRole("button", { name: "暂停" }));
    expect(pause).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument();
    expect(noAudioWarning("Home 🎧")).toBe("未收到来自“Home 🎧”的声音，请检查系统设置中的输入设备");
  });
  it("shows translated processing status and take counts", () => {
    useRecordingStore.setState({ transcribing: { n1: { startedAt: 1, step: "diarizing", doneMs: 1, totalMs: 2, take: 2, takes: 3 } } });
    render(<CaptureIndicator variant="bar" noteId="n1" />);
    expect(screen.getByRole("progressbar", { name: "正在区分说话人 第 2/3 次录音…" })).toBeInTheDocument();
  });
  it("retains the settings recovery link for a Chinese permission error", () => {
    useRecordingStore.getState().pushError({ noteId: null, message: "无法录音：尚未获得麦克风权限，请在设置中授权。", sticky: true });
    render(<MemoryRouter><Toaster /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "打开设置" })).toBeInTheDocument();
    expect(screen.getByText("录音提示")).toBeInTheDocument();
  });
  it("translates owned diarization notices but leaves other error text untouched", () => {
    const notice = "Speaker diarization failed; transcript saved without speaker labels.";
    useRecordingStore.getState().pushError({ noteId: null, message: notice, sticky: true });
    useRecordingStore.getState().pushError({ noteId: null, message: "Home", sticky: true });
    render(<MemoryRouter><Toaster /></MemoryRouter>);
    expect(screen.getByText("说话人区分失败。转录已保存，未标注身份。")).toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();
    act(() => setLocale("en-US"));
    expect(screen.getByText(notice)).toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();
  });
});
