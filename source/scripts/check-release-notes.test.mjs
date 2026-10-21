import { test } from "node:test";
import assert from "node:assert/strict";
import { RELEASE_REPOSITORY, validateReleaseNotes } from "./check-release-notes.mjs";

const entry = {
  version: "1.2.3", date: "2026-09-15", title: "A change", summary: "A short summary",
  paragraphs: ["Details."], highlights: ["A feature."], issues: [],
};

test("accepts a complete release without related issues", () => {
  assert.doesNotThrow(() => validateReleaseNotes([entry], "1.2.3"));
});
test("rejects missing or duplicate versions", () => {
  assert.throws(() => validateReleaseNotes([entry], "1.2.4"), /exactly one/);
  assert.throws(() => validateReleaseNotes([entry, entry], "1.2.3"), /exactly one/);
});
test("rejects incomplete posts and impossible dates", () => {
  for (const patch of [{ title: " " }, { summary: "" }, { paragraphs: [] }, { highlights: [""] }, { date: "2026-02-30" }]) {
    assert.throws(() => validateReleaseNotes([{ ...entry, ...patch }], "1.2.3"));
  }
});
test("accepts HoneyVoice repository issues and rejects upstream Humla issues", () => {
  const issue = { title: "A feature", reference: "#12", status: "Closed", url: `https://github.com/${RELEASE_REPOSITORY}/issues/12` };
  assert.doesNotThrow(() => validateReleaseNotes([{ ...entry, issues: [issue] }], "1.2.3"));
  assert.throws(() => validateReleaseNotes([{ ...entry, issues: [{ ...issue, url: "https://github.com/michaelwilhelmsen/humla/issues/12" }] }], "1.2.3"), /Related issues/);
});
