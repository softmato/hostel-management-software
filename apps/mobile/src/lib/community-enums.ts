/**
 * Community enums, in a module that touches nothing.
 *
 * `lib/community-api.ts` imports the axios client and therefore React Native, so
 * nothing in it can be loaded by the node-side Vitest here — and `lib/community.ts`
 * needs these as *values*, not types. Keeping them in their own leaf module is the
 * same arrangement `resident-api.ts` has with `lib/food-week.ts`.
 *
 * Mirrors `REACTION_TYPES` in `apps/web/src/modules/community/community.validation.ts`.
 */

export const REACTION_TYPES = [
  "LIKE",
  "LOVE",
  "LAUGH",
  "SAD",
  "ANGRY",
  "SUPPORT",
] as const;

export type ReactionType = (typeof REACTION_TYPES)[number];
