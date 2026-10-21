import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TelemetryNotice } from "./TelemetryNotice";
import { mockTauri } from "../../test/tauri";

describe("TelemetryNotice", () => {
  it("defaults to off and only sends after the user explicitly turns it on", async () => {
    const writes: Array<{ key: string; value: string }> = [];
    const telemetry = vi.fn();
    mockTauri({
      settings_get: () => null,
      settings_set: (args) => {
        writes.push(args as { key: string; value: string });
        return undefined;
      },
      telemetry_event: telemetry,
    });

    render(<TelemetryNotice />);
    expect(await screen.findByText("Anonymous setup counters are off")).toBeInTheDocument();
    expect(writes).toContainEqual({ key: "telemetry_enabled", value: "false" });
    expect(telemetry).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(telemetry).toHaveBeenCalledWith({ event: "app_first_run" });
  });
});
