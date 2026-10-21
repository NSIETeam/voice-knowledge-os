const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export type HoneyVoiceDeepLink = {
  noteId: string;
  sessionId: string;
  timestampMs: number;
};

export function buildHoneyVoiceDeepLink(
  noteId: string,
  sessionId: string,
  timestampMs: number,
): string | null {
  if (!SAFE_ID.test(noteId) || !SAFE_ID.test(sessionId)) return null;
  if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) return null;
  const query = new URLSearchParams({
    note: noteId,
    session: sessionId,
    t: String(timestampMs),
  });
  return `honeyvoice://open?${query.toString()}`;
}

export function parseHoneyVoiceDeepLink(raw: string): HoneyVoiceDeepLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (
    url.protocol !== "honeyvoice:" ||
    url.hostname !== "open" ||
    url.pathname !== "" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    return null;
  }

  const noteIds = url.searchParams.getAll("note");
  const sessionIds = url.searchParams.getAll("session");
  const timestamps = url.searchParams.getAll("t");
  if (noteIds.length !== 1 || sessionIds.length !== 1 || timestamps.length !== 1) {
    return null;
  }
  const [noteId] = noteIds;
  const [sessionId] = sessionIds;
  if (!/^\d+$/.test(timestamps[0])) return null;
  const timestampMs = Number(timestamps[0]);
  if (
    !SAFE_ID.test(noteId) ||
    !SAFE_ID.test(sessionId) ||
    !Number.isSafeInteger(timestampMs) ||
    timestampMs < 0
  ) {
    return null;
  }
  return { noteId, sessionId, timestampMs };
}

export function honeyVoiceRouteFromDeepLink(raw: string): string | null {
  const target = parseHoneyVoiceDeepLink(raw);
  if (!target) return null;
  const query = new URLSearchParams({
    session: target.sessionId,
    t: String(target.timestampMs),
  });
  return `/note/${encodeURIComponent(target.noteId)}?${query.toString()}`;
}
