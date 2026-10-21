import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { mockTauri } from "../../test/tauri";
import { ipc } from "../../lib/ipc";
import { ProviderKeyCard } from "./ProviderKeyCard";
import { useProviderKey } from "./useProviderKey";
import { useCloudModels } from "./useCloudModels";
import { providerRevision } from "../../lib/providerConfig";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function Harness() {
  const key = useProviderKey("mimo");
  const options = useCloudModels("mimo", key.hasKey, "");
  return <><ProviderKeyCard provider="mimo" /><output data-testid="stored">{String(key.hasKey)}</output>
    <output data-testid="models">{options.map((o) => o.value).join(",")}</output></>;
}
function saveFixtureKey() {
  fireEvent.change(screen.getByLabelText("MiMo API key"), { target: { value: "fixture-not-a-real-key" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
}

describe("provider configuration lifecycle", () => {
  it("does not publish a failed key save or discard the draft", async () => {
    const revision = providerRevision("mimo");
    const list = vi.fn(() => []);
    mockTauri({ provider_key_get: () => null, provider_key_set: () => { throw new Error("fixture denied"); }, mimo_list_models: list });
    render(<Harness />);
    saveFixtureKey();
    expect(await screen.findByText(/fixture denied/)).toBeInTheDocument();
    expect(screen.getByLabelText("MiMo API key")).toHaveValue("fixture-not-a-real-key");
    expect(screen.getByTestId("stored")).toHaveTextContent("false");
    expect(providerRevision("mimo")).toBe(revision);
    expect(list).not.toHaveBeenCalled();
  });
  it("does not invalidate models after a failed endpoint write", async () => {
    const list = vi.fn(() => ["mimo-fixture-before"]);
    mockTauri({ provider_key_get: () => "stored", mimo_list_models: list,
      settings_set: () => { throw new Error("fixture database unavailable"); } });
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("models")).toHaveTextContent("mimo-fixture-before"));
    const revision = providerRevision("mimo");
    const count = list.mock.calls.length;
    await act(async () => { await expect(ipc.setSetting("mimo_base_url", "https://gateway.example/v1")).rejects.toThrow("fixture database unavailable"); });
    expect(providerRevision("mimo")).toBe(revision);
    expect(list).toHaveBeenCalledTimes(count);
    expect(screen.getByTestId("models")).toHaveTextContent("mimo-fixture-before");
  });
  it("ignores model listings from the previous endpoint", async () => {
    const old = deferred<string[]>();
    const list = vi.fn().mockImplementationOnce(() => old.promise).mockResolvedValue(["mimo-fixture-new"]);
    mockTauri({ provider_key_get: () => "stored", mimo_list_models: list });
    render(<Harness />);
    await waitFor(() => expect(list).toHaveBeenCalledOnce());
    await act(() => ipc.setSetting("mimo_base_url", "https://gateway.example/v1"));
    await waitFor(() => expect(screen.getByTestId("models")).toHaveTextContent("mimo-fixture-new"));
    await act(async () => { old.resolve(["mimo-fixture-old"]); await old.promise; });
    expect(screen.getByTestId("models")).not.toHaveTextContent("mimo-fixture-old");
    expect(screen.getByTestId("models")).toHaveTextContent("mimo-fixture-new");
  });
  it("clears a successful verdict when the endpoint changes", async () => {
    mockTauri({ provider_key_get: () => "stored", provider_key_test: () => ({ ok: true, status: 200, error: null }) });
    render(<ProviderKeyCard provider="mimo" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Test" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    await screen.findByText("Connected ✓");
    await act(() => ipc.setSetting("mimo_base_url", "https://gateway.example/v1"));
    expect(screen.queryByText("Connected ✓")).not.toBeInTheDocument();
  });
  it("does not clear a new provider draft when an old save completes", async () => {
    const pending = deferred<void>();
    mockTauri({ provider_key_get: () => null, provider_key_set: () => pending.promise });
    const view = render(<ProviderKeyCard provider="mimo" />);
    saveFixtureKey();
    view.rerender(<ProviderKeyCard provider="deepseek" />);
    fireEvent.change(screen.getByLabelText("DeepSeek API key"), { target: { value: "deepseek-fixture-draft" } });
    await act(async () => { pending.resolve(); await pending.promise; });
    expect(screen.getByLabelText("DeepSeek API key")).toHaveValue("deepseek-fixture-draft");
    expect(screen.getByRole("button", { name: "Test" })).toBeDisabled();
  });
  it("publishes a saved key to other consumers and loads the model list", async () => {
    let stored = false;
    const list = vi.fn(() => ["mimo-fixture-coding"]);
    mockTauri({ provider_key_get: () => stored ? "stored" : null,
      provider_key_set: () => { stored = true; }, mimo_list_models: list });
    render(<Harness />);
    expect(screen.getByTestId("stored")).toHaveTextContent("false");
    saveFixtureKey();
    await waitFor(() => expect(screen.getByTestId("stored")).toHaveTextContent("true"));
    await waitFor(() => expect(screen.getByTestId("models")).toHaveTextContent("mimo-fixture-coding"));
    expect(list).toHaveBeenCalled();
  });
  it("refreshes models when an already-stored key is replaced", async () => {
    let model = "mimo-fixture-before";
    mockTauri({ provider_key_get: () => "stored", provider_key_set: () => { model = "mimo-fixture-after"; },
      mimo_list_models: () => [model] });
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("models")).toHaveTextContent("mimo-fixture-before"));
    saveFixtureKey();
    await waitFor(() => expect(screen.getByTestId("models")).toHaveTextContent("mimo-fixture-after"));
  });
  it("invalidates an old endpoint listing only after a setting write succeeds", async () => {
    let model = "mimo-fixture-before";
    mockTauri({ provider_key_get: () => "stored", mimo_list_models: () => [model],
      settings_set: () => { model = "mimo-fixture-after"; } });
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("models")).toHaveTextContent("mimo-fixture-before"));
    await act(() => ipc.setSetting("mimo_base_url", "https://gateway.example/v1"));
    await waitFor(() => expect(screen.getByTestId("models")).toHaveTextContent("mimo-fixture-after"));
  });
  it("does not apply a late test verdict to a newly selected provider", async () => {
    const pending = deferred<{ ok: boolean; status: number; error: null }>();
    const test = vi.fn(() => pending.promise);
    mockTauri({ provider_key_get: () => "stored", provider_key_test: test });
    const view = render(<ProviderKeyCard provider="mimo" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Test" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(test).toHaveBeenCalledOnce());
    view.rerender(<ProviderKeyCard provider="deepseek" />);
    await act(async () => { pending.resolve({ ok: true, status: 200, error: null }); await pending.promise; });
    expect(screen.queryByText("Connected ✓")).not.toBeInTheDocument();
  });
  it("does not restore a stale missing-key read after a successful save", async () => {
    const old = deferred<null>();
    let stored = false;
    const read = vi.fn(() => stored ? Promise.resolve("stored") : old.promise);
    mockTauri({ provider_key_get: read, provider_key_set: () => { stored = true; }, mimo_list_models: () => ["mimo-fixture"] });
    render(<Harness />);
    await waitFor(() => expect(read).toHaveBeenCalled());
    saveFixtureKey();
    await screen.findByPlaceholderText("•••••••• stored");
    await act(async () => { old.resolve(null); await old.promise; });
    expect(screen.getByTestId("stored")).toHaveTextContent("true");
    expect(screen.getByPlaceholderText("•••••••• stored")).toBeInTheDocument();
  });
});
