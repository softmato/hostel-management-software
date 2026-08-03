import { Types } from "mongoose";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { EmergencyContactModel } from "@hostel/db/models/EmergencyContact";
import { GuardianModel } from "@hostel/db/models/Guardian";
import { HostelModel } from "@hostel/db/models/Hostel";
import { NoticeModel } from "@hostel/db/models/Notice";
import { PaymentModel } from "@hostel/db/models/Payment";
import { getFoodRoutine, mealsOn } from "@/modules/food/food-routine.service";
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

type PaymentRecord = {
  _id: Types.ObjectId;
  dueAmount: number;
  dueDate: Date;
  month: string;
  paidAmount: number;
  status: string;
};

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
  const cover = photos.find((photo) => photo.kind === "EXTERIOR" && photo.url) ?? photos[0];

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
    dueDate: payment.dueDate.toISOString(),
    id: payment._id.toString(),
    month: payment.month,
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
    PaymentModel.find({ residentId: resident._id, hostelId: resident.hostelId })
      .sort({ dueDate: -1 })
      .limit(6)
      .lean<PaymentRecord[]>(),
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

function buildFeeSummary(payments: PaymentRecord[]) {
  const dueAmount = payments.reduce(
    (sum, payment) =>
      ["UNPAID", "PARTIAL", "OVERDUE", "PENDING_PROOF"].includes(payment.status)
        ? sum + Math.max(payment.dueAmount - payment.paidAmount, 0)
        : sum,
    0,
  );
  const latestPayment = payments[0] ? serializePayment(payments[0]) : null;

  return {
    dueAmount,
    latestPayment,
    pendingProofs: payments.filter((payment) => payment.status === "PENDING_PROOF")
      .length,
    unpaidCount: payments.filter((payment) =>
      ["UNPAID", "PARTIAL", "OVERDUE", "PENDING_PROOF"].includes(payment.status),
    ).length,
  };
}

export async function getResidentDashboard(principal: ApiPrincipal) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);
  const { hostel, notices, payments, roomType, routine } =
    await loadResidentBase(resident);

  return {
    dashboard: {
      accommodation: serializeAccommodation(roomType),
      complaints: {
        openCount: 0,
        recent: [],
      },
      feeStatus: buildFeeSummary(payments),
      foodMenu: mealsOn(routine, new Date()),
      hostel: serializeHostel(hostel),
      nightStatus: {
        checkedAt: null,
        status: "UNKNOWN",
      },
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
