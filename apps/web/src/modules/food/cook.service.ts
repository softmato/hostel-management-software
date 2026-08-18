import { randomBytes } from "node:crypto";
import { Types } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { REALTIME_TOPIC } from "@/lib/realtime/channels";
import { publishResourceChange } from "@/lib/realtime/server";
import { Role } from "@/lib/roles";
import { assertHostelAccess } from "@/lib/tenant";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { FoodReadyLogModel } from "@hostel/db/models/FoodReadyLog";
import { HostelModel } from "@hostel/db/models/Hostel";
import { HostelSettingsModel } from "@hostel/db/models/HostelSettings";
import { UserModel } from "@hostel/db/models/User";
import { ResidentModel } from "@hostel/db/models/Resident";
import { getFoodRoutine, mealsOn } from "@/modules/food/food-routine.service";
import { uploadFoodPhoto } from "@/modules/food/food.service";
import { createInAppNotification } from "@/modules/notifications/notification.service";
import { getOperationsConfig } from "@/modules/platform-config/operations-config";
import { normalizeObjectId } from "@/modules/residents/resident-access";
import {
  appUrl,
  resolveActiveResidentRecipients,
  resolveHostelAdminContacts,
  sendNotificationEmail,
} from "@/modules/residents/resident-notify";
import { cookPortalEnabledEmail } from "@hostel/shared/email/templates/hostel/cook-portal-enabled";
import type {
  cookPortalUpdateSchema,
  foodReadySchema,
} from "@/modules/food/cook.validation";
import type { foodPhotoUploadSchema } from "@/modules/food/food.validation";

type CookPortalUpdateInput = z.infer<typeof cookPortalUpdateSchema>;
type FoodReadyInput = z.infer<typeof foodReadySchema>;
type FoodPhotoUploadInput = z.infer<typeof foodPhotoUploadSchema>;

type HostelSettingsRecord = {
  _id: Types.ObjectId;
  cookCredentialIssuedAt?: Date;
  cookName?: string;
  cookPortalEnabled: boolean;
  cookUserId?: Types.ObjectId;
  hostelId: Types.ObjectId;
};

export class CookServiceError extends Error {
  constructor(
    message: string,
    public errorCode = "COOK_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}

function generatePassword() {
  return randomBytes(9).toString("base64url");
}

function serializeSettings(
  settings: HostelSettingsRecord | null,
  cookAccount?: { email?: string; mustChangePassword?: boolean } | null,
) {
  return {
    /** The stable login, safe to show in the dashboard — the password is not. */
    cookEmail: cookAccount?.email ?? "",
    cookName: settings?.cookName ?? "",
    cookPortalEnabled: Boolean(settings?.cookPortalEnabled),
    cookUserId: settings?.cookUserId?.toString(),
    credentialIssuedAt: settings?.cookCredentialIssuedAt?.toISOString(),
    /**
     * True while the emailed hand-off password is still unused. Once a cook
     * sets their own, only its bcrypt hash exists — nobody, including the
     * hostel admin, can read it back; recovery is a rotation.
     */
    initialPasswordPending: Boolean(cookAccount?.mustChangePassword),
  };
}

function resolveAdminHostelId(principal: ApiPrincipal, requestedHostelId?: string) {
  if (requestedHostelId) {
    assertHostelAccess(principal, requestedHostelId);
    return normalizeObjectId(requestedHostelId, "hostel id");
  }

  if (principal.hostelIds.length === 1) {
    return normalizeObjectId(principal.hostelIds[0], "hostel id");
  }

  throw new CookServiceError(
    "A hostelId is required for this hostel admin action.",
    "HOSTEL_SCOPE_REQUIRED",
    422,
  );
}

/**
 * Cook logins are generated, not owned by a real mailbox: the address is
 * derived from the hostel slug so it is stable and recognisable, and the
 * password is delivered to the hostel admin instead.
 */
function cookEmailForSlug(slug: string) {
  return `cook@${slug}.hostelhub.local`;
}

/**
 * Creates (or rotates) the hostel's single shared cook account and records it on
 * HostelSettings. One account per hostel by design: kitchen staff share a phone,
 * and per-announcement attribution comes from `FoodReadyLog.deviceInfo` rather
 * than separate logins (PHASES.md §3.1).
 *
 * Every call issues a **fresh** password, so this doubles as the "rotate
 * credentials" path when a shared password is suspected to have leaked.
 * Returns the plaintext password — the only moment it exists in the clear.
 */
export async function provisionCookAccount(input: {
  actorId: string;
  cookName?: string;
  hostelId: Types.ObjectId;
  hostelName: string;
  hostelSlug: string;
}) {
  const cookName = input.cookName ?? `${input.hostelName} Cook`;
  const email = cookEmailForSlug(input.hostelSlug);
  const temporaryPassword = generatePassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const cook = await UserModel.findOneAndUpdate(
    { email },
    {
      $addToSet: { hostelIds: input.hostelId },
      $set: {
        authProvider: "LOCAL",
        email,
        emailVerified: true,
        // The emailed password is a hand-off credential only: the first cook to
        // sign in is forced to replace it, and because the account is shared,
        // the password they choose becomes the kitchen's password. Changing it
        // revokes every existing session, so the others simply sign in again
        // with the new one.
        mustChangePassword: true,
        name: cookName,
        passwordHash,
        role: Role.COOK,
        status: "ACTIVE",
        updatedBy: input.actorId,
      },
    },
    { new: true, setDefaultsOnInsert: true, upsert: true },
  ).lean<{ _id: Types.ObjectId } | null>();

  if (!cook) {
    throw new CookServiceError(
      "Cook account could not be created.",
      "COOK_ACCOUNT_FAILED",
      500,
    );
  }

  const settings = await HostelSettingsModel.findOneAndUpdate(
    { hostelId: input.hostelId },
    {
      $set: {
        cookCredentialIssuedAt: new Date(),
        cookName,
        cookPortalEnabled: true,
        cookUserId: cook._id,
        hostelId: input.hostelId,
        updatedBy: input.actorId,
      },
    },
    { new: true, setDefaultsOnInsert: true, upsert: true },
  ).lean<HostelSettingsRecord | null>();

  return {
    cookName,
    credentials: { email, temporaryPassword },
    settings,
  };
}

/** Loads the cook User behind a settings row, for read-only status display. */
async function loadCookAccount(settings: HostelSettingsRecord | null) {
  if (!settings?.cookUserId) {
    return null;
  }

  return UserModel.findOne({ _id: settings.cookUserId })
    .select("email mustChangePassword")
    .lean<{ email?: string; mustChangePassword?: boolean } | null>();
}

export async function getCookPortalSettings(
  principal: ApiPrincipal,
  requestedHostelId?: string,
) {
  await connectToDatabase();

  const hostelId = resolveAdminHostelId(principal, requestedHostelId);
  const settings = await HostelSettingsModel.findOne({
    hostelId,
  }).lean<HostelSettingsRecord | null>();
  const cookAccount = await loadCookAccount(settings);

  return { settings: serializeSettings(settings, cookAccount) };
}

export async function updateCookPortal(
  input: CookPortalUpdateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const hostelId = resolveAdminHostelId(principal, input.hostelId);
  const hostel = await HostelModel.findOne({ _id: hostelId })
    .select("name slug")
    .lean<{ name?: string; slug?: string } | null>();

  if (!hostel) {
    throw new CookServiceError("Hostel was not found.", "HOSTEL_NOT_FOUND", 404);
  }

  const existing = await HostelSettingsModel.findOne({
    hostelId,
  }).lean<HostelSettingsRecord | null>();

  if (!input.enabled) {
    if (existing?.cookUserId) {
      await UserModel.updateOne(
        { _id: existing.cookUserId },
        { $set: { status: "SUSPENDED", updatedBy: principal.userId } },
      );
    }

    const settings = await HostelSettingsModel.findOneAndUpdate(
      { hostelId },
      {
        $set: {
          cookPortalEnabled: false,
          hostelId,
          updatedBy: principal.userId,
        },
      },
      { new: true, setDefaultsOnInsert: true, upsert: true },
    ).lean<HostelSettingsRecord | null>();

    await AuditLogModel.create({
      action: "COOK_PORTAL_DISABLED",
      actorId: principal.userId,
      entityId: hostelId.toString(),
      entityType: "HostelSettings",
      hostelId,
    });

    return { credentialsIssued: false, settings: serializeSettings(settings) };
  }

  // Re-enabling (or an explicit rotate) issues a fresh password, so a shared
  // credential that has leaked can be retired without deleting the account.
  const { cookName, credentials, settings } = await provisionCookAccount({
    actorId: principal.userId,
    cookName: input.cookName ?? existing?.cookName,
    hostelId,
    hostelName: hostel.name ?? "Hostel",
    hostelSlug: hostel.slug ?? hostelId.toString(),
  });
  const { email, temporaryPassword } = credentials;

  await AuditLogModel.create({
    action: "COOK_PORTAL_ENABLED",
    actorId: principal.userId,
    entityId: hostelId.toString(),
    entityType: "HostelSettings",
    hostelId,
    metadata: { cookName },
  });

  const admins = await resolveHostelAdminContacts(hostelId);
  const message = cookPortalEnabledEmail({
    cookName,
    credentials: { email, temporaryPassword },
    hostelName: hostel.name ?? "your hostel",
    loginUrl: appUrl("/login"),
  });

  await Promise.all(
    admins.map((admin) =>
      sendNotificationEmail({
        action: "cook_portal_enabled",
        html: message.html,
        subject: message.subject,
        to: admin.email,
      }),
    ),
  );

  return {
    /** Returned once so the admin can hand it over if the email never lands. */
    credentials: { email, temporaryPassword },
    credentialsIssued: true,
    settings: serializeSettings(settings, { email, mustChangePassword: true }),
  };
}

async function resolveCookHostelId(principal: ApiPrincipal, requestedHostelId?: string) {
  if (principal.role === Role.COOK) {
    const hostelId = requestedHostelId ?? principal.hostelIds[0];

    if (!hostelId) {
      throw new CookServiceError(
        "This cook account is not linked to a hostel.",
        "HOSTEL_SCOPE_REQUIRED",
        422,
      );
    }

    assertHostelAccess(principal, hostelId);

    return normalizeObjectId(hostelId, "hostel id");
  }

  return resolveAdminHostelId(principal, requestedHostelId);
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * "Food Ready" announcement (PHASES.md §3.1 Cook Portal). Logs the event and
 * notifies every active resident in the hostel. Push delivery arrives with the
 * mobile app in Phase 6; today the notification lands in the web notification
 * centre.
 */
export async function announceFoodReady(input: FoodReadyInput, principal: ApiPrincipal) {
  await connectToDatabase();

  const hostelId = await resolveCookHostelId(principal, input.hostelId);
  const today = startOfToday();

  // The routine repeats weekly, so today's meal is today's weekday entry.
  const menu = input.useMenuDescription
    ? mealsOn(await getFoodRoutine(hostelId), today).find(
        (meal) => meal.mealType === input.mealType,
      )
    : null;

  const mealLabel = input.mealType.toLowerCase();
  const body =
    input.message ??
    (menu?.items?.length
      ? `Today's ${mealLabel}: ${menu.items.join(", ")}`
      : `${mealLabel.charAt(0).toUpperCase()}${mealLabel.slice(1)} is ready.`);

  // Cook credentials are shared kitchen-wide and effectively static, so treat
  // "announce" as the one abusable action: a cooldown caps how much noise a
  // leaked login (or a mis-tapping cook) can push to every resident at once.
  const { foodReadyCooldownMinutes } = await getOperationsConfig();

  if (foodReadyCooldownMinutes > 0) {
    const cooldownStart = new Date(Date.now() - foodReadyCooldownMinutes * 60 * 1000);
    const recent = await FoodReadyLogModel.findOne({
      announcedAt: { $gte: cooldownStart },
      hostelId,
      mealType: input.mealType,
    })
      .sort({ announcedAt: -1 })
      .lean<{ announcedAt: Date } | null>();

    if (recent) {
      const waitMinutes = Math.max(
        1,
        Math.ceil(
          (recent.announcedAt.getTime() +
            foodReadyCooldownMinutes * 60 * 1000 -
            Date.now()) /
            60_000,
        ),
      );

      throw new CookServiceError(
        `${input.mealType.toLowerCase()} was already announced recently. Try again in ${waitMinutes} minute(s).`,
        "FOOD_READY_COOLDOWN",
        429,
      );
    }
  }

  const recipients = await resolveActiveResidentRecipients(hostelId);
  let notifiedCount = 0;

  for (const recipient of recipients) {
    if (!recipient.userId) {
      continue;
    }

    await createInAppNotification({
      body,
      category: "FOOD",
      createdBy: principal.userId,
      data: { mealType: input.mealType },
      hostelId: hostelId.toString(),
      title: "Food is ready",
      userId: recipient.userId,
    });
    notifiedCount += 1;
  }

  const log = await FoodReadyLogModel.create({
    announcedAt: new Date(),
    announcedBy: principal.userId,
    deviceInfo: input.deviceInfo,
    hostelId,
    mealType: input.mealType,
    message: body,
    notifiedCount,
  });

  await AuditLogModel.create({
    action: "FOOD_READY_ANNOUNCED",
    actorId: principal.userId,
    entityId: log._id.toString(),
    entityType: "FoodReadyLog",
    hostelId,
    metadata: { mealType: input.mealType, notifiedCount },
  });

  // "Food is ready" is time-critical and goes to the whole hostel — including
  // residents with no account, whose food screen would otherwise wait out a
  // poll interval before showing it.
  await publishResourceChange({
    hostelIds: [hostelId.toString()],
    topics: [REALTIME_TOPIC.FOOD],
  });

  return {
    announcement: {
      announcedAt: log.announcedAt.toISOString(),
      id: log._id.toString(),
      mealType: input.mealType,
      message: body,
      notifiedCount,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Cook-scoped reads                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Everything a cook needs to start a shift, in one request.
 *
 * ## Why this exists at all
 *
 * Until now the cook had exactly one endpoint — `POST /cook/food-ready` — and
 * the reads a kitchen actually needs sat under `hostel-admin/food/routine`
 * behind `requireHostelCapability("manageFood")`, which is `HOSTEL_ADMIN` or
 * `WARDEN` only. A cook is neither. So the person cooking the meal could
 * announce it but could not look up what it was, or how many people to cook
 * for. That was tracked as server gap #3 in MOBILE_APP_PHASES.md §1.
 *
 * ## Scope, and what is deliberately not returned
 *
 * `resolveCookHostelId` already handles both audiences: a COOK is pinned to the
 * hostel on their principal, and hostel staff may pass one explicitly. So this
 * is safe to expose to the shared kitchen login *and* useful to an admin
 * previewing what the cook sees.
 *
 * `residentCount` is a **number**, not a list. A cook needs to know how many
 * plates; nothing about the kitchen's job requires knowing whose. The names are
 * a separate, narrower endpoint below, and even that returns no contact details.
 *
 * `announced` is today's `FoodReadyLog` rows, so the four buttons can show
 * which meals have already gone out — the cooldown is enforced server-side and
 * a button that 429s after the fact is a worse way to learn that.
 */
export async function getCookToday(principal: ApiPrincipal, requestedHostelId?: string) {
  await connectToDatabase();

  const hostelId = await resolveCookHostelId(principal, requestedHostelId);
  const today = startOfToday();

  const [hostel, routine, residentCount, announcements] = await Promise.all([
    HostelModel.findOne({ _id: hostelId, isDeleted: false })
      .select("name")
      .lean<{ _id: Types.ObjectId; name: string } | null>(),
    getFoodRoutine(hostelId),
    // The same filter `resolveActiveResidentRecipients` counts for the
    // announcement fan-out, so "cook for 38" and "38 residents notified" agree.
    ResidentModel.countDocuments({ hostelId, isDeleted: false, status: "ACTIVE" }),
    FoodReadyLogModel.find({ announcedAt: { $gte: today }, hostelId })
      .sort({ announcedAt: -1 })
      .limit(12)
      .lean<
        {
          _id: Types.ObjectId;
          announcedAt: Date;
          mealType: string;
          message?: string;
          notifiedCount: number;
        }[]
      >(),
  ]);

  return {
    today: {
      announced: announcements.map((log) => ({
        announcedAt: log.announcedAt.toISOString(),
        id: log._id.toString(),
        mealType: log.mealType,
        message: log.message ?? "",
        notifiedCount: log.notifiedCount,
      })),
      date: today.toISOString().slice(0, 10),
      hostel: hostel
        ? { id: hostel._id.toString(), name: hostel.name }
        : { id: hostelId.toString(), name: "Your hostel" },
      /** Today's weekday entries off the weekly routine, in meal order. */
      meals: mealsOn(routine, today),
      /** The whole week, so the menu screen needs no second request. */
      routine,
      residentCount,
    },
  };
}

/**
 * The roster, reduced to what a kitchen has any business seeing.
 *
 * Name, room type and status — no phone, no email, no deposit, no move-in date,
 * no account linkage. The cook login is **shared kitchen-wide** and effectively
 * static (`provisionCookAccount` issues one password per hostel), so this is the
 * one endpoint in the product where a leaked credential hands a stranger a list
 * of residents. Keeping it to a name and a room means that list is worth
 * nothing beyond what a noticeboard already shows.
 *
 * ACTIVE only: someone who has moved out is not eating here.
 */
export async function listCookResidents(
  principal: ApiPrincipal,
  requestedHostelId?: string,
) {
  await connectToDatabase();

  const hostelId = await resolveCookHostelId(principal, requestedHostelId);
  const residents = await ResidentModel.find({
    hostelId,
    isDeleted: false,
    status: "ACTIVE",
  })
    .select("firstName lastName roomType")
    .sort({ firstName: 1, lastName: 1 })
    .limit(500)
    .lean<
      { _id: Types.ObjectId; firstName: string; lastName: string; roomType: string }[]
    >();

  return {
    residents: residents.map((resident) => ({
      fullName: `${resident.firstName} ${resident.lastName}`.trim(),
      id: resident._id.toString(),
      roomType: resident.roomType,
    })),
  };
}

/**
 * A photo of the meal, straight from the kitchen.
 *
 * Delegates to `uploadFoodPhoto` rather than writing its own `FoodPhoto` —
 * that function owns the audit row and the realtime publish that makes the
 * photo appear on residents' food screens — and hands it the hostel this cook
 * is scoped to, because `resolveAdminHostelId` inside it would refuse a COOK
 * principal outright.
 */
export async function uploadCookFoodPhoto(
  input: FoodPhotoUploadInput,
  principal: ApiPrincipal,
) {
  const hostelId = await resolveCookHostelId(principal, input.hostelId);

  return uploadFoodPhoto(input, principal, { hostelId });
}

/** Recent announcements, for the cook dashboard and food-timing reports. */
export async function listFoodReadyLogs(
  principal: ApiPrincipal,
  requestedHostelId?: string,
) {
  await connectToDatabase();

  const hostelId = await resolveCookHostelId(principal, requestedHostelId);
  const logs = await FoodReadyLogModel.find({ hostelId })
    .sort({ announcedAt: -1 })
    .limit(50)
    .lean<
      {
        _id: Types.ObjectId;
        announcedAt: Date;
        mealType: string;
        message?: string;
        notifiedCount: number;
      }[]
    >();

  return {
    logs: logs.map((log) => ({
      announcedAt: log.announcedAt.toISOString(),
      id: log._id.toString(),
      mealType: log.mealType,
      message: log.message ?? "",
      notifiedCount: log.notifiedCount,
    })),
  };
}
