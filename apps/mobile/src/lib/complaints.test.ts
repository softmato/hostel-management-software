import { describe, expect, it } from "vitest";

import type { Complaint, ComplaintUpdate } from "@/lib/complaints-api";
import {
  canConfirmResolution,
  complaintCategoryLabel,
  complaintStanding,
  confirmNote,
  hasComplaintErrors,
  threadEntries,
  validateComplaint,
} from "@/lib/complaints";

function update(overrides: Partial<ComplaintUpdate> = {}): ComplaintUpdate {
  return {
    actorId: "user-1",
    actorRole: "RESIDENT",
    complaintId: "complaint-1",
    createdAt: "2026-08-17T04:00:00.000Z",
    hostelId: "hostel-1",
    id: "update-1",
    message: "",
    type: "CREATED",
    ...overrides,
  };
}

function complaint(overrides: Partial<Complaint> = {}): Complaint {
  return {
    adminResponse: "",
    attachments: [],
    category: "MAINTENANCE",
    description: "The tap in the shared bathroom has not stopped running.",
    hostelId: "hostel-1",
    id: "complaint-1",
    isAnonymous: false,
    isOverdue: false,
    residentId: "resident-1",
    slaDueAt: "2026-08-19T04:00:00.000Z",
    status: "PENDING",
    title: "Running tap",
    updates: [],
    ...overrides,
  };
}

describe("validateComplaint", () => {
  it("accepts a filled-in draft", () => {
    const errors = validateComplaint({
      attachmentCount: 2,
      description: "Water everywhere.",
      title: "Running tap",
    });

    expect(hasComplaintErrors(errors)).toBe(false);
  });

  /*
   * The server trims before measuring, so a title of spaces is a 422 rather
   * than a two-character title.
   */
  it("measures trimmed lengths, like the server does", () => {
    expect(validateComplaint({ attachmentCount: 0, description: "     ", title: "  " }))
      .toEqual({
        description: "Describe what is wrong.",
        title: "Give this a short title.",
      });
  });

  it("holds the server's exact bounds", () => {
    expect(
      validateComplaint({
        attachmentCount: 0,
        description: "Long enough.",
        title: "a".repeat(161),
      }).title,
    ).toContain("160");

    expect(
      validateComplaint({
        attachmentCount: 0,
        description: "d".repeat(4001),
        title: "Fine",
      }).description,
    ).toContain("4000");

    // `complaintCreateSchema` caps `attachmentAssetIds` at 5 — a sixth photo is
    // a rejected submission after six uploads have already completed.
    expect(
      validateComplaint({ attachmentCount: 6, description: "Long enough.", title: "Fine" })
        .attachmentCount,
    ).toContain("5");
  });

  it("passes a draft sitting exactly on the limits", () => {
    const errors = validateComplaint({
      attachmentCount: 5,
      description: "12345",
      title: "ab",
    });

    expect(hasComplaintErrors(errors)).toBe(false);
  });
});

describe("canConfirmResolution", () => {
  it("is true only for a resolved complaint nobody has confirmed", () => {
    expect(canConfirmResolution({ status: "RESOLVED" })).toBe(true);
  });

  /*
   * The 409 this avoids is `COMPLAINT_NOT_RESOLVED`. Drawing the button on a
   * pending complaint spends a request to be told what the payload already said.
   */
  it("is false for every status the server would refuse", () => {
    expect(canConfirmResolution({ status: "PENDING" })).toBe(false);
    expect(canConfirmResolution({ status: "IN_PROGRESS" })).toBe(false);
    expect(canConfirmResolution({ status: "REJECTED" })).toBe(false);
  });

  // The service does not guard against this: a second confirmation re-stamps
  // the date and appends another line to the thread.
  it("is false once already confirmed", () => {
    expect(
      canConfirmResolution({ confirmedAt: "2026-08-17T05:00:00.000Z", status: "RESOLVED" }),
    ).toBe(false);
  });
});

describe("confirmNote", () => {
  it("omits an empty note rather than sending an empty string", () => {
    expect(confirmNote("")).toEqual({});
    expect(confirmNote("   ")).toEqual({});
  });

  // `note` is optional with min 2, so one character is the one length that is
  // neither absent nor valid.
  it("rejects a one-character note", () => {
    expect(confirmNote("k").error).toBeTruthy();
  });

  it("trims and keeps a real note", () => {
    expect(confirmNote("  Fixed properly, thanks.  ")).toEqual({
      note: "Fixed properly, thanks.",
    });
  });

  it("rejects a note past the server's limit", () => {
    expect(confirmNote("n".repeat(1001)).error).toBeTruthy();
  });
});

describe("complaintStanding", () => {
  it("asks for confirmation on a resolved complaint", () => {
    expect(complaintStanding({ isOverdue: false, status: "RESOLVED" })).toEqual({
      action: "confirm",
      headline: "The hostel marked this resolved. Confirm it is actually fixed.",
    });
  });

  it("stops asking once confirmed", () => {
    const standing = complaintStanding({
      confirmedAt: "2026-08-17T05:00:00.000Z",
      isOverdue: false,
      status: "RESOLVED",
    });

    expect(standing.action).toBeNull();
    expect(standing.headline).toBe("Resolved, and you confirmed it.");
  });

  it("never offers an action on a rejected complaint", () => {
    expect(complaintStanding({ isOverdue: true, status: "REJECTED" })).toEqual({
      action: null,
      headline: "The hostel rejected this.",
    });
  });

  /*
   * Overdue is the whole reason a resident reopens this screen, so it changes
   * the sentence rather than only a badge colour.
   */
  it("says so when an open complaint is past its SLA", () => {
    expect(complaintStanding({ isOverdue: true, status: "PENDING" }).headline).toContain(
      "past the time",
    );
    expect(
      complaintStanding({ isOverdue: true, status: "IN_PROGRESS" }).headline,
    ).toContain("past the time");
    expect(complaintStanding({ isOverdue: false, status: "PENDING" }).headline).not.toContain(
      "past the time",
    );
  });
});

describe("threadEntries", () => {
  /*
   * The line that matters most in the thread is the one an admin leaves no
   * words on. `message` is their *optional* response, so a status change is
   * usually empty — and an empty bubble with a timestamp says nothing.
   */
  it("turns a wordless status change into the event itself", () => {
    const [entry] = threadEntries(
      complaint({
        updates: [
          update({
            actorRole: "HOSTEL_ADMIN",
            nextStatus: "IN_PROGRESS",
            previousStatus: "PENDING",
            type: "STATUS_CHANGE",
          }),
        ],
      }),
    );

    expect(entry.body).toBe("Marked in progress.");
    expect(entry.note).toBeUndefined();
    expect(entry.actor).toBe("Hostel admin");
    expect(entry.mine).toBe(false);
  });

  it("keeps the admin's words alongside the status move", () => {
    const [entry] = threadEntries(
      complaint({
        updates: [
          update({
            actorRole: "WARDEN",
            message: "Plumber comes Tuesday.",
            nextStatus: "RESOLVED",
            type: "STATUS_CHANGE",
          }),
        ],
      }),
    );

    expect(entry.body).toBe("Marked resolved.");
    expect(entry.note).toBe("Plumber comes Tuesday.");
    expect(entry.actor).toBe("Warden");
  });

  /*
   * `actorId` is a `User` id and `complaint.residentId` is a `Resident` id, so
   * an id comparison is always false and every one of the resident's own lines
   * would be attributed to the hostel. The role is the only usable signal.
   */
  it("attributes the resident's own lines to them, by role", () => {
    const entries = threadEntries(
      complaint({
        residentId: "resident-1",
        updates: [
          update({ actorId: "user-9", actorRole: "RESIDENT", type: "CREATED" }),
          update({
            actorId: "user-4",
            actorRole: "HOSTEL_ADMIN",
            id: "update-2",
            message: "Looking into it.",
            type: "ADMIN_REPLY",
          }),
        ],
      }),
    );

    expect(entries.map((entry) => entry.mine)).toEqual([true, false]);
    expect(entries[0].actor).toBe("You");
    expect(entries[0].body).toBe("Complaint submitted.");
    expect(entries[1].body).toBe("Looking into it.");
  });

  it("gives a bare confirmation words of its own", () => {
    const [entry] = threadEntries(
      complaint({
        updates: [update({ type: "RESIDENT_CONFIRMATION" })],
      }),
    );

    expect(entry.body).toBe("Confirmed the fix.");
  });

  it("preserves the server's oldest-first order", () => {
    const entries = threadEntries(
      complaint({
        updates: [
          update({ id: "first", type: "CREATED" }),
          update({ id: "second", message: "Later.", type: "ADMIN_REPLY" }),
        ],
      }),
    );

    expect(entries.map((entry) => entry.id)).toEqual(["first", "second"]);
  });

  it("falls back to a readable role for one nobody mapped", () => {
    const [entry] = threadEntries(
      complaint({ updates: [update({ actorRole: "SERVICE_PROVIDER", message: "On site." })] }),
    );

    expect(entry.actor).toBe("Service provider");
  });
});

describe("complaintCategoryLabel", () => {
  it("labels every category the server sends", () => {
    expect(complaintCategoryLabel("MAINTENANCE")).toBe("Maintenance");
    expect(complaintCategoryLabel("FOOD")).toBe("Food");
  });

  it("humanizes one it has never seen rather than rendering the enum", () => {
    expect(complaintCategoryLabel("SOMETHING_NEW")).toBe("Something new");
  });
});
