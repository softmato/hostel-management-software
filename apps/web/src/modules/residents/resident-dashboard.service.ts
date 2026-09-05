import { Types } from "mongoose";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { EmergencyContactModel } from "@hostel/db/models/EmergencyContact";
import { GuardianModel } from "@hostel/db/models/Guardian";
import { HostelModel } from "@hostel/db/models/Hostel";
import { NoticeModel } from "@hostel/db/models/Notice";
import { summarizeResidentComplaints } from "@/modules/complaints/complaint.service";
import {
  listResidentInvoices,
  type LedgerInvoice,
} from "@/modules/finance/ledger-read.service";
import { getFoodRoutine, mealsOn } from "@/modules/food/food-routine.service";
import { readNightStatusFor } from "@/modules/safety/safety.service";
import {
  findCurrentResident,
  serializeResidentSummary,
  type ResidentRecord,
} from "@/modules/residents/resident-access";

type HostelRecord = {
  _id: Types.ObjectId;
  contact?: {
    email?: string;
    phone?: string;
  };
  location?: {
    address?: string;
    area?: string;
    city?: string;
  };
  name: string;
  photos?: Array<{
    kind?: string;
    url?: string;
  }>;
  slug: string;
};

/** Read through the ledger facade (ADR-3), so the shape is the facade's. */
type PaymentRecord = LedgerInvoice;

type NoticeRecord = {
  _id: Types.ObjectId;
  category: string;
  content: string;
  isUrgent: boolean;
  publishedAt?: Date;
  title: string;
};

type GuardianRecord = {
  _id: Types.ObjectId;
  email?: string;
  firstName: string;
  isPrimary: boolean;
  lastName: string;
  phone: string;
  relation: string;
};

type EmergencyContactRecord = {
  _id: Types.ObjectId;
  isPrimary: boolean;
  name: string;
  phone: string;
  relation: string;
};

function serializeHostel(hostel: HostelRecord | null) {
  if (!hostel) {
    return null;
  }

  // The building, not a bedroom: EXTERIOR leads the public listing for the same
  // reason it should lead the resident's dashboard. Any photo beats none.
  const photos = hostel.photos ?? [];
  const cover =
    photos.find((photo) => photo.kind === "EXTERIOR" && photo.url) ?? photos[0];

  return {
    contact: hostel.contact ?? {},
    id: hostel._id.toString(),
    location: hostel.location ?? {},
    name: hostel.name,
    photoUrl: cover?.url ?? "",
    slug: hostel.slug,
  };
}

/**
 * Residents are placed by room type, not by room number, so this is all the
 * accommodation detail there is to show them.
 */
function serializeAccommodation(roomType: string) {
  return { roomType };
}

function serializePayment(payment: PaymentRecord) {
  return {
    dueAmount: payment.dueAmount,
    dueDate: payment.dueDate?.toISOString(),
    id: payment.id,
    month: payment.period,
    paidAmount: payment.paidAmount,
    status: payment.status,
  };
}

function serializeNotice(notice: NoticeRecord) {
  return {
    category: notice.category,
    content: notice.content,
    id: notice._id.toString(),
    isUrgent: notice.isUrgent,
    publishedAt: notice.publishedAt?.toISOString(),
    title: notice.title,
  };
}

function serializeGuardian(guardian: GuardianRecord) {
  return {
    email: guardian.email ?? "",
    firstName: guardian.firstName,
    id: guardian._id.toString(),
    isPrimary: guardian.isPrimary,
    lastName: guardian.lastName,
    phone: guardian.phone,
    relation: guardian.relation,
  };
}

function serializeEmergencyContact(contact: EmergencyContactRecord) {
  return {
    id: contact._id.toString(),
    isPrimary: contact.isPrimary,
    name: contact.name,
    phone: contact.phone,
    relation: contact.relation,
  };
}

async function loadResidentBase(resident: ResidentRecord) {
  const [hostel, payments, notices, routine] = await Promise.all([
    HostelModel.findOne({
      _id: resident.hostelId,
      isDeleted: false,
    }).lean<HostelRecord | null>(),
    listResidentInvoices(
      { hostelId: resident.hostelId, residentId: resident._id },
      { limit: 6 },
    ),
    NoticeModel.find({
      hostelId: resident.hostelId,
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }],
    })
      .sort({ isUrgent: -1, publishedAt: -1 })
      .limit(5)
      .lean<NoticeRecord[]>(),
    getFoodRoutine(resident.hostelId),
  ]);

  return { hostel, notices, payments, roomType: resident.roomType, routine };
}

/**
 * The invoice whose date the resident should be reading.
 *
 * **The earliest unsettled one**, which is very nearly never the same invoice as
 * `latestPayment`. That one is `payments[0]` out of a `dueDate: -1` sort with no
 * unpaid filter at all — the invoice due *furthest in the future*, settled ones
 * included — and the mobile card was printing its due date directly beside a
 * total summed across every unpaid invoice. A resident two months behind read
 * "Across 2 unpaid invoices · Due in 27 days" and was being told they had 27
 * days, when the older of the two had been overdue for a month. Wrong in the
 * reassuring direction, on the one line of this payload that costs money.
 *
 * An invoice with no `dueDate` cannot be ordered by one, so those fall back to
 * the oldest by creation. A one-off — an admission fee, a fine — is exactly that
 * case, and it is still a debt with a month to name.
 */
function pickNextDue(unsettled: PaymentRecord[]): PaymentRecord | null {
  const dated = unsettled.filter((invoice) => invoice.dueDate);

  if (dated.length > 0) {
    return dated.reduce((earliest, invoice) =>
      // Both are non-null by the filter above; `getTime` on the narrowed value.
      (invoice.dueDate?.getTime() ?? 0) < (earliest.dueDate?.getTime() ?? 0)
        ? invoice
        : earliest,
    );
  }

  return (
    unsettled.reduce<PaymentRecord | null>(
      (oldest, invoice) =>
        !oldest ||
        (invoice.createdAt?.getTime() ?? 0) < (oldest.createdAt?.getTime() ?? 0)
          ? invoice
          : oldest,
      null,
    ) ?? null
  );
}

/**
 * What a resident owes, counted over **every** unsettled invoice.
 *
 * ## `payments` is the recent history and must not be the arithmetic
 *
 * `loadResidentBase` reads invoices with `{ limit: 6 }`, which is the right
 * amount of history to *show*. Summing the total and counting the unpaid over
 * that slice is a different thing, and it was silently capping both: a resident
 * eight months behind was under-billed on their own dashboard, and the count
 * stopped at six however far back it went.
 *
 * `unsettled` is the unbounded read — `unsettledOnly`, no limit — so the figure
 * is the debt rather than the debt visible in one page of history. It also drops
 * `DRAFT`, which the old status list counted through its `UNPAID` alias: a draft
 * invoice is not yet an obligation and should not appear on the resident's card
 * before the office has issued it.
 *
 * `latestPayment` keeps its old meaning — the most recent invoice, whatever its
 * state — because the screens use it to say "Bhadra 2083 · PAID". The date a
 * resident has to act on is `nextDue`; see `pickNextDue`.
 */
function buildFeeSummary(payments: PaymentRecord[], unsettled: PaymentRecord[]) {
  const dueAmount = unsettled.reduce(
    (sum, invoice) => sum + Math.max(invoice.dueAmount - invoice.paidAmount, 0),
    0,
  );
  const nextDue = pickNextDue(unsettled);

  return {
    dueAmount,
    latestPayment: payments[0] ? serializePayment(payments[0]) : null,
    nextDue: nextDue ? serializePayment(nextDue) : null,
    pendingProofs: unsettled.filter((invoice) => invoice.status === "PENDING_PROOF")
      .length,
    unpaidCount: unsettled.length,
  };
}

export async function getResidentDashboard(principal: ApiPrincipal) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);
  /*
   * `nightStatus` and `complaints` were hardcoded literals — `{ status:
   * "UNKNOWN" }` (not a value the enum contains) and `{ openCount: 0, recent:
   * [] }`. Nothing wrote them, so the resident portal quietly showed everyone an
   * unknown status and no complaints, and the mobile app had to make a second
   * request to `/resident/night-status` to say anything true.
   *
   * Both reads go alongside the existing ones rather than after them: they are
   * one indexed document and one small find, and serialising them behind the
   * others would add a round trip to the first screen of the app.
   */
  const [
    { hostel, notices, payments, roomType, routine },
    nightStatus,
    complaints,
    unsettled,
  ] = await Promise.all([
    loadResidentBase(resident),
    readNightStatusFor(resident._id),
    summarizeResidentComplaints(resident),
    /*
     * Unbounded, and unsettled only — the arithmetic behind `feeStatus`, which
     * must not be done over `loadResidentBase`'s six rows of history. See
     * `buildFeeSummary`.
     *
     * In this `Promise.all` rather than inside `loadResidentBase`, so it costs
     * no extra latency here and `getResidentProfile` — which shares that loader
     * and reads only the hostel — does not gain a query it has no use for.
     */
    listResidentInvoices({
      hostelId: resident.hostelId,
      residentId: resident._id,
      unsettledOnly: true,
    }),
  ]);

  return {
    dashboard: {
      accommodation: serializeAccommodation(roomType),
      complaints,
      feeStatus: buildFeeSummary(payments, unsettled),
      foodMenu: mealsOn(routine, new Date()),
      hostel: serializeHostel(hostel),
      nightStatus,
      notices: notices.map(serializeNotice),
      resident: serializeResidentSummary(resident),
    },
  };
}

export async function getResidentProfile(principal: ApiPrincipal) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);
  const [guardians, emergencyContacts] = await Promise.all([
    GuardianModel.find({ residentId: resident._id, hostelId: resident.hostelId })
      .sort({ isPrimary: -1, createdAt: 1 })
      .lean<GuardianRecord[]>(),
    EmergencyContactModel.find({ residentId: resident._id, hostelId: resident.hostelId })
      .sort({ isPrimary: -1, createdAt: 1 })
      .lean<EmergencyContactRecord[]>(),
  ]);
  const { hostel, roomType } = await loadResidentBase(resident);

  return {
    profile: {
      accommodation: serializeAccommodation(roomType),
      emergencyContacts: emergencyContacts.map(serializeEmergencyContact),
      guardians: guardians.map(serializeGuardian),
      hostel: serializeHostel(hostel),
      resident: serializeResidentSummary(resident),
    },
  };
}
