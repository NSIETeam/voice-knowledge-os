import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useChatReadiness } from "./useChatReadiness";
import { mockTauri } from "../../test/tauri";
import { broadcastSettingChange } from "../../lib/settingsBus";

describe("pinned chat readiness", () => {
  it("does not report a missing key while the Keychain read is still pending", async () => {
    let finish!: (value: string) => void;
    const pending = new Promise<string>((resolve) => { finish = resolve; });
    const read = vi.fn(() => pending);
    mockTauri({ settings_get: (args) => (args as { key: string }).key === "chat_provider" ? "mimo" : null,
      provider_key_get: read });
    const { result } = renderHook(useChatReadiness);
    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    expect(result.current.loading).toBe(true);
    expect(result.current.ready).toBe(false);
    expect(result.current.hint).toBe("");
    await act(async () => { finish("stored"); await pending; });
    expect(result.current.loading).toBe(false);
    expect(result.current.ready).toBe(true);
  });
  it("uses the newly saved provider/model without remounting or reading unrelated keys", async () => {
    const reads = vi.fn((args) => (args as { provider: string }).provider === "mimo" ? "stored" : null);
    mockTauri({ settings_get: (args) => ({ chat_provider: "deepseek", chat_model: "deepseek-fixture" })[(args as { key: "chat_provider" | "chat_model" }).key] ?? null,
      provider_key_get: reads });
    const { result } = renderHook(useChatReadiness);
    await waitFor(() => expect(result.current.hint).toContain("DeepSeek key"));
    expect(reads.mock.calls.flatMap(([args]) => args.provider)).toEqual(["deepseek"]);
    act(() => {
      broadcastSettingChange("chat_provider", "mimo");
      broadcastSettingChange("chat_model", "mimo-fixture");
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.provider).toBe("mimo");
    expect(result.current.model).toBe("mimo-fixture");
    act(() => broadcastSettingChange("chat_provider", "deepseek"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.ready).toBe(false));
    expect(result.current.hint).toContain("DeepSeek key");
  });
  it("does not replace a new configuration with a late initial snapshot", async () => {
    let finish!: (value: string) => void;
    const initial = new Promise<string>((resolve) => { finish = resolve; });
    const reads = vi.fn(() => null);
    mockTauri({ settings_get: () => initial, provider_key_get: reads });
    const { result } = renderHook(useChatReadiness);
    expect(reads).not.toHaveBeenCalled();
    act(() => {
      broadcastSettingChange("chat_provider", "mimo");
      broadcastSettingChange("chat_model", "mimo-fixture");
      broadcastSettingChange("local_llm_base_url", "http://localhost:2345/v1");
    });
    await act(async () => { finish("old-value"); await initial; });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.provider).toBe("mimo");
    expect(result.current.model).toBe("mimo-fixture");
    expect(result.current.baseUrl).toBe("http://localhost:2345/v1");
    expect(reads.mock.calls).toEqual([[{ provider: "mimo" }]]);
  });
});
