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
  ResidentModel: { findOne: mocks.residentFindOne },
}));

import { notifyClaimReviewed } from "@/modules/finance/finance-notify";

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
  it("emails the resident and the hostel", async () => {
    await notifyClaimReviewed(verified);

    expect(emailsSentTo()).toEqual(
      expect.arrayContaining(["ram@example.test", "owner@example.test"]),
    );
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

  it("tells the hostel even when the resident has no email on file", async () => {
    // Two recipients answering two different questions. A resident without an
    // address is not a reason to leave the owner wondering.
    mocks.resolveResidentContact.mockResolvedValue(null);

    await notifyClaimReviewed(verified);

    expect(emailsSentTo()).toEqual(["owner@example.test"]);
  });

  it("still posts the in-app notification when payment emails are off", async () => {
    // `sendPaymentEmails` is an *email* switch (item 0.6) — a hostel with it off
    // must not become a hostel where a resident's balance changes silently.
    mocks.getOperationsConfig.mockResolvedValue({ sendPaymentEmails: false });

    await notifyClaimReviewed(verified);

    expect(mocks.createInAppNotification).toHaveBeenCalledTimes(1);
    expect(mocks.sendNotificationEmail).not.toHaveBeenCalled();
  });

  it("does not fail the approval when the owner's mail cannot be resolved", async () => {
    mocks.resolveHostelAdminContacts.mockRejectedValue(new Error("directory down"));

    await expect(notifyClaimReviewed(verified)).resolves.toBeUndefined();
    expect(emailsSentTo()).toEqual(["ram@example.test"]);
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
