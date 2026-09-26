/**
 * Who gets told when a claim is reviewed.
 *
 * Until now only the resident was. That is the wrong half of the pair to notify
 * alone — the person who has to answer "did Ram's rent come in?" is the owner,
 * and their only signal was a row quietly leaving the review queue. These tests
 * pin both sides, plus the receipt riding along with the resident's mail, which
 * is the copy of the document they are most likely to actually keep.
 */
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createInAppNotification: vi.fn(),
  eventFind: vi.fn(),
  invoiceFind: vi.fn(),
  receiptFind: vi.fn(),
  residentFind: vi.fn(),
  getOperationsConfig: vi.fn(),
  renderReceiptById: vi.fn(),
  residentFindOne: vi.fn(),
  resolveHostelAdminContacts: vi.fn(),
  resolveResidentContact: vi.fn(),
  sendNotificationEmail: vi.fn(),
}));

vi.mock("@/modules/residents/resident-notify", () => ({
  appUrl: (path: string) => `https://example.test${path}`,
  getHostelName: vi.fn().mockResolvedValue("Rupak Hostel"),
  resolveHostelAdminContacts: mocks.resolveHostelAdminContacts,
  resolveResidentContact: mocks.resolveResidentContact,
  sendNotificationEmail: mocks.sendNotificationEmail,
}));

vi.mock("@/modules/notifications/notification.service", () => ({
  createInAppNotification: mocks.createInAppNotification,
}));

vi.mock("@/modules/platform-config/operations-config", () => ({
  getOperationsConfig: mocks.getOperationsConfig,
}));

vi.mock("@/modules/finance/receipt.service", () => ({
  renderReceiptById: mocks.renderReceiptById,
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: { find: mocks.residentFind, findOne: mocks.residentFindOne },
}));

vi.mock("@hostel/db/models/PaymentEvent", () => ({
  PaymentEventModel: { find: mocks.eventFind },
}));

vi.mock("@hostel/db/models/Receipt", () => ({
  ReceiptModel: { find: mocks.receiptFind },
}));

vi.mock("@hostel/db/models/Invoice", () => ({
  InvoiceModel: { find: mocks.invoiceFind },
}));

import { notifyClaimReviewed, sendAdminPaymentDigest } from "@/modules/finance/finance-notify";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");
const residentId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c1");
const receiptId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0e1");

const verified = {
  hostelId,
  invoiceId: "64f0f0f0f0f0f0f0f0f0f0d1",
  outcome: {
    kind: "verified" as const,
    method: "ESEWA",
    receiptId,
    receiptNumber: "RCP-EDU-2026-08-00001",
    remainingAmount: 0,
    verifiedAmount: 12000,
  },
  period: "2026-08",
  residentId,
};

function emailsSentTo() {
  return mocks.sendNotificationEmail.mock.calls.map((call) => call[0].to);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOperationsConfig.mockResolvedValue({ sendPaymentEmails: true });
  mocks.residentFindOne.mockReturnValue({
    lean: vi.fn().mockResolvedValue({
      _id: residentId,
      firstName: "Ram",
      lastName: "Thapa",
      userId: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0b1"),
    }),
  });
  mocks.resolveResidentContact.mockResolvedValue({
    email: "ram@example.test",
    name: "Ram Thapa",
  });
  mocks.resolveHostelAdminContacts.mockResolvedValue([
    { email: "owner@example.test", userId: null },
  ]);
  mocks.renderReceiptById.mockResolvedValue({
    bytes: new Uint8Array([1, 2, 3]),
    receiptNumber: "RCP-EDU-2026-08-00001",
  });
  mocks.sendNotificationEmail.mockResolvedValue(true);
});

describe("a verified claim", () => {
  it("emails the resident; the owner hears in the morning digest", async () => {
    await notifyClaimReviewed(verified);

    expect(emailsSentTo()).toEqual(["ram@example.test"]);
  });

  it("attaches the receipt to the resident's email", async () => {
    await notifyClaimReviewed(verified);

    const residentEmail = mocks.sendNotificationEmail.mock.calls.find(
      (call) => call[0].to === "ram@example.test",
    )?.[0];

    expect(residentEmail.attachments).toEqual([
      { content: expect.any(Uint8Array), filename: "RCP-EDU-2026-08-00001.pdf" },
    ]);
  });

  it("still sends the notification when the receipt cannot be rendered", async () => {
    // The money has already settled. A PDF library throwing must cost the
    // attachment, never the message telling the resident their rent is paid.
    mocks.renderReceiptById.mockRejectedValue(new Error("pdf exploded"));

    await notifyClaimReviewed(verified);

    const residentEmail = mocks.sendNotificationEmail.mock.calls.find(
      (call) => call[0].to === "ram@example.test",
    )?.[0];

    expect(residentEmail.attachments).toEqual([]);
  });

  it("still posts the in-app notification when payment emails are off", async () => {
    // `sendPaymentEmails` is an *email* switch (item 0.6) — a hostel with it off
    // must not become a hostel where a resident's balance changes silently.
    mocks.getOperationsConfig.mockResolvedValue({ sendPaymentEmails: false });

    await notifyClaimReviewed(verified);

    expect(mocks.createInAppNotification).toHaveBeenCalledTimes(1);
    expect(mocks.sendNotificationEmail).not.toHaveBeenCalled();
  });
});

describe("a rejected claim", () => {
  it("tells the resident only — nothing cleared, so there is nothing to confirm", async () => {
    await notifyClaimReviewed({
      hostelId,
      invoiceId: null,
      outcome: { kind: "rejected", rejectionReason: "Screenshot was unreadable." },
      period: "2026-08",
      residentId,
    });

    expect(emailsSentTo()).toEqual(["ram@example.test"]);
  });
});

describe("the admins' morning payments email", () => {
  const otherHostel = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a2");
  const sitaId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c2");
  const invoiceId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0d2");
  const rows = (value: unknown[]) => ({
    lean: vi.fn().mockResolvedValue(value),
    select: vi.fn().mockReturnThis(),
  });

  beforeEach(() => {
    mocks.residentFind.mockReturnValue(
      rows([
        { _id: residentId, firstName: "Ram", lastName: "Thapa" },
        { _id: sitaId, firstName: "Sita", lastName: "Rai" },
      ]),
    );
    mocks.invoiceFind.mockReturnValue(rows([{ _id: invoiceId, period: "2083-05" }]));
  });

  it("lists each payment by name, month and amount — one email per hostel", async () => {
    mocks.eventFind.mockReturnValue(
      rows([{ amount: 8000, hostelId, invoiceId, residentId }]),
    );
    mocks.receiptFind.mockReturnValue(
      rows([
        { amount: 12000, hostelId, month: "2083-05", residentId: sitaId },
        { amount: 9000, hostelId: otherHostel, month: "2083-05", residentId },
      ]),
    );

    expect(await sendAdminPaymentDigest()).toEqual({ hostels: 2 });

    const [first, second] = mocks.sendNotificationEmail.mock.calls.map((call) => call[0]);
    expect(first.subject).toBe("1 payment to check — Rupak Hostel");
    expect(first.html).toContain("To check (1)");
    expect(first.html).toContain("Ram Thapa");
    expect(first.html).toContain("Bhadra 2083");
    expect(first.html).toContain("NPR 8,000");
    expect(first.html).toContain("Received since yesterday (1)");
    expect(first.html).toContain("Sita Rai");
    expect(second.subject).toBe("1 payment received — Rupak Hostel");
  });

  it("stays silent when nothing is waiting or cleared, or payment emails are off", async () => {
    mocks.eventFind.mockReturnValue(rows([]));
    mocks.receiptFind.mockReturnValue(rows([]));

    expect(await sendAdminPaymentDigest()).toEqual({ hostels: 0 });

    mocks.getOperationsConfig.mockResolvedValue({ sendPaymentEmails: false });
    mocks.eventFind.mockReturnValue(rows([{ amount: 100, hostelId, residentId }]));

    expect(await sendAdminPaymentDigest()).toEqual({ hostels: 0 });
    expect(mocks.sendNotificationEmail).not.toHaveBeenCalled();
  });
});
