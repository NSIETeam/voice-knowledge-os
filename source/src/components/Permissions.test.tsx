import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Permissions } from "./Permissions";
import { mockTauri } from "../test/tauri";

function mount(adHocSignature: boolean) {
  mockTauri({
    permissions_status: () => ({
      microphone: "not_determined",
      screen: "denied",
      adHocSignature,
      appPath: "/Applications/HoneyVoice.app",
    }),
  });
  render(<Permissions />);
}

beforeEach(() => {
  mockTauri();
});

describe("permission identity diagnostics", () => {
  it("refreshes native permission status when returning to the app", async () => {
    const permissionsStatus = vi.fn()
      .mockResolvedValueOnce({
        microphone: "granted",
        screen: "denied",
        adHocSignature: false,
        permissionIdentity: "match",
      })
      .mockResolvedValueOnce({
        microphone: "granted",
        screen: "granted",
        adHocSignature: false,
        permissionIdentity: "match",
      });
    mockTauri({ permissions_status: permissionsStatus });
    render(<Permissions />);

    expect(await screen.findByText("Denied")).toBeTruthy();
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(screen.getAllByText("Granted")).toHaveLength(2));
    expect(permissionsStatus).toHaveBeenCalledTimes(2);
  });

  it("explains why a temporary macOS build can disagree with enabled privacy switches", async () => {
    mount(true);

    expect(
      await screen.findByText(/permission saved for an older HoneyVoice build/),
    ).toBeTruthy();
    expect(screen.getByText("Not requested by this build")).toBeTruthy();
    expect(screen.getByText("No access for this build")).toBeTruthy();
    expect(screen.getByText(/Keep one installed copy/)).toBeTruthy();
  });

  it("does not show ad-hoc signing guidance for a stable identity", async () => {
    mount(false);

    await screen.findByText("Microphone");
    expect(screen.getByText("Not requested")).toBeTruthy();
    expect(screen.getByText("Denied")).toBeTruthy();
    expect(screen.queryByText(/permission saved for an older HoneyVoice build/)).toBeNull();
  });

  it("offers a restart after opening System Settings to recheck a stale TCC status", async () => {
    mockTauri({
      permissions_status: () => ({
        microphone: "granted",
      screen: "denied",
      adHocSignature: true,
      permissionIdentity: "mismatch",
      }),
      permissions_request: () => ({
        microphone: "granted",
        screen: "denied",
        adHocSignature: true,
        permissionIdentity: "mismatch",
      }),
    });
    render(<Permissions />);
    fireEvent.click(await screen.findByRole("button", { name: "Open System Settings" }));

    expect(await screen.findByText("After changing a permission in System Settings, restart HoneyVoice so macOS can recheck it."))
      .toBeTruthy();
    expect(screen.getByRole("button", { name: "Restart HoneyVoice" })).toBeTruthy();
  });

  it("shows permissions granted to an ad-hoc capture helper without a false denial", async () => {
    mockTauri({
      permissions_status: () => ({
        microphone: "granted",
        screen: "granted",
        adHocSignature: true,
        permissionIdentity: "match",
      }),
    });
    render(<Permissions />);

    expect(await screen.findAllByText("Granted")).toHaveLength(2);
    expect(screen.queryByText(/permission saved for an older HoneyVoice build/)).toBeNull();
  });

  it("shows the actual installed copy to recover stale permissions", async () => {
    mount(true);
    expect(await screen.findByText(/Running from: \/Applications\/HoneyVoice.app/)).toBeTruthy();
    expect(screen.queryByText(/different signing identities/)).toBeNull();
  });

  it("shows a failed permission check and recovers on manual retry", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("helper timeout"))
      .mockResolvedValueOnce({ microphone: "granted", screen: "granted", adHocSignature: true });
    mockTauri({ permissions_status: read });
    render(<Permissions />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not check recording access");
    fireEvent.click(screen.getByRole("button", { name: "Check permissions again" }));
    expect(await screen.findAllByText("Granted")).toHaveLength(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not let a delayed old query overwrite a newer grant", async () => {
    const denied = { microphone: "granted", screen: "denied", adHocSignature: false };
    let resolveOld!: (value: typeof denied) => void;
    const oldRead = new Promise<typeof denied>((resolve) => { resolveOld = resolve; });
    const read = vi.fn().mockResolvedValueOnce(denied)
      .mockReturnValueOnce(oldRead)
      .mockResolvedValueOnce({ ...denied, screen: "granted" });
    mockTauri({ permissions_status: read });
    render(<Permissions />);
    await screen.findByText("Denied");
    fireEvent(window, new Event("focus"));
    fireEvent.click(screen.getByRole("button", { name: "Check permissions again" }));
    await waitFor(() => expect(screen.getAllByText("Granted")).toHaveLength(2));
    await act(async () => resolveOld(denied));
    expect(screen.getAllByText("Granted")).toHaveLength(2);
  });
});
