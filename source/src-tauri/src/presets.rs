// Summary presets, mirrored from the frontend so the backend can resolve a
// preset → prompt without round-tripping. Norwegian and English versions per
// preset; English uses {LANGUAGE} which we substitute at request time.
//
// Keep these in sync with src/lib/presets.ts::SUMMARY_PRESETS.

use crate::languages;

/// The built-in default preset. What an unknown or missing preset value
/// resolves to, and what the `custom` fallbacks in `resolve_prompt` use
/// when the user's own prompt row isn't available. Pinned to `ALL[0]` by
/// `the_default_preset_is_the_first_entry`.
pub const DEFAULT_SUMMARY_PRESET: &str = "meeting";

pub fn prompt(preset: &str, lang: &str) -> String {
    let entry = ALL.iter().find(|p| p.value == preset).unwrap_or(&ALL[0]);
    if lang == "no" {
        entry.no.to_string()
    } else {
        // Issue #167: "the input" includes this prompt's own Norwegian
        // labels and, when the user typed nothing, the Norwegian `(ingen)`
        // placeholder — so on `auto` the only language cue in reach was
        // Norwegian. The transcript is the one block that carries the
        // meeting's actual language.
        let label = if lang == "auto" {
            "the same language as the transcript"
        } else {
            languages::english_name(lang)
        };
        entry.en.replace("{LANGUAGE}", label)
    }
}

struct Preset {
    value: &'static str,
    no: &'static str,
    en: &'static str,
}

// Processing modes are semantic compilers, not folders: each has a distinct
// extraction contract while leaving source audio and transcript intact.
const ALL: &[Preset] = &[
    Preset {
        value: "meeting",
        no: "Du lager møtenotater fra [Notater] (brukerens) og [Transkripsjon] (automatisk). Samle alt som ble sagt om samme tema i én seksjon, selv når temaet ble tatt opp flere ganger. Skriv på norsk i Markdown.",
        en: "You produce meeting notes from [Notater] (user-written) and [Transkripsjon] (auto). Group everything said about the same topic into one section, even when it came up at several points. Reply in {LANGUAGE} using Markdown.",
    },
    Preset {
        value: "one_on_one",
        no: "Du lager notater fra en 1:1-samtale fra [Notater] (brukerens) og [Transkripsjon] (automatisk). Samle alt som ble sagt om samme tema i én seksjon, selv når temaet ble tatt opp flere ganger. Skriv på norsk i Markdown.",
        en: "You produce 1:1 notes from [Notater] (user-written) and [Transkripsjon] (auto). Group everything said about the same topic into one section, even when it came up at several points. Reply in {LANGUAGE} using Markdown.",
    },
    Preset {
        value: "lecture",
        no: "Du lager studienotater fra [Notater] (brukerens) og [Transkripsjon] (automatisk). Skriv på norsk i Markdown.",
        en: "You produce study notes from [Notater] (user-written) and [Transkripsjon] (auto). Reply in {LANGUAGE} using Markdown.",
    },
    Preset {
        value: "interview",
        no: "Du lager intervjunotater fra [Notater] (brukerens) og [Transkripsjon] (automatisk). Samle alt som ble sagt om samme tema i én seksjon, selv når temaet ble tatt opp flere ganger. Skriv på norsk i Markdown.",
        en: "You produce interview notes from [Notater] (user-written) and [Transkripsjon] (auto). Group everything said about the same topic into one section, even when it came up at several points. Reply in {LANGUAGE} using Markdown.",
    },
    Preset {
        value: "brainstorm",
        no: "Du oppsummerer en idémyldring fra [Notater] (brukerens) og [Transkripsjon] (automatisk). Skriv på norsk i Markdown.",
        en: "You summarize a brainstorm from [Notater] (user-written) and [Transkripsjon] (auto). Reply in {LANGUAGE} using Markdown.",
    },
    Preset {
        value: "voice_memo",
        no: "Du rydder opp i et stemmenotat fra [Notater] (brukerens) og [Transkripsjon] (automatisk). Behold brukerens stemme. Skriv på norsk i Markdown.",
        en: "You clean up a voice memo from [Notater] (user-written) and [Transkripsjon] (auto). Preserve the user's voice. Reply in {LANGUAGE} using Markdown.",
    },
    Preset {
        value: "knowledge_learning",
        no: "Lag læringsnotater fra [Notater] og [Transkripsjon]. Skill mellom begreper, påstander, konkrete fakta og talerens egne hypoteser. Ta med nyttige eksempler, motargumenter, ubesvarte spørsmål og mulige videre undersøkelser. Ikke finn på fakta eller kilder. Skriv på norsk i Markdown.",
        en: "Create knowledge-learning notes from [Notater] (user context) and [Transkripsjon] (automatic speech recognition). Extract core concepts, arguments, stated facts and evidence, useful examples or quotes, counterarguments, unresolved questions, and research leads. Distinguish what was explicitly said from interpretation; never invent facts, citations, or links. Reply in {LANGUAGE} using Markdown.",
    },
    Preset {
        value: "solution_decision",
        no: "Strukturer [Notater] og [Transkripsjon] som en beslutningslogg: problem, mål, begrensninger, fakta og antakelser, alternativer med avveininger, uenighet, uttrykkelige beslutninger, begrunnelse, handlinger og målepunkt. Ikke presenter et forslag som en vedtatt beslutning, og ikke finn på eiere eller frister. Skriv på norsk i Markdown.",
        en: "Compile [Notater] and [Transkripsjon] as a decision record: problem, goals, constraints, stated facts versus assumptions, options and trade-offs, disagreements, explicit decisions and their rationale, action items, owners or deadlines only when actually stated, success measures, and review date if stated. Never turn a proposal into an approved decision. Reply in {LANGUAGE} using Markdown.",
    },
    Preset {
        value: "research_interview",
        no: "Strukturer samtalen som intervjunotater: spørsmål og svar, uttrykte behov, konkrete eksempler, nyttige direkte sitater, motstridende utsagn, mulige innsikter og spørsmål som fortsatt må undersøkes. Skill respondentens ord fra tolkning, og ikke gjør én persons utsagn til et generelt funn. Skriv på norsk i Markdown.",
        en: "Compile [Notater] and [Transkripsjon] as research-interview notes: question/answer themes, explicitly stated needs, concrete examples, useful short direct quotes, contradictions, tentative insights, and questions still to validate. Separate the participant's words from interpretation; never generalize one person's statement into a population-level finding. Reply in {LANGUAGE} using Markdown.",
    },
    Preset {
        value: "business_negotiation",
        no: "Lag et nøkternt forhandlingsreferat: deltakere når de er kjent, hver parts uttrykte standpunkt, tilbud og vilkår, uttrykkelige innrømmelser, forpliktelser, røde linjer bare når de ble sagt, uavklarte punkter og neste steg. Merk uklare eller indirekte løfter. Ikke utled skjulte motiver, juridiske konklusjoner, beløp eller frister. Skriv på norsk i Markdown.",
        en: "Create a neutral negotiation record from [Notater] and [Transkripsjon]: known participants, each side's stated position, offers and terms, explicit concessions, commitments, red lines only when stated, unresolved terms, risks that were explicitly raised, and next steps. Flag ambiguous or conditional promises. Do not infer hidden motives, legal conclusions, amounts, or deadlines. Reply in {LANGUAGE} using Markdown.",
    },
    Preset {
        value: "relationship_conversation",
        no: "Lag et kort og tilbakeholdent privat samtalenotat fra [Notater] og [Transkripsjon]. Ta bare med tydelige avtaler, relevante hendelser, uttalte preferanser og konkrete ting brukeren selv sa at hen vil følge opp. Skill sitat fra tolkning. Ikke utled følelser, personlighet, sensitive egenskaper eller varige personprofiler; ikke foreslå automatisk deling eller ekstern handling. Skriv på norsk i Markdown.",
        en: "Create a brief, restrained private-conversation note from [Notater] and [Transkripsjon]. Include only clear agreements, relevant events, explicitly stated preferences, and concrete follow-ups the user actually expressed. Distinguish quotes from interpretation. Do not infer emotions, personality, sensitive traits, or enduring personal profiles; do not suggest automatic sharing or external actions. Reply in {LANGUAGE} using Markdown.",
    },
    Preset {
        value: "factual_record",
        no: "Lag en nøktern hendelseslogg fra [Notater] og [Transkripsjon]: hvem som deltok når det er kjent, hendelsesrekkefølge, direkte uttalte fakta, viktige sitater og usikkerheter. Bevar motstridende opplysninger side om side. Ikke trekk konklusjoner om skyld, hensikt eller årsak som ikke uttrykkelig støttes. Oppgi aldri oppdiktede tidsstempler eller kilder. Skriv på norsk i Markdown.",
        en: "Create a neutral factual record from [Notater] and [Transkripsjon]: known participants, event sequence, directly stated facts, material short quotes, and uncertainties. Keep conflicting accounts distinct. Do not draw unsupported conclusions about fault, intent, or causation, and never invent timestamps or sources. Reply in {LANGUAGE} using Markdown.",
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    // Issue #167 — "the input" is ambiguous when the notes are empty, and
    // the Norwegian block labels are part of "the input" too. Name the one
    // block that actually carries the meeting's language.
    #[test]
    fn auto_points_every_preset_at_the_transcript() {
        for p in ALL {
            let out = prompt(p.value, "auto");
            assert!(
                out.contains("the same language as the transcript"),
                "{}: {out}",
                p.value
            );
        }
    }

    // `prompt` falls back to `ALL[0]` for an unrecognised preset, so the
    // named default has to be that same entry or the two disagree about
    // what "the built-in default" means.
    #[test]
    fn the_default_preset_is_the_first_entry() {
        assert_eq!(ALL[0].value, DEFAULT_SUMMARY_PRESET);
        assert_eq!(
            prompt("no-such-preset", "en"),
            prompt(DEFAULT_SUMMARY_PRESET, "en")
        );
    }

    #[test]
    fn explicit_language_substitutes_its_english_name() {
        assert!(prompt("meeting", "en").contains("Reply in English"));
        assert!(prompt("meeting", "no").contains("Skriv på norsk"));
    }

    #[test]
    fn semantic_compilers_have_distinct_safety_contracts() {
        assert!(prompt("knowledge_learning", "en").contains("never invent facts"));
        assert!(prompt("solution_decision", "en").contains("Never turn a proposal into an approved decision"));
        assert!(prompt("research_interview", "en").contains("never generalize one person's statement"));
        assert!(prompt("business_negotiation", "en").contains("Do not infer hidden motives"));
        assert!(prompt("relationship_conversation", "en").contains("Do not infer emotions"));
        assert!(prompt("factual_record", "en").contains("never invent timestamps or sources"));
    }
}
