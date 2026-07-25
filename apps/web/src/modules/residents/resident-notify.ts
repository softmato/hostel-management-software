import type { Types } from "mongoose";

import { siteUrl } from "@/lib/site";
import { Role } from "@/lib/roles";
import { HostelMemberModel } from "@hostel/db/models/HostelMember";
import { HostelModel } from "@hostel/db/models/Hostel";
import { ResidentModel } from "@hostel/db/models/Resident";
import { UserModel } from "@hostel/db/models/User";
import { sendEmail } from "@hostel/shared/email/sender";

export type Contact = {
  email: string;
  name: string;
  userId?: string;
};

export type ResidentRecipient = Contact & {
  residentId: string;
};

export function appUrl(path: string) {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function getHostelName(hostelId: Types.ObjectId | string) {
  const hostel = await HostelModel.findOne({ _id: hostelId })
    .select("name")
    .lean<{ name?: string } | null>();

  return hostel?.name ?? "your hostel";
}

/**
 * Best contact address for a resident: their own record's email, falling back
 * to the linked user account. Returns `null` when neither exists — residents
 * can be registered phone-only.
 */
export async function resolveResidentContact(resident: {
  _id: Types.ObjectId;
  email?: string;
  firstName: string;
  lastName: string;
  userId?: Types.ObjectId;
}): Promise<ResidentRecipient | null> {
  const name = `${resident.firstName} ${resident.lastName}`.trim();

  if (resident.email) {
    return {
      email: resident.email,
      name,
      residentId: resident._id.toString(),
      userId: resident.userId?.toString(),
    };
  }

  if (!resident.userId) {
    return null;
  }

  const user = await UserModel.findOne({
    _id: resident.userId,
    isDeleted: { $ne: true },
  }).lean<{ _id: Types.ObjectId; email?: string; name?: string } | null>();

  if (!user?.email) {
    return null;
  }

  return {
    email: user.email,
    name: user.name ?? name,
    residentId: resident._id.toString(),
    userId: user._id.toString(),
  };
}

/** Owner + active hostel-admin members, de-duplicated by user id. */
export async function resolveHostelAdminContacts(
  hostelId: Types.ObjectId | string,
): Promise<Contact[]> {
  const hostel = await HostelModel.findOne({ _id: hostelId })
    .select("ownerId")
    .lean<{ ownerId?: Types.ObjectId } | null>();

  const members = await HostelMemberModel.find({
    hostelId,
    isDeleted: { $ne: true },
    role: Role.HOSTEL_ADMIN,
    status: "ACTIVE",
  }).lean<{ userId: Types.ObjectId }[]>();

  const userIds = [
    ...(hostel?.ownerId ? [hostel.ownerId] : []),
    ...members.map((member) => member.userId),
  ];

  if (userIds.length === 0) {
    return [];
  }

  const users = await UserModel.find({
    _id: { $in: userIds },
    isDeleted: { $ne: true },
  }).lean<{ _id: Types.ObjectId; email?: string; name?: string }[]>();

  const byId = new Map<string, Contact>();

  for (const user of users) {
    if (!user.email) {
      continue;
    }

    byId.set(user._id.toString(), {
      email: user.email,
      name: user.name ?? "Hostel admin",
      userId: user._id.toString(),
    });
  }

  return [...byId.values()];
}

/** Active residents of a hostel that can actually be reached by email. */
export async function resolveActiveResidentRecipients(
  hostelId: Types.ObjectId | string,
): Promise<ResidentRecipient[]> {
  const residents = await ResidentModel.find({
    hostelId,
    isDeleted: false,
    status: "ACTIVE",
  }).lean<
    {
      _id: Types.ObjectId;
      email?: string;
      firstName: string;
      lastName: string;
      userId?: Types.ObjectId;
    }[]
  >();

  const recipients = await Promise.all(residents.map(resolveResidentContact));

  return recipients.filter((recipient): recipient is ResidentRecipient =>
    Boolean(recipient),
  );
}

/**
 * Fire-and-forget transactional send. Notifications must never fail the action
 * that triggered them (RULES.md), so delivery problems are logged and swallowed.
 */
export async function sendNotificationEmail(input: {
  action: string;
  html: string;
  subject: string;
  to: string;
}) {
  try {
    const delivery = await sendEmail({
      html: input.html,
      subject: input.subject,
      to: input.to,
    });

    if (!delivery.sent) {
      console.warn(
        JSON.stringify({
          level: "warn",
          action: `${input.action}_email_failed`,
          message: `Recipient was not notified (${delivery.reason}).`,
          to: input.to,
        }),
      );
    }

    return delivery.sent;
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        action: `${input.action}_email_error`,
        message: error instanceof Error ? error.message : "Unknown email error",
        to: input.to,
      }),
    );

    return false;
  }
}
