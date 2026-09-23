/**
 * Booking a room, paying, and the payment check — docs/BOOKINGS.md item 5.
 *
 * Runs the real services over in-memory models. What would go wrong quietly:
 * a Book button for a hostel nobody can pay out to, a fee that is not 7% of the
 * rate card, a refund account stored readable, a booking taken on terms the
 * person never saw, two open bookings for one person, a screenshot that is not
 * theirs, a paid booking the hostel is never told about, and a refusal that
 * leaves the person unable to try again.
 *
 * Item 6 — answering and cancelling: a confirm that holds no bed, a late answer
 * treated as in time, a refund off the frozen steps, a cancel after the hold
 * paid as a cancel, a strike that never pauses, and a resume that re-pauses on
 * the next strike.
 */
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FakeModel } from "../../../test/fake-mongo";

const sent = vi.hoisted(() => {
  process.env.FINANCE_MASTER_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 7)).toString("base64");
  process.env.PERSONAL_DATA_ENCRYPTION_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 91)).toString("base64");

  return {
    bells: [] as Array<{ category: string; data?: Record<string, unknown>; title: string; userId: string }>,
    claimed: [] as Array<{ roomType: string }>,
    emails: [] as Array<{ category?: string; html?: string; subject: string; to: string }>,
    moved: [] as Array<{ from: string; to: string }>,
    released: [] as Array<{ roomType: string }>,
    sequence: 0,
  };
});

function fake(path: string, exportName: string, unique?: Array<{ fields: string[]; partial?: (doc: Record<string, unknown>) => boolean }>) {
  return async (importOriginal: () => Promise<Record<string, unknown>>) => {
    const actual = await importOriginal();
    const { fakeModel } = await import("../../../test/fake-mongo");

    return { ...actual, [exportName]: fakeModel({ unique }) };
  };
}

vi.mock("@/lib/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@hostel/db/models/Booking", fake("Booking", "BookingModel", [
  { fields: ["code"] },
  { fields: ["userId"], partial: (doc) => doc.isOpen === true },
]));
vi.mock("@hostel/db/models/BookingPayment", fake("BookingPayment", "BookingPaymentModel"));
vi.mock("@hostel/db/models/BookingTransfer", fake("BookingTransfer", "BookingTransferModel", [
  { fields: ["bookingId", "kind"] },
]));
vi.mock("@hostel/db/models/ConsentLog", fake("ConsentLog", "ConsentLogModel"));
vi.mock("@hostel/db/models/FileAsset", fake("FileAsset", "FileAssetModel"));
vi.mock("@hostel/db/models/Resident", fake("Resident", "ResidentModel"));
vi.mock("@hostel/db/models/User", fake("User", "UserModel"));
vi.mock("@hostel/db/models/AuditLog", fake("AuditLog", "AuditLogModel"));
vi.mock("@hostel/db/models/Hostel", fake("Hostel", "HostelModel"));
vi.mock("@hostel/db/models/HostelPayoutAccount", fake("HostelPayoutAccount", "HostelPayoutAccountModel"));
vi.mock("@hostel/db/models/PlatformSetting", fake("PlatformSetting", "PlatformSettingModel"));

vi.mock("@/modules/billing/documents/issue", () => ({
  documentFileName: (number: string) => `${number.replace(/\//g, "-")}.pdf`,
  loadIssuer: vi.fn(async () => ({
    address: "Kathmandu",
    email: "billing@softmato.test",
    legalName: "Softmato Pvt. Ltd.",
    pan: "600000000",
    phone: "01-4000000",
    productName: "HostelPalika",
    vatRegistered: false,
  })),
  allocate: vi.fn(async (kind: string) => {
    sent.sequence += 1;

    return `${({ BOOKING_INVOICE: "HH-BKI", BOOKING_PAYOUT: "HH-BPO", BOOKING_RECEIPT: "HH-BKR", BOOKING_REFUND: "HH-BRF" } as Record<string, string>)[kind] ?? "HH-DOC"}-2083/84-${String(sent.sequence).padStart(6, "0")}`;
  }),
}));
vi.mock("@/modules/finance/fee-schedule.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/finance/fee-schedule.service")>()),
  getEffectiveSchedule: vi.fn(async () => ({
    rates: [
      { monthlyAmount: 10000, roomType: "Double sharing" },
      { monthlyAmount: 15000, roomType: "Single" },
    ],
  })),
}));
vi.mock("@hostel/shared/email/sender", () => ({
  sendEmail: vi.fn(async (message: { category?: string; subject: string; to: string }) => {
    sent.emails.push(message);

    return { sent: true };
  }),
}));
vi.mock("@/modules/notifications/notification.service", () => ({
  createInAppNotification: vi.fn(async (row: (typeof sent.bells)[number]) => {
    sent.bells.push(row);
  }),
}));
vi.mock("@/modules/residents/resident-notify", () => ({
  appUrl: (path: string) => `https://hostelpalika.test${path}`,
  resolveHostelAdminContacts: vi.fn(async () => [
    { email: "owner@everest.test", name: "Owner", userId: OWNER_ID },
  ]),
}));
// The real normalizer drags R2 and the personal-data crypto in behind it.
vi.mock("@/modules/users/resident-identity.service", () => ({
  normalizeResidentId: (value: string) => {
    const compact = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

    return /^HH[A-Z0-9]{8}$/.test(compact) ? `HH-${compact.slice(2, 6)}-${compact.slice(6, 10)}` : null;
  },
}));
vi.mock("@/modules/hostels/hostel-capacity.service", () => ({
  claimBedForRoomType: vi.fn(async (_hostelId: unknown, roomType: string) => {
    sent.claimed.push({ roomType });
  }),
  moveBedBetweenRoomTypes: vi.fn(async (_hostelId: unknown, from: string, to: string) => {
    sent.moved.push({ from, to });
  }),
  releaseBedForRoomType: vi.fn(async (_hostelId: unknown, roomType: string) => {
    sent.released.push({ roomType });
  }),
}));

const OWNER_ID = new Types.ObjectId().toString();

import { BookingModel } from "@hostel/db/models/Booking";
import { BookingPaymentModel } from "@hostel/db/models/BookingPayment";
import { BookingTransferModel } from "@hostel/db/models/BookingTransfer";
import { ConsentLogModel } from "@hostel/db/models/ConsentLog";
import { FileAssetModel } from "@hostel/db/models/FileAsset";
import { HostelModel } from "@hostel/db/models/Hostel";
import { HostelPayoutAccountModel } from "@hostel/db/models/HostelPayoutAccount";
import { PlatformSettingModel } from "@hostel/db/models/PlatformSetting";
import { ResidentModel } from "@hostel/db/models/Resident";
import { UserModel } from "@hostel/db/models/User";

import { Role } from "@/lib/roles";
import {
  cancelBookingByHostel,
  cancelBookingByPlatform,
  cancelMyBooking,
  confirmBooking,
  declineBooking,
  setHostelBookingPause,
} from "@/modules/bookings/booking-answer.service";
import {
  checkInBooking,
  findCardBooking,
  findHeldBooking,
  returnHeldBed,
  takeHeldBed,
} from "@/modules/bookings/booking-checkin.service";
import { DEFAULT_BOOKING_CONFIG } from "@/modules/bookings/booking-config";
import { resolveBookingDocument } from "@/modules/bookings/booking-documents.service";
import {
  listHostelBookings,
  listPausedHostels,
  listPlatformBookings,
} from "@/modules/bookings/booking-queries.service";
import { sweepBookings } from "@/modules/bookings/booking-sweep.service";
import {
  listTransfersDue,
  markTransferSent,
  revealTransferDestination,
} from "@/modules/bookings/booking-transfer.service";
import { claimBedForRoomType } from "@/modules/hostels/hostel-capacity.service";
import {
  listBookingPaymentsToCheck,
  reviewBookingPayment,
} from "@/modules/bookings/booking-review.service";
import {
  createBooking,
  getBookingQuote,
  getMyBooking,
  submitBookingPayment,
} from "@/modules/bookings/booking.service";
import { openValue, resetMasterKeyCache } from "@/modules/finance/gateway/secret-store";

const Booking = BookingModel as unknown as FakeModel;
const Payment = BookingPaymentModel as unknown as FakeModel;
const Transfers = BookingTransferModel as unknown as FakeModel;
const Consent = ConsentLogModel as unknown as FakeModel;
const Files = FileAssetModel as unknown as FakeModel;
const Hostel = HostelModel as unknown as FakeModel;
const Payout = HostelPayoutAccountModel as unknown as FakeModel;
const Settings = PlatformSettingModel as unknown as FakeModel;
const Residents = ResidentModel as unknown as FakeModel;
const Users = UserModel as unknown as FakeModel;

const hostelId = new Types.ObjectId();
const guestId = new Types.ObjectId();
const otherGuestId = new Types.ObjectId();
const superadminId = new Types.ObjectId();

const guest = { hostelIds: [], role: Role.PUBLIC, userId: guestId.toString() };
const otherGuest = { hostelIds: [], role: Role.PUBLIC, userId: otherGuestId.toString() };
const superadmin = { hostelIds: [], role: Role.SUPERADMIN, userId: superadminId.toString() };

const refundAccount = { holderName: "Sita Sharma", method: "ESEWA", number: "9807654321" };

async function quote(roomType = "Double sharing", principal: typeof guest | null = guest) {
  return getBookingQuote("everest-boys", roomType, principal);
}

async function book(overrides: Record<string, unknown> = {}, principal = guest) {
  const { policyVersion } = await quote("Double sharing", principal);

  return createBooking(
    {
      acceptPolicy: true,
      hostel: "everest-boys",
      policyVersion,
      refundAccount,
      roomType: "Double sharing",
      ...overrides,
    },
    principal,
    "WEB",
  );
}

async function uploadProof(ownerId: Types.ObjectId, overrides: Record<string, unknown> = {}) {
  const asset = await Files.create({
    isDeleted: false,
    kind: "BOOKING_PAYMENT_PROOF",
    ownerId,
    status: "ACTIVE",
    uploadCompletedAt: new Date(),
    ...overrides,
  });

  return String(asset._id);
}

beforeEach(() => {
  resetMasterKeyCache();
  sent.bells = [];
  sent.claimed = [];
  sent.emails = [];
  sent.moved = [];
  sent.released = [];

  Booking.reset();
  Payment.reset();
  Transfers.reset();
  Consent.reset();
  Files.reset();
  Residents.reset();
  Hostel.reset([
    {
      _id: hostelId,
      bookingPause: { pausedAt: null },
      contact: { phone: "9800000000" },
      isDeleted: false,
      location: { address: "Baneshwor-10", area: "Baneshwor", city: "Kathmandu" },
      name: "Everest Boys Hostel",
      photos: [{ kind: "EXTERIOR", url: "https://media.test/front.jpg" }],
      roomConfigurations: [
        { bedsPerRoom: 2, roomType: "Double sharing", vacantBeds: 2 },
        { bedsPerRoom: 1, roomType: "Single", vacantBeds: 0 },
        { bedsPerRoom: 3, roomType: "Triple", vacantBeds: 3 },
      ],
      slug: "everest-boys",
      status: "PUBLISHED",
      suspension: { graceEndsAt: null, startedAt: null },
      verificationStatus: "VERIFIED",
    },
  ]);
  Payout.reset([{ hostelId, status: "VERIFIED" }]);
  Settings.reset([
    { key: "bookings", value: { ...DEFAULT_BOOKING_CONFIG, enabled: true } },
    { key: "operations", value: { collectionQrLabel: "Softmato — Fonepay", collectionQrUrl: "https://media.test/qr.png" } },
  ]);
  Users.reset([
    { _id: guestId, email: "sita@example.test", name: "Sita Sharma", phone: "9841234567", role: "PUBLIC" },
    { _id: otherGuestId, email: "ram@example.test", name: "Ram", role: "PUBLIC" },
    { _id: superadminId, email: "work.softmato@gmail.com", name: "Softmato", role: "SUPERADMIN", status: "ACTIVE" },
  ]);
});

describe("the quote", () => {
  it("prices a room at 7% of its rate-card rent", async () => {
    const result = await quote();

    expect(result).toMatchObject({
      available: true,
      fee: 700,
      hostel: { address: "Baneshwor-10, Baneshwor, Kathmandu", coverPhotoUrl: "https://media.test/front.jpg" },
      payment: { qrReady: true },
      reason: null,
      room: { monthlyRent: 10000, roomType: "Double sharing" },
    });
    expect(result.policy?.rows.map((row) => row.refund)).toEqual([525, 350, 175]);
    expect(result.policyVersion).toMatch(/^[a-f0-9]{16}$/);
  });

  it.each([
    ["a full room type", "Single", "FULL"],
    ["a room type with no rent", "Triple", "NOT_PRICED"],
  ])("refuses %s", async (_label, roomType, reason) => {
    expect(await quote(roomType)).toMatchObject({ available: false, reason });
  });

  it("offers nothing while bookings are switched off", async () => {
    Settings.reset([{ key: "bookings", value: DEFAULT_BOOKING_CONFIG }]);

    expect(await quote()).toMatchObject({ available: false, reason: "BOOKINGS_OFF" });
  });

  it("offers nothing on a hostel with no verified payout account", async () => {
    Payout.reset([{ hostelId, status: "PENDING_REVIEW" }]);

    expect(await quote()).toMatchObject({ available: false, reason: "NO_PAYOUT_ACCOUNT" });
  });

  it("offers nothing on a paused or suspended hostel", async () => {
    await Hostel.updateOne({ _id: hostelId }, { $set: { "bookingPause.pausedAt": new Date() } });
    expect(await quote()).toMatchObject({ reason: "BOOKINGS_PAUSED" });

    await Hostel.updateOne(
      { _id: hostelId },
      {
        $set: {
          "bookingPause.pausedAt": null,
          suspension: { graceEndsAt: new Date(Date.now() + 86_400_000), startedAt: new Date() },
        },
      },
    );
    expect(await quote()).toMatchObject({ reason: "HOSTEL_SUSPENDED" });
  });

  it("works for a signed-out visitor", async () => {
    expect(await quote("Double sharing", null)).toMatchObject({ available: true, openBooking: null });
  });
});

describe("createBooking", () => {
  it("creates an unpaid booking with the invoice and how to pay", async () => {
    const booking = await book();

    expect(booking).toMatchObject({
      code: expect.stringMatching(/^BK-[2-9A-HJ-NP-Z]{6}$/),
      fee: 700,
      invoiceNumber: expect.stringMatching(/^HH-BKI-/),
      monthlyRent: 10000,
      pay: {
        amount: 700,
        qr: { label: "Softmato — Fonepay", url: "https://media.test/qr.png" },
      },
      refundAccount: { maskedNumber: "••••4321", methodLabel: "eSewa" },
      status: "AWAITING_PAYMENT",
    });
    expect(booking.pay?.reference).toBe(booking.code);
    expect(booking.cancel).toEqual({ allowed: true, refund: 0, refundPercent: 0 });
  });

  it("seals the refund account to the booking", async () => {
    const booking = await book();
    const stored = Booking.docs[0] as { refundAccount: { number: Parameters<typeof openValue>[0] } };

    expect(JSON.stringify(Booking.docs)).not.toContain("9807654321");
    expect(openValue(stored.refundAccount.number, { hostelId: booking.id, purpose: "BOOKING_REFUND_ACCOUNT" })).toBe(
      "9807654321",
    );
  });

  it("records the policy the person accepted", async () => {
    const booking = await book();

    expect(Consent.docs[0]).toMatchObject({ consentType: "BOOKING_REFUND_POLICY", granted: true });
    expect(Booking.docs[0]).toMatchObject({ policy: { source: "WEB" } });
    expect(booking.policy.rows).toHaveLength(3);
  });

  it("emails the invoice to the person", async () => {
    await book();

    expect(sent.emails).toEqual([
      expect.objectContaining({
        category: "billing",
        subject: expect.stringMatching(/^Booking invoice HH-BKI-.* — Rs 700 for Everest Boys Hostel$/),
        to: "sita@example.test",
      }),
    ]);
    expect(sent.bells[0]).toMatchObject({ category: "BOOKING", userId: guestId.toString() });
  });

  it("refuses terms the person was not shown", async () => {
    await expect(book({ policyVersion: "0000000000000000" })).rejects.toMatchObject({
      errorCode: "BOOKING_POLICY_CHANGED",
    });
  });

  it("refuses without the policy tick", async () => {
    await expect(book({ acceptPolicy: false })).rejects.toThrow();
  });

  it("refuses a second open booking", async () => {
    await book();

    await expect(book()).rejects.toMatchObject({ errorCode: "OPEN_BOOKING_EXISTS" });
  });

  it("refuses a staff account", async () => {
    await expect(book({}, { ...guest, role: Role.WARDEN })).rejects.toMatchObject({
      errorCode: "BOOKING_ACCOUNT_NOT_ALLOWED",
    });
  });

  it("refuses somebody who already lives at the hostel", async () => {
    await Residents.create({ hostelId, isDeleted: false, status: "ACTIVE", userId: guestId });

    await expect(book()).rejects.toMatchObject({ errorCode: "ALREADY_RESIDENT" });
  });

  it("refuses an account with no email", async () => {
    await Users.updateOne({ _id: guestId }, { $set: { email: null } });

    await expect(book()).rejects.toMatchObject({ errorCode: "BOOKING_EMAIL_REQUIRED" });
  });

  it("refuses a room that cannot be booked", async () => {
    const { policyVersion } = await quote();

    await expect(
      createBooking(
        { acceptPolicy: true, hostel: "everest-boys", policyVersion, refundAccount, roomType: "Single" },
        guest,
        "WEB",
      ),
    ).rejects.toMatchObject({ errorCode: "BOOKING_UNAVAILABLE_FULL" });
  });
});

describe("submitBookingPayment", () => {
  it("sends the booking for checking and tells the superadmins", async () => {
    const booking = await book();
    sent.emails = [];

    const result = await submitBookingPayment(
      booking.id,
      { proofAssetId: await uploadProof(guestId), reference: "ESW123" },
      guest,
    );

    expect(result.status).toBe("PAYMENT_IN_REVIEW");
    expect(result.cancel.allowed).toBe(false);
    expect(Payment.docs[0]).toMatchObject({ amount: 700, reference: "ESW123", status: "IN_REVIEW" });
    expect(sent.emails.map((email) => email.to).sort()).toEqual([
      "sita@example.test",
      "work.softmato@gmail.com",
    ]);
  });

  it("refuses somebody else's file, or a file of the wrong kind", async () => {
    const booking = await book();

    await expect(
      submitBookingPayment(booking.id, { proofAssetId: await uploadProof(otherGuestId) }, guest),
    ).rejects.toMatchObject({ errorCode: "PROOF_NOT_OWNED" });

    await expect(
      submitBookingPayment(
        booking.id,
        { proofAssetId: await uploadProof(guestId, { kind: "PAYMENT_PROOF" }) },
        guest,
      ),
    ).rejects.toMatchObject({ errorCode: "PROOF_NOT_OWNED" });
  });

  it("refuses a second screenshot while the first is checked", async () => {
    const booking = await book();

    await submitBookingPayment(booking.id, { proofAssetId: await uploadProof(guestId) }, guest);

    await expect(
      submitBookingPayment(booking.id, { proofAssetId: await uploadProof(guestId) }, guest),
    ).rejects.toMatchObject({ errorCode: "BOOKING_PAYMENT_IN_REVIEW" });
  });

  it("closes a booking whose time to pay has run out, which frees the person to book again", async () => {
    const booking = await book();

    await Booking.updateOne({}, { $set: { paymentDueBy: new Date(Date.now() - 1000) } });

    await expect(
      submitBookingPayment(booking.id, { proofAssetId: await uploadProof(guestId) }, guest),
    ).rejects.toMatchObject({ errorCode: "BOOKING_EXPIRED" });
    expect(Booking.docs[0]).toMatchObject({ isOpen: false, status: "EXPIRED" });

    await expect(book()).resolves.toMatchObject({ status: "AWAITING_PAYMENT" });
  });

  it("will not show one person's booking to another", async () => {
    const booking = await book();

    await expect(getMyBooking(booking.id, otherGuest)).rejects.toMatchObject({ status: 404 });
  });
});

describe("reviewBookingPayment", () => {
  async function paidScreenshot() {
    const booking = await book();

    await submitBookingPayment(booking.id, { proofAssetId: await uploadProof(guestId) }, guest);
    sent.emails = [];
    sent.bells = [];

    const [queued] = await listBookingPaymentsToCheck();

    return { booking, paymentId: queued!.id };
  }

  it("approves: receipt to the person, 24 hours and the share to the hostel", async () => {
    const { booking, paymentId } = await paidScreenshot();
    const before = Date.now();

    const result = await reviewBookingPayment(paymentId, { approve: true }, superadmin);

    expect(result).toMatchObject({ receiptNumber: expect.stringMatching(/^HH-BKR-/), status: "AWAITING_HOSTEL" });

    const view = await getMyBooking(booking.id, guest);
    const answerBy = Date.parse(view.hostelAnswerBy!);

    expect(answerBy - before).toBeGreaterThanOrEqual(24 * 3_600_000 - 5_000);
    expect(answerBy - before).toBeLessThanOrEqual(24 * 3_600_000 + 5_000);
    expect(view.cancel).toEqual({ allowed: true, refund: 700, refundPercent: 100 });

    expect(sent.emails.map((email) => [email.to, email.subject])).toEqual(
      expect.arrayContaining([
        ["sita@example.test", expect.stringMatching(/^Receipt HH-BKR-/)],
        ["owner@everest.test", expect.stringMatching(/^Sita Sharma booked a Double sharing — answer by /)],
      ]),
    );
    expect(sent.bells).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: "New booking to confirm", userId: OWNER_ID })]),
    );
  });

  it("rejects with a reason and lets the person send another", async () => {
    const { booking, paymentId } = await paidScreenshot();

    await expect(reviewBookingPayment(paymentId, { approve: false }, superadmin)).rejects.toMatchObject({
      status: 422,
    });

    const result = await reviewBookingPayment(
      paymentId,
      { approve: false, note: "No payment of Rs 700 arrived with that reference." },
      superadmin,
    );

    expect(result).toMatchObject({ status: "AWAITING_PAYMENT" });

    const view = await getMyBooking(booking.id, guest);

    expect(view.paymentRejection?.reason).toBe("No payment of Rs 700 arrived with that reference.");
    expect(Date.parse(view.paymentDueBy)).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    expect(sent.emails[0]).toMatchObject({ subject: expect.stringMatching(/^We could not confirm your payment/) });

    await expect(
      submitBookingPayment(booking.id, { proofAssetId: await uploadProof(guestId) }, guest),
    ).resolves.toMatchObject({ status: "PAYMENT_IN_REVIEW" });
  });

  it("is a superadmin's decision, made once", async () => {
    const { paymentId } = await paidScreenshot();

    await expect(
      reviewBookingPayment(paymentId, { approve: true }, { ...superadmin, role: Role.PLATFORM_MODERATOR }),
    ).rejects.toMatchObject({ status: 403 });

    await reviewBookingPayment(paymentId, { approve: true }, superadmin);

    await expect(reviewBookingPayment(paymentId, { approve: true }, superadmin)).rejects.toMatchObject({
      errorCode: "PAYMENT_ALREADY_REVIEWED",
    });
  });

  it("refunds straight away when the hostel is gone by the time the payment is checked", async () => {
    const { booking, paymentId } = await paidScreenshot();

    await Hostel.updateOne({ _id: hostelId }, { $set: { isDeleted: true } });

    const result = await reviewBookingPayment(paymentId, { approve: true }, superadmin);

    expect(result).toMatchObject({ settlement: { refund: 700, refundPercent: 100 }, status: "CANCELLED_BY_PLATFORM" });
    expect((await getMyBooking(booking.id, guest)).refund).toMatchObject({ amount: 700, status: "DUE" });
  });
});

describe("answering, cancelling and strikes", () => {
  const owner = () => ({ hostelIds: [hostelId.toString()], role: Role.HOSTEL_ADMIN, userId: OWNER_ID });
  const transfers = () =>
    (Transfers.docs as Array<{ amount: number; kind: string }>)
      .map((transfer) => [transfer.kind, transfer.amount])
      .sort();
  const quiet = () => {
    sent.bells = [];
    sent.claimed = [];
    sent.emails = [];
    sent.released = [];
  };

  async function waitingOnHostel() {
    const booking = await book();

    await submitBookingPayment(booking.id, { proofAssetId: await uploadProof(guestId) }, guest);

    const [queued] = await listBookingPaymentsToCheck();

    await reviewBookingPayment(queued!.id, { approve: true }, superadmin);
    quiet();

    return booking.id;
  }

  async function confirmed() {
    const id = await waitingOnHostel();

    await confirmBooking(id, owner());
    quiet();

    return id;
  }

  /** Moves the confirmation back so the hold is `hours` old. */
  async function holdAge(id: string, hours: number) {
    const confirmedAt = new Date(Date.now() - hours * 3_600_000);

    await Booking.updateOne(
      { _id: new Types.ObjectId(id) },
      { $set: { confirmedAt, holdEndsAt: new Date(confirmedAt.getTime() + 7 * 86_400_000) } },
    );
  }

  const current = async (id: string) => Booking.findOne({ _id: new Types.ObjectId(id) }).lean();

  it("confirm holds a bed for 7 days and tells the person where to go", async () => {
    const id = await waitingOnHostel();
    const before = Date.now();

    await Hostel.updateOne({ _id: hostelId }, { $set: { "location.mapLink": "https://maps.app.goo.gl/everest" } });

    const view = await confirmBooking(id, owner());

    expect(view.status).toBe("CONFIRMED");
    expect(Date.parse(view.holdEndsAt!) - before).toBeGreaterThanOrEqual(7 * 86_400_000 - 5_000);
    expect(sent.claimed).toEqual([{ roomType: "Double sharing" }]);
    expect(await current(id)).toMatchObject({ bedHeld: true });
    expect(sent.emails).toEqual([
      expect.objectContaining({
        subject: expect.stringMatching(/^Everest Boys Hostel confirmed your booking — move in by /),
        to: "sita@example.test",
      }),
    ]);
    expect(sent.emails[0]!.html).toContain("https://maps.app.goo.gl/everest");
    expect((await getMyBooking(id, guest)).cancel).toEqual({ allowed: true, refund: 525, refundPercent: 75 });
  });

  it("answers only for this hostel's admins", async () => {
    const id = await waitingOnHostel();

    await expect(confirmBooking(id, { ...owner(), hostelIds: [new Types.ObjectId().toString()] })).rejects.toMatchObject({
      status: 404,
    });
    await expect(confirmBooking(id, guest)).rejects.toMatchObject({ status: 404 });
    await expect(declineBooking(id, {}, { ...owner(), role: Role.WARDEN })).rejects.toMatchObject({ status: 404 });
  });

  it("will not confirm with no bed of that type left", async () => {
    const id = await waitingOnHostel();

    vi.mocked(claimBedForRoomType).mockRejectedValueOnce(Object.assign(new Error("full"), { errorCode: "ROOM_TYPE_FULL" }));

    await expect(confirmBooking(id, owner())).rejects.toMatchObject({ errorCode: "ROOM_TYPE_FULL" });
    expect(await current(id)).toMatchObject({ status: "AWAITING_HOSTEL" });
  });

  it("treats an answer after the window as a missed answer: full refund and a strike", async () => {
    const id = await waitingOnHostel();

    await Booking.updateOne({}, { $set: { hostelAnswerBy: new Date(Date.now() - 1000) } });

    await expect(confirmBooking(id, owner())).rejects.toMatchObject({ errorCode: "ANSWER_WINDOW_CLOSED" });
    expect(await current(id)).toMatchObject({ hostelStrike: true, status: "HOSTEL_NO_RESPONSE" });
    expect(sent.claimed).toEqual([]);
    expect(transfers()).toEqual([["REFUND", 700]]);
    expect(sent.emails.map((email) => email.to).sort()).toEqual([
      "owner@everest.test",
      "sita@example.test",
      "work.softmato@gmail.com",
    ]);
  });

  it("declines in time with a full refund and no strike", async () => {
    const id = await waitingOnHostel();

    const view = await declineBooking(id, { reason: "Room under repair." }, owner());

    expect(view).toMatchObject({ status: "DECLINED", strike: false });
    expect(transfers()).toEqual([["REFUND", 700]]);

    const email = sent.emails.find((message) => message.to === "sita@example.test");

    expect(email?.subject).toMatch(/^The hostel declined your booking — booking BK-/);
    expect(email?.html).toContain("Room under repair.");
    expect(email?.html).toContain("Rs 700");
    expect(sent.bells).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: "Refund to send", userId: superadminId.toString() })]),
    );
  });

  it("cancels a confirmed booking on the step it is on, and refuses a figure the clock has moved", async () => {
    const id = await confirmed();

    await holdAge(id, 3.5 * 24); // day 4: 50%

    await expect(cancelMyBooking(id, { expectedRefund: 525 }, guest)).rejects.toMatchObject({
      details: { cancel: { refund: 350 } },
      errorCode: "REFUND_CHANGED",
    });

    const view = await cancelMyBooking(id, { expectedRefund: 350 }, guest);

    expect(view).toMatchObject({ settlement: { refund: 350, refundPercent: 50 }, status: "CANCELLED_BY_USER" });
    expect(sent.released).toEqual([{ roomType: "Double sharing" }]);
    expect(transfers()).toEqual([
      ["PAYOUT", 210],
      ["REFUND", 350],
    ]);
    expect(sent.emails.map((email) => email.to).sort()).toEqual([
      "owner@everest.test",
      "sita@example.test",
    ]);
  });

  it("ends a cancel after the hold as a no-show, not a cancel", async () => {
    const id = await confirmed();

    await holdAge(id, 7 * 24 + 1);

    await expect(cancelMyBooking(id, {}, guest)).rejects.toMatchObject({ errorCode: "HOLD_ENDED" });
    expect(await current(id)).toMatchObject({ settlement: { refund: 0 }, status: "NO_SHOW" });
    expect(transfers()).toEqual([["PAYOUT", 420]]);
    expect(sent.released).toEqual([{ roomType: "Double sharing" }]);
  });

  it("refuses a cancel while the payment is checked; an unpaid cancel owes nothing", async () => {
    const booking = await book();

    await expect(cancelMyBooking(booking.id, {}, otherGuest)).rejects.toMatchObject({ status: 404 });

    const view = await cancelMyBooking(booking.id, {}, guest);

    expect(view).toMatchObject({ settlement: null, status: "CANCELLED_BY_USER" });
    expect(Transfers.docs).toEqual([]);

    const again = await book();

    await submitBookingPayment(again.id, { proofAssetId: await uploadProof(guestId) }, guest);

    await expect(cancelMyBooking(again.id, {}, guest)).rejects.toMatchObject({ errorCode: "BOOKING_PAYMENT_IN_REVIEW" });
  });

  it("counts a hostel's cancel as a strike, refunds in full and needs a reason", async () => {
    const id = await confirmed();

    await expect(cancelBookingByHostel(id, {}, owner())).rejects.toThrow();

    const view = await cancelBookingByHostel(id, { reason: "Double booked the room." }, owner());

    expect(view).toMatchObject({ status: "CANCELLED_BY_HOSTEL", strike: true });
    expect(sent.released).toEqual([{ roomType: "Double sharing" }]);
    expect(transfers()).toEqual([["REFUND", 700]]);
  });

  it("pauses a hostel on 3 strikes until a superadmin resumes it, and forgives those strikes", async () => {
    for (let round = 0; round < 3; round += 1) {
      await cancelBookingByHostel(await confirmed(), { reason: "Full." }, owner());
    }

    expect(Hostel.docs[0]).toMatchObject({ bookingPause: { pausedAt: expect.any(Date), pausedBy: null } });
    expect(sent.emails.map((email) => email.subject)).toEqual(
      expect.arrayContaining([
        "Bookings paused on Everest Boys Hostel",
        "Bookings paused automatically — Everest Boys Hostel",
      ]),
    );
    expect(await quote()).toMatchObject({ reason: "BOOKINGS_PAUSED" });

    await expect(setHostelBookingPause(hostelId.toString(), { paused: false }, owner())).rejects.toMatchObject({
      status: 403,
    });
    await setHostelBookingPause(hostelId.toString(), { paused: false }, superadmin);
    expect(await quote()).toMatchObject({ available: true });

    await cancelBookingByHostel(await confirmed(), { reason: "Full." }, owner());

    expect(Hostel.docs[0]).toMatchObject({ bookingPause: { pausedAt: null } });
  });

  it("lets a superadmin cancel any paid booking in full, with a reason", async () => {
    const id = await confirmed();

    await holdAge(id, 6 * 24);

    await expect(cancelBookingByPlatform(id, { reason: "x" }, owner())).rejects.toMatchObject({ status: 403 });
    await expect(cancelBookingByPlatform(id, {}, superadmin)).rejects.toThrow();

    const view = await cancelBookingByPlatform(id, { reason: "Payment disputed." }, superadmin);

    expect(view).toMatchObject({
      platformSettlement: { platformShare: 0, refund: 700 },
      status: "CANCELLED_BY_PLATFORM",
      transfers: [expect.objectContaining({ amount: 700, kind: "REFUND" })],
    });
    expect(sent.released).toEqual([{ roomType: "Double sharing" }]);
  });

  describe("sending money out", () => {
    async function declined() {
      const id = await waitingOnHostel();

      await declineBooking(id, {}, owner());
      quiet();

      return id;
    }

    it("sends a refund: numbered, where it went kept, the person told the transaction ID", async () => {
      const id = await declined();
      const [due] = await listTransfersDue("REFUND");

      expect(due).toMatchObject({
        amount: 700,
        blocked: null,
        destination: { maskedNumber: "••••4321", methodLabel: "eSewa" },
        guestName: "Sita Sharma",
        kind: "REFUND",
      });

      const row = await markTransferSent(
        due!.id,
        { proofAssetId: await uploadProof(superadminId, { kind: "BOOKING_TRANSFER_PROOF" }), transactionId: "ESW-889977" },
        superadmin,
      );

      expect(row).toMatchObject({ documentNumber: expect.stringMatching(/^HH-BRF-/), status: "SENT", transactionId: "ESW-889977" });
      expect(Transfers.docs[0]).toMatchObject({ destination: { holderName: "Sita Sharma", method: "ESEWA", numberLast4: "4321" } });
      expect((await getMyBooking(id, guest)).refund).toMatchObject({ status: "SENT", transactionId: "ESW-889977" });
      expect(sent.emails).toEqual([
        expect.objectContaining({ subject: expect.stringMatching(/^Refund sent — Rs 700 for booking BK-/), to: "sita@example.test" }),
      ]);
      expect(await listTransfersDue("REFUND")).toEqual([]);
      await expect(markTransferSent(due!.id, { transactionId: "ESW-889977" }, superadmin)).rejects.toMatchObject({
        errorCode: "TRANSFER_ALREADY_SENT",
      });
    });

    it("holds a payout until the hostel's payout account is verified", async () => {
      const id = await confirmed();
      const account = { bankName: "NIBL", holderName: "Everest Hostel", method: "BANK", numberLast4: "7788" };

      await holdAge(id, 7 * 24 + 1);
      await sweepBookings();
      quiet();
      await Payout.updateOne({ hostelId }, { $set: { ...account, status: "PENDING_REVIEW" } });

      const [due] = await listTransfersDue("PAYOUT");

      expect(due).toMatchObject({ amount: 420, blocked: "PAYOUT_ACCOUNT_NOT_VERIFIED", kind: "PAYOUT" });
      await expect(markTransferSent(due!.id, { transactionId: "NIBL-1" }, superadmin)).rejects.toMatchObject({
        errorCode: "PAYOUT_ACCOUNT_NOT_VERIFIED",
      });

      await Payout.updateOne({ hostelId }, { $set: { status: "VERIFIED" } });

      await expect(markTransferSent(due!.id, { transactionId: "NIBL-1" }, superadmin)).resolves.toMatchObject({
        destination: { bankName: "NIBL", maskedNumber: "••••7788" },
        documentNumber: expect.stringMatching(/^HH-BPO-/),
      });
      expect(sent.emails).toEqual([
        expect.objectContaining({ subject: expect.stringMatching(/^Payout sent — Rs 420 for booking BK-/), to: "owner@everest.test" }),
      ]);
    });

    it("is a superadmin's to mark and to reveal, with their own transfer screenshot", async () => {
      await declined();

      const [due] = await listTransfersDue();

      await expect(markTransferSent(due!.id, { transactionId: "ESW-1" }, owner())).rejects.toMatchObject({ status: 403 });
      await expect(
        markTransferSent(due!.id, { proofAssetId: await uploadProof(guestId), transactionId: "ESW-1" }, superadmin),
      ).rejects.toMatchObject({ errorCode: "PROOF_NOT_OWNED" });

      await expect(revealTransferDestination(due!.id, owner())).rejects.toMatchObject({ status: 403 });
      expect(await revealTransferDestination(due!.id, superadmin)).toMatchObject({
        account: { number: "9807654321" },
        kind: "REFUND",
      });
    });
  });

  describe("the lists", () => {
    it("shows a hostel only paid bookings, by tab, with its counts and what it is owed", async () => {
      await book();
      expect((await listHostelBookings(hostelId, "requests")).bookings).toEqual([]);

      Booking.reset();
      const id = await confirmed();
      const confirmedTab = await listHostelBookings(hostelId, "confirmed");

      expect(confirmedTab).toMatchObject({ counts: { confirmed: 1, requests: 0 }, owed: { due: 0, sent: 0 } });
      expect(confirmedTab.bookings).toEqual([expect.objectContaining({ id, status: "CONFIRMED" })]);

      await holdAge(id, 7 * 24 + 1);
      await sweepBookings();

      const history = await listHostelBookings(hostelId, "history");

      expect(history).toMatchObject({ owed: { due: 420, sent: 0 } });
      expect(history.bookings).toEqual([
        expect.objectContaining({ payout: expect.objectContaining({ amount: 420, status: "DUE" }), status: "NO_SHOW" }),
      ]);
    });

    it("gives the platform its queues and the paused hostels", async () => {
      const id = await waitingOnHostel();
      const waiting = await listPlatformBookings({ tab: "waiting" });

      expect(waiting.counts).toMatchObject({ holds: 0, payments: 0, waiting: 1 });
      expect(waiting.bookings).toEqual([expect.objectContaining({ id, strike: false })]);

      await setHostelBookingPause(hostelId.toString(), { paused: true, reason: "Complaints from guests." }, superadmin);

      expect(await listPausedHostels()).toEqual([
        expect.objectContaining({ automatic: false, name: "Everest Boys Hostel", reason: "Complaints from guests." }),
      ]);
      expect(sent.bells).toEqual(
        expect.arrayContaining([expect.objectContaining({ title: "Bookings paused", userId: OWNER_ID })]),
      );
    });
  });

  describe("documents", () => {
    const isPdf = (bytes?: Uint8Array) => Buffer.from(bytes?.slice(0, 5) ?? []).toString() === "%PDF-";

    it("serves the guest's invoice, receipt and refund note to the guest and the platform only", async () => {
      const id = await waitingOnHostel();

      await declineBooking(id, {}, owner());

      const [due] = await listTransfersDue("REFUND");
      const refund = await markTransferSent(due!.id, { transactionId: "ESW-1" }, superadmin);
      const view = await getMyBooking(id, guest);

      expect(view.refund?.documentNumber).toBe(refund.documentNumber);

      for (const [kind, number] of [
        ["invoice", view.invoiceNumber],
        ["receipt", view.receiptNumber!],
        ["refund", refund.documentNumber!],
      ] as const) {
        const paper = await resolveBookingDocument(kind, number, { userId: guestId.toString() });

        expect(isPdf(paper?.bytes)).toBe(true);
        expect(paper?.filename).not.toContain("/");
        expect(await resolveBookingDocument(kind, number, { userId: otherGuestId.toString() })).toBeNull();
        expect(await resolveBookingDocument(kind, number, { hostelIds: [hostelId.toString()] })).toBeNull();
        expect(isPdf((await resolveBookingDocument(kind, number, { platform: true }))?.bytes)).toBe(true);
      }

      expect(await resolveBookingDocument("receipt", "HH-BKR-nope", { platform: true })).toBeNull();
      expect(await resolveBookingDocument("statement", view.invoiceNumber, { platform: true })).toBeNull();
    });

    it("serves a payout advice to its own hostel", async () => {
      const id = await confirmed();

      await holdAge(id, 7 * 24 + 1);
      await sweepBookings();
      await Payout.updateOne(
        { hostelId },
        { $set: { bankName: "NIBL", holderName: "Everest Hostel", method: "BANK", numberLast4: "7788", status: "VERIFIED" } },
      );

      const [due] = await listTransfersDue("PAYOUT");
      const { documentNumber } = await markTransferSent(due!.id, { transactionId: "NIBL-1" }, superadmin);
      const paper = await resolveBookingDocument("payout", documentNumber!, { hostelIds: [hostelId.toString()] });

      expect(isPdf(paper?.bytes)).toBe(true);
      expect(paper?.filename).toMatch(/^HH-BPO-2083-84-\d{6}\.pdf$/);
      expect(await resolveBookingDocument("payout", documentNumber!, { userId: guestId.toString() })).toBeNull();
      expect(
        await resolveBookingDocument("payout", documentNumber!, { hostelIds: [new Types.ObjectId().toString()] }),
      ).toBeNull();
    });
  });

  describe("check-in by card", () => {
    it("closes the booking, keeps its bed for the resident and raises the hostel's share", async () => {
      const id = await confirmed();
      const booking = await findHeldBooking(hostelId, guestId);

      expect(booking).not.toBeNull();

      await takeHeldBed(booking!, "Double sharing");
      expect(sent.claimed).toEqual([]);
      expect(sent.moved).toEqual([]);

      const residentId = new Types.ObjectId();
      const ended = await checkInBooking(booking!, { principal: owner(), residentId, roomType: "Double sharing" });

      expect(ended).toMatchObject({ bedHeld: false, settlement: { hostelShare: 420, refund: 0 }, status: "CHECKED_IN" });
      expect(String(ended!.residentId)).toBe(String(residentId));
      expect(sent.released).toEqual([]);
      expect(transfers()).toEqual([["PAYOUT", 420]]);
      expect(sent.bells).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Payout to send" })]));
      await expect(cancelMyBooking(id, {}, guest)).rejects.toMatchObject({ errorCode: "BOOKING_CLOSED" });
    });

    it("moves the held bed when they take another room type, and back if the intake fails", async () => {
      await confirmed();

      const booking = await findHeldBooking(hostelId, guestId);

      await takeHeldBed(booking!, "Single");
      await returnHeldBed(booking!, "Single");

      expect(sent.moved).toEqual([
        { from: "Double sharing", to: "Single" },
        { from: "Single", to: "Double sharing" },
      ]);
      expect(sent.claimed).toEqual([]);
    });

    it("tells the intake screen which booking a scanned card will close", async () => {
      await confirmed();
      await Users.updateOne({ _id: guestId }, { $set: { isDeleted: false, userResidentId: "HH-4K7M-9XQ2" } });

      expect(await findCardBooking(hostelId, "hh4k7m9xq2")).toMatchObject({
        code: expect.stringMatching(/^BK-/),
        guestName: "Sita Sharma",
        roomType: "Double sharing",
      });
      expect(await findCardBooking(new Types.ObjectId(), "HH-4K7M-9XQ2")).toBeNull();
      expect(await findCardBooking(hostelId, "HH-2222-3333")).toBeNull();
      expect(await findCardBooking(hostelId, "not a card")).toBeNull();
    });

    it("is personal, and ends a lapsed hold as a no-show instead", async () => {
      const id = await confirmed();

      expect(await findHeldBooking(hostelId, otherGuestId)).toBeNull();

      await holdAge(id, 7 * 24 + 1);

      expect(await findHeldBooking(hostelId, guestId)).toBeNull();
      expect(await current(id)).toMatchObject({ status: "NO_SHOW" });
    });

    it("takes the bed back when the booking ended at the same moment", async () => {
      await confirmed();

      const booking = await findHeldBooking(hostelId, guestId);

      await cancelMyBooking(String(booking!._id), {}, guest);
      sent.claimed = [];

      expect(
        await checkInBooking(booking!, { principal: owner(), residentId: new Types.ObjectId(), roomType: "Double sharing" }),
      ).toBeNull();
      expect(sent.claimed).toEqual([{ roomType: "Double sharing" }]);
    });
  });

  describe("the sweep", () => {
    const H = 3_600_000;

    it("closes a booking nobody paid for, once, and tells the person", async () => {
      const booking = await book();

      await Booking.updateOne({}, { $set: { paymentDueBy: new Date(Date.now() - 1000) } });
      quiet();

      expect(await sweepBookings()).toMatchObject({ expired: 1 });
      expect(await current(booking.id)).toMatchObject({ status: "EXPIRED" });
      expect(sent.emails).toEqual([
        expect.objectContaining({ subject: expect.stringMatching(/^Booking closed — booking BK-/), to: "sita@example.test" }),
      ]);
      expect(await sweepBookings()).toMatchObject({ expired: 0 });
    });

    it("reminds the hostel once per step, then ends a missed answer with a strike", async () => {
      const id = await waitingOnHostel();
      const answerIn = (hours: number) =>
        Booking.updateOne({}, { $set: { hostelAnswerBy: new Date(Date.now() + hours * H) } });

      await answerIn(11);
      expect(await sweepBookings()).toMatchObject({ hostelReminders: 1 });
      expect(await sweepBookings()).toMatchObject({ hostelReminders: 0 });

      await answerIn(1.5);
      expect(await sweepBookings()).toMatchObject({ hostelReminders: 1 });
      expect(sent.emails.map((email) => email.subject)).toEqual([
        expect.stringMatching(/^Less than 12 hours to answer/),
        expect.stringMatching(/^Less than 2 hours to answer/),
      ]);

      await answerIn(-0.001);
      expect(await sweepBookings()).toMatchObject({ missedAnswers: 1 });
      expect(await current(id)).toMatchObject({ hostelStrike: true, status: "HOSTEL_NO_RESPONSE" });
      expect(transfers()).toEqual([["REFUND", 700]]);
      expect(await sweepBookings()).toMatchObject({ missedAnswers: 0 });
    });

    it("reminds the person to move in, then releases the bed as a no-show", async () => {
      const id = await confirmed();

      await holdAge(id, 7 * 24 - 20);
      expect(await sweepBookings()).toMatchObject({ moveInReminders: 1 });
      expect(sent.emails).toEqual([
        expect.objectContaining({ subject: expect.stringMatching(/^Move in by .* — booking BK-/), to: "sita@example.test" }),
      ]);

      await holdAge(id, 7 * 24 + 1);
      expect(await sweepBookings()).toMatchObject({ noShows: 1 });
      expect(await current(id)).toMatchObject({ bedHeld: false, status: "NO_SHOW" });
      expect(transfers()).toEqual([["PAYOUT", 420]]);

      expect(await sweepBookings()).toMatchObject({ noShows: 0 });
      expect(sent.released).toEqual([{ roomType: "Double sharing" }]);
    });
  });
});

