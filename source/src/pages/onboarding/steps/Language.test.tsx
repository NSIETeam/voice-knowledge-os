import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { setLocale } from "../../../lib/locale";
import { mockTauri } from "../../../test/tauri";
import type { StepContext } from "../types";
import { LanguageStep } from "./Language";

const ctx: StepContext = {
  stepId: "language",
  index: 2,
  total: 7,
  goNext: () => {},
  goBack: () => {},
  goTo: () => {},
  canGoBack: true,
  complete: () => {},
};

beforeEach(() => {
  setLocale("zh-CN");
  mockTauri({ settings_get: () => "zh" });
});

describe("Chinese meeting-language onboarding", () => {
  it("distinguishes the meeting language from the interface language", async () => {
    render(<LanguageStep ctx={ctx} />);

    expect(await screen.findByRole("heading", { name: "你的会议主要使用哪种语言？" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "会议语言" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "继续" })).toBeEnabled();
  });
});
