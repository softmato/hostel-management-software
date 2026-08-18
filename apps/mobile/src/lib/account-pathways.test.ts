import { describe, expect, it } from "vitest";

import {
  canRequestDeletion,
  type DeletionPathway,
  deletionReasonError,
  MAX_DELETION_REASON,
  MIN_DELETION_REASON,
  PATHWAY_COPY,
} from "@/lib/account-pathways";

const PATHWAYS: DeletionPathway[] = [
  "BLOCKED",
  "GUARDIAN_RELEASE",
  "PLATFORM_REVIEW",
  "SELF_SERVICE",
];

describe("PATHWAY_COPY", () => {
  it("covers every pathway the server can return", () => {
    for (const pathway of PATHWAYS) {
      expect(PATHWAY_COPY[pathway]).toBeDefined();
      expect(PATHWAY_COPY[pathway].heading.length).toBeGreaterThan(0);
    }
  });

  /*
   * The whole reason this table exists. "Delete my account" means four different
   * things, and the copy has to say which one *before* the tap — a guardian loses
   * access to a resident, not their account; an admin starts a conversation, not a
   * countdown.
   */
  it("promises something different in each pathway's confirmation", () => {
    expect(PATHWAY_COPY.GUARDIAN_RELEASE.confirmDescription).toContain(
      "Your account itself stays",
    );
    expect(PATHWAY_COPY.PLATFORM_REVIEW.confirmDescription).toContain(
      "Nothing changes on your account",
    );
    expect(PATHWAY_COPY.SELF_SERVICE.confirmDescription).toContain("signed out");
  });

  // `SELF_SERVICE` is the only one that starts a countdown, and the only one with
  // an undo. Both facts have to be in the copy, not just in the docs.
  it("states the grace period and the undo on the self-service pathway", () => {
    expect(PATHWAY_COPY.SELF_SERVICE.body).toContain("60 days");
    expect(PATHWAY_COPY.SELF_SERVICE.body).toContain("undo");
  });

  // `BLOCKED` has no action, so an action label would draw a button with no verb.
  it("gives BLOCKED no action label", () => {
    expect(PATHWAY_COPY.BLOCKED.action).toBe("");
  });

  it("gives every other pathway an action label", () => {
    for (const pathway of ["GUARDIAN_RELEASE", "PLATFORM_REVIEW", "SELF_SERVICE"] as const) {
      expect(PATHWAY_COPY[pathway].action.length).toBeGreaterThan(0);
    }
  });
});

describe("canRequestDeletion", () => {
  it("is false only for BLOCKED", () => {
    expect(canRequestDeletion("BLOCKED")).toBe(false);
    expect(canRequestDeletion("GUARDIAN_RELEASE")).toBe(true);
    expect(canRequestDeletion("PLATFORM_REVIEW")).toBe(true);
    expect(canRequestDeletion("SELF_SERVICE")).toBe(true);
  });
});

describe("deletionReasonError", () => {
  it("holds the server's 10-character floor", () => {
    expect(deletionReasonError("Moving out", "SELF_SERVICE")).toBeNull();
    expect(deletionReasonError("too short", "SELF_SERVICE")).toBeTruthy();
    expect(deletionReasonError("x".repeat(MIN_DELETION_REASON), "SELF_SERVICE")).toBeNull();
  });

  it("measures the trimmed reason", () => {
    expect(deletionReasonError("   short   ", "SELF_SERVICE")).toBeTruthy();
  });

  /*
   * The web labels this field "optional context for the hostel" on the guardian
   * pathway. `accountDeletionRequestSchema` has no branch, so an empty reason is a
   * 422 there too — the label is wrong and this one says required.
   */
  it("requires a reason on the guardian pathway too, and says who reads it", () => {
    const error = deletionReasonError("", "GUARDIAN_RELEASE");

    expect(error).toBeTruthy();
    expect(error).toContain("hostel");
  });

  it("holds the upper bound", () => {
    expect(
      deletionReasonError("x".repeat(MAX_DELETION_REASON + 1), "SELF_SERVICE"),
    ).toBeTruthy();
  });
});
