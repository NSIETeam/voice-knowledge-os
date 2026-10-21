# Nemotron 3 diarization: target default deferred pending acceptance

> **Current status (2026-09-27):** The default decision in this proposal has
> not shipped. macOS currently defaults to Sortformer; Nemotron 3 is an
> experimental opt-in in Settings. Do not change the default until echo
> cancellation, public Mandarin evaluation, real-device inference, and the
> packaged model lifecycle are accepted. The current release gate is
> `docs/RELEASE_ACCEPTANCE.md`.

Humla diarizes each capture stream once, after stop. Until now there were two engines. The default was community-1: pyannote segmentation plus VBx clustering, via FluidAudio's `OfflineDiarizerManager`. The opt-in was Sortformer v2.1: NVIDIA's end-to-end model, capped at four speakers. The default path was the unreliable one. With the note's speaker count on Auto, VBx picks its own cluster count, and on any conversation one person dominates it picks one: a 45-minute three-person meeting came back as a single speaker. Setting the count fixes it, but every note starts on Auto, and most notes stay there.

NVIDIA released Nemotron 3 Diarization on 2026-09-23. It is Sortformer's successor: the same end-to-end family, up to eight speakers, arrival-order channels, and the permissive OpenMDW-1.1 licence. FluidAudio v0.17.0 shipped a CoreML port the same day. NVIDIA's card compares it against exactly the checkpoint Humla ran as Sortformer, `diar_streaming_sortformer_4spk-v2.1`. Offline DER falls from 21.42 to 11.14 on AMI single distant mic, and from 30.49 to 11.00 on NOTSOFAR1 single channel. Nemotron at any of its latency settings beats v2.1's best on every meeting set. It loses only on two-speaker telephone calls (CALLHOME, 5.68 → 5.98).

A local spike on an M1 Max tested this on the "Test audio" note, a 211 s capture with raw streams kept. The clean system stream held five podcast voices. Nemotron found five on Auto, and two splits the other engines disputed were confirmed by listening. Sortformer found four, as its cap forces. community-1 found one on Auto. Given the correct count of five, community-1 still merged a pair confirmed by listening to be two people, and made up the number by splitting a voice that the three other runs agree is one.

The product direction is to evaluate **Nemotron 3** as the long-term default,
using FluidAudio's `Nemotron3Diarizer` with the `fast128` preset. This is a
target, not an accepted shipping decision: the real-M1 spike and NVIDIA's
benchmarks do not cover the echo-contaminated mic path or the public Mandarin
fixtures required by HoneyVoice. Until those gates pass, retain the current
Sortformer default, keep Nemotron opt-in, and do not remove either existing
engine.

## Considered Options

- **Keep the verified current default and add Nemotron as an experimental option.** Accepted as the interim shipping state. Revisit only after the open acceptance gates pass.
- **Replace Sortformer only.** This was the first proposal. It was superseded because the evidence says Nemotron is better on exactly the default path.
- **Route by the count: a set count goes to community-1, Auto goes to Nemotron.** Rejected on the spike. community-1 given the correct count still mis-partitioned, so the count fixes the number of speakers, not who they are. Routing survives only above eight, where community-1 is the one engine that can represent the meeting.
- **Use the count as a cap on Nemotron by merging its smallest clusters.** Rejected for now. It needs new merge logic, Nemotron exposes no embedding to merge by, and it can only ever fix over-splitting.
- **The `c128-split-w8a8` preset (95 MB, FluidAudio's batch pick).** Rejected. On the M1 Max Neural Engine it outputs speaker probabilities near 0.5 everywhere, silence included. CPU and GPU compute it correctly, so this is a W8A8-on-older-ANE fault. `fast128` (fp16, 193 MB) matched CPU on the same Neural Engine (mean |Δ| 0.0003) and diarized 56 minutes in 14 s.
- **Move existing installs silently.** Rejected. A 193 MB download and a one-time Neural Engine compile of about 100 s should not happen behind the user's back.

## Consequences

- **Echo cancellation is a prerequisite, and the switch ships with or after it.** When a call plays through the speakers, the mic stream carries every remote voice as echo, about 16 dB down and 157–420 ms late depending on the setup. community-1 merges that echo with the user into one cluster, so "You" is earned by accident. An end-to-end engine reports each echoed voice as a speaker, so "You" is never earned. On a speaker-played call that is a regression unless the diarize input is echo-cancelled first.
- **The speaker-count chip matters only above eight.** Up to eight, Nemotron ignores `expected_speakers`. A count above eight routes the whole note to community-1 with the hint, which keeps today's hybrid split of that total. The chip stays visible.
- **Migration/onboarding changes are deferred.** Do not migrate saved engines, auto-download Nemotron, or delete existing model caches until a separately reviewed rollout plan defines opt-in, rollback, fallback semantics, and download/compile UX.
- **FluidAudio moves from 0.14.2 to 0.17.1, which crosses its PR #802.** That change inverted community-1's `clusteringThreshold` to pyannote semantics: larger now merges more and yields fewer speakers. The sidecar maps Humla's stored value with `sqrt(2 − 2·old)` (0.5 → 1.0), so settings, UI copy and CLAUDE.md keep their meaning. #802 also changed how a fixed count is enforced, so community-1's output may still shift slightly.
- **The evidence is thin where the promise is biggest.** It rests on NVIDIA's published benchmarks, one clean 3.5-minute podcast, and one 56-minute call, all at 16 kHz mono. In-person meetings with several people on one laptop mic are the case this is meant to fix, and they are untested. Norwegian is not in Nemotron's training data. Diarization is largely acoustic and Sortformer had the same gap, but a Norwegian in-person recording is the next measurement to take.
