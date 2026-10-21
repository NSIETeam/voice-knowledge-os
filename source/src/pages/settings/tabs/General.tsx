import { useThemeStore } from "../../../lib/theme";
import { PALETTE_REGISTRY, usePaletteStore } from "../../../lib/palette";
import { Row, Section } from "../components/Section";
import { Segmented } from "../components/Segmented";
import { PALETTES, THEMES } from "../types";
import { Select } from "../../../components/ui/Select";
import { setLocale, useLocale, useT } from "../../../lib/locale";

// General owns appearance + the absorbed About content. UI language is an
// app preference here; note transcription language remains under Transcription.
export function GeneralTab() {
  const locale = useLocale();
  const t = useT();
  const theme = useThemeStore((t) => t.theme);
  const setThemePref = useThemeStore((t) => t.setTheme);
  const palette = usePaletteStore((p) => p.palette);
  const setPalettePref = usePaletteStore((p) => p.setPalette);

  // The description is the selected design's own, so the row explains what is
  // actually on screen instead of describing the picker.
  const design = PALETTE_REGISTRY.find((p) => p.id === palette);

  return (
    <>
        <Row
          label={t("Language")}
          description={locale === "zh-CN" ? "选择 HoneyVoice 界面显示语言。" : "Choose the HoneyVoice interface language."}
          control={
            <Select
              value={locale}
              onChange={(value) => setLocale(value === "en-US" ? "en-US" : "zh-CN")}
              ariaLabel={t("Language")}
              options={[
                { value: "zh-CN", label: "简体中文" },
                { value: "en-US", label: "English" },
              ]}
            />
          }
        />
      <Section title={t("Appearance")}>
        <Row
          label={t("Design")}
          description={
            design
              ? `${t(design.description)} ${t("Each design has its own light and dark mode.")}`
              : t("Typeface, type scale and colours. Each design has its own light and dark mode.")
          }
          control={
            <Segmented
              label={t("Design")}
              value={palette}
              onChange={setPalettePref}
              options={PALETTES.map((option) => ({ ...option, label: t(option.label) }))}
            />
          }
        />
        <Row
          label={t("Theme")}
          description={t("System follows macOS appearance.")}
          control={
            <Segmented
              label={t("Theme")}
              value={theme}
              onChange={setThemePref}
              options={THEMES.map((option) => ({ ...option, label: t(option.label) }))}
            />
          }
        />
      </Section>
    </>
  );
}
