import { parseHoneyVoiceDeepLink, type HoneyVoiceDeepLink } from "./honeyVoiceDeepLink";
import type { NoteSession, TimelineEntry } from "./ipc";

/** Only resolve a summary citation to an exact, locally playable timeline turn. */
export function resolveSummaryAudioCitation(
  raw: string,
  noteId: string,
  timeline: TimelineEntry[],
  sessions: NoteSession[],
): HoneyVoiceDeepLink | null {
  const target = parseHoneyVoiceDeepLink(raw);
  if (!target || target.noteId !== noteId) return null;
  if (!sessions.some((session) => session.id === target.sessionId && session.hasPlayback)) return null;
  if (!timeline.some((entry) =>
    entry.sessionId === target.sessionId && entry.startMs === target.timestampMs && entry.text.trim().length > 0,
  )) return null;
  return target;
}
