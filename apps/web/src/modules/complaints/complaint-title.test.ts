import { describe, expect, it } from "vitest";

import { complaintTitle } from "./complaint-title";

describe("complaintTitle", () => {
  it("keeps a title somebody actually typed", () => {
    expect(
      complaintTitle({
        category: "MAINTENANCE",
        description: "Since Tuesday.",
        title: "Running tap",
      }),
    ).toBe("Running tap");
  });

  /*
   * The phone sends no title at all now, so this is the common path: the
   * headline is the first thing the resident wrote.
   */
  it("takes the first line of the description when there is no title", () => {
    expect(
      complaintTitle({
        category: "MAINTENANCE",
        description: "Tap in 204 is running\nIt started on Tuesday.",
      }),
    ).toBe("Tap in 204 is running");
  });

  it("skips blank leading lines rather than titling a complaint with nothing", () => {
    expect(
      complaintTitle({ category: "FOOD", description: "\n   \nDinner was cold." }),
    ).toBe("Dinner was cold.");
  });

  // A voice-only complaint has no text anywhere, and the queue still needs a row
  // that says something — including that there is a recording to play.
  it("names the category, and says when it was spoken", () => {
    expect(complaintTitle({ category: "FOOD", hasVoiceNote: true })).toBe(
      "Food — voice note",
    );
    expect(complaintTitle({ category: "NOISE" })).toBe("Noise complaint");
  });

  it("falls back to Other for a category it does not know", () => {
    expect(complaintTitle({ category: "WHATEVER" })).toBe("Other complaint");
  });

  // `title` is capped at 160 by the schema, but `description` is capped at 4000
  // — so the derived title is the one that can overrun the column.
  it("clamps a long first line to 160 characters, on a word", () => {
    const title = complaintTitle({
      category: "ROOM",
      description: `${"word ".repeat(60)}end`,
    });

    expect(title.length).toBeLessThanOrEqual(160);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toContain("  ");
  });

  it("still clamps a single unbroken run with no space to break on", () => {
    expect(complaintTitle({ category: "ROOM", description: "x".repeat(400) })).toHaveLength(
      160,
    );
  });
});
