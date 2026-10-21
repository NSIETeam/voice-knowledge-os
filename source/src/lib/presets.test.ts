import { describe, expect, it } from "vitest";
import { SUMMARY_PRESETS, presetLabel, presetPromptForLang } from "./presets";
import { LANGUAGES, languageOptionLabel } from "./languages";
import { setLocale } from "./locale";

describe("summary language is independent of interface language", () => {
  it("never falls back to English for Chinese preset prompts", () => {
    for (const preset of SUMMARY_PRESETS) {
      expect(presetPromptForLang(preset, "zh")).toContain("Reply in Chinese");
      expect(presetPromptForLang(preset, "zh")).not.toContain("Reply in English");
    }
  });
  it("uses every known recording language, not the old four-language subset", () => {
    for (const lang of LANGUAGES.filter((l) => !["auto", "no"].includes(l.value))) {
      expect(presetPromptForLang(SUMMARY_PRESETS[0], lang.value)).toContain(`Reply in ${lang.label}`);
    }
  });
  it("translates built-in labels without changing the requested output language or protocol ids", () => {
    setLocale("zh-CN");
    expect(presetLabel(SUMMARY_PRESETS[0])).toBe("会议");
    expect(SUMMARY_PRESETS[0].value).toBe("meeting");
    expect(presetPromptForLang(SUMMARY_PRESETS[0], "en")).toContain("Reply in English");
    expect(presetPromptForLang(SUMMARY_PRESETS[0], "auto")).toContain("the same language as the transcript");
  });
  it("exposes the PRD's semantic processing modes with Chinese labels and mode-specific guardrails", () => {
    setLocale("zh-CN");
    const expected = [
      ["knowledge_learning", "知识学习", "never invent facts"],
      ["solution_decision", "方案与决策", "Never turn a proposal into an approved decision"],
      ["research_interview", "访谈与调研", "never generalize one person's statement"],
      ["business_negotiation", "商务谈判", "Do not infer hidden motives"],
      ["relationship_conversation", "关系与日常对话", "Do not infer emotions"],
      ["factual_record", "事实与证据", "never invent timestamps or sources"],
    ] as const;

    for (const [id, label, guardrail] of expected) {
      const preset = SUMMARY_PRESETS.find((item) => item.value === id);
      expect(preset, `missing processing mode ${id}`).toBeDefined();
      expect(presetLabel(preset!)).toBe(label);
      expect(presetPromptForLang(preset!, "en")).toContain(guardrail);
      expect(presetPromptForLang(preset!, "zh")).toContain("Reply in Chinese");
    }
    expect(new Set(SUMMARY_PRESETS.map((item) => item.value)).size).toBe(SUMMARY_PRESETS.length);
    expect(SUMMARY_PRESETS.find((item) => item.value === "meeting")).toBeDefined();
  });
  it("localizes language labels without changing language codes", () => {
    setLocale("zh-CN");
    const chinese = LANGUAGES.find((l) => l.value === "zh")!;
    expect(languageOptionLabel(chinese)).toBe("中文");
    expect(chinese.value).toBe("zh");
    expect(languageOptionLabel(LANGUAGES[0])).toBe("自动识别");
    setLocale("en-US");
    expect(languageOptionLabel(chinese)).toBe("Chinese (中文)");
  });
});
