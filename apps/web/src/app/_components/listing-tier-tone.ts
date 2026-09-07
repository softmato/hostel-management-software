import type { ListingTierTone } from "./plans-catalog";

/**
 * The two metals, written out as whole class strings rather than assembled from
 * a colour name — Tailwind reads these files literally, and a class built at
 * runtime is a class that is never generated.
 *
 * Gold is amber and platinum is a cool grey with a lift on it, so the pair read
 * as two different metals at card size rather than as two warm yellows. This is
 * the one accent on these pages that is not the brand teal, and it is a badge a
 * plan earns rather than a decoration — which is also why it lives in a file of
 * its own: the plan cards and the badge's own page must paint it identically.
 */
export const TIER_TONE: Record<
  ListingTierTone,
  { badge: string; check: string; label: string; ring: string }
> = {
  gold: {
    badge:
      "border border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
    check: "text-amber-600 dark:text-amber-400",
    label: "text-amber-700 dark:text-amber-300",
    ring: "border-amber-500/40 bg-amber-500/5",
  },
  platinum: {
    badge:
      "border border-slate-400/50 bg-slate-400/20 text-slate-700 dark:text-slate-200",
    check: "text-slate-500 dark:text-slate-300",
    label: "text-slate-700 dark:text-slate-200",
    ring: "border-slate-400/50 bg-slate-400/10",
  },
};
