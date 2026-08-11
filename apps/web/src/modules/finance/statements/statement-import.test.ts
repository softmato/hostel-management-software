/**
 * Statement import — Block 4 item 4.2 of docs/FINANCE_IMPLEMENTATION_PLAN.md
 * (target §6.4).
 *
 * The ladder's rules are tested pure in `matching/ladder.test.ts`. What is left
 * to prove here is what the *pipeline* guarantees, and the plan names both:
 *
 * - overlapping date ranges across two uploads produce **zero** duplicate
 *   events, which is the difference between a feature owners use weekly and one
 *   they use once;
 * - a file that cannot be fully read imports **nothing**, and says so — a
 *   half-ingested statement is money that silently went missing.
 */
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiPrincipal } from "@/lib/api-auth";
import { Role } from "@/lib/roles";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");
const assetId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0b1");
const importId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c1");

const mocks = vi.hoisted(() => ({
  appendEvent: vi.fn(),
  assetFindOne: vi.fn(),
  eventFind: vi.fn(),
  importCreate: vi.fn(),
  importUpdateOne: vi.fn(),
  loadMatchContext: vi.fn(),
  profileUpdateOne: vi.fn(),
  r2Send: vi.fn(),
  settleEvent: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/lib/r2", () => ({ getR2Client: () => ({ send: mocks.r2Send }) }));
vi.mock("@/lib/realtime/server", () => ({ publishResourceChange: vi.fn() }));
vi.mock("@/modules/finance/audit-finance", () => ({ auditFinanceAction: vi.fn() }));

vi.mock("@/modules/finance/payment-event.service", () => ({
  appendEvent: mocks.appendEvent,
  settleEvent: mocks.settleEvent,
}));

// Partial: `classifyCredit` is the real ladder, only the loader is stubbed.
vi.mock("@/modules/finance/matching/ladder.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/finance/matching/ladder.service")>()),
  loadMatchContext: mocks.loadMatchContext,
}));

vi.mock("@hostel/db/models/FileAsset", () => ({
  FileAssetModel: { findOne: mocks.assetFindOne },
}));
vi.mock("@hostel/db/models/HostelPaymentProfile", () => ({
  HostelPaymentProfileModel: { updateOne: mocks.profileUpdateOne },
}));
vi.mock("@hostel/db/models/PaymentEvent", () => ({
  PaymentEventModel: { find: mocks.eventFind },
}));
vi.mock("@hostel/db/models/StatementImport", () => ({
  StatementImportModel: {
    create: mocks.importCreate,
    updateOne: mocks.importUpdateOne,
  },
}));
vi.mock("@hostel/db/models/ReconciliationRun", () => ({
  ReconciliationRunModel: {
    create: vi.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    updateOne: vi.fn(),
  },
}));

import { generateReferenceCode } from "@/modules/finance/reference-code";
import { importStatement } from "@/modules/finance/statements/statement-import.service";

const CODE = generateReferenceCode("RUP", 4821);

const principal = {
  hostelIds: [hostelId.toString()],
  role: Role.HOSTEL_ADMIN,
  userId: "64f0f0f0f0f0f0f0f0f0f0d1",
} as ApiPrincipal;

const STATEMENT = [
  "S.N.,Date,Transaction Code,Name,Remarks,Debit,Credit",
  `1,2026-08-02 09:14:03,ESW001,Bikash Thapa,${CODE} august rent,,"8,000"`,
  '2,2026-08-04 18:02:44,ESW002,Kirana Store,grocery,"1,500",',
  '3,2026-08-12 20:31:59,ESW003,S. TAMANG,,,"8,000"',
  "",
].join("\n");

function chain<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value), select: vi.fn().mockReturnThis() };
}

function setStatementBody(text: string) {
  mocks.r2Send.mockResolvedValue({
    Body: { transformToByteArray: async () => new TextEncoder().encode(text) },
  });
}

/** Transaction ids the hostel is treated as already holding. */
function setKnownTxnIds(ids: string[]) {
  mocks.eventFind.mockReturnValue(
    chain(ids.map((providerTxnId) => ({ providerTxnId }))),
  );
}

beforeEach(() => {
  vi.clearAllMocks();

  mocks.assetFindOne.mockReturnValue(
    chain({
      _id: assetId,
      bucket: "bucket",
      fileName: "esewa_august.csv",
      hostelId,
      key: "statements/esewa_august.csv",
      sizeBytes: 2048,
      uploadCompletedAt: new Date(),
    }),
  );
  mocks.importCreate.mockResolvedValue({ _id: importId });
  mocks.importUpdateOne.mockResolvedValue({});
  mocks.profileUpdateOne.mockResolvedValue({});
  mocks.appendEvent.mockImplementation(async () => ({
    created: true,
    event: { _id: new Types.ObjectId() },
  }));
  mocks.settleEvent.mockResolvedValue({});
  mocks.loadMatchContext.mockResolvedValue({
    claims: [],
    claimsByTxnId: new Map(),
    invoicesByCode: new Map([
      [
        CODE,
        {
          bedLabel: "Dormitory",
          dueDate: new Date(2026, 7, 5),
          invoiceId: "inv-1",
          outstanding: 8000,
          period: "2026-08",
          referenceCode: CODE,
          residentId: "res-1",
          residentName: "Bikash Thapa",
          totalAmount: 8000,
        },
      ],
    ]),
    openInvoices: [],
  });

  setStatementBody(STATEMENT);
  setKnownTxnIds([]);
});

describe("importing a statement", () => {
  it("reads credits, ignores debits, and settles only the referenced row", async () => {
    const summary = await importStatement({
      assetId: assetId.toString(),
      hostelId,
      principal,
      provider: "ESEWA",
    });

    expect(summary.rowCount).toBe(3);
    expect(summary.creditCount).toBe(2);
    expect(summary.matchedCount).toBe(1);
    expect(summary.orphanCount).toBe(1);

    // The debit never becomes an event: money leaving the hostel is not a
    // payment to anybody in it.
    expect(mocks.appendEvent).toHaveBeenCalledTimes(2);
    expect(mocks.settleEvent).toHaveBeenCalledTimes(1);
    expect(mocks.settleEvent.mock.calls[0]?.[1].confirmation).toBe("STATEMENT_MATCH");
  });

  it("derives the period from the rows rather than the upload time", async () => {
    const summary = await importStatement({
      assetId: assetId.toString(),
      hostelId,
      principal,
      provider: "ESEWA",
    });

    expect(summary.periodStart?.getDate()).toBe(2);
    expect(summary.periodEnd?.getDate()).toBe(12);
  });

  it("stores the parser version, so this import stays re-parseable", async () => {
    const summary = await importStatement({
      assetId: assetId.toString(),
      hostelId,
      principal,
      provider: "ESEWA",
    });

    expect(summary.parserVersion).toBe("esewa@2");
  });

  it("records the upload time, which is what the nudge banner reads", async () => {
    await importStatement({
      assetId: assetId.toString(),
      hostelId,
      principal,
      provider: "ESEWA",
    });

    expect(mocks.profileUpdateOne).toHaveBeenCalled();
  });
});

describe("overlapping uploads", () => {
  it("writes zero duplicate events when every row was already ingested", async () => {
    setKnownTxnIds(["ESW001", "ESW003"]);

    const summary = await importStatement({
      assetId: assetId.toString(),
      hostelId,
      principal,
      provider: "ESEWA",
    });

    expect(summary.duplicateCount).toBe(2);
    expect(mocks.appendEvent).not.toHaveBeenCalled();
    expect(mocks.settleEvent).not.toHaveBeenCalled();
  });

  it("ingests only the rows that are new to an overlapping range", async () => {
    setKnownTxnIds(["ESW001"]);

    const summary = await importStatement({
      assetId: assetId.toString(),
      hostelId,
      principal,
      provider: "ESEWA",
    });

    expect(summary.duplicateCount).toBe(1);
    expect(mocks.appendEvent).toHaveBeenCalledTimes(1);
    expect(mocks.appendEvent.mock.calls[0]?.[0].providerTxnId).toBe("ESW003");
  });

  it("does not settle twice when the append was a replay", async () => {
    mocks.appendEvent.mockResolvedValue({
      created: false,
      event: { _id: new Types.ObjectId() },
    });

    await importStatement({
      assetId: assetId.toString(),
      hostelId,
      principal,
      provider: "ESEWA",
    });

    expect(mocks.settleEvent).not.toHaveBeenCalled();
  });
});

describe("a file that cannot be read", () => {
  it("imports nothing and records why", async () => {
    setStatementBody(
      STATEMENT.replace('"8,000"', "eight thousand"),
    );

    await expect(
      importStatement({
        assetId: assetId.toString(),
        hostelId,
        principal,
        provider: "ESEWA",
      }),
    ).rejects.toThrow(/amount/i);

    expect(mocks.appendEvent).not.toHaveBeenCalled();

    const failed = mocks.importUpdateOne.mock.calls.find(
      (call) => call[1]?.$set?.status === "FAILED",
    );

    expect(failed).toBeDefined();
    expect(failed?.[1].$set.errorDetail).toMatch(/amount/i);
  });

  it("refuses a file belonging to another hostel", async () => {
    mocks.assetFindOne.mockReturnValue(
      chain({
        _id: assetId,
        bucket: "bucket",
        hostelId: new Types.ObjectId(),
        key: "k",
        uploadCompletedAt: new Date(),
      }),
    );

    await expect(
      importStatement({
        assetId: assetId.toString(),
        hostelId,
        principal,
        provider: "ESEWA",
      }),
    ).rejects.toThrow(/does not belong to this hostel/i);

    expect(mocks.importCreate).not.toHaveBeenCalled();
  });

  it("refuses a file whose upload was never verified", async () => {
    mocks.assetFindOne.mockReturnValue(
      chain({ _id: assetId, bucket: "bucket", hostelId, key: "k" }),
    );

    await expect(
      importStatement({
        assetId: assetId.toString(),
        hostelId,
        principal,
        provider: "ESEWA",
      }),
    ).rejects.toThrow(/did not finish uploading/i);
  });
});
