import { z } from "zod";

import { paginationQuerySchema } from "@/lib/pagination";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id.");

export const notificationPrioritySchema = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);

const campaignBaseSchema = {
  body: z.string().trim().min(2).max(2000),
  category: z.string().trim().min(2).max(60).default("ANNOUNCEMENT"),
  priority: notificationPrioritySchema.default("NORMAL"),
  /**
   * Absent means "send now". A past timestamp is rejected rather than silently
   * dispatched — an admin who typed yesterday's date meant something else.
   */
  scheduledFor: z.coerce.date().optional(),
  title: z.string().trim().min(2).max(160),
};

export const hostelNotificationCampaignSchema = z
  .object({
    ...campaignBaseSchema,
    audience: z.enum(["ALL", "RESIDENTS", "GUARDIANS", "SPECIFIC"]).default("ALL"),
    hostelId: objectIdSchema.optional(),
    residentIds: z.array(objectIdSchema).max(500).default([]),
  })
  .refine((value) => value.audience !== "SPECIFIC" || value.residentIds.length > 0, {
    message: "Select at least one resident.",
    path: ["residentIds"],
  });

export const platformNotificationCampaignSchema = z.object({
  ...campaignBaseSchema,
  /** Empty means every hostel on the platform. */
  hostelIds: z.array(objectIdSchema).max(200).default([]),
});

export const notificationCampaignListQuerySchema = z.object({
  ...paginationQuerySchema,
  hostelId: objectIdSchema.optional(),
});

export const deviceTokenSaveSchema = z.object({
  deviceId: z.string().trim().max(160).optional(),
  platform: z.enum(["IOS", "ANDROID", "WEB"]),
  token: z.string().trim().min(8).max(4096),
});
