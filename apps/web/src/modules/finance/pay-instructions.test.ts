/**
 * Pay instructions — Block 3 item 3.3 of docs/FINANCE_IMPLEMENTATION_PLAN.md
 * (target §11.1).
 *
 * The three things that can go wrong here all cost the resident money or the
 * owner an afternoon: showing the full invoice total on a part-paid month,
 * rendering a blank card when the hostel has configured nothing, and losing the
 * reference code — without which the transfer lands in the owner's queue as an
 * unidentifiable credit.
 */
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiPrincipal } from "@/lib/api-auth";
import { Role } from "@/lib/roles";

const mocks = vi.hoisted(() => ({
  balanceFindOne: vi.fn(),
  findCurrentResident: vi.fn(),
  invoiceFindOne: vi.fn(),
  profileFindOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: vi.fn() }));

vi.mock("@/modules/residents/resident-access", () => ({
  findCurrentResident: mocks.findCurrentResident,
}));

vi.mock("@hostel/db/models/Invoice", () => ({
  InvoiceModel: { findOne: mocks.invoiceFindOne },
}));

vi.mock("@hostel/db/models/InvoiceBalance", () => ({
  InvoiceBalanceModel: { findOne: mocks.balanceFindOne },
}));

vi.mock("@hostel/db/models/HostelPaymentProfile", async () => {
  const actual = await vi.importActual<
    typeof import("@hostel/db/models/HostelPaymentProfile")
  >("@hostel/db/models/HostelPaymentProfile");

  return {
    ...actual,
    HostelPaymentProfileModel: { findOne: mocks.profileFindOne },
  };
});

const { getPayInstructions } = await import("./pay-instructions.service");

const hostelId = new Types.ObjectId();
const residentId = new Types.ObjectId();
const invoiceId = new Types.ObjectId();
const qrAssetId = new Types.ObjectId();

const principal = {
  role: Role.RESIDENT,
  userId: new Types.ObjectId().toString(),
} as unknown as ApiPrincipal;

function lean<T>(value: T) {
  return { lean: () => Promise.resolve(value) };
}

const invoice = {
  _id: invoiceId,
  dueDate: new Date("2026-09-30T00:00:00.000Z"),
  hostelId,
  period: "2026-09",
  referenceCode: "EDU-0001-F",
  status: "OPEN",
  totalAmount: 10000,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findCurrentResident.mockResolvedValue({ _id: residentId, hostelId });
  mocks.invoiceFindOne.mockReturnValue(lean(invoice));
  mocks.balanceFindOne.mockReturnValue(lean(null));
  mocks.profileFindOne.mockReturnValue(
    lean({ displayName: "Green View Hostel", esewaId: "9800000000" }),
  );
});

describe("getPayInstructions", () => {
  it("returns the reference code and the amount still owed", async () => {
    const result = await getPayInstructions(invoiceId.toString(), principal);

    expect(result.referenceCode).toBe("EDU-0001-F");
    expect(result.amountDue).toBe(10000);
    expect(result.period).toBe("2026-09");
    expect(result.tier).toBe("TIER_0");
  });

  it("shows the outstanding half of a part-paid invoice, not the total", async () => {
    mocks.balanceFindOne.mockReturnValue(lean({ settledAmount: 4000 }));

    // Showing 10,000 here is how a resident pays a month twice.
    expect((await getPayInstructions(invoiceId.toString(), principal)).amountDue).toBe(
      6000,
    );
  });

  it("never returns a negative amount when more was settled than billed", async () => {
    mocks.balanceFindOne.mockReturnValue(lean({ settledAmount: 15000 }));

    expect((await getPayInstructions(invoiceId.toString(), principal)).amountDue).toBe(
      0,
    );
  });

  it("orders methods QR, eSewa, Khalti, bank", async () => {
    mocks.profileFindOne.mockReturnValue(
      lean({
        bankAccountNumber: "0123456789",
        bankName: "NIC Asia",
        esewaId: "9800000000",
        khaltiId: "9811111111",
        staticQrAssetId: qrAssetId,
      }),
    );

    expect(
      (await getPayInstructions(invoiceId.toString(), principal)).methods.map(
        (method) => method.kind,
      ),
    ).toEqual(["QR", "ESEWA", "KHALTI", "BANK"]);
  });

  it("omits methods the hostel has not configured rather than showing them empty", async () => {
    mocks.profileFindOne.mockReturnValue(lean({ bankName: "NIC Asia" }));

    const result = await getPayInstructions(invoiceId.toString(), principal);

    // A bank name with no account number is not a way to be paid.
    expect(result.methods).toEqual([]);
    expect(result.usable).toBe(false);
  });

  it("reports an unconfigured hostel as unusable rather than failing", async () => {
    mocks.profileFindOne.mockReturnValue(lean(null));

    const result = await getPayInstructions(invoiceId.toString(), principal);

    expect(result.usable).toBe(false);
    expect(result.methods).toEqual([]);
    // Still returns the code and the amount: the resident can be told what they
    // owe even when they cannot yet be told where to send it.
    expect(result.referenceCode).toBe("EDU-0001-F");
  });

  it("answers NOT_FOUND for a voided invoice, same as a missing one", async () => {
    mocks.invoiceFindOne.mockReturnValue(lean({ ...invoice, status: "VOID" }));

    await expect(
      getPayInstructions(invoiceId.toString(), principal),
    ).rejects.toMatchObject({ errorCode: "INVOICE_NOT_FOUND" });
  });

  it("answers NOT_FOUND for another resident's invoice", async () => {
    mocks.invoiceFindOne.mockReturnValue(lean(null));

    await expect(
      getPayInstructions(invoiceId.toString(), principal),
    ).rejects.toMatchObject({ errorCode: "INVOICE_NOT_FOUND" });
  });

  it("scopes the lookup to the calling resident and their hostel", async () => {
    await getPayInstructions(invoiceId.toString(), principal);

    expect(mocks.invoiceFindOne.mock.calls[0][0]).toMatchObject({
      hostelId,
      residentId,
    });
  });

  it("does not invent a reference code for a migrated invoice", async () => {
    mocks.invoiceFindOne.mockReturnValue(lean({ ...invoice, referenceCode: undefined }));

    // 2.4 deliberately left migrated invoices without one: a code invented now
    // was never written on any transfer, so it could only cause false matches.
    expect(
      (await getPayInstructions(invoiceId.toString(), principal)).referenceCode,
    ).toBeNull();
  });
});
