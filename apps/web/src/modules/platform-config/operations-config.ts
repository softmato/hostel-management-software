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
   * Minimum gap between two "food ready" announcements for the same meal.
   * Cook credentials are shared kitchen-wide, so this is the blast-radius limit
   * on the one action a leaked cook login can actually abuse: spamming every
   * resident's notifications.
   */
  foodReadyCooldownMinutes: z.number().int().min(0).max(1440).default(120),
  paymentReminderDaysBefore: z.number().int().min(0).max(30).default(3),
  qrActivationExpiryDays: z.number().int().min(1).max(60).default(7),
  receiptNumberPrefix: z.string().trim().min(1).max(10).default("RCP"),
  sendNoticeEmails: z.boolean().default(true),
  sendPaymentEmails: z.boolean().default(true),
});

export type OperationsConfig = z.infer<typeof operationsConfigSchema>;

export const DEFAULT_OPERATIONS_CONFIG: OperationsConfig =
  operationsConfigSchema.parse({});

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
