import { describe, expect, it, vi } from "vitest";
import { PendingHoneyVoiceDeepLinks } from "./pendingHoneyVoiceDeepLinks";

const link = (note: string) =>
  `honeyvoice://open?note=${note}&session=take-1&t=8250`;

describe("pending HoneyVoice deep links", () => {
  it("queues a cold-start URL until first-run onboarding completes", () => {
    const navigate = vi.fn();
    const links = new PendingHoneyVoiceDeepLinks(navigate);

    links.receive(link("note-1"));
    expect(navigate).not.toHaveBeenCalled();

    links.setReady(true);
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/note/note-1?session=take-1&t=8250");
  });

  it("opens live links immediately after onboarding and ignores invalid ones", () => {
    const navigate = vi.fn();
    const links = new PendingHoneyVoiceDeepLinks(navigate);
    links.setReady(true);

    links.receive("honeyvoice://open?note=../outside&session=take-1&t=8250");
    expect(navigate).not.toHaveBeenCalled();

    links.receive(link("note-2"));
    expect(navigate).toHaveBeenCalledWith("/note/note-2?session=take-1&t=8250");
  });

  it("keeps only the latest valid URL while onboarding is in progress", () => {
    const navigate = vi.fn();
    const links = new PendingHoneyVoiceDeepLinks(navigate);
    links.receive(link("note-1"));
    links.receive(link("note-2"));
    links.setReady(true);

    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/note/note-2?session=take-1&t=8250");
    links.setReady(true);
    expect(navigate).toHaveBeenCalledOnce();
  });
});
