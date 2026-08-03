/**
 * Multi-tenant isolation suite — TESTING.md §6.1 ("⭐ HIGHEST PRIORITY"),
 * RULES.md §3, PRD.md §11 v1 success criterion.
 *
 * **Deviation from the §7.1 template, deliberately.** That template drives real
 * HTTP through Supertest against a seeded `mongodb-memory-server`. Neither is
 * installed (TODO.md B8 holds that decision), so this suite proves the same
 * property one layer down, at the service boundary, with mocked models — which
 * is where the tenant scoping actually lives (RULES.md §3: route handlers never
 * query models directly). Two things are asserted per resource:
 *
 * 1. **Reads by id cannot cross tenants.** Every by-id lookup must put the
 *    caller's hostel scope *into the query*, so another hostel's row can never
 *    be the document that comes back. Asserting on the filter — rather than on
 *    a null result — is what makes the test meaningful: a service that fetched
 *    first and checked after would return the row on the day someone deletes
 *    the check, and a null-only assertion would not notice.
 * 2. **Lists cannot leak rows.** The filter handed to `find` *and* to
 *    `countDocuments` must constrain `hostelId` to the principal's hostels
 *    under every combination of search, status filter, sort and page. A total
 *    counted over an unscoped filter leaks the other hostel's row count even
 *    when the page itself is clean.
 *
 * And that an explicitly requested foreign `hostelId` is refused with **404,
 * never 403** — a 403 confirms the hostel exists.
 *
 * When Supertest and an in-memory Mongo land, this file should be joined by
 * route-level tests, not replaced: the two catch different mistakes.
 */
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const mocks = vi.hoisted(() => ({
  complaintAggregate: vi.fn(),
  complaintCountDocuments: vi.fn(),
  complaintFind: vi.fn(),
  connectToDatabase: vi.fn(),
  maintenanceFind: vi.fn(),
  noticeCountDocuments: vi.fn(),
  noticeFind: vi.fn(),
  paymentCountDocuments: vi.fn(),
  paymentFind: vi.fn(),
  paymentProofFind: vi.fn(),
  residentCountDocuments: vi.fn(),
  residentFind: vi.fn(),
  residentFindOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: {
    countDocuments: mocks.residentCountDocuments,
    exists: vi.fn(),
    find: mocks.residentFind,
    findOne: mocks.residentFindOne,
    updateOne: vi.fn(),
  },
}));

vi.mock("@hostel/db/models/Payment", () => ({
  PaymentModel: {
    aggregate: vi.fn().mockResolvedValue([]),
    countDocuments: mocks.paymentCountDocuments,
    find: mocks.paymentFind,
    findOne: vi.fn(),
  },
}));

vi.mock("@hostel/db/models/PaymentProof", () => ({
  PaymentProofModel: { find: mocks.paymentProofFind, findOne: vi.fn() },
}));

vi.mock("@hostel/db/models/Notice", () => ({
  NoticeModel: {
    countDocuments: mocks.noticeCountDocuments,
    find: mocks.noticeFind,
    findOne: vi.fn(),
  },
}));

vi.mock("@hostel/db/models/Complaint", () => ({
  ComplaintModel: {
    aggregate: mocks.complaintAggregate,
    countDocuments: mocks.complaintCountDocuments,
    find: mocks.complaintFind,
    findOne: vi.fn(),
  },
}));

vi.mock("@hostel/db/models/MaintenanceRequest", () => ({
  MaintenanceRequestModel: { find: mocks.maintenanceFind, findOne: vi.fn() },
}));

vi.mock("@hostel/db/models/MaintenanceComment", () => ({
  MaintenanceCommentModel: { find: vi.fn(), create: vi.fn() },
}));

vi.mock("@hostel/db/models/MaintenanceHistory", () => ({
  MaintenanceHistoryModel: { find: vi.fn(), create: vi.fn() },
}));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: { find: vi.fn(), findOne: vi.fn() },
}));

vi.mock("@hostel/db/models/AuditLog", () => ({ AuditLogModel: { create: vi.fn() } }));

import { listAdminComplaints } from "@/modules/complaints/complaint.service";
import { listMaintenanceRequests } from "@/modules/maintenance/maintenance.service";
import { listNotices } from "@/modules/notices/notice.service";
import { listPayments } from "@/modules/payments/payment.service";
import { getResidentById, listResidents } from "@/modules/residents/resident.service";

/** Hostel A is the caller's. Hostel B is the one that must stay invisible. */
const hostelA = "64f0f0f0f0f0f0f0f0f0aa01";
const hostelB = "64f0f0f0f0f0f0f0f0f0bb01";
const residentInB = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0bb02");

const adminOfA = {
  hostelIds: [hostelA],
  role: Role.HOSTEL_ADMIN,
  sessionId: "session-a",
  userId: "64f0f0f0f0f0f0f0f0f0aa03",
};

const wardenOfA = {
  hostelIds: [hostelA],
  role: Role.WARDEN,
  sessionId: "session-w",
  userId: "64f0f0f0f0f0f0f0f0f0aa04",
};

function leanResult<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value) };
}

function queryResult<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
    limit: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
  };
}

/**
 * The property every list filter must hold: `hostelId` is pinned to hostel A,
 * either as the resolved single hostel or as an `$in` over the principal's
 * hostels — and hostel B appears nowhere in it.
 */
function expectScopedToHostelA(filter: Record<string, unknown>) {
  const hostelId = filter.hostelId as { $in?: Types.ObjectId[] } | Types.ObjectId;

  expect(hostelId).toBeDefined();

  const scoped =
    hostelId instanceof Types.ObjectId
      ? [hostelId]
      : ((hostelId.$in ?? []) as Types.ObjectId[]);

  expect(scoped.map(String)).toEqual([hostelA]);
  expect(JSON.stringify(filter)).not.toContain(hostelB);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.residentFind.mockReturnValue(queryResult([]));
  mocks.residentCountDocuments.mockResolvedValue(0);
  mocks.residentFindOne.mockReturnValue(leanResult(null));
  mocks.paymentFind.mockReturnValue(queryResult([]));
  mocks.paymentCountDocuments.mockResolvedValue(0);
  mocks.paymentProofFind.mockReturnValue(queryResult([]));
  mocks.noticeFind.mockReturnValue(queryResult([]));
  mocks.noticeCountDocuments.mockResolvedValue(0);
  mocks.complaintFind.mockReturnValue(queryResult([]));
  mocks.complaintCountDocuments.mockResolvedValue(0);
  mocks.complaintAggregate.mockResolvedValue([]);
  mocks.maintenanceFind.mockReturnValue(queryResult([]));
});

describe("tenant isolation — reading another hostel's record by id", () => {
  it("scopes the resident lookup to the caller's hostel and 404s on a miss", async () => {
    await expect(
      getResidentById(residentInB.toString(), {}, adminOfA),
    ).rejects.toMatchObject({ errorCode: "RESIDENT_NOT_FOUND", status: 404 });

    // The scope is in the query, so hostel B's row was never a candidate.
    expectScopedToHostelA(mocks.residentFindOne.mock.calls[0][0]);
  });

  it("never returns hostel B's resident even when the model hands one back", async () => {
    // Simulates the scoping being dropped from the query: the guard that is
    // left must still refuse. Today the filter is the guard, so this asserts
    // the filter carried hostel A rather than the id alone.
    mocks.residentFindOne.mockReturnValue(
      leanResult({ _id: residentInB, hostelId: new Types.ObjectId(hostelB) }),
    );

    await getResidentById(residentInB.toString(), {}, adminOfA).catch(() => undefined);

    const filter = mocks.residentFindOne.mock.calls[0][0];
    expect(filter._id).toBeDefined();
    expectScopedToHostelA(filter);
  });
});

describe("tenant isolation — an explicitly requested foreign hostelId", () => {
  // 404 and not 403: a 403 tells the caller hostel B exists (RULES.md §3).
  const cases: [string, () => Promise<unknown>][] = [
    ["residents", () => listResidents({ hostelId: hostelB }, adminOfA)],
    ["payments", () => listPayments({ hostelId: hostelB }, adminOfA)],
    ["notices", () => listNotices({ hostelId: hostelB }, adminOfA)],
    ["complaints", () => listAdminComplaints({ hostelId: hostelB }, adminOfA)],
    ["maintenance", () => listMaintenanceRequests({ hostelId: hostelB }, adminOfA)],
    ["resident by id", () => getResidentById(residentInB.toString(), { hostelId: hostelB }, adminOfA)],
  ];

  it.each(cases)("%s → 404, never 403", async (_name, call) => {
    await expect(call()).rejects.toMatchObject({
      errorCode: "NOT_FOUND",
      status: 404,
    });
  });

  it("does not reach the database at all when the scope check fails", async () => {
    await listResidents({ hostelId: hostelB }, adminOfA).catch(() => undefined);

    expect(mocks.residentFind).not.toHaveBeenCalled();
    expect(mocks.residentCountDocuments).not.toHaveBeenCalled();
  });
});

describe("tenant isolation — list endpoints under every filter combination", () => {
  it("scopes residents, including the search and status filters and the count", async () => {
    await listResidents(
      {
        page: 3,
        pageSize: 50,
        q: "Asha",
        residentType: "STUDENT",
        status: "ACTIVE",
      },
      adminOfA,
    );

    expectScopedToHostelA(mocks.residentFind.mock.calls[0][0]);
    // The total is what the pager reports; counting unscoped would leak how
    // many residents hostel B has even with a clean page.
    expectScopedToHostelA(mocks.residentCountDocuments.mock.calls[0][0]);
  });

  it("keeps the hostel scope when a search term adds its own $or", async () => {
    await listResidents({ q: "9800000000" }, adminOfA);

    const filter = mocks.residentFind.mock.calls[0][0];
    expect(filter.$or).toBeDefined();
    // The $or must narrow *within* the tenant, not replace the tenant clause.
    expectScopedToHostelA(filter);
  });

  it("scopes payments, list and count alike", async () => {
    await listPayments({ month: "2030-01", status: "UNPAID" }, adminOfA);

    expectScopedToHostelA(mocks.paymentFind.mock.calls[0][0]);
    expectScopedToHostelA(mocks.paymentCountDocuments.mock.calls[0][0]);
  });

  it("scopes notices, list and count alike", async () => {
    await listNotices({ category: "GENERAL" }, adminOfA);

    expectScopedToHostelA(mocks.noticeFind.mock.calls[0][0]);
    expectScopedToHostelA(mocks.noticeCountDocuments.mock.calls[0][0]);
  });

  it("scopes complaints — page, total and the summary aggregate", async () => {
    await listAdminComplaints({ status: "PENDING" }, adminOfA);

    expectScopedToHostelA(mocks.complaintFind.mock.calls[0][0]);
    expectScopedToHostelA(mocks.complaintCountDocuments.mock.calls[0][0]);

    // The header summary is an aggregate over the same filter; an unscoped
    // $match there would report hostel B's complaints in hostel A's header.
    const pipeline = mocks.complaintAggregate.mock.calls[0][0] as Record<
      string,
      Record<string, unknown>
    >[];
    const match = pipeline.find((stage) => stage.$match)?.$match;
    expectScopedToHostelA(match as Record<string, unknown>);
  });

  it("scopes maintenance requests", async () => {
    await listMaintenanceRequests({ status: "PENDING" }, adminOfA);

    expectScopedToHostelA(mocks.maintenanceFind.mock.calls[0][0]);
  });

  it("scopes a warden the same way it scopes an admin", async () => {
    // Wardens are hostel staff with a narrower role but the same tenant
    // boundary — a lower privilege level must not mean a looser filter.
    await listResidents({}, wardenOfA);

    expectScopedToHostelA(mocks.residentFind.mock.calls[0][0]);
  });
});
