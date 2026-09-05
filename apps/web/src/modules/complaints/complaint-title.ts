/**
 * The one-line name a complaint is listed under, when nobody typed one.
 *
 * ## Why a complaint has a title at all when the form no longer asks for one
 *
 * The admin queue, the SLA breach alert, the push notification and the
 * resident's own list are all one line per complaint, and one line has to say
 * something. Dropping the field from the phone did not remove that need — it
 * moved the job here, where it can be done from what the resident actually
 * gave us instead of by making them invent a headline for their own problem.
 *
 * ## What it derives from, in order
 *
 * 1. **A title somebody typed.** The web form still has the field, so anything
 *    it sends wins outright.
 * 2. **The first line of the description.** The way people write a complaint is
 *    to lead with the fault — "Tap in 204 has not stopped running since
 *    Tuesday" — so the first line is the headline they would have written.
 * 3. **The category, plus whether it was spoken.** "Food complaint" is thin,
 *    but a voice-only complaint has no text at all and an empty title in the
 *    queue is worse than a coarse one. "Food — voice note" also tells the admin
 *    there is something to press play on before they open it.
 *
 * Pure and tested rather than inline in the service, because every one of those
 * three branches is a row somebody reads in four places.
 */

const TITLE_MAX = 160;

const CATEGORY_LABELS: Record<string, string> = {
  FOOD: "Food",
  MAINTENANCE: "Maintenance",
  NOISE: "Noise",
  OTHER: "Other",
  PAYMENT: "Payment",
  ROOM: "Room",
  SAFETY: "Safety",
  STAFF: "Staff",
};

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? "Other";
}

/** Truncates on a whole word where it can, so a title never ends mid-syllable. */
function clamp(value: string): string {
  if (value.length <= TITLE_MAX) {
    return value;
  }

  const cut = value.slice(0, TITLE_MAX - 1);
  const lastSpace = cut.lastIndexOf(" ");

  return `${(lastSpace > TITLE_MAX / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function complaintTitle(input: {
  category: string;
  description?: string;
  hasVoiceNote?: boolean;
  title?: string;
}): string {
  const typed = input.title?.trim() ?? "";

  if (typed.length >= 2) {
    return clamp(typed);
  }

  const firstLine = (input.description ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length >= 2);

  if (firstLine) {
    return clamp(firstLine);
  }

  return input.hasVoiceNote
    ? `${categoryLabel(input.category)} — voice note`
    : `${categoryLabel(input.category)} complaint`;
}
