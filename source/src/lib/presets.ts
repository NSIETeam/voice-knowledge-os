import { LANGUAGES } from "./languages";
import { translate } from "./locale";
// Summary presets — labels + the prompt text used by Settings to seed the
// global custom prompt and as a reference for the per-note picker.
//
// Keep these in sync with src-tauri/src/presets.rs. The backend resolves the
// prompt at request time from the note's stored preset value, so this file
// is mostly UI labeling + the "custom" path's seed text.

export type PresetSpec = {
  value: string;
  label_no: string;
  label_en: string;
  prompt_no: string;
  prompt_en: string;
};

// Processing modes are semantic compilers, not folders: each has a distinct
// extraction contract while leaving the source audio and transcript intact.
// Keep these in sync with src-tauri/src/presets.rs.
export const SUMMARY_PRESETS: PresetSpec[] = [
  {
    value: "meeting",
    label_no: "Møte",
    label_en: "Meeting",
    prompt_no: `Du lager møtenotater fra [Notater] (brukerens) og [Transkripsjon] (automatisk). Samle alt som ble sagt om samme tema i én seksjon, selv når temaet ble tatt opp flere ganger. Skriv på norsk i Markdown.`,
    prompt_en: `You produce meeting notes from [Notater] (user-written) and [Transkripsjon] (auto). Group everything said about the same topic into one section, even when it came up at several points. Reply in {LANGUAGE} using Markdown.`,
  },
  {
    value: "one_on_one",
    label_no: "1:1-samtale",
    label_en: "1:1 conversation",
    prompt_no: `Du lager notater fra en 1:1-samtale fra [Notater] (brukerens) og [Transkripsjon] (automatisk). Samle alt som ble sagt om samme tema i én seksjon, selv når temaet ble tatt opp flere ganger. Skriv på norsk i Markdown.`,
    prompt_en: `You produce 1:1 notes from [Notater] (user-written) and [Transkripsjon] (auto). Group everything said about the same topic into one section, even when it came up at several points. Reply in {LANGUAGE} using Markdown.`,
  },
  {
    value: "lecture",
    label_no: "Foredrag",
    label_en: "Lecture",
    prompt_no: `Du lager studienotater fra [Notater] (brukerens) og [Transkripsjon] (automatisk). Skriv på norsk i Markdown.`,
    prompt_en: `You produce study notes from [Notater] (user-written) and [Transkripsjon] (auto). Reply in {LANGUAGE} using Markdown.`,
  },
  {
    value: "interview",
    label_no: "Intervju",
    label_en: "Interview",
    prompt_no: `Du lager intervjunotater fra [Notater] (brukerens) og [Transkripsjon] (automatisk). Samle alt som ble sagt om samme tema i én seksjon, selv når temaet ble tatt opp flere ganger. Skriv på norsk i Markdown.`,
    prompt_en: `You produce interview notes from [Notater] (user-written) and [Transkripsjon] (auto). Group everything said about the same topic into one section, even when it came up at several points. Reply in {LANGUAGE} using Markdown.`,
  },
  {
    value: "brainstorm",
    label_no: "Idémyldring",
    label_en: "Brainstorm",
    prompt_no: `Du oppsummerer en idémyldring fra [Notater] (brukerens) og [Transkripsjon] (automatisk). Skriv på norsk i Markdown.`,
    prompt_en: `You summarize a brainstorm from [Notater] (user-written) and [Transkripsjon] (auto). Reply in {LANGUAGE} using Markdown.`,
  },
  {
    value: "voice_memo",
    label_no: "Stemmenotat",
    label_en: "Voice memo",
    prompt_no: `Du rydder opp i et stemmenotat fra [Notater] (brukerens) og [Transkripsjon] (automatisk). Behold brukerens stemme. Skriv på norsk i Markdown.`,
    prompt_en: `You clean up a voice memo from [Notater] (user-written) and [Transkripsjon] (auto). Preserve the user's voice. Reply in {LANGUAGE} using Markdown.`,
  },
  {
    value: "knowledge_learning",
    label_no: "Kunnskapslæring",
    label_en: "Knowledge learning",
    prompt_no: `Lag læringsnotater fra [Notater] og [Transkripsjon]. Skill mellom begreper, påstander, konkrete fakta og talerens egne hypoteser. Ta med nyttige eksempler, motargumenter, ubesvarte spørsmål og mulige videre undersøkelser. Ikke finn på fakta eller kilder. Skriv på norsk i Markdown.`,
    prompt_en: `Create knowledge-learning notes from [Notater] (user context) and [Transkripsjon] (automatic speech recognition). Extract core concepts, arguments, stated facts and evidence, useful examples or quotes, counterarguments, unresolved questions, and research leads. Distinguish what was explicitly said from interpretation; never invent facts, citations, or links. Reply in {LANGUAGE} using Markdown.`,
  },
  {
    value: "solution_decision",
    label_no: "Løsning og beslutning",
    label_en: "Solution & decisions",
    prompt_no: `Strukturer [Notater] og [Transkripsjon] som en beslutningslogg: problem, mål, begrensninger, fakta og antakelser, alternativer med avveininger, uenighet, uttrykkelige beslutninger, begrunnelse, handlinger og målepunkt. Ikke presenter et forslag som en vedtatt beslutning, og ikke finn på eiere eller frister. Skriv på norsk i Markdown.`,
    prompt_en: `Compile [Notater] and [Transkripsjon] as a decision record: problem, goals, constraints, stated facts versus assumptions, options and trade-offs, disagreements, explicit decisions and their rationale, action items, owners or deadlines only when actually stated, success measures, and review date if stated. Never turn a proposal into an approved decision. Reply in {LANGUAGE} using Markdown.`,
  },
  {
    value: "research_interview",
    label_no: "Intervju og innsikt",
    label_en: "Research interview",
    prompt_no: `Strukturer samtalen som intervjunotater: spørsmål og svar, uttrykte behov, konkrete eksempler, nyttige direkte sitater, motstridende utsagn, mulige innsikter og spørsmål som fortsatt må undersøkes. Skill respondentens ord fra tolkning, og ikke gjør én persons utsagn til et generelt funn. Skriv på norsk i Markdown.`,
    prompt_en: `Compile [Notater] and [Transkripsjon] as research-interview notes: question/answer themes, explicitly stated needs, concrete examples, useful short direct quotes, contradictions, tentative insights, and questions still to validate. Separate the participant's words from interpretation; never generalize one person's statement into a population-level finding. Reply in {LANGUAGE} using Markdown.`,
  },
  {
    value: "business_negotiation",
    label_no: "Forretningsforhandling",
    label_en: "Business negotiation",
    prompt_no: `Lag et nøkternt forhandlingsreferat: deltakere når de er kjent, hver parts uttrykte standpunkt, tilbud og vilkår, uttrykkelige innrømmelser, forpliktelser, røde linjer bare når de ble sagt, uavklarte punkter og neste steg. Merk uklare eller indirekte løfter. Ikke utled skjulte motiver, juridiske konklusjoner, beløp eller frister. Skriv på norsk i Markdown.`,
    prompt_en: `Create a neutral negotiation record from [Notater] and [Transkripsjon]: known participants, each side's stated position, offers and terms, explicit concessions, commitments, red lines only when stated, unresolved terms, risks that were explicitly raised, and next steps. Flag ambiguous or conditional promises. Do not infer hidden motives, legal conclusions, amounts, or deadlines. Reply in {LANGUAGE} using Markdown.`,
  },
  {
    value: "relationship_conversation",
    label_no: "Relasjon og hverdagssamtale",
    label_en: "Relationship & conversation",
    prompt_no: `Lag et kort og tilbakeholdent privat samtalenotat fra [Notater] og [Transkripsjon]. Ta bare med tydelige avtaler, relevante hendelser, uttalte preferanser og konkrete ting brukeren selv sa at hen vil følge opp. Skill sitat fra tolkning. Ikke utled følelser, personlighet, sensitive egenskaper eller varige personprofiler; ikke foreslå automatisk deling eller ekstern handling. Skriv på norsk i Markdown.`,
    prompt_en: `Create a brief, restrained private-conversation note from [Notater] and [Transkripsjon]. Include only clear agreements, relevant events, explicitly stated preferences, and concrete follow-ups the user actually expressed. Distinguish quotes from interpretation. Do not infer emotions, personality, sensitive traits, or enduring personal profiles; do not suggest automatic sharing or external actions. Reply in {LANGUAGE} using Markdown.`,
  },
  {
    value: "factual_record",
    label_no: "Fakta og bevis",
    label_en: "Facts & evidence",
    prompt_no: `Lag en nøktern hendelseslogg fra [Notater] og [Transkripsjon]: hvem som deltok når det er kjent, hendelsesrekkefølge, direkte uttalte fakta, viktige sitater og usikkerheter. Bevar motstridende opplysninger side om side. Ikke trekk konklusjoner om skyld, hensikt eller årsak som ikke uttrykkelig støttes. Oppgi aldri oppdiktede tidsstempler eller kilder. Skriv på norsk i Markdown.`,
    prompt_en: `Create a neutral factual record from [Notater] and [Transkripsjon]: known participants, event sequence, directly stated facts, material short quotes, and uncertainties. Keep conflicting accounts distinct. Do not draw unsupported conclusions about fault, intent, or causation, and never invent timestamps or sources. Reply in {LANGUAGE} using Markdown.`,
  },
];

const LANGUAGE_LABELS: Record<string, string> = {
  no: "Norwegian",
  en: "English",
  sv: "Swedish",
  da: "Danish",
  // Mirror of presets.rs — issue #167. "the input" includes the Norwegian
  // block labels and the `(ingen)` empty-notes placeholder; the transcript
  // is the only block that carries the meeting's own language.
  auto: "the same language as the transcript",
};

export function presetPromptForLang(preset: PresetSpec, lang: string): string {
  if (lang === "no") return preset.prompt_no;
  const label = LANGUAGE_LABELS[lang] ?? LANGUAGES.find((language) => language.value === lang)?.label ?? "English";
  return preset.prompt_en.replace("{LANGUAGE}", label);
}

export function presetLabelForLang(preset: PresetSpec, lang: string): string {
  return lang === "no" ? preset.label_no : preset.label_en;
}

// Built-in labels follow the app locale, independently of prompt/output
// language. Custom user-named prompts never pass through this function.
export function presetLabel(preset: PresetSpec): string {
  return translate(preset.label_en);
}

export function presetByValue(value: string): PresetSpec | undefined {
  return SUMMARY_PRESETS.find((p) => p.value === value);
}
