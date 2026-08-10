/**
 * Finance audit envelope — Block 0 item 0.4 of
 * docs/FINANCE_IMPLEMENTATION_PLAN.md (§5.3, target §13.5, current §6.3).
 *
 * Two properties, both of which the old `auditPaymentAction` lacked: every
 * finance entry carries the amount before and after, and the entries are
 * chained so that editing or removing one breaks every hash after it.
 */
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const mocks = vi.hoisted(() => ({ create: vi.fn(), findOne: vi.fn() }));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: { create: mocks.create, findOne: mocks.findOne },
}));

const { auditFinanceAction, financeIntegrityHash } =
  await import("@/modules/finance/audit-finance");

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");
const entityId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a7");

const principal = {
  hostelIds: [hostelId.toString()],
  role: Role.HOSTEL_ADMIN,
  sessionId: "session-1",
  userId: "64f0f0f0f0f0f0f0f0f0f0a4",
};

function headEntry(financeIntegrity: string | null) {
  return {
    lean: vi.fn().mockResolvedValue(financeIntegrity ? { financeIntegrity } : null),
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
  };
}

async function write(overrides: Record<string, unknown> = {}) {
  await auditFinanceAction(principal, {
    action: "PAYMENT_PROOF_APPROVED",
    amountAfter: 12000,
    amountBefore: 0,
    entityId,
    entityType: "PaymentProof",
    hostelId,
    source: "PROOF_APPROVAL",
    ...overrides,
  });

  return mocks.create.mock.calls[0][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findOne.mockReturnValue(headEntry(null));
  mocks.create.mockResolvedValue({});
});

describe("auditFinanceAction", () => {
  it("records the amount before and after, with a currency", async () => {
    const entry = await write();

    expect(entry.metadata).toMatchObject({
      actorRole: Role.HOSTEL_ADMIN,
      amountAfter: 12000,
      amountBefore: 0,
      currency: "NPR",
      source: "PROOF_APPROVAL",
    });
  });

  // Rejections and no-op corrections move no money. Recording the unchanged
  // pair is the point: "nothing changed" is itself the auditable claim.
  it("records an unchanged balance rather than omitting the amounts", async () => {
    const entry = await write({ amountAfter: 5000, amountBefore: 5000 });

    expect(entry.metadata.amountBefore).toBe(5000);
    expect(entry.metadata.amountAfter).toBe(5000);
  });

  it("chains each entry to the hostel's previous finance entry", async () => {
    mocks.findOne.mockReturnValue(headEntry("previous-hash"));

    const entry = await write();

    expect(entry.financeIntegrity).toBe(
      financeIntegrityHash({
        action: "PAYMENT_PROOF_APPROVED",
        amountAfter: 12000,
        createdAt: entry.createdAt,
        entityId: entityId.toString(),
        previousEntryHash: "previous-hash",
      }),
    );
  });

  it("starts a fresh chain when the hostel has no finance entries yet", async () => {
    const entry = await write();

    expect(entry.financeIntegrity).toBe(
      financeIntegrityHash({
        action: "PAYMENT_PROOF_APPROVED",
        amountAfter: 12000,
        createdAt: entry.createdAt,
        entityId: entityId.toString(),
        previousEntryHash: "",
      }),
    );
  });

  // Per hostel, not platform-wide: a global chain would serialise every
  // hostel's finance writes behind one head row.
  it("looks for the chain head within the hostel only", async () => {
    await write();

    expect(mocks.findOne).toHaveBeenCalledWith({
      financeIntegrity: { $exists: true },
      hostelId,
    });
  });

  // The hash covers createdAt, so it must be the value that is stored — not
  // one the schema's timestamp default assigns a moment later.
  it("stores the timestamp the hash was computed over", async () => {
    const entry = await write();

    expect(entry.createdAt).toBeInstanceOf(Date);
  });
});

describe("financeIntegrityHash", () => {
  const base = {
    action: "PAYMENT_UPDATED",
    amountAfter: 12000,
    createdAt: new Date("2026-08-06T10:00:00.000Z"),
    entityId: "abc",
    previousEntryHash: "head",
  };

  it("is stable for identical input", () => {
    expect(financeIntegrityHash(base)).toBe(financeIntegrityHash(base));
  });

  it("changes when the amount is altered", () => {
    expect(financeIntegrityHash({ ...base, amountAfter: 0 })).not.toBe(
      financeIntegrityHash(base),
    );
  });

  // The property that makes the chain worth having: rewriting one entry
  // invalidates every entry after it.
  it("changes when the previous entry changes", () => {
    expect(financeIntegrityHash({ ...base, previousEntryHash: "tampered" })).not.toBe(
      financeIntegrityHash(base),
    );
  });
});
