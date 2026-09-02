import { describe, expect, it } from "vitest";

import {
  formatDuration,
  isUsableRecording,
  recorderHint,
  VOICE_NOTE_MAX_MS,
} from "@/lib/voice-note";

/**
 * `VOICE_NOTE_RECORDING` is deliberately not asserted here: it lives beside the
 * recorder component because `RecordingOptions` needs `expo-audio`'s runtime
 * enums, and importing those into a node-side test pulls in React Native. What
 * is testable is everything around it.
 */
describe("formatDuration", () => {
  it("pads the seconds so the label does not jump about", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(9_400)).toBe("0:09");
    expect(formatDuration(67_000)).toBe("1:07");
    expect(formatDuration(VOICE_NOTE_MAX_MS)).toBe("3:00");
  });

  it("does not render a negative clock", () => {
    // The countdown subtracts elapsed from the cap, and the poll that trips the
    // auto-stop can arrive a tick past it.
    expect(formatDuration(-500)).toBe("0:00");
  });
});

describe("isUsableRecording", () => {
  it("rejects the accidental tap", () => {
    // A start-stop produces a fraction of a second of silence. Attaching it is
    // worse than attaching nothing: the provider presses play, hears nothing,
    // and stops trusting the next one.
    expect(isUsableRecording(200)).toBe(false);
    expect(isUsableRecording(1_200)).toBe(true);
  });
});

describe("recorderHint", () => {
  it("counts down while recording", () => {
    const hint = recorderHint({
      durationMs: 60_000,
      hasRecording: false,
      recording: true,
    });

    expect(hint).toContain("2:00 left");
  });

  it("asks for a listen before the job goes out", () => {
    expect(
      recorderHint({ durationMs: 12_000, hasRecording: true, recording: false }),
    ).toMatch(/play it back/i);
  });

  it("says it is optional when there is nothing yet", () => {
    expect(
      recorderHint({ durationMs: 0, hasRecording: false, recording: false }),
    ).toMatch(/optional/i);
  });
});
