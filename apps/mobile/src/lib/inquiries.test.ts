import { describe, expect, it } from "vitest";

import type { ManagedInquiry } from "@/lib/admin-manage-api";
import {
  inquiriesIn,
  inquiryActions,
  inquiryBucket,
  inquiryCounts,
} from "@/lib/inquiries";

function lead(overrides: Partial<ManagedInquiry> = {}): ManagedInquiry {
  return {
    budgetRange: "",
    createdAt: "2026-08-18T06:00:00.000Z",
    email: "",
    gender: "",
    id: "1",
    message: "",
    name: "Asha Rai",
    phone: "9800000000",
    preferredRoomType: "",
    source: "PUBLIC_WEBSITE",
    status: "NEW",
    ...overrides,
  };
}

describe("inquiryBucket", () => {
  it("folds five statuses into the three questions people ask", () => {
    expect(inquiryBucket("NEW")).toBe("new");
    expect(inquiryBucket("CONTACTED")).toBe("working");
    expect(inquiryBucket("VISIT_SCHEDULED")).toBe("working");
    expect(inquiryBucket("CONVERTED")).toBe("done");
    expect(inquiryBucket("CLOSED")).toBe("done");
  });

  it("treats a status it has never heard of as unanswered", () => {
    // The safe direction. Filing it under Done would bury a lead in the segment
    // people stop opening, and nobody would ever find out.
    expect(inquiryBucket("SOMETHING_NEW")).toBe("new");
  });
});

describe("inquiriesIn", () => {
  it("puts the newest lead first — this is a desk queue, not triage", () => {
    const rows = [
      lead({ createdAt: "2026-08-01T06:00:00.000Z", id: "old" }),
      lead({ createdAt: "2026-08-18T06:00:00.000Z", id: "fresh" }),
      lead({ id: "done", status: "CLOSED" }),
    ];

    expect(inquiriesIn(rows, "new").map((row) => row.id)).toEqual(["fresh", "old"]);
    expect(inquiriesIn(rows, "done").map((row) => row.id)).toEqual(["done"]);
  });

  it("does not drop a lead with no date", () => {
    const rows = [lead({ createdAt: undefined, id: "undated" })];

    expect(inquiriesIn(rows, "new")).toHaveLength(1);
  });
});

describe("inquiryCounts", () => {
  it("counts every lead exactly once", () => {
    const rows = [
      lead({ id: "a" }),
      lead({ id: "b", status: "CONTACTED" }),
      lead({ id: "c", status: "VISIT_SCHEDULED" }),
      lead({ id: "d", status: "CONVERTED" }),
    ];

    expect(inquiryCounts(rows)).toEqual({ done: 1, new: 1, working: 2 });
  });
});

describe("inquiryActions", () => {
  it("offers mark-read on a new lead, and it writes CONTACTED", () => {
    // There is no read flag on an inquiry. `CONTACTED` is the server's word for
    // "somebody picked this up", and writing it is what drops the lead out of
    // the `status=NEW` pull behind the red count on Home.
    expect(inquiryActions("NEW")).toEqual([
      { label: "Mark read", status: "CONTACTED" },
      { label: "Close", status: "CLOSED" },
    ]);
  });

  it("never draws a button that would change nothing", () => {
    // "Mark read" on a lead already contacted, or "Close" on a closed one, is a
    // control that looks like an action and is a no-op.
    expect(inquiryActions("CONTACTED").map((action) => action.status)).toEqual([
      "CONVERTED",
      "CLOSED",
    ]);
    expect(inquiryActions("CLOSED")).toEqual([
      { label: "Reopen", status: "CONTACTED" },
    ]);
  });
});
