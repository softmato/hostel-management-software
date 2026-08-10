import { z } from "zod";

/**
 * The per-provider gateway setup form (target §11.8, plan item 6.1).
 *
 * Separate from `payment-profile.validation.ts` and deliberately so: a signing
 * secret must not travel through the same general-purpose PATCH that writes
 * display text and bank account numbers. That endpoint is broad, its payload is
 * logged like any other, and widening it to carry a secret makes every future
 * field added to it a decision about secrets.
 *
 * The secret is **write-only** in both directions. There is no field to read it
 * back and no code path that returns one — see `describeSecret`.
 */

export const GATEWAY_PROVIDERS = ["ESEWA", "FONEPAY", "KHALTI"] as const;

export const gatewayConfigSaveSchema = z.object({
  /**
   * Whether this is a registered merchant account or a personal wallet.
   *
   * A personal account is accepted and stored — an owner who has only one
   * should be able to record it — but it can never be enabled for online
   * payment. The service explains why rather than the form hiding the option,
   * because the owner needs to know what to ask their bank for.
   */
  accountKind: z.enum(["MERCHANT", "PERSONAL"]).default("MERCHANT"),
  /** Whether residents should be offered this provider. */
  enabled: z.boolean().optional(),
  /** eSewa's product code, Fonepay's merchant code. Khalti leaves it empty. */
  merchantCode: z.string().trim().max(64).optional(),
  mode: z.enum(["LIVE", "SANDBOX"]).default("SANDBOX"),
  provider: z.enum(GATEWAY_PROVIDERS),
  /**
   * The signing secret. Omitted means "leave whatever is stored alone", which is
   * what the form sends when the owner edits a merchant code without retyping a
   * key they cannot see. An empty string is rejected rather than treated as a
   * deletion — deleting a key is `DELETE`, and a blank field is far more often a
   * form that failed to populate.
   */
  secret: z.string().min(1).max(512).optional(),
  /** Only where the provider issues a second key for callbacks. */
  webhookSecret: z.string().min(1).max(512).optional(),
});

export type GatewayConfigSaveInput = z.infer<typeof gatewayConfigSaveSchema>;
