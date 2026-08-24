/**
 * The arithmetic behind the admin Home screen.
 *
 * Pure and free of the axios client, same rule as `lib/admin-alerts.ts` and
 * `lib/admin-money.ts`: Vitest runs node-side here with no React Native shim, so
 * anything that reaches `lib/api` is untestable by construction. The screen is a
 * renderer over these functions.
 *
 * Type-only imports of `admin-api` are fine — they are erased before the module
 * is ever loaded.
 */

import type { AdminHostel, AdminPeriodRow, AdminReport } from "@/lib/admin-api";
import { humanizeEnum } from "@/lib/format";

/* -------------------------------------------------------------------------- */
/* Money                                                                      */
/* -------------------------------------------------------------------------- */

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * `2026-08` → `Aug`. The x-axis label on the earnings bars.
 *
 * Deliberately **not** Bikram Sambat, unlike the invoice due dates in
 * `format.ts`. A due date is a deadline somebody has to act on, so it is worth
 * two calendars; this is a six-bar trend where the label's whole job is to tell
 * one bar from its neighbour, and `Bhadra` / `Bhadau` transliterations disagree
 * across sources in a way that would make the axis argue with itself. The
 * period string the server returns is Gregorian either way.
 *
 * Returns the raw input for anything that is not `YYYY-MM` rather than throwing
 * or rendering `undefined` — a malformed period is a bad label, not a crash.
 */
export function monthShortLabel(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period.trim());

  if (!match) {
    return period;
  }

  const month = Number(match[2]);

  return MONTH_NAMES[month - 1] ?? period;
}

/**
 * How much of what was billed has actually come in, as a percentage.
 *
 * `null` when nothing was billed, and that is the point: a month with no
 * invoices is not "0% collected", it is a month where the question does not
 * apply. Rendering the zero would put a red empty meter on the screen of a
 * hostel that has simply not run its billing yet, which is a different problem
 * with a different fix.
 *
 * Capped at 100 — a resident settling two months in one transfer pushes
 * `collected` past `due`, and a meter that overflows its track reads as a
 * rendering bug rather than as good news.
 */
export function collectionRate(collected: number, due: number): number | null {
  if (!Number.isFinite(collected) || !Number.isFinite(due) || due <= 0) {
    return null;
  }

  return Math.min(100, Math.round((collected / due) * 100));
}

/**
 * The hero headline's font size, stepped down by how long the string is.
 *
 * The headline is one line by construction — a rupee figure that wraps is not a
 * figure any more, it is two — so something has to give when the number is long,
 * and the choice is between shrinking the text and ellipsing it. Ellipsing a
 * *total* is the worst possible truncation: `NPR 12,84,…` is not a smaller
 * version of the number, it is a different number.
 *
 * ## Why not `adjustsFontSizeToFit`
 *
 * React Native only implements it on iOS. On Android the prop is accepted and
 * ignored, which is the failure mode that gets shipped — it looks right on the
 * simulator the developer has open and clips on every phone in Nepal.
 *
 * So the size comes from the character count instead. Approximate by design: the
 * steps are wide enough that being a character or two out cannot push a string
 * past the edge, and the arithmetic holds for the only alphabet this string is
 * ever in (`NPR`, digits, commas, a possible minus).
 */
export function heroAmountSize(amount: string): number {
  const length = amount.length;

  if (length <= 14) {
    return 34;
  }

  if (length <= 17) {
    return 29;
  }

  if (length <= 20) {
    return 24;
  }

  return 20;
}

export type TrendBar = {
  collected: number;
  due: number;
  /** Height as a fraction of the tallest bar in the window, `0`–`1`. */
  fill: number;
  /** `Aug`. */
  label: string;
  /** The rightmost bar — drawn in the accent so "now" is findable at a glance. */
  latest: boolean;
  period: string;
};

/**
 * The last `count` months, **oldest first**, sized against each other.
 *
 * The server returns `months` newest-first (it feeds a dropdown); a chart reads
 * left to right in time, so this reverses. Both orderings are defensible and
 * that is exactly why it is done here once, with a test, rather than by whoever
 * writes the next chart.
 *
 * ## `fill` is relative, not absolute
 *
 * Each bar is measured against the tallest bar *in the window*, so the shape of
 * six months is legible whether the hostel collects thirty thousand a month or
 * three hundred thousand. Against a fixed ceiling every bar on a small hostel
 * would be a sliver.
 *
 * A window where nothing was collected gives every bar `0` rather than `NaN`
 * from a divide by zero — the chart draws its empty track and the caption
 * underneath says the real thing.
 */
export function earningsTrend(
  months: readonly AdminPeriodRow[],
  count = 6,
): TrendBar[] {
  const window = months.slice(0, Math.max(0, count)).reverse();
  const peak = Math.max(0, ...window.map((row) => row.collected));

  return window.map((row, index) => ({
    collected: row.collected,
    due: row.due,
    fill: peak > 0 ? Math.max(0, row.collected) / peak : 0,
    label: monthShortLabel(row.period),
    latest: index === window.length - 1,
    period: row.period,
  }));
}

export type MonthDelta = {
  direction: "down" | "flat" | "up";
  /** Ready to render: `Up 12% on Jul`. */
  label: string;
  /** Always positive — the sign is in `direction`. */
  percent: number;
};

/**
 * This month against last month, as a percentage.
 *
 * The single most useful thing that can be said about a collections figure, and
 * the reason the trend bars exist at all — this is the same comparison stated in
 * words for the one pair of months anybody asks about.
 *
 * ## Null is common and is not a failure
 *
 * Three cases return it, and each would otherwise produce a confident lie:
 *
 * - **No previous month.** A hostel in its first month has nothing to compare
 *   against; "up 100%" would be arithmetic on an absence.
 * - **Last month collected nothing.** A rise from zero has no percentage — every
 *   formula returns infinity — and "up ∞%" is not a thing to put on a dashboard.
 * - **This month is still running.** Not detectable here, and deliberately not
 *   guessed at: the caller knows whether `months[0]` is the current month, and
 *   the screen says "so far" rather than pretending the month is closed.
 *
 * Rounded to whole percent. Half a percent of movement in rent collection is
 * noise, and a figure with a decimal in it invites someone to read it as precise.
 */
export function monthOverMonth(months: readonly AdminPeriodRow[]): MonthDelta | null {
  const current = months[0];
  const previous = months[1];

  if (!current || !previous || previous.collected <= 0) {
    return null;
  }

  const change = Math.round(
    ((current.collected - previous.collected) / previous.collected) * 100,
  );
  const against = monthShortLabel(previous.period);

  if (change === 0) {
    return { direction: "flat", label: `Level with ${against}`, percent: 0 };
  }

  return {
    direction: change > 0 ? "up" : "down",
    label: `${change > 0 ? "Up" : "Down"} ${Math.abs(change)}% on ${against}`,
    percent: Math.abs(change),
  };
}

/**
 * `42 residents · 6 beds free · 88% full` — the hero's quiet line of context.
 *
 * Three frosted tiles carried these on the hero, and the account card this is
 * modelled on has no tiles: it prints the account holder's name as one plain
 * line under the balance and stops. This is what goes in that slot — the same
 * three numbers, in the register of a caption rather than of a figure, because
 * none of them is a thing to act on and all three were competing with the
 * amount above them for the same glance.
 *
 * ## Occupancy drops out rather than reading zero
 *
 * `null` means the hostel has never configured its rooms, and an owner with
 * forty residents reading `0% full` stops believing the rest of the screen —
 * the same rule the tiles held with a dash, kept here by omitting the segment.
 * The dash cannot come along: a run of `· — ·` in a sentence reads as a
 * rendering fault, where a missing clause reads as nothing to say.
 */
export function occupancyLine(input: {
  occupancy: number | null;
  residents: number;
  vacantBeds: number;
}): string {
  const parts = [
    `${input.residents} ${input.residents === 1 ? "resident" : "residents"}`,
    `${input.vacantBeds} ${input.vacantBeds === 1 ? "bed" : "beds"} free`,
  ];

  if (input.occupancy !== null) {
    parts.push(`${input.occupancy}% full`);
  }

  return parts.join(" · ");
}

export type EarningsSummary = {
  /** Everything ever collected, or `null` when the periods read was refused. */
  lifetime: number | null;
  /** This month, from the period roll-up when available and the report if not. */
  thisMonth: number;
  thisMonthBilled: number;
  /** Lifetime outstanding when known; this month's shortfall otherwise. */
  outstanding: number;
  /** True when `outstanding` covers every month rather than only this one. */
  outstandingIsLifetime: boolean;
};

/**
 * The three money figures the hero shows, from whichever source answered.
 *
 * ## Why there are two sources at all
 *
 * `viewPayments` is a per-warden grant. A warden without it gets a 403 from the
 * periods route while the dashboard report — a different capability — still
 * answers, so the hero has to degrade rather than blank: it loses the lifetime
 * figure (which it says, by showing a dash) and keeps the month, which is the
 * number on the screen either way.
 *
 * ## The month comes from the roll-up when both are present
 *
 * They are computed from the same invoices but not by the same code, and the
 * report's `paidAmount` is scoped to the current calendar month while the
 * roll-up keys on the invoice's own `period`. A hostel that bills September in
 * August has those two disagree, and showing the lifetime total next to a
 * month figure derived somewhere else is how a screen ends up not adding up.
 * One source wins, and it is the one the lifetime total came from.
 */
export function earningsSummary(input: {
  months: readonly AdminPeriodRow[] | null;
  overall: { collected: number; outstanding: number } | null;
  report: Pick<AdminReport, "monthlyDues" | "paidAmount">;
}): EarningsSummary {
  const current = input.months?.[0] ?? null;

  if (!input.overall) {
    return {
      lifetime: null,
      outstanding: Math.max(0, input.report.monthlyDues - input.report.paidAmount),
      outstandingIsLifetime: false,
      thisMonth: input.report.paidAmount,
      thisMonthBilled: input.report.monthlyDues,
    };
  }

  return {
    lifetime: input.overall.collected,
    outstanding: input.overall.outstanding,
    outstandingIsLifetime: true,
    thisMonth: current?.collected ?? input.report.paidAmount,
    thisMonthBilled: current?.due ?? input.report.monthlyDues,
  };
}

/* -------------------------------------------------------------------------- */
/* The hostel                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The building's own photograph, for the hero.
 *
 * Exterior first, then anything: the point of the picture is that an owner with
 * two hostels recognises which workspace this is, and a shot of a bunk bed does
 * that job less well than a shot of the front of the building. Unlike the public
 * serializer the admin one does not pre-sort `photos`, so the preference is
 * applied here.
 *
 * Returns the stored, still-relative URL — `absoluteMediaUrl` is the caller's
 * job, because only the caller knows the API origin.
 */
export function heroPhotoUrl(hostel: Pick<AdminHostel, "photos"> | null): string | null {
  const photos = hostel?.photos ?? [];

  const chosen =
    photos.find((photo) => photo.kind === "EXTERIOR" && photo.url?.trim()) ??
    photos.find((photo) => photo.url?.trim());

  return chosen?.url?.trim() || null;
}

/**
 * The hostel's ID as something a person can read out — `HH-6F2A9C41`.
 *
 * The account card in `ebl-01` prints the account number directly under the
 * account name, and it is not decoration: it is what you quote when you ring the
 * bank. A hostel has the same need — every support conversation, every invoice
 * query and every "which of your two buildings" starts with identifying the
 * hostel — and until now the only way to answer was to read a URL.
 *
 * There is **no registration-number field** on `Hostel`, so this is derived
 * rather than stored: the last eight characters of the record's own id, which
 * for a Mongo ObjectId is hex and is the part that actually varies (the leading
 * bytes are a timestamp and a machine id, so a whole hostel's worth of records
 * share them). Uppercased because this is read aloud and copied by hand, and
 * prefixed so it is recognisable as ours rather than as a stray hex string.
 *
 * Stable for the life of the hostel, and unique in practice at any size this
 * product will reach. If a real registration number is ever added to the schema
 * it should replace this and keep the same slot on the card.
 */
export function hostelCode(hostel: { id?: string } | null | undefined): string | null {
  const id = hostel?.id?.trim();

  if (!id) {
    return null;
  }

  return `HH-${id.slice(-8).toUpperCase()}`;
}

/** `Ghattekulo, Kathmandu`, or `null` when the listing has no location set. */
export function hostelAreaLabel(
  location: { area?: string; city?: string } | null | undefined,
): string | null {
  const parts = [location?.area, location?.city]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  return [...new Set(parts)].join(", ") || null;
}

/**
 * Whether the public listing is live, and what to say about it if it is not.
 *
 * Both flags matter and they fail differently: `DRAFT` is the owner's own doing
 * and they fix it in the portal, whereas `PENDING` verification is on the
 * platform and no amount of editing moves it. A single "not live" badge would
 * send half of them to a screen that cannot help.
 */
export function listingState(hostel: AdminHostel | null): {
  live: boolean;
  note: string;
} {
  if (!hostel) {
    return { live: false, note: "No single listing" };
  }

  if (hostel.verificationStatus !== "VERIFIED") {
    return { live: false, note: "Awaiting verification" };
  }

  if (hostel.status !== "PUBLISHED") {
    return { live: false, note: "Not published yet" };
  }

  return { live: true, note: "Live on the site" };
}

/* -------------------------------------------------------------------------- */
/* Tonight                                                                    */
/* -------------------------------------------------------------------------- */

export type NightChip = {
  count: number;
  key: string;
  label: string;
  tone: "danger" | "neutral" | "success" | "warning";
};

const NIGHT_LABELS: Record<string, string> = {
  INSIDE_HOSTEL: "Inside",
  MARKED_SAFE: "Marked safe",
  NOT_VERIFIED: "Not verified",
  OUTSIDE_HOSTEL: "Outside",
  SOS_TRIGGERED: "SOS",
};

const NIGHT_TONES: Record<string, NightChip["tone"]> = {
  INSIDE_HOSTEL: "success",
  MARKED_SAFE: "success",
  NOT_VERIFIED: "neutral",
  OUTSIDE_HOSTEL: "warning",
  SOS_TRIGGERED: "danger",
};

/**
 * Tonight's roster as chips, worst first.
 *
 * ## Zeroes are dropped, but `SOS_TRIGGERED` is why the order matters
 *
 * A roster where everyone is accounted for should be a single green chip, not
 * five chips four of which say nothing — so empty statuses are filtered out.
 * What survives is sorted by *how much it needs a person*, not alphabetically
 * and not by count: one resident who triggered an SOS outranks thirty-nine who
 * are safely inside, and a count-ordered list buries it at the end.
 *
 * An unrecognised status is humanised rather than dropped — the server owns
 * this enum and a new member should show up as an odd label, not vanish. It
 * goes through `humanizeEnum` so it comes out in the same sentence case as the
 * mapped ones; the chip cannot fix that with a `capitalize` class, which would
 * turn "Not verified" into "Not Verified" on the four labels that are already
 * right.
 */
export function nightChips(summary: Record<string, number> | null | undefined): NightChip[] {
  const order: NightChip["tone"][] = ["danger", "warning", "neutral", "success"];

  return Object.entries(summary ?? {})
    .filter(([, count]) => typeof count === "number" && count > 0)
    .map(([key, count]) => ({
      count,
      key,
      label: NIGHT_LABELS[key] ?? humanizeEnum(key),
      tone: NIGHT_TONES[key] ?? "neutral",
    }))
    .sort(
      (left, right) =>
        order.indexOf(left.tone) - order.indexOf(right.tone) ||
        right.count - left.count ||
        left.key.localeCompare(right.key),
    );
}
