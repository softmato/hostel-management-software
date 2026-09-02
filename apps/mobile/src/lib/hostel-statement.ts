/**
 * The hostel statement — every rupee that has actually arrived, newest first.
 *
 * Pure and free of the axios client, same rule as `lib/admin-money.ts`: Vitest
 * here runs node-side with no React Native shim, so the part worth testing is
 * kept out of the screen. `app/manage/finance/statement.tsx` is a renderer over
 * these functions.
 *
 * ## Credits only, and that is the product decision
 *
 * The wallet apps our users already read — see
 * `ui_inspiration_folder/app_recordings/NOTES.md` — put debits and credits in
 * one list and sign them by colour. A hostel's statement is not that list. A
 * hostel does not *spend* through this product, so a debit column would be a
 * column of nothing; what an owner opens this screen for is "what has come in,
 * from whom, and when". So an entry earns a row here when `paidAmount > 0` and
 * for no other reason, every amount is a credit, and the direction marker is
 * green in every row rather than being a thing to read.
 *
 * An invoice that is merely *raised* is therefore absent. That is deliberate and
 * it is the difference between this screen and the Money tab: Money answers "who
 * still owes", this answers "what was received". Neither is a filter over the
 * other.
 *
 * ## One invoice is one credit, not one payment
 *
 * The ledger route serves invoices, so a resident who paid a month in two
 * instalments appears once, at the paid amount, dated by the **last**
 * settlement. That is what the server records — `paidDate` is a single field on
 * the invoice — and inventing two rows out of one would be inventing data. The
 * detail sheet says `NPR 3,000 of NPR 5,000` in that case rather than implying
 * the month is closed.
 *
 * ## Every function that spells a date takes the calendar
 *
 * This is an **admin** surface, and the hostel portal has a calendar preference
 * (`uiSlice.calendarPreference`, reached through `hooks/use-dates.ts`). These
 * functions used to call `formatDate` / `formatPeriod` from `lib/format.ts`
 * directly, so with the preference on Nepali the statement screen printed the
 * same month twice in two calendars — `Bhadra 2083` in the detail sheet, from
 * `dates.period`, and `September 2026` in the row title above it, from here.
 *
 * So `calendar` is a required argument rather than one defaulting to `"AD"`: a
 * default is exactly how a new call site keeps printing Gregorian while every
 * row around it has moved. The two deliberate exceptions are the day heading,
 * which shows **both** calendars because a date over money is the one place the
 * standing rule says to double them, and the search haystack, which indexes
 * both so the search box finds a row either way.
 */

import type { AdminLedger, AdminLedgerEntry } from "@/lib/admin-api";
import {
  type CalendarSystem,
  formatDateIn,
  formatPeriodIn,
} from "@/lib/calendar";
import {
  formatAmount,
  formatDateBoth,
  formatMoney,
  formatPeriod,
  formatPeriodBs,
  formatWeekday,
  humanizeEnum,
  nepalDayKey,
  nepalPeriodKey,
} from "@/lib/format";
import { endOfDayIso, startOfDayIso, toDayInput } from "@/lib/manage-dates";

/**
 * The word for a settlement whose provider the server could not name.
 *
 * `HostelLedgerEntry.paymentMethod` comes out of a provider lookup that has no
 * fallback, so a cash-book entry recorded before the provider vocabulary
 * existed — or any settlement whose provider is simply absent — arrives as
 * `undefined`. Rendering that as a blank cell reads as a bug; rendering it as
 * `Cash` would be a guess about money. `OTHER` is the honest third answer, and
 * it is a real member of `PAYMENT_METHODS` rather than a word invented here.
 */
export const UNKNOWN_METHOD = "OTHER";

/** One credit on the statement. */
export type StatementCredit = {
  /** What arrived. Always `> 0` — that is what makes it a credit. */
  amount: number;
  /** What the invoice asked for. Larger than `amount` on a part payment. */
  billed: number;
  dueDate: string | null;
  /** The invoice id. Unique per row, because one invoice is one row. */
  id: string;
  method: string;
  /** `2026-08`, or `null` for a one-off — an admission fee, a fine. */
  period: string | null;
  /** ISO, or `null` when the server recorded neither a paid nor a raised date. */
  receivedAt: string | null;
  remarks: string;
  residentId: string;
  residentName: string;
  /**
   * Everything this hostel had taken up to and including this row.
   *
   * The `BALANCE` line the reference frames put under every transaction, which
   * on a wallet is the balance *after* it. A hostel has no wallet, so the
   * honest analogue is the cumulative total — the figure an owner would get by
   * adding the column up from the bottom.
   *
   * `null` when the ledger came back truncated: the rows before the cap are
   * missing, so every total computed from these ones is short by an unknown
   * amount. A running total that is quietly wrong is worse than none, and the
   * screen says which it is rather than printing a number nobody can reconcile.
   */
  runningTotal: number | null;
  status: string;
};

/**
 * Every credit in the ledger, newest first, with the running total attached.
 *
 * The sort is on `receivedAt` and the running total is accumulated the other
 * way — oldest first — so the two are computed in one pass rather than by
 * reversing an array twice.
 *
 * Undated credits sort to the end and carry the total as it stood before them,
 * because there is no position in a chronological sum for a row with no date.
 */
export function statementCredits(ledger: AdminLedger | null | undefined): StatementCredit[] {
  const entries = ledger?.entries ?? [];
  const credits = entries
    .filter((entry) => entry.paidAmount > 0)
    .map(toCredit)
    .sort(byNewestFirst);

  if (ledger?.truncated) {
    return credits;
  }

  let total = 0;

  // Oldest first, so each row's total includes itself and everything under it.
  for (let index = credits.length - 1; index >= 0; index -= 1) {
    total += credits[index].amount;
    credits[index].runningTotal = total;
  }

  return credits;
}

function toCredit(entry: AdminLedgerEntry): StatementCredit {
  return {
    amount: entry.paidAmount,
    billed: entry.dueAmount,
    dueDate: entry.dueDate ?? null,
    id: entry.id,
    method: (entry.paymentMethod ?? entry.method ?? UNKNOWN_METHOD).trim() || UNKNOWN_METHOD,
    period: entry.month,
    /*
     * `paidDate` is when the money landed and `createdAt` is when the invoice
     * was raised, which are not the same fact — but a credit with no paid date
     * is still money that arrived, and the day it was billed is the only
     * timestamp the server has for it. Better a row in roughly the right week
     * than a row the statement cannot place at all.
     */
    receivedAt: entry.paidDate ?? entry.createdAt ?? null,
    remarks: entry.remarks?.trim() ?? "",
    residentId: entry.residentId,
    residentName: entry.residentName.trim(),
    runningTotal: null,
    status: entry.status,
  };
}

function timeOf(credit: StatementCredit): number {
  if (!credit.receivedAt) {
    return Number.NEGATIVE_INFINITY;
  }

  const millis = new Date(credit.receivedAt).getTime();

  return Number.isNaN(millis) ? Number.NEGATIVE_INFINITY : millis;
}

/**
 * Newest first, ties broken on the id.
 *
 * The tiebreak is not cosmetic. A billing run settles a dozen invoices inside
 * the same second, and without it the list reshuffles on every refresh — the
 * row somebody was reaching for moves under their thumb. Same reasoning as the
 * name tiebreak in `outstandingRows`.
 */
function byNewestFirst(left: StatementCredit, right: StatementCredit): number {
  return timeOf(right) - timeOf(left) || left.id.localeCompare(right.id);
}

/* -------------------------------------------------------------------------- */
/* Filtering                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What the filter sheet holds. Every field is a string, and `""` means "all".
 *
 * Strings rather than a union per field because two of the four are populated
 * from the data — see {@link methodOptions} — so the set of legal values is not
 * known until the ledger has loaded.
 */
export type StatementFilter = {
  /** `YYYY-MM-DD`, inclusive. */
  from: string;
  method: string;
  /**
   * Hide anything under this many rupees. `""` for no floor.
   *
   * A string because it is typed, and a half-typed number is a state the filter
   * has to survive: `"5"` on the way to `"5000"` must not blank the list and
   * then repopulate it. Anything that is not a number is treated as no floor —
   * see {@link filterCredits} — rather than as zero, which would look identical
   * and mean something different the moment somebody typed a stray character.
   */
  minAmount: string;
  /** Free text over the row, as one string. */
  query: string;
  status: string;
  /** `YYYY-MM-DD`, inclusive — the whole day, not midnight. */
  to: string;
};

export const NO_FILTER: StatementFilter = {
  from: "",
  method: "",
  minAmount: "",
  query: "",
  status: "",
  to: "",
};

/** The typed floor as a number, or `null` when there isn't a usable one. */
function amountFloor(value: string): number | null {
  const parsed = Number(value.trim());

  return value.trim() !== "" && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The quick ranges above the list — the reference's `7 days / 14 days / 30 days`.
 *
 * A separate control from the sheet and not a duplicate of it: these write into
 * the same `from`/`to` the sheet edits, which is why tapping `30 days` and then
 * opening the sheet shows the dates it chose rather than two filters disagreeing
 * about the same range.
 */
export const QUICK_RANGES = [7, 14, 30] as const;

/** `{ from, to }` for the last `days` days, ending today in Kathmandu. */
export function quickRange(days: number, now: Date = new Date()): { from: string; to: string } {
  return {
    // `days - 1`, so "7 days" is a week including today rather than eight days.
    from: toDayInput(new Date(now.getTime() - (days - 1) * 86_400_000)),
    to: toDayInput(now),
  };
}

/**
 * Which quick range a filter currently *is*, or `null` for anything else.
 *
 * Derived rather than stored, so the chip cannot drift out of step with the
 * dates: editing `from` by hand in the sheet un-highlights the chip on its own,
 * with nothing to remember to clear.
 */
export function activeQuickRange(
  filter: StatementFilter,
  now: Date = new Date(),
): number | null {
  return (
    QUICK_RANGES.find((days) => {
      const range = quickRange(days, now);

      return filter.from === range.from && filter.to === range.to;
    }) ?? null
  );
}

/**
 * How many filters are on, for the dot on the filter button.
 *
 * A date range counts once however many of its two ends are set — an owner who
 * picked "last 7 days" applied *one* filter, and a badge reading `2` for it
 * teaches people the number means nothing.
 */
export function activeFilterCount(filter: StatementFilter): number {
  return (
    Number(filter.method !== "") +
    Number(filter.status !== "") +
    Number(filter.query.trim() !== "") +
    Number(amountFloor(filter.minAmount) !== null) +
    Number(filter.from !== "" || filter.to !== "")
  );
}

/**
 * Everything a row can be searched by, as one lowercase string.
 *
 * One haystack rather than a field-by-field test, same as `searchInvoices`: an
 * owner typing "kartik esewa" is describing one row, not composing a query, and
 * a per-field match would find nothing for them.
 */
function haystack(credit: StatementCredit): string {
  return [
    credit.residentName,
    humanizeEnum(credit.method),
    credit.remarks,
    // **Both** month spellings, always, whatever the calendar preference says.
    // The row is *displayed* in one calendar; it is *searched* in either, so an
    // owner who reads Nepali dates and types "bhadra" finds the same row as one
    // who types "september". Indexing only the displayed spelling would make the
    // search box quietly change what it can find when the setting is flipped.
    credit.period ? formatPeriod(credit.period) : "one-off",
    credit.period ? formatPeriodBs(credit.period) : "",
    humanizeEnum(credit.status),
    formatAmount(credit.amount),
  ]
    .join(" ")
    .toLowerCase();
}

/** The credits a filter admits, in the order they came in. */
export function filterCredits(
  credits: readonly StatementCredit[],
  filter: StatementFilter,
): StatementCredit[] {
  const query = filter.query.trim().toLowerCase();
  const floor = amountFloor(filter.minAmount);
  const from = filter.from ? startOfDayIso(filter.from) : null;
  const to = filter.to ? endOfDayIso(filter.to) : null;

  return credits.filter((credit) => {
    if (filter.method && credit.method !== filter.method) {
      return false;
    }

    if (filter.status && credit.status !== filter.status) {
      return false;
    }

    if (floor !== null && credit.amount < floor) {
      return false;
    }

    if (query && !haystack(credit).includes(query)) {
      return false;
    }

    /*
     * An undated credit is excluded by any date filter rather than kept.
     * "Between these two days" is a claim about when something happened, and a
     * row that cannot answer it does not belong in the answer — keeping it
     * would put a row with no date inside a range the reader chose.
     */
    if ((from || to) && !credit.receivedAt) {
      return false;
    }

    if (from && credit.receivedAt && credit.receivedAt < from) {
      return false;
    }

    return !(to && credit.receivedAt && credit.receivedAt > to);
  });
}

/* -------------------------------------------------------------------------- */
/* Filter options                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The method chips, taken from the data rather than from the enum.
 *
 * `PAYMENT_METHODS` has six members and a hostel that only ever takes cash
 * would get five chips that filter to nothing — a control whose options are
 * mostly dead teaches people not to open it. So the sheet offers what this
 * hostel has actually been paid through, in a stable order.
 *
 * Alphabetical on the humanised word, so the list does not reorder itself when
 * a new method first appears.
 */
export function methodOptions(credits: readonly StatementCredit[]): string[] {
  return [...new Set(credits.map((credit) => credit.method))].sort((left, right) =>
    humanizeEnum(left).localeCompare(humanizeEnum(right)),
  );
}

/** The status chips, on the same argument as {@link methodOptions}. */
export function statusOptions(credits: readonly StatementCredit[]): string[] {
  return [...new Set(credits.map((credit) => credit.status))].sort((left, right) =>
    humanizeEnum(left).localeCompare(humanizeEnum(right)),
  );
}

/* -------------------------------------------------------------------------- */
/* Grouping                                                                   */
/* -------------------------------------------------------------------------- */

/** One day's credits, with the heading that sits **outside** the card. */
export type StatementDay = {
  credits: StatementCredit[];
  key: string;
  label: string;
  /** What the hostel took that day. */
  total: number;
};

/** The heading for a day with no date behind it. */
const UNDATED_KEY = "undated";

/**
 * The day heading — `Sun · 8 Bhadra 2083 · 24 Aug 2026`.
 *
 * Three parts, and each is there for a reason:
 *
 * - the **weekday**, because that is how the reference frames head their groups
 *   and how people remember a payment ("that Friday");
 * - **both calendars**, because this is a date where money happened and the
 *   standing rule for those is BS beside AD — the hostel's books run on one and
 *   the bank's statement runs on the other. See `formatDateBoth`.
 *
 * No `Today` / `Yesterday`. It reads well on the top group and turns the heading
 * into a different *kind* of label from the ones under it, which is exactly what
 * a column of headings must not do — and the row already carries the clock time.
 */
function dayLabel(iso: string): string {
  const weekday = formatWeekday(iso);
  const date = formatDateBoth(iso);

  return weekday === "—" ? date : `${weekday.slice(0, 3)} · ${date}`;
}

/**
 * Credits grouped by the Kathmandu day they landed on, in the order given.
 *
 * The input is already sorted, so this preserves that order rather than sorting
 * again — a group's position is its newest member's position. Undated credits
 * collect into one trailing group instead of being dropped: they are money that
 * arrived, and a statement that silently omits a row does not add up.
 */
export function groupByDay(credits: readonly StatementCredit[]): StatementDay[] {
  const days: StatementDay[] = [];
  const byKey = new Map<string, StatementDay>();

  for (const credit of credits) {
    const date = credit.receivedAt ? new Date(credit.receivedAt) : null;
    const dated = date && !Number.isNaN(date.getTime());
    const key = dated ? nepalDayKey(date) : UNDATED_KEY;

    let day = byKey.get(key);

    if (!day) {
      day = {
        credits: [],
        key,
        label: dated ? dayLabel(credit.receivedAt as string) : "Date not recorded",
        total: 0,
      };
      byKey.set(key, day);
      days.push(day);
    }

    day.credits.push(credit);
    day.total += credit.amount;
  }

  return days;
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                    */
/* -------------------------------------------------------------------------- */

export type StatementSummary = {
  /** How many credits are in scope. */
  count: number;
  /** `August 2026` — the month {@link StatementSummary.total} covers. */
  periodLabel: string;
  /** What this hostel took that month. */
  total: number;
};

/**
 * The strip under the bar: what has come in **this month**, and how much of it.
 *
 * The month rather than the visible list on purpose. The list is whatever the
 * filters left behind, and a headline that moves when a filter is tapped is a
 * headline nobody can quote; "NPR 84,500 received in August" is a fact about the
 * hostel that stays true while the reader searches around underneath it.
 *
 * The month is decided in **Nepal** time (`nepalPeriodKey`), not the device's,
 * for the same reason invoice periods are — a phone left on UTC would call the
 * first two hours of the month the previous one, on the busiest rent day there
 * is.
 *
 * It counts by the day the money **landed**, not by the period the invoice is
 * for: an August payment against July's rent is August's collection, which is
 * the figure the owner is going to compare against their own cash box.
 */
export function statementSummary(
  credits: readonly StatementCredit[],
  calendar: CalendarSystem,
  now: Date = new Date(),
): StatementSummary {
  const period = nepalPeriodKey(now);
  const thisMonth = credits.filter(
    (credit) =>
      credit.receivedAt && nepalPeriodKey(new Date(credit.receivedAt)) === period,
  );

  return {
    count: thisMonth.length,
    periodLabel: formatPeriodIn(calendar, period),
    total: thisMonth.reduce((sum, credit) => sum + credit.amount, 0),
  };
}

/** What a filtered list adds up to — the line under the search field. */
export function visibleTotal(credits: readonly StatementCredit[]): number {
  return credits.reduce((sum, credit) => sum + credit.amount, 0);
}

/**
 * What a row is called — `Rent from Kartik Adhikari`.
 *
 * The period leads because it is what distinguishes two rows for the same
 * resident, and a one-off says so rather than borrowing a month it does not
 * have: an admission fee carries `period: null`, and every month-keyed reader
 * that assumed otherwise has broken on the first resident a hostel takes.
 *
 * An unnamed resident is "a resident", not an empty string — `residentName` is
 * `""` when the record could not be resolved, and a title that starts with a
 * space reads as a rendering fault rather than as missing data.
 */
export function creditTitle(
  credit: StatementCredit,
  calendar: CalendarSystem,
): string {
  const what = credit.period
    ? `${formatPeriodIn(calendar, credit.period)} rent`
    : "One-off charge";

  return `${what} from ${credit.residentName || "a resident"}`;
}

/** Whether the invoice this credit sits on is still short. */
export function isPartial(credit: StatementCredit): boolean {
  return credit.amount < credit.billed;
}

/**
 * The range a filter describes, in words — `20 Aug 2026 to 26 Aug 2026`.
 *
 * Both open ends are named rather than left blank: "up to 26 Aug 2026" is a
 * range and "26 Aug 2026" on its own is a day, and a reader handed the second
 * when the first was meant will reconcile the wrong week.
 */
export function rangeLabel(
  filter: StatementFilter,
  calendar: CalendarSystem,
): string {
  const from = filter.from ? formatDateIn(calendar, startOfDayIso(filter.from)) : "";
  const to = filter.to ? formatDateIn(calendar, endOfDayIso(filter.to)) : "";

  if (from && to) {
    return from === to ? from : `${from} to ${to}`;
  }

  if (from) {
    return `${from} onwards`;
  }

  return to ? `Up to ${to}` : "All time";
}

/**
 * What the share button sends.
 *
 * Pure and free of `react-native`'s `Share`, the same split `lib/hostel-share.ts`
 * takes and for the same reason: Vitest here cannot load that module, and the
 * part worth testing is the words.
 *
 * It describes **what is on screen**, filters included, because that is what the
 * person tapping share is looking at. Sending the lifetime total from a screen
 * filtered to one week would be answering a question nobody asked, and the
 * recipient has no way to tell which they were sent — so the range is stated on
 * its own line rather than implied.
 *
 * No resident names and no invoice ids. This lands in a WhatsApp thread, and a
 * summary is the one shape of this data that carries nothing personal; anyone
 * entitled to the detail can open the screen.
 */
export function statementShareText({
  calendar,
  credits,
  filter,
  hostelName,
}: {
  /*
   * The sender's calendar, so the shared text reads the way the screen they
   * shared it from did. A statement pasted into a thread in the other calendar
   * from the one the owner was looking at is a range nobody can check.
   */
  calendar: CalendarSystem;
  credits: readonly StatementCredit[];
  filter: StatementFilter;
  /** Blank when the caller is a warden scoped to more than one hostel. */
  hostelName: string;
}): string {
  const count = credits.length;

  return [
    hostelName ? `${hostelName} — statement` : "Hostel statement",
    rangeLabel(filter, calendar),
    `${count} ${count === 1 ? "payment" : "payments"} · ${formatMoney(visibleTotal(credits))} received`,
  ].join("\n");
}
