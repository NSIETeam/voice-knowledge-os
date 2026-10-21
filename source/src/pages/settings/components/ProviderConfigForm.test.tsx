import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProviderConfigForm } from "./ProviderConfigForm";
import { setLocale } from "../../../lib/locale";

describe("local model setup", () => {
  it("keeps on-device processing selectable on a fresh install", async () => {
    const change = vi.fn();
    render(<ProviderConfigForm value={{ provider: "openai", model: "whisper-1" }} onChange={change} localModels={[]} />);
    await userEvent.click(screen.getByRole("combobox", { name: "OpenAI" }));
    await userEvent.click(screen.getByRole("option", { name: "Local (Whisper, on-device)" }));
    expect(change).toHaveBeenCalledWith({ provider: "local", model_id: "large-v3-turbo-q5", preset: "quality", use_gpu: true });
  });
  it("shows the selected missing model even when another model is downloaded", () => {
    setLocale("zh-CN");
    const change = vi.fn();
    render(<ProviderConfigForm value={{ provider: "local", model_id: "medium-q5", preset: "quality", use_gpu: true }} onChange={change} localModels={[
      { id: "medium-q5", label: "Medium (quantized)", kind: "multilingual", specificLanguage: null, downloaded: false },
      { id: "large-v3-q5", label: "Large v3 (quantized)", kind: "multilingual", specificLanguage: null, downloaded: true },
    ]} />);
    expect(screen.getByRole("combobox", { name: "Medium（量化版）（未下载）" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "本地（Whisper，设备端运行）" })).toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
  });
});
