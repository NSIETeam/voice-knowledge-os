import { describe, expect, it } from "vitest";
import type { NoteSession, TimelineEntry } from "./ipc";
import { resolveSummaryAudioCitation } from "./summaryEvidence";

const noteId = "note_123";
const sessionId = "take-1";
const sessions: NoteSession[] = [{
  id: sessionId,
  index: 0,
  startedAt: "2026-09-27T00:00:00Z",
  durationMs: 20_000,
  streams: ["mic"],
  hasPlayback: true,
  canTranscribe: false,
  canRetranscribe: false,
}];
const timeline: TimelineEntry[] = [{
  startMs: 3_000,
  endMs: 5_000,
  label: "Speaker 1",
  text: "A supported statement.",
  uncertain: false,
  overlap: false,
  words: [],
  sessionId,
  sessionIndex: 0,
  chunkIdx: 0,
}];
const citation = `honeyvoice://open?note=${noteId}&session=${sessionId}&t=3000`;

describe("resolveSummaryAudioCitation", () => {
  it("resolves an exact citation to an existing turn with local playback", () => {
    expect(resolveSummaryAudioCitation(citation, noteId, timeline, sessions)).toEqual({
      noteId,
      sessionId,
      timestampMs: 3_000,
    });
  });

  it("rejects other notes, invented timestamps, missing sessions, and sessions without audio", () => {
    expect(resolveSummaryAudioCitation(citation, "another-note", timeline, sessions)).toBeNull();
    expect(resolveSummaryAudioCitation(citation.replace("t=3000", "t=3001"), noteId, timeline, sessions)).toBeNull();
    expect(resolveSummaryAudioCitation(citation.replace(sessionId, "take-missing"), noteId, timeline, sessions)).toBeNull();
    expect(resolveSummaryAudioCitation(citation, noteId, timeline, [{ ...sessions[0], hasPlayback: false }])).toBeNull();
  });

  it("rejects malformed or duplicate query parameters", () => {
    expect(resolveSummaryAudioCitation("honeyvoice://open?note=x&note=y&session=take-1&t=3000", noteId, timeline, sessions)).toBeNull();
  });
});
