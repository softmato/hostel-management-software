import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const gateway = vi.hoisted(() => ({
  fetchInvoiceDetail: vi.fn(),
  issueInvoiceDocument: vi.fn(),
}));
const updateOne = vi.hoisted(() => vi.fn());

vi.mock("@/modules/billing/billing-gateway", () => gateway);
vi.mock("@hostel/db/models/SubscriptionInvoice", () => ({
  SubscriptionInvoiceModel: { updateOne },
}));
vi.mock("@/modules/billing/subscription.service", () => ({
  invoiceDocumentInput: vi.fn(async () => ({
    amount: 5000,
    customer: { hostelId: "h", name: "Study Sanjal" },
    description: "Pro — 12 months",
    invoiceNumber: "SUB-0001-2431",
  })),
}));

import { checkoutDocumentFor, softmatoDocumentNumbers } from "./balance-document";

const invoice = {
  _id: new Types.ObjectId(),
  amount: 5000,
  invoiceNumber: "SUB-0001-2431",
  softmatoInvoiceId: "inv_original",
  softmatoInvoiceNo: "INV-2083/84-000001",
} as Parameters<typeof checkoutDocumentFor>[0];

beforeEach(() => vi.clearAllMocks());

describe("checkoutDocumentFor", () => {
  it("checks out against the original when Softmato's due is our balance", async () => {
    gateway.fetchInvoiceDetail.mockResolvedValue({ due_minor: 300_000 });

    await expect(checkoutDocumentFor(invoice, 3000)).resolves.toBe("inv_original");
    expect(gateway.issueInvoiceDocument).not.toHaveBeenCalled();
  });

  it("raises a document for exactly the balance when Softmato's due is higher", async () => {
    // Rs 2,000 confirmed from a proof here: Softmato still thinks Rs 5,000 is due.
    gateway.fetchInvoiceDetail.mockResolvedValue({ due_minor: 500_000 });
    gateway.issueInvoiceDocument.mockResolvedValue({
      softmatoInvoiceId: "inv_balance",
      softmatoInvoiceNo: "INV-2083/84-000002",
    });

    await expect(checkoutDocumentFor(invoice, 3000)).resolves.toBe("inv_balance");
    expect(gateway.issueInvoiceDocument).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 3000, invoiceNumber: "SUB-0001-2431-B3000" }),
    );
    expect(updateOne).toHaveBeenCalledWith(
      { _id: invoice._id },
      {
        $addToSet: {
          softmatoBalanceInvoices: { amount: 3000, id: "inv_balance", no: "INV-2083/84-000002" },
        },
      },
    );
  });

  it("reuses the balance document already raised for this amount", async () => {
    gateway.fetchInvoiceDetail.mockResolvedValue({ due_minor: 500_000 });

    await expect(
      checkoutDocumentFor(
        { ...invoice, softmatoBalanceInvoices: [{ amount: 3000, id: "inv_balance", no: "N" }] },
        3000,
      ),
    ).resolves.toBe("inv_balance");
    expect(gateway.issueInvoiceDocument).not.toHaveBeenCalled();
  });
});

it("lists the original document first, then balances", () => {
  expect(
    softmatoDocumentNumbers({
      softmatoBalanceInvoices: [{ no: "B1" }],
      softmatoInvoiceNo: "O",
    }),
  ).toEqual(["O", "B1"]);
});
