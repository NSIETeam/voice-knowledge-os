import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DISCONNECTED, useCloudStore } from "../../../lib/cloud";
import { setLocale } from "../../../lib/locale";
import { mockTauri } from "../../../test/tauri";
import type { StepContext } from "../types";
import { CloudStep } from "./Cloud";

const ctx: StepContext = {
  stepId: "cloud",
  index: 5,
  total: 7,
  goNext: () => {},
  goBack: () => {},
  goTo: () => {},
  canGoBack: true,
  complete: () => {},
};

beforeEach(() => {
  setLocale("zh-CN");
  useCloudStore.getState().setStatus(DISCONNECTED);
  mockTauri({ cloud_status: () => DISCONNECTED });
});

describe("local-first team-sync onboarding", () => {
  it("defaults to personal local use and avoids unsupported hosted pricing claims", async () => {
    render(<CloudStep ctx={ctx} />);

    expect(await screen.findByRole("heading", { name: "团队同步" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /仅在这台 Mac 上使用/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("本地使用并保护隐私，无需账户或同步服务器。")).toBeTruthy();
    expect(screen.getByText(/服务条款由该服务器提供方决定/)).toBeTruthy();
    expect(screen.queryByText(/\$5|14 天免费试用/)).toBeNull();
  });
});
