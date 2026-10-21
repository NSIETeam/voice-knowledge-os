import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, translate } from "../../lib/locale";
import { aiSettingsZhCN } from "../../lib/aiSettingsLocale";
import { mockTauri } from "../../test/tauri";
import { SummaryTab } from "./tabs/Summary";
import { ChatTab } from "./tabs/Chat";
import { SummaryPromptsManager } from "./components/SummaryPromptsManager";
import { DEFAULTS } from "./types";
import { useSettings } from "./useSettings";

beforeEach(() => { mockTauri(); setLocale("zh-CN"); });
describe("Chinese AI settings", () => {
  it("normalizes every owned dictionary key and leaves dynamic values to interpolation", () => {
    for (const [key, value] of Object.entries(aiSettingsZhCN)) {
      expect(key).toBe(key.trim().replace(/\s+/g, " "));
      expect(translate(key, "zh-CN")).toBe(value);
    }
  });
  it("translates summary controls but preserves model ids and provider protocol values", async () => {
    const update = vi.fn(async () => {});
    render(<SummaryTab s={{ ...DEFAULTS, summary_provider: "mimo", summary_model: "mimo-fixture-{model}" }} update={update} />);
    expect(await screen.findByText("摘要提示词")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存地址" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "mimo-fixture-{model}" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ 新建提示词" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("combobox", { name: "MiMo" }));
    const option = screen.getByRole("option", { name: translate("Local (any OpenAI-compatible server)") });
    expect(option).not.toHaveTextContent("Local (any");
    await userEvent.click(screen.getByRole("option", { name: "DeepSeek" }));
    expect(update).toHaveBeenCalledWith("summary_provider", "deepseek");
  });
  it("localizes chat readiness and dynamic counts without claiming a network test passed", async () => {
    mockTauri({ provider_key_get: () => null, chat_stale_note_count: () => 3, chat_rebuild_index: () => 5 });
    render(<ChatTab s={{ ...DEFAULTS, chat_provider: "mimo", chat_model: "mimo-fixture" }} update={async () => {}} />);
    expect(await screen.findByText("请在上方添加 MiMo 密钥以使用对话。")).toBeInTheDocument();
    expect(await screen.findByText(/有 3 段录音仍使用旧版索引/)).toBeInTheDocument();
    expect(screen.getByText(/可能向所配置的服务商发送内容片段并产生费用/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重建索引" }));
    expect(await screen.findByText("已重建 5 篇笔记的索引 ✓")).toBeInTheDocument();
    expect(screen.queryByText("Connected ✓")).not.toBeInTheDocument();
    act(() => setLocale("en-US"));
    expect(screen.getByText("Add your MiMo key above to use chat.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "mimo-fixture" })).toBeInTheDocument();
  });
  it("keeps a prompt draft through language changes and exposes validation inside its modal", async () => {
    const create = vi.fn(() => { throw new Error("fixture Name provider {model} error"); });
    mockTauri({ summary_prompts_create: create });
    render(<SummaryPromptsManager language="zh" />);
    fireEvent.click(await screen.findByRole("button", { name: "+ 新建提示词" }));
    const dialog = within(screen.getByRole("dialog", { name: "新建提示词" }));
    fireEvent.click(dialog.getByRole("button", { name: "保存" }));
    expect(dialog.getByRole("alert")).toHaveTextContent("请填写名称。");
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(dialog.getByLabelText("名称"), { target: { value: "Name 原文 {model}" } });
    fireEvent.change(dialog.getByLabelText("内容"), { target: { value: "Keep this exact prompt：{provider}。" } });
    act(() => setLocale("en-US"));
    const english = within(screen.getByRole("dialog", { name: "New prompt" }));
    expect(english.getByLabelText("Name")).toHaveValue("Name 原文 {model}");
    expect(english.getByLabelText("Content")).toHaveValue("Keep this exact prompt：{provider}。");
    expect(english.getByRole("alert")).toHaveTextContent("Name is required.");
    fireEvent.click(english.getByRole("button", { name: "Save" }));
    expect(await english.findByRole("alert")).toHaveTextContent("fixture Name provider {model} error");
    expect(create).toHaveBeenCalledWith({ name: "Name 原文 {model}", content: "Keep this exact prompt：{provider}。" });
    act(() => setLocale("zh-CN"));
    expect(screen.getByRole("alert")).toHaveTextContent("fixture Name provider {model} error");
  });
  it("does not announce a new endpoint in settings state until persistence commits", async () => {
    const initial = "https://gateway.example/v1";
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => { complete = resolve; });
    mockTauri({ settings_get: (args) => (args as { key: string }).key === "mimo_base_url" ? initial : null,
      settings_set: () => pending });
    const { result } = renderHook(useSettings);
    await waitFor(() => expect(result.current.s.mimo_base_url).toBe(initial));
    let update!: Promise<void>;
    act(() => { update = result.current.update("mimo_base_url", "https://new.example/v1"); });
    expect(result.current.s.mimo_base_url).toBe(initial);
    await act(async () => { complete(); await update; });
    expect(result.current.s.mimo_base_url).toBe("https://new.example/v1");
  });
  it("keeps the previous endpoint when persistence fails", async () => {
    const initial = "https://gateway.example/v1";
    mockTauri({ settings_get: (args) => (args as { key: string }).key === "mimo_base_url" ? initial : null,
      settings_set: () => { throw new Error("fixture write failed"); } });
    const { result } = renderHook(useSettings);
    await waitFor(() => expect(result.current.s.mimo_base_url).toBe(initial));
    await act(async () => { await expect(result.current.update("mimo_base_url", "https://new.example/v1")).rejects.toThrow("fixture write failed"); });
    expect(result.current.s.mimo_base_url).toBe(initial);
  });
});
