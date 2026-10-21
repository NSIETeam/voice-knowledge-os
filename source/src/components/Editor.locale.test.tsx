import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NoteEditor } from "./Editor";
import { setLocale } from "../lib/locale";

describe("note editor locale", () => {
  it("refreshes the empty placeholder without emitting content changes", async () => {
    setLocale("zh-CN");
    const changed = vi.fn();
    const { container } = render(<NoteEditor initialHTML="" onChange={changed} />);
    await waitFor(() => expect(container.querySelector("[data-placeholder]")).toHaveAttribute("data-placeholder", "在这里记录笔记…"));
    const editor = container.querySelector(".tiptap");
    act(() => setLocale("en-US"));
    await waitFor(() => expect(container.querySelector("[data-placeholder]")).toHaveAttribute("data-placeholder", "Write your notes here…"));
    expect(container.querySelector(".tiptap")).toBe(editor);
    expect(changed).not.toHaveBeenCalled();
  });
  it("preserves literal user content on UI language changes", async () => {
    setLocale("en-US");
    const changed = vi.fn();
    const { container } = render(<NoteEditor initialHTML="<p>Summary, Home, Settings</p>" onChange={changed} />);
    await waitFor(() => expect(container.querySelector(".tiptap")).toHaveTextContent("Summary, Home, Settings"));
    const editor = container.querySelector(".tiptap");
    act(() => setLocale("zh-CN"));
    expect(container.querySelector(".tiptap")).toBe(editor);
    expect(editor).toHaveTextContent("Summary, Home, Settings");
    expect(changed).not.toHaveBeenCalled();
  });
});
