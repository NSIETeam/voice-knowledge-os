import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MimoEndpointField } from "./MimoEndpointField";
import { setLocale } from "../../lib/locale";

const initial = "https://gateway.example/v1";
const next = "https://token-plan-cn.xiaomimimo.com/v1";
function input(value: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value } });
}
describe("MiMo endpoint commit boundary", () => {
  it("does not save a draft and normalizes only an explicit save", async () => {
    const save = vi.fn(async () => {});
    render(<MimoEndpointField value={initial} onSave={save} />);
    input(`${next}/`);
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save endpoint" }));
    await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith(next));
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(next));
  });
  it.each(["", "invalid", "http://gateway.example/v1", "https://user:pass@gateway.example/v1",
    "https://gateway.example/v1?key=fixture", "https://gateway.example/v1#secret"])(
    "rejects %s without a persistence call", (value) => {
      const save = vi.fn();
      render(<MimoEndpointField value={initial} onSave={save} />);
      input(value);
      fireEvent.click(screen.getByRole("button", { name: "Save endpoint" }));
      expect(screen.getByRole("alert")).toHaveTextContent("Use an HTTPS URL");
      expect(save).not.toHaveBeenCalled();
    });
  it("retains the draft after failure and permits an explicit retry", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("fixture write failed")).mockResolvedValueOnce(undefined);
    render(<MimoEndpointField value={initial} onSave={save} />);
    input(next);
    fireEvent.click(screen.getByRole("button", { name: "Save endpoint" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("fixture write failed");
    expect(screen.getByRole("textbox")).toHaveValue(next);
    fireEvent.click(screen.getByRole("button", { name: "Save endpoint" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
  it("commits only once while a save is pending", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const save = vi.fn(() => pending);
    render(<MimoEndpointField value={initial} onSave={save} />);
    input(next);
    const form = screen.getByRole("textbox").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(save).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox")).toBeDisabled();
    await act(async () => { finish(); await pending; });
    expect(screen.getByRole("textbox")).toBeEnabled();
  });
  it("updates owned errors on language change without changing the draft", () => {
    render(<MimoEndpointField value={initial} onSave={vi.fn()} />);
    input("http://fixture.example");
    fireEvent.click(screen.getByRole("button", { name: "Save endpoint" }));
    act(() => setLocale("zh-CN"));
    expect(screen.getByRole("button", { name: "保存地址" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).not.toHaveTextContent("Use an HTTPS URL");
    expect(screen.getByRole("textbox")).toHaveValue("http://fixture.example");
  });
});
