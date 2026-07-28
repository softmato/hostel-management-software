import { Types } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { assertHostelAccess } from "@/lib/tenant";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { FoodFeedbackModel } from "@hostel/db/models/FoodFeedback";
import { FoodMenuModel } from "@hostel/db/models/FoodMenu";
import { FoodPhotoModel } from "@hostel/db/models/FoodPhoto";
import {
  findCurrentResident,
  normalizeObjectId,
  serializeResidentSummary,
} from "@/modules/residents/resident-access";
import type {
  foodFeedbackSchema,
  foodMenuCreateSchema,
  foodMenuListQuerySchema,
  foodMenuUpdateSchema,
  foodPhotoUploadSchema,
} from "@/modules/food/food.validation";

type FoodMenuCreateInput = z.infer<typeof foodMenuCreateSchema>;
type FoodMenuUpdateInput = z.infer<typeof foodMenuUpdateSchema>;
type FoodMenuListQuery = z.infer<typeof foodMenuListQuerySchema>;
type FoodPhotoUploadInput = z.infer<typeof foodPhotoUploadSchema>;
type FoodFeedbackInput = z.infer<typeof foodFeedbackSchema>;

type FoodMenuRecord = {
  _id: Types.ObjectId;
  createdAt?: Date;
  date: Date;
  dayOfWeek: string;
  hostelId: Types.ObjectId;
  items: string[];
  mealType: string;
  specialNotes?: string;
  timing: string;
  updatedAt?: Date;
  weekStartDate: Date;
};

type FoodPhotoRecord = {
  _id: Types.ObjectId;
  caption?: string;
  date: Date;
  hostelId: Types.ObjectId;
  mealType: string;
  photoAssetId: string;
  residentId?: Types.ObjectId;
  uploadedAt: Date;
  uploadedBy: Types.ObjectId;
};

type FoodFeedbackRecord = {
  _id: Types.ObjectId;
  comment?: string;
  createdAt?: Date;
  date: Date;
  hostelId: Types.ObjectId;
  isAnonymous: boolean;
  mealType: string;
  menuId?: Types.ObjectId;
  rating: number;
  residentId: Types.ObjectId;
};

export class FoodServiceError extends Error {
  constructor(
    message: string,
    public errorCode = "FOOD_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}

function normalizeObjectIds(values: string[]) {
  return values.map((value) => normalizeObjectId(value, "hostel id"));
}

function resolveAdminHostelId(principal: ApiPrincipal, requestedHostelId?: string) {
  if (requestedHostelId) {
    assertHostelAccess(principal, requestedHostelId);
    return normalizeObjectId(requestedHostelId, "hostel id");
  }

  if (principal.hostelIds.length === 1) {
    return normalizeObjectId(principal.hostelIds[0], "hostel id");
  }

  throw new FoodServiceError(
    "A hostelId is required for this hostel admin action.",
    "HOSTEL_SCOPE_REQUIRED",
    422,
  );
}

function scopedHostelFilter(principal: ApiPrincipal, requestedHostelId?: string) {
  if (requestedHostelId) {
    return { hostelId: resolveAdminHostelId(principal, requestedHostelId) };
  }

  return {
    hostelId: {
      $in: normalizeObjectIds(principal.hostelIds),
    },
  };
}

/**
 * Menu dates are day-granular. Callers send them in assorted shapes (a bare
 * `YYYY-MM-DD`, a full timestamp from a seed script), so everything is pinned
 * to UTC midnight before it is written or matched — otherwise two entries for
 * the same meal on the same day slip past the unique (hostel, date, meal)
 * index and the reader picks whichever one it happens to see last.
 */
function startOfUtcDay(value: Date) {
  const date = new Date(value);

  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function addUtcDay(value: Date) {
  const date = startOfUtcDay(value);

  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function dayRange(value: Date) {
  return { $gte: startOfUtcDay(value), $lt: addUtcDay(value) };
}

function definedUpdate(input: Record<string, unknown>, omittedKeys: string[] = []) {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) => value !== undefined && !omittedKeys.includes(key),
    ),
  );
}

function serializeFoodMenu(menu: FoodMenuRecord) {
  return {
    createdAt: menu.createdAt?.toISOString(),
    date: menu.date.toISOString(),
    dayOfWeek: menu.dayOfWeek,
    hostelId: menu.hostelId.toString(),
    id: menu._id.toString(),
    items: menu.items,
    mealType: menu.mealType,
    specialNotes: menu.specialNotes ?? "",
    timing: menu.timing,
    updatedAt: menu.updatedAt?.toISOString(),
    weekStartDate: menu.weekStartDate.toISOString(),
  };
}

function serializeFoodPhoto(photo: FoodPhotoRecord) {
  return {
    caption: photo.caption ?? "",
    date: photo.date.toISOString(),
    hostelId: photo.hostelId.toString(),
    id: photo._id.toString(),
    mealType: photo.mealType,
    photoAssetId: photo.photoAssetId,
    residentId: photo.residentId?.toString(),
    uploadedAt: photo.uploadedAt.toISOString(),
    uploadedBy: photo.uploadedBy.toString(),
  };
}

function serializeFoodFeedback(feedback: FoodFeedbackRecord) {
  return {
    comment: feedback.comment ?? "",
    createdAt: feedback.createdAt?.toISOString(),
    date: feedback.date.toISOString(),
    hostelId: feedback.hostelId.toString(),
    id: feedback._id.toString(),
    isAnonymous: feedback.isAnonymous,
    mealType: feedback.mealType,
    menuId: feedback.menuId?.toString(),
    rating: feedback.rating,
    residentId: feedback.residentId.toString(),
  };
}

async function auditFoodAction(
  principal: ApiPrincipal,
  hostelId: Types.ObjectId,
  entityId: Types.ObjectId,
  entityType: string,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await AuditLogModel.create({
    action,
    actorId: principal.userId,
    entityId: entityId.toString(),
    entityType,
    hostelId,
    metadata,
  });
}

export async function createFoodMenu(
  input: FoodMenuCreateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const hostelId = resolveAdminHostelId(principal, input.hostelId);
  const normalized = {
    ...input,
    date: startOfUtcDay(input.date),
    weekStartDate: startOfUtcDay(input.weekStartDate),
  };
  // Re-posting the same meal replaces that day's entry instead of adding a
  // second one: the match is on the whole day, so an entry written earlier with
  // a time component is still the one that gets updated.
  // Oldest-first: if a midnight row already exists it is the one that gets
  // updated, so normalizing the date cannot collide with it on the unique
  // (hostel, date, meal) index.
  const existing = await FoodMenuModel.findOne({
    date: dayRange(input.date),
    hostelId,
    mealType: input.mealType,
  }).sort({ date: 1 });

  const menu = existing
    ? await FoodMenuModel.findOneAndUpdate(
        { _id: existing._id },
        {
          ...definedUpdate({ ...normalized }, ["hostelId"]),
          updatedBy: principal.userId,
        },
        { new: true },
      )
    : await FoodMenuModel.create({
        ...normalized,
        createdBy: principal.userId,
        hostelId,
        updatedBy: principal.userId,
      });

  if (!menu) {
    throw new FoodServiceError("Food menu could not be saved.", "FOOD_MENU_SAVE_FAILED", 500);
  }

  await auditFoodAction(
    principal,
    hostelId,
    menu._id,
    "FoodMenu",
    existing ? "FOOD_MENU_UPDATED" : "FOOD_MENU_CREATED",
  );

  return {
    menu: serializeFoodMenu(menu as FoodMenuRecord),
  };
}

export async function listFoodMenus(query: FoodMenuListQuery, principal: ApiPrincipal) {
  await connectToDatabase();

  const filter: Record<string, unknown> = {
    ...scopedHostelFilter(principal, query.hostelId),
  };

  if (query.date) {
    filter.date = dayRange(query.date);
  } else if (query.from || query.to) {
    const range: Record<string, Date> = {};

    if (query.from) {
      range.$gte = startOfUtcDay(query.from);
    }

    if (query.to) {
      // `to` is inclusive, so the exclusive upper bound is the next day.
      range.$lt = addUtcDay(query.to);
    }

    filter.date = range;
  }

  if (query.weekStartDate) {
    filter.weekStartDate = query.weekStartDate;
  }

  if (query.mealType) {
    filter.mealType = query.mealType;
  }

  // A single month of four meals a day is already 124 rows, so the cap has to
  // clear a couple of months for a ranged read to come back whole.
  const menus = await FoodMenuModel.find(filter)
    .sort({ date: 1, mealType: 1 })
    .limit(500)
    .lean<FoodMenuRecord[]>();

  return {
    menus: menus.map(serializeFoodMenu),
  };
}

/**
 * The routine a public hostel page shows — no principal, because a published
 * hostel's menu is public information.
 *
 * A hostel that keeps the same routine for months only configures it once, so
 * this reads the most recently published week rather than today's: strictly
 * scoping to the current week would blank the page for every hostel whose menu
 * has not been touched since it was set up.
 */
export async function listPublicFoodRoutine(
  hostelId: Types.ObjectId,
  referenceDate = new Date(),
) {
  await connectToDatabase();

  const today = startOfUtcDay(referenceDate);
  // Prefer the newest week already in effect, so a routine published ahead of
  // time does not replace the one residents are eating this week.
  const current = await FoodMenuModel.findOne({
    hostelId,
    weekStartDate: { $lte: today },
  })
    .sort({ weekStartDate: -1 })
    .lean<FoodMenuRecord | null>();
  const latest =
    current ??
    (await FoodMenuModel.findOne({ hostelId })
      .sort({ weekStartDate: -1 })
      .lean<FoodMenuRecord | null>());

  if (!latest) {
    return { menus: [], weekStartDate: "" };
  }

  const menus = await FoodMenuModel.find({
    hostelId,
    weekStartDate: latest.weekStartDate,
  })
    .sort({ date: 1, mealType: 1, updatedAt: 1 })
    .limit(60)
    .lean<FoodMenuRecord[]>();

  return {
    menus: menus.map(serializeFoodMenu),
    weekStartDate: latest.weekStartDate.toISOString(),
  };
}

export async function updateFoodMenu(
  menuId: string,
  input: FoodMenuUpdateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const existingMenu = await FoodMenuModel.findOne({
    _id: normalizeObjectId(menuId, "food menu id"),
    ...scopedHostelFilter(principal, input.hostelId),
  }).lean<FoodMenuRecord | null>();

  if (!existingMenu) {
    throw new FoodServiceError("Food menu was not found.", "FOOD_MENU_NOT_FOUND", 404);
  }

  const menu = await FoodMenuModel.findOneAndUpdate(
    { _id: existingMenu._id },
    {
      $set: {
        ...definedUpdate(input, ["hostelId"]),
        updatedBy: principal.userId,
      },
    },
    { new: true },
  ).lean<FoodMenuRecord | null>();

  if (!menu) {
    throw new FoodServiceError("Food menu was not found.", "FOOD_MENU_NOT_FOUND", 404);
  }

  await auditFoodAction(
    principal,
    existingMenu.hostelId,
    existingMenu._id,
    "FoodMenu",
    "FOOD_MENU_UPDATED",
  );

  return {
    menu: serializeFoodMenu(menu),
  };
}

export async function uploadFoodPhoto(
  input: FoodPhotoUploadInput,
  principal: ApiPrincipal,
  residentScoped = false,
) {
  await connectToDatabase();

  const resident = residentScoped ? await findCurrentResident(principal) : null;
  const hostelId = resident
    ? resident.hostelId
    : resolveAdminHostelId(principal, input.hostelId);
  const photo = await FoodPhotoModel.create({
    ...input,
    hostelId,
    residentId: resident?._id,
    uploadedBy: principal.userId,
  });

  await auditFoodAction(
    principal,
    hostelId,
    photo._id,
    "FoodPhoto",
    "FOOD_PHOTO_UPLOADED",
  );

  return {
    photo: serializeFoodPhoto(photo as FoodPhotoRecord),
    resident: resident ? serializeResidentSummary(resident) : null,
  };
}

export async function listFoodForResident(principal: ApiPrincipal) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);
  const menus = await FoodMenuModel.find({
    hostelId: resident.hostelId,
  })
    .sort({ date: 1, mealType: 1 })
    .limit(80)
    .lean<FoodMenuRecord[]>();
  const photos = await FoodPhotoModel.find({
    hostelId: resident.hostelId,
    date: {
      $gte: menus[0]?.date ?? new Date(0),
    },
  })
    .sort({ date: -1, uploadedAt: -1 })
    .limit(40)
    .lean<FoodPhotoRecord[]>();

  return {
    menus: menus.map(serializeFoodMenu),
    photos: photos.map(serializeFoodPhoto),
    resident: serializeResidentSummary(resident),
  };
}

export async function submitFoodFeedback(
  input: FoodFeedbackInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);

  if (input.menuId) {
    const menuExists = await FoodMenuModel.exists({
      _id: normalizeObjectId(input.menuId, "food menu id"),
      hostelId: resident.hostelId,
    });

    if (!menuExists) {
      throw new FoodServiceError("Food menu was not found.", "FOOD_MENU_NOT_FOUND", 404);
    }
  }

  const feedback = await FoodFeedbackModel.create({
    ...input,
    hostelId: resident.hostelId,
    residentId: resident._id,
  });

  await auditFoodAction(
    principal,
    resident.hostelId,
    feedback._id,
    "FoodFeedback",
    "FOOD_FEEDBACK_SUBMITTED",
  );

  return {
    feedback: serializeFoodFeedback(feedback as FoodFeedbackRecord),
    resident: serializeResidentSummary(resident),
  };
}
