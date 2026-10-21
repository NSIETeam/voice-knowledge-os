import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RecordingSessions } from "./RecordingSessions";
import type { NoteSession } from "../lib/ipc";

const sessions: NoteSession[] = [{
  id: "take-a",
  index: 1,
  startedAt: "2026-09-27T10:00:00Z",
  durationMs: 20_000,
  streams: ["mic"],
  hasPlayback: true,
  canTranscribe: false,
  canRetranscribe: true,
}];

describe("RecordingSessions source-audio integrity", () => {
  it("shows explicit local integrity results and exact hashes on mismatch", async () => {
    const onVerify = vi.fn().mockResolvedValue({
      ledgerPresent: true,
      streams: [{
        source: "mic",
        fileName: "mic.wav",
        integrity: {
          status: "mismatch",
          expectedSha256: "a".repeat(64),
          actualSha256: "b".repeat(64),
          expectedBytes: 100,
          actualBytes: 101,
        },
      }],
    });
    render(
      <RecordingSessions
        sessions={sessions}
        activeId="take-a"
        onSelect={vi.fn()}
        onVerify={onVerify}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Verify source-audio integrity/i }));
    expect(await screen.findByRole("status")).toHaveTextContent("Source audio differs from its capture record");
    fireEvent.click(screen.getByText("Show audio integrity details"));
    const mismatch = screen.getByRole("listitem");
    expect(mismatch).toHaveTextContent("a".repeat(64));
    expect(mismatch).toHaveTextContent("b".repeat(64));
    expect(onVerify).toHaveBeenCalledWith("take-a");
  });
});
