import { Types } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import {
  MAX_PAGE_SIZE,
  paginationMeta,
  paginationRange,
  type PaginationQuery,
} from "@/lib/pagination";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { HostelModel } from "@hostel/db/models/Hostel";
import { RatingReviewModel } from "@hostel/db/models/RatingReview";
import { ResidentModel } from "@hostel/db/models/Resident";
import { ReviewModerationLogModel } from "@hostel/db/models/ReviewModerationLog";
import {
  findCurrentResident,
  normalizeObjectId,
  serializeResidentSummary,
} from "@/modules/residents/resident-access";
import type {
  platformReviewListQuerySchema,
  reviewCreateSchema,
  reviewModerationSchema,
} from "@/modules/reviews/review.validation";

type ReviewCreateInput = z.infer<typeof reviewCreateSchema>;
type ReviewModerationInput = z.infer<typeof reviewModerationSchema>;
type PlatformReviewListQuery = z.infer<typeof platformReviewListQuerySchema>;

type ReviewRecord = {
  _id: Types.ObjectId;
  cleanlinessRating?: number;
  comment?: string;
  createdAt?: Date;
  foodRating?: number;
  hiddenAt?: Date;
  hiddenBy?: Types.ObjectId;
  hostelId: Types.ObjectId;
  locationRating?: number;
  managementRating?: number;
  overallRating: number;
  residentId: Types.ObjectId;
  roomRating?: number;
  safetyRating?: number;
  status: "VISIBLE" | "HIDDEN";
  updatedAt?: Date;
  userId: Types.ObjectId;
};

export class ReviewServiceError extends Error {
  constructor(
    message: string,
    public errorCode = "REVIEW_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}

function serializeReview(review: ReviewRecord) {
  return {
    cleanlinessRating: review.cleanlinessRating,
    comment: review.comment ?? "",
    createdAt: review.createdAt?.toISOString(),
    foodRating: review.foodRating,
    hiddenAt: review.hiddenAt?.toISOString(),
    hiddenBy: review.hiddenBy?.toString(),
    hostelId: review.hostelId.toString(),
    id: review._id.toString(),
    locationRating: review.locationRating,
    managementRating: review.managementRating,
    overallRating: review.overallRating,
    residentId: review.residentId.toString(),
    roomRating: review.roomRating,
    safetyRating: review.safetyRating,
    status: review.status,
    updatedAt: review.updatedAt?.toISOString(),
    userId: review.userId.toString(),
  };
}

/**
 * Public shape of a review. Reviews can only be written by a resident of the
 * hostel (`createResidentReview` enforces it), so the badge is a fact about the
 * record, not a claim. The reviewer is shown as a first name plus an initial —
 * enough to read as a real person, not enough to identify one.
 */
function serializePublicReview(review: ReviewRecord, displayName: string) {
  return {
    cleanlinessRating: review.cleanlinessRating,
    comment: review.comment ?? "",
    createdAt: review.createdAt?.toISOString(),
    foodRating: review.foodRating,
    id: review._id.toString(),
    isVerifiedResident: true,
    locationRating: review.locationRating,
    managementRating: review.managementRating,
    overallRating: review.overallRating,
    reviewerName: displayName,
    roomRating: review.roomRating,
    safetyRating: review.safetyRating,
  };
}

function averageOf(values: Array<number | undefined>) {
  const scored = values.filter((value): value is number => typeof value === "number");

  if (scored.length === 0) {
    return null;
  }

  return (
    Math.round((scored.reduce((sum, value) => sum + value, 0) / scored.length) * 10) / 10
  );
}

async function auditReviewAction(
  principal: ApiPrincipal,
  review: ReviewRecord,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await AuditLogModel.create({
    action,
    actorId: principal.userId,
    entityId: review._id.toString(),
    entityType: "RatingReview",
    hostelId: review.hostelId,
    metadata,
  });
}

export async function createResidentReview(
  input: ReviewCreateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);

  if (!["ACTIVE", "MOVED_OUT"].includes(resident.status)) {
    throw new ReviewServiceError(
      "Only verified current or past residents can review.",
      "REVIEW_NOT_ALLOWED",
      403,
    );
  }

  const review = (await RatingReviewModel.findOneAndUpdate(
    {
      hostelId: resident.hostelId,
      residentId: resident._id,
    },
    {
      $set: {
        ...input,
        hostelId: resident.hostelId,
        residentId: resident._id,
        status: "VISIBLE",
        userId: principal.userId,
      },
      $unset: {
        hiddenAt: "",
        hiddenBy: "",
      },
    },
    { new: true, upsert: true },
  ).lean<ReviewRecord>()) as ReviewRecord;

  await auditReviewAction(principal, review, "REVIEW_SUBMITTED");

  return {
    resident: serializeResidentSummary(resident),
    review: serializeReview(review),
  };
}

/**
 * Accepts either a hostel id or its public slug — the public detail page is
 * routed by slug, and passing that straight through used to fail id parsing.
 */
async function resolveHostelId(hostelIdOrSlug: string) {
  if (Types.ObjectId.isValid(hostelIdOrSlug)) {
    return normalizeObjectId(hostelIdOrSlug, "hostel id");
  }

  const hostel = await HostelModel.findOne({
    isDeleted: { $ne: true },
    slug: hostelIdOrSlug,
  })
    .select("_id")
    .lean<{ _id: Types.ObjectId } | null>();

  if (!hostel) {
    throw new ReviewServiceError("Hostel was not found.", "HOSTEL_NOT_FOUND", 404);
  }

  return hostel._id;
}

export async function listPublicHostelReviews(
  hostelIdOrSlug: string,
  query: PaginationQuery = { page: 1, pageSize: MAX_PAGE_SIZE },
) {
  await connectToDatabase();

  const objectId = await resolveHostelId(hostelIdOrSlug);
  const filter = {
    hostelId: objectId,
    status: "VISIBLE",
  };
  const { limit, skip } = paginationRange(query);

  // Two reads on purpose. `reviews` is the page the visitor sees; `scored` is
  // every visible review's rating fields, because the summary below — average,
  // per-category means, star distribution, total — describes the hostel, not
  // the page. Computing it from `reviews` would make a hostel's rating change
  // as you click through pages. `scored` is a narrow projection, so it stays
  // cheap even when the list does not.
  const [reviews, scored] = await Promise.all([
    RatingReviewModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<ReviewRecord[]>(),
    RatingReviewModel.find(filter)
      .select(
        "overallRating cleanlinessRating foodRating locationRating managementRating roomRating safetyRating",
      )
      .lean<ReviewRecord[]>(),
  ]);
  const residents = await ResidentModel.find({
    _id: { $in: reviews.map((review) => review.residentId) },
  }).lean<Array<{ _id: Types.ObjectId; firstName: string; lastName: string }>>();
  const nameByResidentId = new Map(
    residents.map((resident) => [
      resident._id.toString(),
      `${resident.firstName} ${resident.lastName.slice(0, 1)}.`.trim(),
    ]),
  );
  const averageRating =
    scored.length === 0
      ? 0
      : scored.reduce((sum, review) => sum + review.overallRating, 0) / scored.length;

  return {
    pagination: paginationMeta(query, scored.length),
    reviews: reviews.map((review) =>
      serializePublicReview(
        review,
        nameByResidentId.get(review.residentId.toString()) ?? "Verified resident",
      ),
    ),
    summary: {
      averageRating,
      // Per-category averages skip reviews that left a category unscored, so a
      // single food rating is not diluted by everyone who ignored the field.
      categories: {
        cleanliness: averageOf(scored.map((review) => review.cleanlinessRating)),
        food: averageOf(scored.map((review) => review.foodRating)),
        location: averageOf(scored.map((review) => review.locationRating)),
        management: averageOf(scored.map((review) => review.managementRating)),
        overall: averageOf(scored.map((review) => review.overallRating)),
        room: averageOf(scored.map((review) => review.roomRating)),
        security: averageOf(scored.map((review) => review.safetyRating)),
      },
      // Real counts per star, so the public bar chart reflects the reviews that
      // exist rather than a shape assumed from the total.
      distribution: [5, 4, 3, 2, 1].map((stars) => ({
        count: scored.filter((review) => Math.round(review.overallRating) === stars)
          .length,
        stars,
      })),
      total: scored.length,
    },
  };
}

export async function listPlatformReviews(query: PlatformReviewListQuery) {
  await connectToDatabase();

  const filter: Record<string, unknown> = {};

  if (query.hostelId) {
    filter.hostelId = normalizeObjectId(query.hostelId, "hostel id");
  }

  if (query.status) {
    filter.status = query.status;
  }

  const { limit, skip } = paginationRange(query);

  const [reviews, total] = await Promise.all([
    RatingReviewModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<ReviewRecord[]>(),
    RatingReviewModel.countDocuments(filter),
  ]);

  return {
    pagination: paginationMeta(query, total),
    reviews: reviews.map(serializeReview),
  };
}

async function moderateReview(
  reviewId: string,
  action: "HIDE" | "UNHIDE",
  input: ReviewModerationInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const status = action === "HIDE" ? "HIDDEN" : "VISIBLE";
  const review = await RatingReviewModel.findOneAndUpdate(
    { _id: normalizeObjectId(reviewId, "review id") },
    action === "HIDE"
      ? {
          $set: {
            hiddenAt: new Date(),
            hiddenBy: principal.userId,
            status,
          },
        }
      : {
          $set: { status },
          $unset: { hiddenAt: "", hiddenBy: "" },
        },
    { new: true },
  ).lean<ReviewRecord | null>();

  if (!review) {
    throw new ReviewServiceError("Review was not found.", "REVIEW_NOT_FOUND", 404);
  }

  await Promise.all([
    ReviewModerationLogModel.create({
      action,
      actorId: principal.userId,
      hostelId: review.hostelId,
      reason: input.reason,
      reviewId: review._id,
    }),
    auditReviewAction(principal, review, `REVIEW_${action}`, { reason: input.reason }),
  ]);

  return {
    review: serializeReview(review),
  };
}

export function hideReview(
  reviewId: string,
  input: ReviewModerationInput,
  principal: ApiPrincipal,
) {
  return moderateReview(reviewId, "HIDE", input, principal);
}

export function unhideReview(
  reviewId: string,
  input: ReviewModerationInput,
  principal: ApiPrincipal,
) {
  return moderateReview(reviewId, "UNHIDE", input, principal);
}
