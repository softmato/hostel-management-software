/**
 * The deck of trades on the raise-a-request sheet, and what each one costs.
 *
 * Pure so it can be tested node-side — the carousel that draws these is
 * `components/service-carousel.tsx`, and everything here is the data behind it.
 *
 * ## The charge is a hostel's own agreement, never a platform figure
 *
 * `minimumCharges` comes from `HostelSettings.maintenance` and is edited by the
 * owner. A trade the hostel has not priced has **no** charge — not zero — and
 * every function here keeps that distinction, because `NPR 0` on the confirm
 * step is the app telling a warden the electrician works for nothing.
 */

import { humanizeEnum } from "@/lib/format";

/**
 * What this hostel has agreed a call-out of `category` costs, or `null`.
 *
 * `null` and `0` are different answers and callers must render them
 * differently — see the note at the top of the file.
 */
export function minimumChargeFor(
  charges: { amount: number; category: string }[],
  category: string | null,
): number | null {
  if (!category) {
    return null;
  }

  const match = charges.find((charge) => charge.category === category);

  return match ? match.amount : null;
}

/**
 * Which trades match what somebody typed into the search field.
 *
 * Matches the trade's own display name — `Room repair`, not `ROOM_REPAIR` —
 * because that is the string on the card being searched. An empty query returns
 * everything rather than nothing: the deck is the default state of the sheet,
 * and a search box that empties it when cleared is a search box that has eaten
 * the screen.
 */
export function searchServices(
  categories: readonly string[],
  query: string,
): string[] {
  const needle = query.trim().toLowerCase();

  if (!needle) {
    return [...categories];
  }

  return categories.filter((category) =>
    humanizeEnum(category).toLowerCase().includes(needle),
  );
}

/**
 * The sentence under a trade's name on its card.
 *
 * Three states, and the middle one is the one worth having: a hostel that has
 * agreed the plumber comes for at least 800 rupees, a hostel that has agreed
 * nothing, and a trade whose agreed figure is genuinely zero — which is a real
 * thing when a hostel employs its own handyman and wants the card to say so.
 */
export function chargeNote(amount: number | null): string {
  if (amount === null) {
    return "No agreed call-out charge";
  }

  return amount === 0 ? "No call-out charge" : `From NPR ${amount.toLocaleString("en-US")}`;
}

/**
 * The title a request goes out under.
 *
 * ## Why this is not just the typed sentence any more
 *
 * Since the raise sheet defaults to a recording, a perfectly valid request can
 * carry no typed words at all — and `title` is required by the server, is what
 * the queue lists, and is the line a provider reads in their job list. A blank
 * one would be refused at the API and, if it were not, would render as an empty
 * row nobody could scan.
 *
 * So a spoken-only request is titled after the trade: `Plumbing job`. It is
 * deliberately plain rather than clever — the detail is in the recording, and a
 * title inventing detail it does not have would be worse than a dull one.
 *
 * The typed sentence always wins when there is one, trimmed to its first line
 * the way `titleFromProblem` has always done.
 */
export function titleForRequest(problem: string, category: string | null): string {
  const typed = problem.trim().split("\n")[0]?.trim() ?? "";

  if (typed.length >= 2) {
    return typed.length > 180 ? `${typed.slice(0, 177)}...` : typed;
  }

  return `${humanizeEnum(category ?? "OTHER")} job`;
}
