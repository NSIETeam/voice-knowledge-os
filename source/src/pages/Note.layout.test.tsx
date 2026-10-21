import { afterEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, fireEvent } from "@testing-library/react";
import { renderApp } from "../test/app";
import { makeNote } from "../test/fixtures";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.removeItem("humla.panelWidth"); });

describe("note columns after async load", () => {
  it("observes newly mounted columns, clamps narrow windows and retains the user's preferred width", async () => {
    const observers: { target: Element; callback: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal("ResizeObserver", class {
      callback: ResizeObserverCallback;
      disconnect = vi.fn();
      constructor(callback: ResizeObserverCallback) { this.callback = callback; }
      observe(target: Element) { observers.push({ target, callback: this.callback, disconnect: this.disconnect }); }
      unobserve() {}
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(708);
    localStorage.setItem("humla.panelWidth", "440");
    const note = makeNote({ id: "layout-note" });
    let release!: (value: typeof note) => void;
    const pending = new Promise<typeof note>((resolve) => { release = resolve; });
    const view = renderApp("/note/layout-note", { notes_list: () => [], notes_get: () => pending });
    expect(view.container.querySelector("aside[aria-hidden]")).toBeNull();
    await act(async () => { release(note); });
    await screen.findByRole("button", { name: "Summarize" });
    const panel = view.container.querySelector("aside[aria-hidden]")!;
    await waitFor(() => expect(panel).toHaveStyle({ width: "282px" }));
    const columns = observers.find((item) => item.target === panel.parentElement)!;
    expect(columns).toBeDefined();
    const resize = (width: number) => act(() => columns.callback([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver));
    resize(1200);
    expect(panel).toHaveStyle({ width: "440px" });
    resize(708);
    expect(panel).toHaveStyle({ width: "282px" });
    expect(localStorage.getItem("humla.panelWidth")).toBe("440");
    resize(800);
    expect(panel).toHaveStyle({ width: "374px" });
    // Begin dragging from the visible clamped width, not the old 440px
    // preference; otherwise the handle cannot shrink in a narrow window.
    fireEvent.mouseDown(screen.getByTitle("Drag to resize"), { clientX: 420 });
    fireEvent.mouseMove(window, { clientX: 426 });
    fireEvent.mouseUp(window);
    expect(panel).toHaveStyle({ width: "368px" });
    expect(localStorage.getItem("humla.panelWidth")).toBe("368");
    view.unmount();
    expect(columns.disconnect).toHaveBeenCalled();
  });
});
