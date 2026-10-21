import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { setLocale } from "../../../lib/locale";
import { mockTauri } from "../../../test/tauri";
import type { StepContext } from "../types";
import { PermissionsStep } from "./Permissions";

const ctx: StepContext = {
  stepId: "permissions",
  index: 1,
  total: 7,
  goNext: () => {},
  goBack: () => {},
  goTo: () => {},
  canGoBack: true,
  complete: () => {},
};

beforeEach(() => {
  setLocale("zh-CN");
  mockTauri({
    permissions_status: () => ({
      microphone: "not_determined",
      screen: "denied",
      adHocSignature: true,
      permissionIdentity: "mismatch",
    }),
  });
});

describe("Chinese onboarding permissions", () => {
  it("localizes the permission flow and explains build-identity mismatches", async () => {
    render(<PermissionsStep ctx={ctx} />);

    expect(await screen.findByRole("heading", { name: "授予录音权限" })).toBeTruthy();
    expect(screen.getByText("麦克风")).toBeTruthy();
    expect(screen.getByText("屏幕录制")).toBeTruthy();
    expect(screen.getByRole("button", { name: "允许使用麦克风" })).toBeTruthy();
    expect(screen.getByText(/旧版 HoneyVoice.*只保留一份/)).toBeTruthy();
    expect(screen.getByText("当前版本未获授权")).toBeTruthy();
    expect(screen.getByRole("button", { name: "继续" })).toBeDisabled();
  });

  it("does not call another ad-hoc build's denied status a user rejection", async () => {
    mockTauri({
      permissions_status: () => ({
        microphone: "denied",
        screen: "denied",
        adHocSignature: true,
        permissionIdentity: "mismatch",
      }),
    });

    render(<PermissionsStep ctx={ctx} />);

    expect(await screen.findAllByText("当前版本未获授权")).toHaveLength(2);
    expect(screen.getByText(/旧版 HoneyVoice.*只保留一份/)).toBeTruthy();
    expect(screen.queryByText("麦克风访问被拒绝。请在系统设置中启用，然后返回此处。")).toBeNull();
  });

  it("offers a relaunch when macOS keeps returning a stale denied screen status after Settings", async () => {
    mockTauri({
      permissions_status: () => ({
        microphone: "granted",
      screen: "denied",
      adHocSignature: true,
      permissionIdentity: "mismatch",
      }),
    });

    render(<PermissionsStep ctx={ctx} />);
    fireEvent.click(await screen.findByRole("button", { name: "启用屏幕录制权限" }));

    expect(await screen.findByText("在系统设置中更改权限后，请重新启动 HoneyVoice，让 macOS 重新检查权限状态。"))
      .toBeTruthy();
    expect(screen.getByRole("button", { name: "重新启动 HoneyVoice" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "继续" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /不重新启动，继续/ })).toBeTruthy();
  });
});
