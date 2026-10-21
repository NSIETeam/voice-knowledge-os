import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "./test/app";
import { makeNote } from "./test/fixtures";

const deepLinkMocks = vi.hoisted(() => ({
  getCurrent: vi.fn(),
  onOpenUrl: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-deep-link", () => deepLinkMocks);

describe("application deep-link startup", () => {
  beforeEach(() => {
    vi.stubGlobal("isTauri", true);
    deepLinkMocks.getCurrent.mockReset();
    deepLinkMocks.onOpenUrl.mockReset();
    deepLinkMocks.getCurrent.mockResolvedValue([
      "honeyvoice://open?note=first-note&session=take-1&t=8250",
    ]);
    deepLinkMocks.onOpenUrl.mockResolvedValue(() => {});
  });

  it("subscribes during onboarding and opens the cold-start destination after Skip setup", async () => {
    const note = makeNote({ id: "first-note", title: "First note" });
    renderApp("/", {
      settings_get: (args) =>
        (args as { key?: string } | undefined)?.key === "onboarding_completed"
          ? "false"
          : null,
      notes_list: () => [note],
      notes_get: () => note,
    });

    await screen.findByRole("button", { name: /skip setup/i });
    await waitFor(() => expect(deepLinkMocks.onOpenUrl).toHaveBeenCalledOnce());
    expect(deepLinkMocks.getCurrent).toHaveBeenCalledOnce();
    expect(screen.getByTestId("location")).toHaveTextContent("/");

    await userEvent.click(screen.getByRole("button", { name: /skip setup/i }));

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/note/first-note?session=take-1&t=8250",
      ),
    );
  });
});
