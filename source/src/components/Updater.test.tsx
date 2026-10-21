import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { emit } from "@tauri-apps/api/event";
import { Updater } from "./Updater";
import { mockTauri } from "../test/tauri";

function mount(updatesCheck: () => unknown) {
  mockTauri({ updates_check: updatesCheck }, { events: true });
  render(<Updater />);
}

beforeEach(() => {
  mockTauri({}, { events: true });
});

describe("release check", () => {
  it("reports the current version when no newer release exists", async () => {
    mount(() => ({
      currentVersion: "1.2.0",
      latestVersion: "1.2.0",
      updateAvailable: false,
      configured: true,
    }));

    await emit("menu://check-for-updates");
    await waitFor(() => expect(screen.getByText("HoneyVoice is up to date")).toBeTruthy());
    expect(screen.getByText("You’re using version 1.2.0.")).toBeTruthy();
  });

  it("shows when a newer version is available without linking to another product's releases", async () => {
    mount(() => ({
      currentVersion: "1.2.0",
      latestVersion: "1.3.0",
      updateAvailable: true,
      configured: true,
    }));

    await emit("menu://check-for-updates");
    await waitFor(() => expect(screen.getByText("A new version is available")).toBeTruthy());
    expect(
      screen.getByText("Version 1.3.0 is available (you have 1.2.0). Download it from the release page."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open release page" })).toBeNull();
  });

  it("does not link to an unrelated release page when the online check fails", async () => {
    mount(() => {
      throw new Error("network unavailable");
    });

    await emit("menu://check-for-updates");
    await waitFor(() => expect(screen.getByText("Could not check for updates")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Open release page" })).toBeNull();
  });

  it("says updates are not configured instead of checking an unrelated repository", async () => {
    mount(() => ({
      currentVersion: "0.1.0",
      latestVersion: null,
      updateAvailable: false,
      configured: false,
    }));

    await emit("menu://check-for-updates");
    await waitFor(() => expect(screen.getByText("HoneyVoice releases are not configured yet")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Open release page" })).toBeNull();
  });
});
