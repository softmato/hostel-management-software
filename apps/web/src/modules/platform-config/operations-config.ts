import { z } from "zod";

import { connectToDatabase } from "@/lib/db";
import { PlatformSettingModel } from "@hostel/db/models/PlatformSetting";

/**
 * Runtime-configurable operational knobs (ARCHITECTURE.md §5). Stored as a
 * single `PlatformSetting` document keyed `operations`, separate from the
 * public site-config sections so a website edit can never change how the
 * activation/payment machinery behaves.
 */
export const OPERATIONS_CONFIG_KEY = "operations";

export const operationsConfigSchema = z.object({
  /**
   * Ceilings a hostel admin may not exceed in their own settings. Kept here so
   * the platform decides the outer bounds and each hostel tunes within them
   * (ARCHITECTURE.md §5, PlatformConfig → HostelSettings).
   */
  maxAttendanceRetentionDays: z.number().int().min(30).max(1095).default(600),
  maxInsideZoneRadiusMeters: z.number().int().min(10).max(500).default(100),
  maxNearbyZoneRadiusMeters: z.number().int().min(20).max(2000).default(500),
  /**
   * Minimum gap between two "food ready" announcements for the same meal.
   * Cook credentials are shared kitchen-wide, so this is the blast-radius limit
   * on the one action a leaked cook login can actually abuse: spamming every
   * resident's notifications.
   */
  foodReadyCooldownMinutes: z.number().int().min(0).max(1440).default(120),
  /** Response window a complaint is measured against (PHASES.md §4.1). */
  complaintSlaHours: z.number().int().min(1).max(720).default(72),
  paymentReminderDaysBefore: z.number().int().min(0).max(30).default(3),
  sendComplaintEmails: z.boolean().default(true),
  qrActivationExpiryDays: z.number().int().min(1).max(60).default(7),
  receiptNumberPrefix: z.string().trim().min(1).max(10).default("RCP"),
  sendNoticeEmails: z.boolean().default(true),
  sendPaymentEmails: z.boolean().default(true),
});

export type OperationsConfig = z.infer<typeof operationsConfigSchema>;

export const DEFAULT_OPERATIONS_CONFIG: OperationsConfig = operationsConfigSchema.parse(
  {},
);

type PlatformSettingRecord = {
  key: string;
  value: unknown;
};

/**
 * Never throws: a malformed or missing document falls back to the shipped
 * defaults, because every caller is on a path (activation, payment reminders)
 * that must not fail over a configuration read.
 */
export async function getOperationsConfig(): Promise<OperationsConfig> {
  try {
    await connectToDatabase();

    const record = (await PlatformSettingModel.findOne({
      key: OPERATIONS_CONFIG_KEY,
    }).lean()) as PlatformSettingRecord | null;

    if (!record) {
      return DEFAULT_OPERATIONS_CONFIG;
    }

    const parsed = operationsConfigSchema.safeParse(record.value);

    return parsed.success ? parsed.data : DEFAULT_OPERATIONS_CONFIG;
  } catch {
    return DEFAULT_OPERATIONS_CONFIG;
  }
}

/**
 * Superadmin write path. Unlike the read above this **does** throw: a rejected
 * value has to reach the person editing it, not fall back silently to a default
 * that quietly discards what they typed.
 */
export async function saveOperationsConfig(input: unknown, actorId: string) {
  await connectToDatabase();

  const current = await getOperationsConfig();
  // Partial edits merge onto what is stored, so a form that posts one field
  // does not reset the other eight to their shipped defaults.
  const next = operationsConfigSchema.parse({
    ...current,
    ...(typeof input === "object" && input !== null ? input : {}),
  });

  await PlatformSettingModel.findOneAndUpdate(
    { key: OPERATIONS_CONFIG_KEY },
    { $set: { key: OPERATIONS_CONFIG_KEY, updatedBy: actorId, value: next } },
    { new: true, upsert: true },
  );

  return { config: next };
}
