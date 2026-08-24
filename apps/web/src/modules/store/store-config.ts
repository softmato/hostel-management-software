import { z } from "zod";

import { connectToDatabase } from "@/lib/db";
import { PlatformSettingModel } from "@hostel/db/models/PlatformSetting";

/**
 * The supply store's commercial knobs, as one `PlatformSetting` document keyed
 * `store`.
 *
 * Its own section rather than three more fields on `operations`: the delivery
 * fee is a price the platform charges, and a shop's pricing changing because
 * somebody edited the complaint SLA form is the sort of coupling that only ever
 * gets noticed after an order goes out at the wrong total.
 *
 * Every amount here is **NPR paisa**, matching `StoreProduct.price`.
 */
export const STORE_CONFIG_KEY = "store";

export const storeConfigSchema = z.object({
  /**
   * A currency **code**, not a symbol. The phone maps it through the same
   * `<Money>` component the rest of the app uses, so a store that one day sells
   * in a second currency does not need a second formatter.
   */
  currency: z.string().trim().length(3).toUpperCase().default("NPR"),
  /** Flat fee added to every order that misses the free-delivery threshold. */
  deliveryFee: z.number().int().min(0).max(10_000_00).default(150_00),
  /**
   * Spend at or above this and delivery is free. `0` disables the rule
   * entirely — every order pays `deliveryFee` — rather than making every order
   * free, which is what a naive `subtotal >= 0` comparison would have done.
   */
  freeDeliveryThreshold: z.number().int().min(0).max(1_000_000_00).default(5_000_00),
  /**
   * Turns the shop off without deleting a catalogue. The mobile Store tile stays
   * visible and the screen explains itself, because a button that vanishes is
   * read as a bug and a button that says "closed until Sunday" is read as news.
   */
  isOpen: z.boolean().default(true),
  /** Shown on the shop screen when `isOpen` is false. */
  closedMessage: z
    .string()
    .trim()
    .max(300)
    .default("The supply store is closed for now. Please check back soon."),
  /** Rough promise printed under the total at checkout. Free text, not a date. */
  deliveryEstimate: z.string().trim().max(120).default("Delivered in 2–4 working days"),
  /** Hard ceiling on a single order, as a guard against a fat-fingered stepper. */
  maxOrderTotal: z.number().int().min(1_000_00).max(100_000_000).default(5_000_000),
});

export type StoreConfig = z.infer<typeof storeConfigSchema>;

export const DEFAULT_STORE_CONFIG: StoreConfig = storeConfigSchema.parse({});

type PlatformSettingRecord = { key: string; value: unknown };

/**
 * Never throws. Same contract as `getOperationsConfig`: every caller is on a
 * path that must not fail over a configuration read — the shop screen, the cart
 * and the order placement all quote from this.
 */
export async function getStoreConfig(): Promise<StoreConfig> {
  try {
    await connectToDatabase();

    const record = (await PlatformSettingModel.findOne({
      key: STORE_CONFIG_KEY,
    }).lean()) as PlatformSettingRecord | null;

    if (!record) {
      return DEFAULT_STORE_CONFIG;
    }

    const parsed = storeConfigSchema.safeParse(record.value);

    return parsed.success ? parsed.data : DEFAULT_STORE_CONFIG;
  } catch {
    return DEFAULT_STORE_CONFIG;
  }
}

/**
 * Superadmin write path. Throws on a rejected value, because the person editing
 * a delivery fee has to be told it was refused rather than left believing a
 * silently discarded number is live.
 */
export async function saveStoreConfig(input: unknown, actorId: string) {
  await connectToDatabase();

  const current = await getStoreConfig();
  const next = storeConfigSchema.parse({
    ...current,
    ...(typeof input === "object" && input !== null ? input : {}),
  });

  await PlatformSettingModel.findOneAndUpdate(
    { key: STORE_CONFIG_KEY },
    { $set: { key: STORE_CONFIG_KEY, updatedBy: actorId, value: next } },
    { new: true, upsert: true },
  );

  return { config: next };
}
