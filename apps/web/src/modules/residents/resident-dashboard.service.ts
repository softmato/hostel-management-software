import { Types } from "mongoose";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { EmergencyContactModel } from "@hostel/db/models/EmergencyContact";
import { FoodMenuModel } from "@hostel/db/models/FoodMenu";
import { GuardianModel } from "@hostel/db/models/Guardian";
import { HostelModel } from "@hostel/db/models/Hostel";
import { NoticeModel } from "@hostel/db/models/Notice";
import { PaymentModel } from "@hostel/db/models/Payment";
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

type FoodMenuRecord = {
  _id: Types.ObjectId;
  date: Date;
  items: string[];
  mealType: string;
  timing: string;
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

  return {
    contact: hostel.contact ?? {},
    id: hostel._id.toString(),
    location: hostel.location ?? {},
    name: hostel.name,
    photoUrl: hostel.photos?.[0]?.url ?? "",
    slug: hostel.slug,
  };
}

/**
 * Residents are placed by room type, not by room number, so this is all the
 * accommodation detail there is to show them.
 */
function serializeRoomBed(roomType: string) {
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

function serializeFoodMenu(menu: FoodMenuRecord) {
  return {
    date: menu.date.toISOString(),
    id: menu._id.toString(),
    items: menu.items,
    mealType: menu.mealType,
    timing: menu.timing,
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
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const [hostel, payments, notices, foodMenus] = await Promise.all([
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
    FoodMenuModel.find({
      date: { $gte: todayStart, $lt: todayEnd },
      hostelId: resident.hostelId,
    })
      .sort({ mealType: 1 })
      .lean<FoodMenuRecord[]>(),
  ]);

  return { foodMenus, hostel, notices, payments, roomType: resident.roomType };
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
  const { foodMenus, hostel, notices, payments, roomType } =
    await loadResidentBase(resident);

  return {
    dashboard: {
      complaints: {
        openCount: 0,
        recent: [],
      },
      feeStatus: buildFeeSummary(payments),
      foodMenu: foodMenus.map(serializeFoodMenu),
      hostel: serializeHostel(hostel),
      nightStatus: {
        checkedAt: null,
        status: "UNKNOWN",
      },
      notices: notices.map(serializeNotice),
      resident: serializeResidentSummary(resident),
      roomBed: serializeRoomBed(roomType),
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
      emergencyContacts: emergencyContacts.map(serializeEmergencyContact),
      guardians: guardians.map(serializeGuardian),
      hostel: serializeHostel(hostel),
      resident: serializeResidentSummary(resident),
      roomBed: serializeRoomBed(roomType),
    },
  };
}
