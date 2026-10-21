import { describe, expect, it, vi } from "vitest";
import { getLocale, setLocale, translate, formatMessage } from "./locale";
import { diarizationNoticesZhCN } from "./productLocale";

describe("app locale", () => {
  it("translates every owned diarization fallback notice without guessing identity", () => {
    for (const [english, chinese] of Object.entries(diarizationNoticesZhCN)) {
      setLocale("zh-CN");
      expect(translate(english)).toBe(chinese);
      setLocale("en-US");
      expect(translate(english)).toBe(english);
    }
  });
  it("keeps a session preference when storage cannot be written", () => {
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("unavailable"); });
    try {
      setLocale("zh-CN");
      expect(getLocale()).toBe("zh-CN");
      expect(translate("Record")).toBe("录音");
      setLocale("en-US");
      expect(getLocale()).toBe("en-US");
    } finally {
      storage.mockRestore();
      setLocale("en-US");
    }
  });
  it("interpolates data without translating or reinterpreting it", () => {
    setLocale("zh-CN");
    expect(formatMessage("Use {model}", { model: "Home {device}" })).toBe("使用 Home {device}");
    expect(formatMessage(" take {take} of {total}", { take: 2, total: 3 })).toBe(" 第 2/3 次录音");
  });
  it("defaults to Simplified Chinese and falls back to source copy for English", () => {
    window.localStorage.removeItem("honeyvoice.locale");
    expect(getLocale()).toBe("zh-CN");
    expect(translate("Home")).toBe("首页");

    setLocale("en-US");
    expect(translate("Home")).toBe("Home");
  });

  it("persists the selected language", () => {
    setLocale("zh-CN");
    expect(window.localStorage.getItem("honeyvoice.locale")).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("localizes the first-run product choices in the default Chinese locale", () => {
    setLocale("zh-CN");
    const onboardingCopy = [
      "How should HoneyVoice transcribe?",
      "Run it privately on your Mac, or use a cloud API. You can change this any time in Settings.",
      "Team sync",
      "Personal notes stay on this Mac by default. Team sync requires a compatible server; service terms are set by that server.",
      "Just me, on this Mac",
      "Set up a team workspace",
      "Join an existing team",
      "You're all set",
    ];

    for (const copy of onboardingCopy) {
      expect(translate(copy)).not.toBe(copy);
    }
  });
});
