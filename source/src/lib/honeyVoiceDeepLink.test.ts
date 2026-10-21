import { describe, expect, it } from "vitest";
import {
  buildHoneyVoiceDeepLink,
  honeyVoiceRouteFromDeepLink,
  parseHoneyVoiceDeepLink,
} from "./honeyVoiceDeepLink";

describe("HoneyVoice Obsidian deep links", () => {
  it("round-trips a note, session, and session-local timestamp", () => {
    const link = buildHoneyVoiceDeepLink(
      "note_123",
      "550e8400-e29b-41d4-a716-446655440000",
      3_600_001,
    );
    expect(link).toBe(
      "honeyvoice://open?note=note_123&session=550e8400-e29b-41d4-a716-446655440000&t=3600001",
    );
    expect(parseHoneyVoiceDeepLink(link!)).toEqual({
      noteId: "note_123",
      sessionId: "550e8400-e29b-41d4-a716-446655440000",
      timestampMs: 3_600_001,
    });
  });

  it.each([
    "https://open?note=n&session=s&t=1",
    "honeyvoice://other?note=n&session=s&t=1",
    "honeyvoice://open/extra?note=n&session=s&t=1",
    "honeyvoice://open?note=../outside&session=s&t=1",
    "honeyvoice://open?note=n&session=../outside&t=1",
    "honeyvoice://open?note=n&session=s&t=-1",
    "honeyvoice://open?note=n&session=s&t=1.2",
    "honeyvoice://open?note=n&session=s&t=",
    "honeyvoice://open?note=n&note=m&session=s&t=1",
    "honeyvoice://open?note=n&session=s",
    "honeyvoice://user@open?note=n&session=s&t=1",
    "honeyvoice://open?note=n&session=s&t=1#fragment",
  ])("rejects untrusted or malformed URL: %s", (raw) => {
    expect(parseHoneyVoiceDeepLink(raw)).toBeNull();
  });

  it("does not create links from unsafe IDs or invalid time values", () => {
    expect(buildHoneyVoiceDeepLink("../note", "take-1", 1)).toBeNull();
    expect(buildHoneyVoiceDeepLink("note", "take/1", 1)).toBeNull();
    expect(buildHoneyVoiceDeepLink("note", "take-1", Number.NaN)).toBeNull();
    expect(buildHoneyVoiceDeepLink("note", "take-1", -1)).toBeNull();
  });

  it("maps a validated link to the matching app note route", () => {
    expect(
      honeyVoiceRouteFromDeepLink(
        "honeyvoice://open?note=note_123&session=take-2&t=8250",
      ),
    ).toBe("/note/note_123?session=take-2&t=8250");
    expect(honeyVoiceRouteFromDeepLink("honeyvoice://open?note=../x&session=s&t=1")).toBeNull();
  });
});
