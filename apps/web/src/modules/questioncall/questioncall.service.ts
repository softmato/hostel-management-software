import { SignJWT } from "jose";
import { Types } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { HostelModel } from "@hostel/db/models/Hostel";
import { QuestionCallClickModel } from "@hostel/db/models/QuestionCallClick";
import { findCurrentResident } from "@/modules/residents/resident-access";
import type {
  questionCallAnalyticsQuerySchema,
  questionCallClickSchema,
  questionCallConversionSchema,
} from "@/modules/questioncall/questioncall.validation";

type QuestionCallClickInput = z.infer<typeof questionCallClickSchema>;
type QuestionCallAnalyticsQuery = z.infer<typeof questionCallAnalyticsQuerySchema>;
type QuestionCallConversionInput = z.infer<typeof questionCallConversionSchema>;

/** Where a resident lands when no SSO handshake is configured. */
const DEFAULT_QUESTIONCALL_URL = "https://questioncall.com";

export class QuestionCallServiceError extends Error {
  constructor(
    message: string,
    public errorCode = "QUESTIONCALL_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}

type ClickRecord = {
  _id: Types.ObjectId;
  clickedAt: Date;
  converted?: boolean;
  conversionTrackedAt?: Date;
  deviceType?: string;
  hostelId: Types.ObjectId;
  userId: Types.ObjectId;
};

function questionCallBaseUrl() {
  return process.env.QUESTIONCALL_URL?.trim() || DEFAULT_QUESTIONCALL_URL;
}

/**
 * Signs the SSO token QuestionCall exchanges for a session.
 *
 * Returns `null` when `QUESTIONCALL_SSO_SECRET` is unset — the integration then
 * degrades to a plain outbound link instead of failing the click, because the
 * secret is a partner credential this deployment may simply not have yet.
 */
async function signSsoToken(payload: {
  email?: string;
  hostelId: string;
  name?: string;
  residentId: string;
  userId: string;
}) {
  const secret = process.env.QUESTIONCALL_SSO_SECRET?.trim();

  if (!secret || secret.length < 32) {
    return null;
  }

  return new SignJWT({
    email: payload.email,
    hostelId: payload.hostelId,
    name: payload.name,
    residentId: payload.residentId,
    source: "hostelhub",
    tokenType: "questioncall_sso",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(secret));
}

/**
 * Records the click and hands back where to send the resident.
 *
 * Only STUDENT residents see the entry point (PHASES.md §5.1), and the check is
 * repeated here — a hidden button is not access control.
 */
export async function trackQuestionCallClick(
  input: QuestionCallClickInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);

  if ((resident.residentType ?? "STUDENT") !== "STUDENT") {
    throw new QuestionCallServiceError(
      "QuestionCall is available to student residents only.",
      "QUESTIONCALL_NOT_ELIGIBLE",
      403,
    );
  }

  const click = await QuestionCallClickModel.create({
    clickedAt: new Date(),
    converted: false,
    deviceType: input.deviceType,
    hostelId: resident.hostelId,
    residentId: resident._id,
    userId: resident.userId ?? principal.userId,
  });

  const token = await signSsoToken({
    email: resident.email,
    hostelId: resident.hostelId.toString(),
    name: `${resident.firstName} ${resident.lastName}`.trim(),
    residentId: resident._id.toString(),
    userId: (resident.userId ?? principal.userId).toString(),
  });
  const base = questionCallBaseUrl();

  return {
    clickId: click._id.toString(),
    redirectUrl: token
      ? `${base}/sso?token=${encodeURIComponent(token)}`
      : `${base}?utm_source=hostelhub`,
    ssoEnabled: Boolean(token),
  };
}

export async function getQuestionCallStatus(principal: ApiPrincipal) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);
  const [latest, clickCount] = await Promise.all([
    QuestionCallClickModel.findOne({ residentId: resident._id })
      .sort({ clickedAt: -1 })
      .lean<ClickRecord | null>(),
    QuestionCallClickModel.countDocuments({ residentId: resident._id }),
  ]);

  return {
    clickCount,
    converted: Boolean(latest?.converted),
    eligible: (resident.residentType ?? "STUDENT") === "STUDENT",
    lastClickedAt: latest?.clickedAt?.toISOString(),
  };
}

/**
 * Callback from QuestionCall confirming a referred student signed up there.
 * Idempotent: a repeated ping does not move `conversionTrackedAt`.
 */
export async function recordQuestionCallConversion(input: QuestionCallConversionInput) {
  await connectToDatabase();

  if (!input.clickId && !input.userId) {
    throw new QuestionCallServiceError(
      "A clickId or userId is required.",
      "QUESTIONCALL_CONVERSION_TARGET_REQUIRED",
      422,
    );
  }

  const filter = input.clickId
    ? { _id: new Types.ObjectId(input.clickId) }
    : { userId: new Types.ObjectId(input.userId) };

  const result = await QuestionCallClickModel.updateMany(
    { ...filter, converted: { $ne: true } },
    { $set: { conversionTrackedAt: new Date(), converted: true } },
  );

  return { updated: result.modifiedCount ?? 0 };
}

function dayKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

export async function getQuestionCallAnalytics(query: QuestionCallAnalyticsQuery) {
  await connectToDatabase();

  const filter: Record<string, unknown> = {};

  if (query.hostelId) {
    filter.hostelId = new Types.ObjectId(query.hostelId);
  }

  if (query.startDate || query.endDate) {
    filter.clickedAt = {
      ...(query.startDate ? { $gte: query.startDate } : {}),
      ...(query.endDate ? { $lte: query.endDate } : {}),
    };
  }

  const clicks = await QuestionCallClickModel.find(filter)
    .sort({ clickedAt: -1 })
    .limit(5000)
    .lean<ClickRecord[]>();

  const perHostel = new Map<string, { clicks: number; conversions: number }>();
  const perDay = new Map<string, { clicks: number; conversions: number }>();
  const uniqueUsers = new Set<string>();
  let conversions = 0;

  for (const click of clicks) {
    const hostelKey = click.hostelId.toString();
    const hostelEntry = perHostel.get(hostelKey) ?? { clicks: 0, conversions: 0 };
    const day = dayKey(click.clickedAt);
    const dayEntry = perDay.get(day) ?? { clicks: 0, conversions: 0 };

    hostelEntry.clicks += 1;
    dayEntry.clicks += 1;
    uniqueUsers.add(click.userId.toString());

    if (click.converted) {
      conversions += 1;
      hostelEntry.conversions += 1;
      dayEntry.conversions += 1;
    }

    perHostel.set(hostelKey, hostelEntry);
    perDay.set(day, dayEntry);
  }

  // Names, not ObjectIds — the breakdown is read by a person.
  const hostels = await HostelModel.find({
    _id: { $in: [...perHostel.keys()].map((id) => new Types.ObjectId(id)) },
  })
    .select("name")
    .lean<Array<{ _id: Types.ObjectId; name: string }>>();
  const hostelNameById = new Map(
    hostels.map((hostel) => [hostel._id.toString(), hostel.name]),
  );

  const byHostel = [...perHostel.entries()]
    .map(([hostelId, entry]) => ({
      clicks: entry.clicks,
      conversionRate: entry.clicks > 0 ? entry.conversions / entry.clicks : 0,
      conversions: entry.conversions,
      hostelId,
      hostelName: hostelNameById.get(hostelId) ?? "Unknown hostel",
    }))
    .sort((a, b) => b.clicks - a.clicks);

  return {
    byDay: [...perDay.entries()]
      .map(([date, entry]) => ({ ...entry, date }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    byHostel,
    summary: {
      conversionRate: clicks.length > 0 ? conversions / clicks.length : 0,
      conversions,
      totalClicks: clicks.length,
      uniqueResidents: uniqueUsers.size,
    },
  };
}
