# HoneyVoice release acceptance

This is the release gate for the macOS desktop app. A successful compile, unit
test run, or ad-hoc launch is not evidence that microphone/system-audio capture
works on a user's Mac. Record the exact source revision, app signature, macOS
version, hardware, and test result for every release candidate.

## Current local evidence

Last checked on 2026-09-27 on Apple Silicon macOS 26.5.1 (25F80). The source directory used for
this check has no `.git` metadata, so it cannot establish an exact source commit
or be used as a release checkout.

| Gate | Result | Evidence / remaining work |
| --- | --- | --- |
| Frontend suite | Pass, current unreleased source | `pnpm exec vitest run`: 93 files / 1088 tests passed, including Obsidian export preview/confirmation/cancel, note-summary success/failure handling, and the app-level cold-start deep-link route through first-run onboarding. `pnpm exec tsc --noEmit` and `pnpm build` pass; Vite reports the existing setupStatus mixed-import and large-chunk warnings. |
| Rust library suite | Pass, current unreleased source | `cargo test --locked`: 831 passed, 0 failed, 6 ignored. Includes preview-without-write, changed-file conflict, newly-created-target conflict, existing managed-section preservation, and Obsidian metadata round-trip/escaping tests. |
| Whisper model bootstrap | Pass, native download path; installed UI pending | Real Medium Q5 download using the new downloader, ModelScope mirror and TLS verification completed with an independent on-disk SHA-256 recheck. Source changes are not yet installed; installed-app/download UI acceptance remains required. |
| macOS app build | Pass, isolated 0.1.3 candidate; not installed | Rebuilt the latest source, including Obsidian processing-profile/client frontmatter metadata, through the full native preparation hook and Tauri bundler at `/private/tmp/honeyvoice-candidate.Rgv2R9/cargo-target/release/bundle/macos/HoneyVoice.app`. `codesign --verify --deep --strict` passes; signature is ad-hoc with hardened runtime, not Developer ID/notarized. SHA-256: `humla` `ee8e11a0f4a391146c4905b856b6ae9366c9c07e97dc2e13885aa03bf790437f`; `macos-speech` `0a5e5c345a331a2ee023e8560afe4c5d4564fd09eb0d939b931cbb7902665020`; `audio-capture` `6da1504745126516eaa87a31908e1cc390445f1a9770503e9d87d1002e962f73`; `speaker-diarize` `bb26266b6f5095bd4aac58ac8ca86dd56230a46b89eb801596f642eae72a2f2e`; `humla-mcp` `0fca74ab32ba6ca3a13270e4ee480a01658789a987a9422d3ab4b6327c3de10c`. Version 0.1.3, arm64, minimum macOS 14.0; `honeyvoice` URL scheme is present. Candidate lives in a temporary build path and has not been launched or installed. The installed HoneyVoice remains open, so the install script correctly refuses replacing `/Applications/HoneyVoice.app`; use its reversible backup path after the app quits. |
| Obsidian Vault export safety | Pass, source-level and packaged | Export now prepares a before/after preview without modifying the Vault. Explicit confirmation is required to create or update a file; cancel discards the preview. Commit refuses changed existing content or a target that appeared after preview. UI suite and Rust safety tests pass. The installed 0.1.2 app lacks the URL scheme. A previous home-directory 0.1.3 candidate registered and resolved under LaunchServices; the latest candidate declares `honeyvoice` but is under `/private/tmp`, where LaunchServices does not offer it as a handler. Runtime URL event delivery after installation remains unverified. A native Obsidian plugin is not implemented. |
| Obsidian knowledge metadata | Pass, source-level and packaged | New Vault exports include the note's processing profile and associated Client name in quoted HoneyVoice frontmatter fields (`honeyvoice_processing_profile`, `honeyvoice_client`); names are JSON/YAML escaped. Re-export updates those owned fields, adds them to older HoneyVoice files, and preserves user-owned frontmatter. Focused export tests and the full Rust suite pass. This does not yet add independent conversation-scene or People/Project entities. |
| Obsidian transcript provenance and audio return | Source queue tested; installed runtime pending | Export keeps session-local timestamps, speakers, and stable block IDs. When that session has local playback, each timestamp links to a validated `honeyvoice://open?note=…&session=…&t=…` URL; HoneyVoice routes to the note and seeks that session without autoplay. Sessions without playback get plain timestamps; audio is never copied to the Vault. The latest isolated 0.1.3 candidate's `Info.plist` declares `honeyvoice`; the earlier home-directory candidate registered and resolved through LaunchServices. The latest build sits under `/private/tmp`, where LaunchServices does not currently offer it as a URL handler, so dispatch must be rechecked after installation to `/Applications`. Installed 0.1.2 lacks `CFBundleURLTypes`. Cold-start link receipt and post-onboarding navigation pass an app-level integration test plus three queue unit tests; a native Obsidian plugin remains unimplemented. |
| Summary audio-citation navigation | Local resolver implemented; generation still open | Summary Markdown now intercepts valid `honeyvoice://` links and switches to the transcript player at the cited session/time. Resolution requires the current note, an exact timeline start time, a non-empty turn, and a session with local playback; invalid or invented links do nothing. Target tests cover valid and rejected citations. The model prompt has not yet been changed to receive speaker/time/note/session evidence metadata; explicit authorization for sending that additional metadata to the configured MiMo endpoint is pending. |
| Human transcript review marks | Source lifecycle implementation and focused tests pass | Each transcript turn can be marked “待核验” or “重叠发言”; flags persist in the local session timeline used by sync, appear in Obsidian export, and carry through re-transcription/re-diarization and cross-session unification by audio-time overlap within the same stream. Focused regressions cover rechunking/stream isolation (4 Rust review tests), all 20 speaker-unification tests, 2 export tests, and 44 frontend tests. Actual shared-workspace multi-device round-trip and installed-app interaction remain unverified. |
| Local source-audio ledger | Source implementation + focused tests; candidate built | At capture finalization, a write-once local ledger records per-stream SHA-256 and byte length before temporary source WAVs are removed. The session strip can verify retained streams and show expected/current hashes for a mismatch. The ledger is intentionally excluded from cloud assets and does not retain audio; legacy flat-session migration carries it into the new session directory. Rust ledger tests (3/3), migration regression, focused UI/session tests (18/18), TypeScript check, production frontend build, and the rebuilt candidate pass. Actual capture acceptance and installed-app interaction remain open. |
| Hybrid-call echo cancellation | Pass, synthetic known-answer only | Delay tracking + AEC now feed a temporary derived mic WAV to post-stop and manual hybrid diarization when alignment and quality gates pass. Raw mic/system WAVs are hash-verified unchanged in integration tests; short, silent, mismatched, or weak-evidence takes fall back to raw mic. DSP suite 18/18; app integration suite 4/4. No new real human-call A/B result has been recorded, so diarization remains unaccepted. |
| Installed app launch | Pass, restored 0.1.2 | The restored `/Applications/HoneyVoice.app` launched through the desktop app selector and displayed the original three notes. Candidate 0.1.3 remains in the release bundle directory; no user notes were created or changed during this smoke test. |
| Microphone permission UI | Pass, local candidate | Current 0.1.2 reports granted after the macOS prompt; real microphone WAV contains frames and nonzero signal. |
| ScreenCaptureKit permission | **Pass, local candidate** | Removing the stale HoneyVoice entry, re-adding `/Applications/HoneyVoice.app` and restarting restored access. Merely adding an already-listed app did not refresh the old requirement. 0.1.2 reports granted and captures system audio. See the root-cause evidence below. |
| Real microphone + system-audio recording | **Pass, bounded local smoke** | 0.1.1: start/pause/resume/stop saved both streams. After updating and refreshing grants, 0.1.2 saved a new 37.59-second take with independent, nonzero mic/sys WAVs. This is not clean-host, multi-device or release-signed acceptance. |
| Real transcription | Pass, bounded Chinese fixture | Medium Q5 + Metal processed a synthetic Chinese WAV, and the installed 0.1.2 UI now preserves the complete model text. Corrected a UTF-8/BPE word-timing bug that had dropped Chinese characters. Model accuracy is not perfect; see below. |
| Apple SpeechTranscriber | **Pass, bounded synthetic fixture with source timing** | On macOS 26.5.1, the bundled helper reports `zh_CN` supported/installed and transcribed the system-generated Chinese fixture with 50 attributed audio-time ranges, from 0–12,360 ms. The Rust adapter preserves these ranges in the common chunk timeline; a legacy JSON response without ranges remains compatible. Output had one lexical substitution, so this proves runtime and timing wiring, not accuracy on real meetings. Current bundled helper SHA-256: `0a5e5c345a331a2ee023e8560afe4c5d4564fd09eb0d939b931cbb7902665020`. No personal recordings were used. |
| Fresh-install transcription default | **Pass, automated onboarding coverage** | On a supported macOS/language, a successfully read fresh-install fallback selects Apple Speech, writes the provider config, prepares missing Apple language assets and enables Continue without a Whisper download. Existing local/cloud choices remain unchanged; failed config or Keychain reads do not trigger the automatic write. The installed app has not been replaced with this frontend change. |
| Speaker diarization | **Bounded Mandarin controls pass; real meetings not accepted** | macOS fresh installs default to Sortformer. The current candidate's bundled helper was rerun with native user-cache access: the 32.034-second Tingting/Meijia A/B/A/B fixture passed with four segments, correct identities, 100% coverage on every turn, zero registry requests, and model/silence/corrupt-cache controls passing. Community-1 and experimental Nemotron fail specific Chinese controls. This is not a real-meeting accuracy benchmark; real conversations and installed-app UI acceptance remain open. |
| macOS compatibility | **Open release gate** | App metadata now advertises 14.0, matching the diarization helper's declared minimum. This removes the known packaging mismatch, but native evidence is still only on macOS 26.5.1; clean-host testing on macOS 14 and the pinned FluidAudio macOS 14 BNNS warning remain unresolved. |
| Developer ID signing / notarization | **Blocked** | No valid signing identity is installed; `.env.notarise` is absent. `scripts/release.sh` must reject this machine's current ad-hoc build. |
| Update and rollback | Not verified | There is no official release or in-app installer; validate the published DMG and manual update/rollback path when signing is available. |
| Release-channel targeting | Pass, guarded | The previous UI/backend checked `NSIETeam/voice-knowledge-os`, whose public repository does not currently contain this HoneyVoice source. Update checks now report “not configured” without making that request; set `HONEYVOICE_RELEASES_API` only after the official HoneyVoice release endpoint is confirmed. |
| Windows acceptance | Not assessed here | Keep the Windows installer, clean-host bootstrap, capture, and lifecycle matrix as a separate release gate. |
| MiMo live integration | **Pass, native provider path; installed-app acceptance pending** | On 2026-09-27, both opt-in `live_mimo_coding_plan` tests passed against `https://token-plan-cn.xiaomimimo.com/v1` in 5.69 seconds using hidden terminal input. Authenticated model discovery/summary completion and streamed chat completed. Only synthetic prompts were sent; the key was not saved. Source includes MiMo onboarding and Settings setup, Keychain-backed credential storage, model discovery, and per-note summary generation; the focused MiMo setup/key/summary UI suite passed 59 tests on 2026-09-27. New note-action coverage confirms summary requests carry the selected note ID and provider errors are surfaced. Installed-app end-to-end acceptance remains pending. Do not send transcript evidence metadata to MiMo without explicit authorization. |

## Required macOS release gates

### Nemotron 3 opt-in integration and public Mandarin evaluation — 2026-09-27

The 0.17.4 FluidAudio `Nemotron3Diarizer.fast128` path is now wired through
the Swift sidecar, Rust engine selection/model gates, Tauri progress events,
frontend model store, Chinese Settings UI, and explicit download/delete
commands. The existing Sortformer fresh-install default was not changed. The
macOS sidecar was rebuilt through `scripts/build-diarize.sh`; its SHA-256 is
`46ea948d1282ef57e59d2059f86da13ea2a86dc90e1d09fa5d5ab36606f03bff`.
Its status command correctly reports Nemotron's independent cache while the
existing Sortformer cache remains visible.

Evaluation used a temporary mirror-downloaded 199,096,435-byte cache and
hash-pinned Apache-2.0 AISHELL-3 fixtures (repository revision
`f20d5db4a31fe779ef07bb1af4ea92da5c786622`). The model cache was deleted
through the sidecar after testing; the temporary directory was removed. All
inference runs used an HTTP registry trap and recorded zero model-registry
requests. Missing/stale cache rejection, silence behavior, isolated deletion,
and idempotent delete passed.

| Fixture | A/B/A/B speaker identity | Coverage after 350 ms collar | Result |
| --- | --- | --- | --- |
| AISHELL-3 short, default threshold 0.5 | S0/S1/S0/S1 | 0.615/0.579/0.529/0.556 | **Fail** (<0.70 per turn) |
| AISHELL-3 short, diagnostic threshold 0.25 | S0/S1/S0/S1 | 0.633/0.631/0.548/0.576 | **Fail** (<0.70 per turn) |
| AISHELL-3 long | S0/S1/S0/S1 | 1.000/0.980/1.000/0.968 | Pass, bounded control only |
| macOS Mandarin TTS, 32.034 s | S0/S0/S0/S0 | 1.000/1.000/0.966/1.000 | **Fail** (two voices merged) |

This is not DER or a real-meeting benchmark. It shows that threshold lowering
does not fix short-turn coverage and that high coverage on long turns does not
guarantee distinct voice identities. Nemotron remains experimental; do not
recommend it for Mandarin, set it as default, or claim overall quality
acceptance. The extra Settings prediction-threshold control is diagnostic,
not a quality workaround. Echo cancellation and real mic/system playback
evaluation are still required before reconsidering the default.

The evaluation exposed two test/release defects which were fixed: the
prebuilt sidecar had not been refreshed after source changes, and the local
fixture runner omitted `--engine` on status/delete calls (silently exercising
Community-1 instead). Rebuilding the sidecar and explicitly routing every
lifecycle command now makes the test evidence attributable to the requested
engine. Full app candidate build/install remains pending for this source state.

### Previous 0.1.3 candidate with Apple Speech and macOS 14 floor — 2026-09-27 (superseded)

`pnpm tauri build --bundles app` completed through the shared native build
hook. The app bundle's `LSMinimumSystemVersion` was independently read back as
`14.0`, matching `speaker-diarize/Package.swift`. The helper inside the bundle
reported Chinese assets installed and transcribed a short system-generated
Chinese speech fixture. `codesign --verify --strict --deep` passed.

| Bundle component | SHA-256 |
| --- | --- |
| `Contents/MacOS/humla` | `b428745bf59de78083a3ab95ca271d7a6c00102cfa81c3eca64a548672e6a50a` |
| `Contents/MacOS/macos-speech` | `d48fd956e6c9e2eabc0d0eb73367d0de7af501858fafaeb19a11ba7822c1ef88` |
| `Contents/MacOS/audio-capture` | `6da1504745126516eaa87a31908e1cc390445f1a9770503e9d87d1002e962f73` |
| `Contents/MacOS/speaker-diarize` | `31f5d3da2713cb05abf8f2c20dcd99957f3a3c8d0baddc45691038b0f45a1fa2` |
| `Contents/MacOS/humla-mcp` | `6b95fa7441b659b424e8ea1de4095cf6b233b41f2ad167aef62fe8fe5f041210` |
| `Contents/Resources/default.metallib` | `21dedc65b43580ec0ff48e8a0a8c2c4edb24959324f3944c9be0c471895f78c1` |

This remains an ad-hoc local candidate: notarization was skipped because no
Apple Developer credentials are configured. No GUI launch, install, DMG, or
public release occurred; the installed 0.1.2 app is unchanged. This source
directory has no `.git` metadata, so the exact source revision is unknown.

Final checks for this source state: frontend 1059 passed across 89 files;
TypeScript passed; Rust 807 passed and 6 ignored. The two live MiMo tests
passed through hidden credential input; no key was persisted. See the gate
table above for the remaining real-device, diarization, signing, compatibility,
and app-level provider checks.

### Previous 0.1.3 candidate with AI settings fixes — 2026-09-27

`CARGO_NET_OFFLINE=true pnpm tauri build --bundles app -- --locked` completed
successfully after the final source checks. The existing native build chain
verified capture, diarization, Metal and MCP inputs; the production frontend
was built and embedded in the host. Version 0.1.3, arm64, bundle identifier
`com.miraphant.voice-memory`, output:
`src-tauri/target/release/bundle/macos/HoneyVoice.app`.

| Bundle component | SHA-256 |
| --- | --- |
| `Contents/MacOS/humla` | `9c85002e63840276cff239620f4bc104b1e62ce2e830c0be8d955841603c5dc0` |
| `Contents/MacOS/audio-capture` | `6da1504745126516eaa87a31908e1cc390445f1a9770503e9d87d1002e962f73` |
| `Contents/MacOS/speaker-diarize` | `655663fd8ae812aaf24edcac68a6b9105ad92d5df1cff6dea465d52b167f0add` |
| `Contents/MacOS/humla-mcp` | `4a447e03d74fe45d82383fc9b7e29c19c16769879e9b6abaaf75a7373a1165aa` |
| `Contents/Resources/default.metallib` | `21dedc65b43580ec0ff48e8a0a8c2c4edb24959324f3944c9be0c471895f78c1` |

`codesign --verify --deep --strict` passes. The identity remains ad-hoc with
no developer team; notarization was explicitly skipped because credentials
are absent. This supersedes the lifecycle-only candidate checksum below,
not the installed application. No candidate GUI launch, install, TCC reset,
DMG or public release occurred. The reused precompiled Metal library and
missing Git metadata still prevent a clean-host source-provenance claim.

### AI settings and configuration lifecycle — 2026-09-27

Scope: existing Humla controls, HoneyVoice's unchanged blue-gray tokens,
Chinese Summary/Chat settings, custom prompt editor, and the configuration
lifecycle used by the already-mounted personal chat view. No real credentials,
notes or recordings were read or sent to a provider in this pass. Installed
0.1.2 was not restarted/replaced and permissions were not reset. Its host and
capture hashes still match the installation record below.

Five focused regressions first failed on the old implementation: saving a key
did not update other hook consumers/model lists; rotating an existing key did
not refresh models; a committed endpoint change left an old model listing;
late test results could appear on a different provider; and late initial
key reads could overwrite a successful save. The patch adds secret-free
per-provider revision counters after native commits, scoped async results,
duplicate-operation guards and save/test busy states. Keys/drafts are never
placed on the notification bus. Successful native writes are reflected in
onboarding test mocks; existing commit/failure assertions remain intact.

- MiMo endpoint typing stays local until **Save endpoint**. Frontend and Rust
  both validate HTTPS without URL credentials/query/fragment. Failed native
  persistence keeps the committed destination; the draft remains editable for
  retry. Only successful writes invalidate model lists and connection verdicts.
  Late model listings from previous destinations cannot restore old results.
- Settings is a dialog over a pinned Note/Chat view. Its committed provider,
  model and local-server changes now update chat readiness without a remount;
  late initial snapshots cannot overwrite newer settings. Initial key reads
  wait for the configured provider, avoiding unrelated Keychain prompts.
- A pending Keychain read is not a missing key. The composer keeps its draft
  and DOM while displaying a checking placeholder; Send remains disabled until
  personal readiness is known. Workspace readiness remains a separate path.
  The complete chat send/stream/stop, scope and workspace tests pass.
- Owned static/dynamic copy is localized; provider/model IDs, endpoint text,
  user prompt drafts and arbitrary backend errors remain unchanged. Prompt
  validation appears inside its modal, not hidden behind it. Locale switches
  preserve drafts. Index rebuilding explicitly discloses possible excerpt
  transmission and provider charges instead of asserting a price.
- Browser-only visual QA used synthetic `ai-summary` and `ai-chat` mock
  scenarios: light Summary, Chinese prompt modal and its validation error;
  dark Chat and rejected HTTP endpoint. Existing layout and palette were
  retained. This is **not** installed native/Keychain/live-provider acceptance.

Final source checks: 1058 frontend tests in 89 files; TypeScript passes; lint
0 errors/7 pre-existing warnings; Rust 806 passed/6 ignored. Previous public
Mandarin diarization failures remain failed. The app-level credential setup,
note-to-summary/chat flow with MiMo, native window QA, signing/notarization,
source provenance, installation/update/rollback and OS compatibility remain
open release gates. No user key was saved during these checks.

### Earlier lifecycle-only 0.1.3 candidate — 2026-09-27

`CARGO_NET_OFFLINE=true pnpm tauri build --bundles app -- --locked` completed
using the shared native hook, including all three executable helpers and the
Metal library. The generated bundle is
`src-tauri/target/release/bundle/macos/HoneyVoice.app`, version 0.1.3, arm64,
identifier `com.miraphant.voice-memory`. This checkpoint superseded the earlier
candidate recorded below and included speaker lifecycle/failure-handling changes,
but not the subsequent AI settings/configuration changes described above.

| Bundle component | SHA-256 |
| --- | --- |
| `Contents/MacOS/humla` | `5d85c15802e9c4bce9d7eea61e6b95a3f9894e7734790f9bb7e11b03a798d1fa` |
| `Contents/MacOS/audio-capture` | `6da1504745126516eaa87a31908e1cc390445f1a9770503e9d87d1002e962f73` |
| `Contents/MacOS/speaker-diarize` | `655663fd8ae812aaf24edcac68a6b9105ad92d5df1cff6dea465d52b167f0add` |
| `Contents/MacOS/humla-mcp` | `d454cd20440cd372b77e55c42e81792379ae93d103e39a728a50ffed011ef251` |
| `Contents/Resources/default.metallib` | `21dedc65b43580ec0ff48e8a0a8c2c4edb24959324f3944c9be0c471895f78c1` |

`codesign --verify --deep --strict` passes; identity is ad-hoc, team unset.
The bundled diarizer's read-only status command sees both installed model
caches. No GUI launch, recording, permission prompt, installation, or DMG is
claimed. The standalone helper used for real-model tests has the separately
recorded pre-bundling signature/hash. Final bundling re-signs nested executables.
Mach-O minimum OS values are host 13.0, capture 13.0, diarizer 14.0 and MCP
11.0; this confirms, rather than resolves, the compatibility gate. The app is
not suitable for public release while Chinese diarization, signing/notarization,
source provenance and installed end-to-end acceptance remain open.

### Public Mandarin controls and honest failure handling — 2026-09-27

No installed app was replaced/restarted, no privacy permissions were reset,
and no user notes or recordings were opened, altered, or uploaded. Public
fixtures are opt-in downloads into automatically removed temporary folders.

- Reused the two existing FluidAudio engines, not a new recognition algorithm.
  Community-1 cache is 21786966 bytes. Sortformer High Context v2.1 FP16 cache
  is 255245283 bytes; the native mirror download completed successfully.
  No default engine or thresholds were changed to make a control pass.
- AISHELL-3 is a public Mandarin multi-speaker corpus with Apache 2.0 licensing
  ([official source](https://www.openslr.org/93/)). Manifests pin the dataset
  repository revision `f20d5db4a31fe779ef07bb1af4ea92da5c786622`, file sizes,
  SHA-256 values, speaker IDs and selection rules chosen before inference.
  Only the manifests are shipped, not the audio. Short control: first six
  lexical test utterances per speaker, 1496822 download bytes. Long control:
  first two lexical train utterances per speaker within the declared size
  range, 1868672 bytes. Speakers are SSB0009 and SSB0011 in both controls.
- The test downloader uses native URLSession/system trust, HTTPS-only redirects
  and bounded streaming, without cookies or credentials. It does not disable
  certificate verification to work around this host's curl/Xet certificate
  failure. Every fixture was independently size/hash checked and had nonzero
  normal-volume signal. The two macOS Mandarin TTS voices also produced distinct
  PCM hashes; an identical-voice fallback does not explain that control's loss.

| Four alternating turns (A/B/A/B) | Community-1 auto / known-two | Sortformer auto |
| --- | --- | --- |
| Mandarin TTS, 32.034 s | Fail: S1/S1/S1/S1 in both modes | Pass: S0/S1/S0/S1, 13 segments |
| English TTS control | Pass: S1/S2/S1/S2 in both modes | Not tested |
| AISHELL-3 short, 21.06475 s | Fail: no output segments in both modes | Fail: no output segments |
| AISHELL-3 long, 24.0846875 s | Fail: S1/S1/S1/S2 in both modes | Fail: no output segments |

This is a bounded control, **not DER or a real-meeting quality benchmark**.
Pass requires stable alternating identities and at least 70% coverage of each
turn after a 350 ms boundary collar. Mandarin Sortformer coverage was
0.987/0.938/0.928/0.798. All selected-engine silence checks passed, with zero
connections observed by the local inference registry trap. Corrupt-cache and
deletion checks cover Community-1 only. Sortformer tests used the helper's
default silence threshold (0.2), not the app setting default (0.5); packaged UI
accuracy cannot be inferred. Community-1 debug diagnostics detected speech and
embeddings on the short fixture but reconstruction returned no segments. The
upstream output duration filter is coupled to the minimum embedding duration;
the exact quality failure remains unresolved and was not patched with tuning.

The failed controls exposed a separate, deterministic product defect:
live capture used to convert errors/empty results into fabricated `Speaker 1`
or `You` labels, while deferred single-stream transcription kept identity
unknown. Both live/replay hybrid paths now share one splitter. Missing/failed
streams retain text, word timestamps and source without invented identity;
unlabelled turns cannot merge into adjacent known speakers through text-cleanup
heuristics. A user-requested re-diarize rejects an incomplete hybrid result
before replacing that recording's labels. Tests cover projections, timing,
partial/total failure, lowercase continuations and literal colons. This repairs
failure semantics, **not nonempty but inaccurate model predictions**. Chinese
owned notices are translated through an exact allowlist; other errors stay intact.

### Diarization duration-filter A/B follow-up — 2026-09-27

The duration-filter hypothesis was tested with explicit diagnostic-only CLI
overrides (`minSegmentDuration=0.3 s`, `segmentationMinDurationOn=0.3 s`,
`segmentationStepRatio=0.1`). The shipping defaults remain 1.0 s / 1.0 s / 0.2.
This is reproducible diagnosis, not a quality fix.

| Pinned AISHELL-3 fixture, Community-1 | Auto | Known two speakers | Gate |
| --- | --- | --- | --- |
| Short, 21.06475 s | 12 segments; all turns S1; coverage 0.603/0.524/0.465/0.552 | 12 segments; early turns S2, final turn S1; coverage 0.603/0.524/0.465/0.371 | Fail |
| Long, 24.0846875 s | 5 segments; alternating S2/S1/S2/S1; coverage 0.493/0.969/0.986/0.765 | Same alternating sequence; coverage 0.493/0.969/0.986/0.957 | Fail |

An additional AHC threshold sweep (0.3 and 0.6) did not change the short
fixture's all-S1 assignment or turn coverage. Inference made zero network
registry requests; only explicitly opted-in, hash-pinned public fixtures were
downloaded, then their temporary directory was removed. Lowering the
reconstruction filter helps the long fixture find alternating identities but
still misses the first turn's 70% coverage gate; it does not rescue the short
fixture. No Community-1 defaults were changed. The following Sortformer check
addresses short same-speaker holes without changing model thresholds.

### Sortformer timeline continuity fix — 2026-09-27

The application's Sortformer thresholds were not the cause of the sparse
timeline: explicit A/B settings (`predScoreThreshold=0.12` and
`silenceThreshold=0.05`) produced identical segments and coverage to the app
profile. The actual defect was that the model emits short, same-speaker islands
inside continuous turns. The sidecar now merges only consecutive segments with
the same speaker when their gap is at most 1000 ms. Any intervening segment,
including another speaker, prevents merging. Labels, overlaps, and turn order
are not otherwise rewritten. `--max-same-speaker-gap-ms 0` preserves raw model
output for diagnostics.

| Application Sortformer profile | Segments before → after | A/B/A/B identities | Coverage after 350 ms collar | Gate |
| --- | --- | --- | --- | --- |
| Mandarin TTS, 32.034 s | 13 → 4 | S0/S1/S0/S1 | 1.000/1.000/1.000/1.000 | Pass |
| AISHELL-3 short, 21.065 s | 12 → 4 | S0/S1/S0/S1 | 0.983/0.982/0.995/0.981 | Pass |
| AISHELL-3 long, 24.085 s | 5 → 4 | S0/S1/S0/S1 | 0.995/0.971/0.994/0.955 | Pass |

All three controls report zero model-registry requests during inference. The
AISHELL manifests and fixture-download hashes remain pinned as documented
above; files were isolated in disposable temp directories. This closes the
bounded Mandarin Sortformer fixture gate, **not** real-meeting accuracy or
Community-1 quality: Community-1 remains inaccurate on these Chinese controls,
but macOS fresh installs now default to Sortformer. Existing saved engine
choices are preserved. Onboarding names the selected engine and approximate
download size; Continue starts its local model download, while Skip does not
download the speaker model. This behavior passed the onboarding/settings UI
regressions. macOS user-path selection, real microphones/calls, voice
enrollment/confirmation, and broad DER evaluation remain release gates.

### Refreshed macOS app candidate — 2026-09-27

After Nemotron's evaluation was recorded, the current source was rebuilt with
`CARGO_NET_OFFLINE=true pnpm tauri build --bundles app -- --locked`. The
candidate is `src-tauri/target/release/bundle/macos/HoneyVoice.app` (0.1.3,
arm64, minimum macOS 14.0). `codesign --verify --deep --strict` passes. Its
fresh-install default remains Sortformer; its bundled Nemotron status command
correctly reports the separate Nemotron cache as not downloaded. The app was
not launched or installed; no DMG was made.
Signing is ad-hoc and notarization was skipped because Developer ID credentials
are unavailable. The source checkout has no Git metadata, and clean-host /
installed-device acceptance remains outstanding.

| Bundled component | SHA-256 |
| --- | --- |
| `Contents/MacOS/humla` | `84c6a773b7b14b8e33a75da04594cc942e29f4f57de3b3d9618d5a0ccf4d89bc` |
| `Contents/MacOS/macos-speech` | `d48fd956e6c9e2eabc0d0eb73367d0de7af501858fafaeb19a11ba7822c1ef88` |
| `Contents/MacOS/audio-capture` | `6da1504745126516eaa87a31908e1cc390445f1a9770503e9d87d1002e962f73` |
| `Contents/MacOS/speaker-diarize` | `bb26266b6f5095bd4aac58ac8ca86dd56230a46b89eb801596f642eae72a2f2e` |
| `Contents/MacOS/humla-mcp` | `569c7571f72d3f335a426684267932f718a5ac11d340ec1f1d2a484f945cd4f0` |
| `Contents/Resources/default.metallib` | `21dedc65b43580ec0ff48e8a0a8c2c4edb24959324f3944c9be0c471895f78c1` |

### macOS fresh-install speaker-engine default — 2026-09-27

The native default-engine command selects Sortformer under macOS compilation
and Community-1 elsewhere. Settings asks the backend for that platform value
only when there is no saved `diarize_model`; an existing value continues to
win. During onboarding, Continue is enabled only after the recommended local
model and approximate size are visible (~255 MB for Sortformer, ~22 MB for
Community-1); continuing checks/downloads that model, while Skip advances
without requesting it. The model
download is local inference preparation, separate from transcription provider
credentials.

Latest scoped verification: onboarding + Settings suites, 62/62 passing; full
frontend regression, 89 files / 1063 tests passing; TypeScript build passing;
macOS Rust default-engine unit test 1/1. The current semantic processor
contracts are covered by frontend regression and Rust 1/1; Tauri app build and
deep strict ad-hoc signature verification pass. The
non-macOS compile target has not been built in this environment, so preservation
of its Community-1 default is asserted by cfg-specific source and tests but not
yet verified in a Windows build.

### PRD semantic processing modes — 2026-09-27

The existing per-note summary selector now also exposes six purpose-specific
processors: knowledge learning, solution/decision, research interview,
business negotiation, relationship conversation, and factual record. These
retain the existing note-level recompile path, so changing a processor does
not mutate the source transcript or audio. The relationship processor
explicitly rejects emotional/personality inference and automatic sharing;
decision, research, negotiation, and factual processors each distinguish
stated evidence from inference and forbid their most consequential common
fabrications. Existing preset IDs remain unchanged for saved notes.

Verification: full frontend suite 89 files / 1063 tests passed; focused Rust
processor-contract test 1/1 passed; lint 0 errors with 7 existing hook
dependency warnings. The rebuilt arm64 macOS candidate has passed deep strict
ad-hoc signature verification. These are prompt-contract and build checks, not a measured accuracy or
real-conversation evaluation; the original diarization and human-review gates
remain open.

The native preparation chain is now the same for development, app-only and
DMG builds: capture, diarization, Metal, then MCP; every declared helper is
checked for executable presence, Mach-O format and a valid signature. A real
`bash scripts/build-native.sh` run passed. FluidAudio is pinned exactly to
0.17.1, its `Package.resolved` is no longer ignored, Swift uses
`--force-resolved-versions`, and MCP uses Cargo `--locked`. This is not yet a
clean-host reproducible build: the source directory has no Git metadata and
the Metal compiler is absent, so the pre-existing MetalLib was reused.
MetalLib SHA-256: `21dedc65b43580ec0ff48e8a0a8c2c4edb24959324f3944c9be0c471895f78c1`.

Final source regression: frontend 1028/1028 in 85 files, TypeScript passes,
lint 0 errors/7 pre-existing warnings; Rust 805 passed/6 ignored (811 total).
The real-model failures in the table are separate and remain failed. Installed
0.1.2 and its capture helper were re-hashed and remain identical to the recorded
values below. No formal release or installed-app acceptance of these changes
is claimed.

Reproduce intentionally (downloads public audio, never existing recordings):

```bash
python3 scripts/test-diarize-local.py --fixture aishell3 --download-fixtures
python3 scripts/test-diarize-local.py --fixture aishell3-long --download-fixtures
python3 scripts/test-diarize-local.py --fixture aishell3-long --download-fixtures --engine sortformer
```

These quality commands currently exit nonzero. Do not mark them skipped/passed
or replace them with the passing English/synthetic control in release evidence.

### Unreleased speaker-model lifecycle — 2026-09-27

At this earlier lifecycle-only checkpoint, these changes were in source and
a standalone test helper, not the old 0.1.3 candidate or installed 0.1.2.
They are now included in the refreshed candidate above. No installed
app was replaced/restarted, no privacy grant was reset, and no user recordings
or credentials were read, uploaded or modified for these tests. Community-1
model files were explicitly downloaded into the existing FluidAudio cache.

- Reused FluidAudio 0.17.1, pinned in `speaker-diarize/Package.resolved` at
  `5c51c5c93afff0d89594a2a93c3103e790ba648c`. No replacement diarization
  algorithm/downloader was written. The existing `REGISTRY_URL` hook selects
  hf-mirror first or an explicitly chosen source; inherited HF credentials
  are removed for these public model downloads. TLS verification remains on.
- Native per-engine gates prevent download/delete/inference from racing.
  A download needs the explicit completion marker, exit success and complete
  cache status. Timeouts stop the old writer before source fallback. Closing
  Settings no longer loses the outstanding download's completion/error state
  or allows another UI writer; stale initial status reads cannot overwrite it.
- Inference explicitly enables FluidAudio offline mode. The convenience
  `prepareModels()` method purged a corrupt cache before retrying even offline;
  a temporary-cache test exposed this. Using public `load(from:)` followed by
  `initialize(models:)` keeps failed offline caches intact. Only the explicit
  download command can repair/download. Status checks catch empty model
  directories and malformed PLDA JSON; this is structural validation and
  actual CoreML loading, **not** the pinned SHA-256 policy used for Whisper.
- Model deletion no longer swallows filesystem errors and reports success.
  A permissions-denied temporary cache fails with a nonzero exit; successful
  and repeated deletion work. Tests delete only their own temporary fixtures.
- Corrected the reversed Community-1 threshold help in English and Chinese:
  the pinned AHC uses a Euclidean cut distance; larger thresholds merge more
  aggressively. VBx can still change the final cluster count. Defaults were
  not tuned to make one fixture pass. Both development and bundle build hooks
  now rebuild/check both audio helpers; the diarizer build stamp also includes
  `Package.resolved`, preventing dependency changes from reusing an old helper.
- Release test-helper SHA-256:
  `a81da4b5ce95890d1f7423afdf466ae1a4115be07ef6cbd516a701ddda3e3674`.
  The installed capture helper/main app are unchanged. The diagnostic debug
  helper is not bundled or installed.
- `scripts/test-diarize-local.py` synthesizes four alternating turns locally
  with macOS `say` and tests mono 16 kHz PCM16. The default Mandarin fixture
  (Tingting/Meijia) **fails** in auto and explicit-two-speaker modes, returning
  S1/S1/S1/S1. Diagnostic thresholds 0.3 and 0.6 also fail. Debug logs show
  valid embeddings and the two-speaker constraint reaching FluidAudio, so this
  is not a dropped CLI hint. Exact acoustic/model cause is still unresolved.
- The separately named `--fixture english-control` (Daniel/Samantha) **passes**:
  both modes return S1/S2/S1/S2, four segments, with 100% coverage of each
  turn's inner interval (350 ms boundary collar). That is a bounded pipeline
  control, not a real-world diarization accuracy score or Chinese acceptance.
  Both fixtures also check silent input and offline missing/corrupt caches.
  A loopback registry trap observed zero inference requests. No user audio was
  used; synthetic temporary files were automatically removed.
- Final source checks: frontend 1025 tests across 85 files; Rust 802 passed,
  6 ignored; production frontend build and Swift release/debug builds pass;
  lint has only the seven previously recorded warnings. The candidate app
  checksum below belongs to the **earlier** bundle and does not include these
  changes. Chinese diarization, Sortformer, native settings/download UI, MiMo
  credential/summary/chat UI, signed packaging and compatibility remain open.
  This subsection records the earlier lifecycle-only pass; the newer public
  corpus/Sortformer evidence above supersedes its not-yet-tested status.

### Earlier 0.1.3 local candidate (superseded) — 2026-09-27

- Built at `src-tauri/target/release/bundle/macos/HoneyVoice.app`; bundle version
  `0.1.3`, identifier `com.miraphant.voice-memory`, architecture `arm64`.
  Main executable SHA-256:
  `d8b8df673f47c8d6e0bb6ae6bd906c43358d3ef287683ad6c52d1f808fc38dfc`.
  Capture helper SHA-256 remains
  `6da1504745126516eaa87a31908e1cc390445f1a9770503e9d87d1002e962f73`.
  `codesign --verify --deep --strict` passes, but the identity is ad-hoc with
  no developer team. This is **not** a signed/notarized public release.
- `/Applications/HoneyVoice.app` remains 0.1.2 with the previously recorded
  executable hash `09ce2373aa932dff450f9563391f540cc49a6a54d3d502b494d4cb7d25bf1d21`.
  No app replacement/restart, permission reset, user database edit, audio
  capture, or credential persistence was performed in this acceptance pass.
- Added Chinese-owned copy for recording/transcription settings, note menus,
  recording phases, progress counts, recovery links and editor placeholders.
  User note/title/transcript, provider IDs, device names and credentials are not
  passed through the copy dictionary. Tests cover retained text when switching
  UI language and the separate transcription/output-language setting.
- Fixed the frontend preset-template resolver: `zh` and other supported
  languages outside its former four-language table no longer default to an
  English instruction. Backend presets already used the full language map;
  this does not claim model-output accuracy or app-level MiMo acceptance.
- Real browser rendering exposed a missed lifecycle edge: the note initially
  renders without a draft, so the old one-shot resize effect never attached to
  its columns. The observer now attaches when the draft mounts, reserves the
  panel gap, and starts drag sizing from the visible width. At a 720px viewport,
  the body is 420px and the panel 282px; Summarize, panel toggle and More fit
  inside the toolbar. Light/dark rendering and the 380px multi-stage recording
  indicator were inspected with mocked IPC; this is **not native app testing**.
- The editor refreshes translated placeholder decorations without recreating
  the editor or changing its document. Permission/editability toggles no longer
  emit a content update. A stable host around Tippy's moved menu element avoids
  React unmount errors. Real-editor component tests exercise these paths.
- Final automated evidence: frontend 1018/1018 (84 files); Rust library
  798 passed / 6 ignored; production frontend and Apple Silicon app builds
  completed. The skipped live/model tests retain their separately dated evidence
  below; they were not silently counted as passes in this run.
- Remaining gates are unchanged: complete the remaining Summary/Chat and other
  untranslated surfaces, real installed-app download/recovery and MiMo
  configuration/summary/chat, real diarization, reproducible Git provenance,
  Developer ID/notarization, clean-host install/update/rollback, broader audio
  device/lifecycle coverage, and Windows. No formal release has been published.

### Unreleased model bootstrap changes — 2026-09-26

- Installed app remains **0.1.2**, main executable SHA-256
  `09ce2373aa932dff450f9563391f540cc49a6a54d3d502b494d4cb7d25bf1d21`.
  This turn did not replace/restart it, reset privacy grants, alter its database,
  or overwrite the installed Medium model. No release or new app bundle is claimed.
- `model_download.rs` adds explicit sources (automatic/mirror/official), bounded
  connection/read timeouts, preserved TLS validation, exact size + pinned SHA-256,
  per-attempt temporary files, and verified atomic replacement. Progress phases
  distinguish connecting/downloading/verifying/complete. Only the last phase
  clears the new frontend progress state. An app-wide lock rejects competing
  downloads/deletion without emitting a terminal event for another operation.
- Existing model status and recording prerequisites verify file contents, not
  just existence. Successful hashes are cached against file metadata/identity;
  verification runs off the async UI path. Missing selected models no longer
  fall through to the default model. The local provider remains selectable on
  a fresh install and unavailable selected models remain explicitly labelled.
- Live test `model_download::tests::live_medium_mirror_download_is_verified`:
  **pass, 71.39 s in debug profile**, 539212467 bytes, exact Medium SHA-256 as
  recorded below. This includes streaming hashing, disk synchronization, and an
  independent full-file re-read. Temporary test files were automatically removed.
  The initial native request received ModelScope HTTP 403; adding a descriptive
  HoneyVoice User-Agent was followed by a successful end-to-end run. No TLS
  check was disabled. HF Mirror/Xet still reports UnknownIssuer on this host;
  do not claim all models/sources have been accepted here.
- Fixed size/hash values for all five catalog models were cross-checked against
  upstream Git LFS pointers retrieved through HF Mirror. ModelScope currently
  supplies the identical Medium/Large v2/Large v3 Q5 artifacts in the configured
  repository; it does not contain Turbo or NB Whisper, which must not be replaced
  by another model to make a download appear successful.
- Native regression tests cover missing-selected-model handling, corrupt installed
  status, cache invalidation, successful response without Content-Length,
  corrupt-source fallback, short/oversize/wrong-hash/HTTP failures, interrupted
  stream, cancellation cleanup, atomic visibility and the lifecycle mutex.
- The download controls reuse the existing Select/Btn design tokens. Model
  labels/download states are translated explicitly; transcript and note contents
  are not passed through a generic translation routine. Other untranslated
  settings and note controls remain work, not a completed localization gate.
- Still required: packaged UI download/retry acceptance, remaining localization,
  diarization, app-level MiMo summary/chat acceptance, reproducible source
  provenance, release signing/notarization, update/rollback, and Windows gates.

Repeat the live network check only when intentionally downloading a full model:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --offline --lib \
  live_medium_mirror_download_is_verified -- --ignored --nocapture
```

### 2026-09-26 local candidate evidence

- Installed candidate: **HoneyVoice 0.1.2**, macOS 26.5.1 (25F80), Apple Silicon.
- Canonical installation: `/Applications/HoneyVoice.app`. The prior 0.1.1 is
  in `~/Library/Application Support/HoneyVoice-install-backups/install.yUF5Oq/`;
  the original system/user copies are in `install.st4POS/` under the same root.
  No notes, recordings, credentials or unrelated privacy grants were removed.
- Main executable SHA-256:
  `09ce2373aa932dff450f9563391f540cc49a6a54d3d502b494d4cb7d25bf1d21`.
  Capture helper SHA-256:
  `6da1504745126516eaa87a31908e1cc390445f1a9770503e9d87d1002e962f73`.
- 0.1.2 host designated requirement uses cdhash
  `65dbf58460df3ca935aa7d7d1ad477296ba35960`; the helper uses
  `a026a39830e3d4231367c4571f7c794256e6d802`.
  **Different host/helper hashes coexist with successful permissions and capture.**
- Verified cause of the original loop: tccd attributed the helper to the host,
  but rejected the old saved host ScreenCapture requirement
  `38970c61dc21c04cd85011a1fe78fde072758200` against the then-current host
  `3b46592330c6ef30fa632479030e01e079d6c9f5`. Two installed versions made
  launch-by-name unreliable. The previous inference that unequal helper/host
  requirements alone caused the failure was incorrect. Ad-hoc rebuilds still
  require grant refresh; stable Developer ID distribution remains a release gate.
- Final recording take `7105a0ff-3d68-41b4-a5b2-4eec4ab3609f` in the local
  acceptance note: mic **37.5896875 s**, RMS **0.00412916**; system
  **37.559625 s**, RMS **0.10080134**. Both are separate mono 16 kHz PCM16
  files. Their length difference is about 30 ms, not a measured latency claim.
  Audio is retained locally only and is not committed or uploaded.
- After the final 0.1.2 capture, normal quit left no host/capture/diarization
  process from the installed bundle. Reopening the same app again showed both
  microphone and Screen Recording granted, with all three notes preserved.
- Downloaded and selected `medium-q5`, file `ggml-medium-q5_0.bin`,
  **539212467 bytes**, SHA-256
  `19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f`.
  ModelScope download completed in about 25 seconds; the pinned hash matches
  the ggerganov/whisper.cpp LFS pointer retrieved through hf-mirror. Direct
  Hugging Face / Xet downloads failed TLS verification on this machine; no
  certificate checks were disabled. `scripts/install-local-model-mirror.sh`
  makes the verified installation repeatable; the app downloader itself still
  uses Hugging Face.
- Pure fixture generated by macOS `say`, Tingting, rate 165, converted to mono
  16 kHz PCM16. Text: “这是一次本地录音验收。今天检查麦克风、系统音频和中文转录。
  测试内容不包含真实会议。下一步验证暂停、继续和保存。”
  The old UI lost characters despite the model's complete segment text.
  Re-transcription in installed 0.1.2 preserved those characters. The remaining
  “和” → “核” substitution is a model recognition error, not fixed by this patch.
- Six token/DTW unit tests pass; the opt-in real-model fixture passed in 12.39 s
  and asserts that word timings contain the same text as the model segments.
  No cloud provider received either live test recording. Only the earlier,
  separately authorized synthetic prompts went to MiMo.
- Remaining product gates include fully translated interface strings, app-native
  mirror download/recovery, diarization, UI-level MiMo credential/summary/chat
  acceptance, reproducible Git provenance, signed distribution, update/rollback,
  broader device/lifecycle tests, and Windows acceptance.

### Public release requirements

1. **Reproducible source** — build from a clean Git checkout and record the
   commit SHA, toolchain versions, architecture, and artifact checksums.
2. **Signed identity** — sign the app and the permission/capture helper with a
   valid Developer ID identity. Verify both signatures and ensure the app and
   helper have the intended bundle identifier and expected developer team.
   Verify responsible-process attribution at runtime; their designated
   requirements need not be byte-identical. Do not treat matching names as
   identity proof.
3. **Notarized install** — notarize and staple the app/DMG, then install the
   downloaded artifact on a clean macOS account or machine. Verify first launch
   without Terminal, Xcode, or a pre-existing developer permission grant.
4. **Permission state** — verify microphone and Screen Recording status from
   the running installed app. This implementation captures system audio with
   ScreenCaptureKit and does not create a Core Audio process tap; do not add or
   display an AudioCapture-only permission as if it were the ScreenCaptureKit
   grant.
5. **Real capture** — with explicit consent and a controlled test source, record
   microphone and system audio simultaneously. Verify each stream independently,
   timestamps/alignment, silent-source behavior, cancellation, app quit/reopen,
   and cleanup after failures.
6. **Processing** — run at least one real local transcription and diarization
   pass, then verify transcript provenance, speaker edits, summary grounding,
   and that local-only mode makes no outbound requests.
7. **Data lifecycle** — verify retention off/on, deletion, export, backup/restore,
   and migration from the previous supported release without losing notes.
8. **Distribution and recovery** — validate the published artifact, manual
   update instructions, rollback instructions, and checksums. Do not announce a
   release until these gates are individually evidenced.

## Repeatable checks

For a live MiMo Coding Plan check, run `scripts/test-mimo-live.sh` from a
terminal. It prompts for the key without displaying input or placing it in the
command line/history, then tests authenticated model discovery and a streamed
chat completion. It defaults to the Token Plan endpoint; set `MIMO_BASE_URL`
before running only when intentionally testing another HTTPS endpoint. Never
paste a key into a command or commit it to the repository.

```bash
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
pnpm tauri build
codesign --verify --deep --strict src-tauri/target/release/bundle/macos/HoneyVoice.app
scripts/verify-macos-permission-identity.sh \
  src-tauri/target/release/bundle/macos/HoneyVoice.app \
  "Developer ID Application: <configured identity>"
```

The last check intentionally fails for ad-hoc builds. Release signing and
notarization are checked again by `scripts/release.sh` before it pushes a tag or
publishes a GitHub release.
