import { describe, expect, it } from "vitest";

import type {
  AdminClaim,
  AdminComplaint,
  AdminInquiry,
  AdminSosAlert,
} from "@/lib/admin-api";
import { alertCounts, buildAlertFeed, occupancyRate } from "@/lib/admin-alerts";

function sos(overrides: Partial<AdminSosAlert> = {}): AdminSosAlert {
  return {
    createdAt: "2026-08-17T10:00:00.000Z",
    guardianAlertEnabled: true,
    id: "sos-1",
    message: "Feeling unsafe near the gate",
    residentId: "r-1",
    status: "ACTIVE",
    ...overrides,
  };
}

function complaint(overrides: Partial<AdminComplaint> = {}): AdminComplaint {
  return {
    adminResponse: "",
    category: "PLUMBING",
    createdAt: "2026-08-10T10:00:00.000Z",
    description: "Tap leaking",
    id: "c-1",
    isAnonymous: false,
    isOverdue: true,
    residentId: "r-1",
    slaDueAt: "2026-08-12T10:00:00.000Z",
    status: "PENDING",
    title: "Leaking tap",
    ...overrides,
  };
}

function claim(overrides: Partial<AdminClaim> = {}): AdminClaim {
  return {
    allGreen: true,
    amount: 5000,
    checks: [],
    confirmation: "TXN123",
    eventId: "e-1",
    evidenceAssetId: null,
    evidenceMimeType: null,
    invoiceId: "i-1",
    method: "ESEWA",
    occurredAt: "2026-08-15T10:00:00.000Z",
    period: "2026-08",
    referenceNote: null,
    rejectionReason: null,
    residentId: "r-1",
    residentName: "Asha Rai",
    status: "PENDING",
    transactionCode: null,
    ...overrides,
  };
}

function inquiry(overrides: Partial<AdminInquiry> = {}): AdminInquiry {
  return {
    createdAt: "2026-08-01T10:00:00.000Z",
    email: "",
    id: "q-1",
    message: "Do you have a single room?",
    name: "Sita Gurung",
    phone: "9800000000",
    preferredRoomType: "SINGLE",
    source: "WEBSITE",
    status: "NEW",
    ...overrides,
  };
}

const empty = { claims: [], complaints: [], inquiries: [], sos: [] };

describe("buildAlertFeed", () => {
  /*
   * The ordering is by consequence of ignoring it, not by recency — which is
   * why the *newest* row here (the SOS) still sorts above an inquiry that has
   * been sitting for a fortnight.
   */
  it("ranks by consequence: SOS, overdue complaint, claim, inquiry", () => {
    const rows = buildAlertFeed({
      claims: [claim()],
      complaints: [complaint()],
      inquiries: [inquiry()],
      sos: [sos()],
    });

    expect(rows.map((row) => row.kind)).toEqual(["sos", "complaint", "claim", "inquiry"]);
  });

  it("puts the longest-waiting first within a tier", () => {
    // Every one of these endpoints returns newest first, which is right for a
    // desk queue worked top-down and wrong for triage.
    const rows = buildAlertFeed({
      ...empty,
      claims: [
        claim({ eventId: "new", occurredAt: "2026-08-16T10:00:00.000Z" }),
        claim({ eventId: "old", occurredAt: "2026-08-02T10:00:00.000Z" }),
      ],
    });

    expect(rows.map((row) => row.id)).toEqual(["old", "new"]);
  });

  it("sorts a row with no timestamp oldest rather than burying it", () => {
    const rows = buildAlertFeed({
      ...empty,
      inquiries: [
        inquiry({ createdAt: "2026-08-16T10:00:00.000Z", id: "dated" }),
        inquiry({ createdAt: undefined, id: "undated" }),
      ],
    });

    expect(rows[0]?.id).toBe("undated");
  });

  it("survives an unparseable date instead of scrambling the order", () => {
    const rows = buildAlertFeed({
      ...empty,
      inquiries: [
        inquiry({ createdAt: "not a date", id: "broken" }),
        inquiry({ createdAt: "2026-08-16T10:00:00.000Z", id: "fine" }),
      ],
    });

    expect(rows.map((row) => row.id)).toEqual(["broken", "fine"]);
  });

  it("names an anonymous complaint without leaking its category as identity", () => {
    const rows = buildAlertFeed({ ...empty, complaints: [complaint({ isAnonymous: true })] });

    expect(rows[0]?.subtitle).toBe("Anonymous · past its SLA");
  });

  it("is empty, not undefined, with nothing to show", () => {
    expect(buildAlertFeed(empty)).toEqual([]);
  });
});

describe("alertCounts", () => {
  it("counts each tier", () => {
    const rows = buildAlertFeed({
      claims: [claim(), claim({ eventId: "e-2" })],
      complaints: [],
      inquiries: [inquiry()],
      sos: [sos()],
    });

    expect(alertCounts(rows)).toEqual({ claim: 2, complaint: 0, inquiry: 1, sos: 1 });
  });
});

describe("occupancyRate", () => {
  it("is a percentage of beds filled", () => {
    expect(occupancyRate({ residents: 30, vacantBeds: 10 })).toBe(75);
  });

  /*
   * Null, not zero. A hostel that has not configured its rooms reports no beds
   * — and "0% occupied" shown to an admin with forty residents is how a whole
   * dashboard stops being believed.
   */
  it("is null when the hostel has recorded no capacity", () => {
    expect(occupancyRate({ residents: 0, vacantBeds: 0 })).toBeNull();
  });

  it("is 100 when every bed is taken", () => {
    expect(occupancyRate({ residents: 40, vacantBeds: 0 })).toBe(100);
  });
});
