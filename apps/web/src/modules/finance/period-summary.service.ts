import { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { listRecentInvoices } from "@/modules/finance/ledger-read.service";
import { countableResidentIds } from "@/modules/finance/resident-scope";
import { HostelModel } from "@hostel/db/models/Hostel";
import { HostelVerificationModel } from "@hostel/db/models/HostelVerification";
import { PaymentEventModel } from "@hostel/db/models/PaymentEvent";

/**
 * Everything the payments screen needs that is *not* about one month.
 *
 * The screen used to know only the month it was showing, which made three things
 * impossible: totals that mean "this hostel" rather than "this filter", a month
 * picker that can say which months still need attention, and a floor stopping
 * the picker walking back into 1970.
 *
 * **One call, because they are one question.** Fetching a per-month roll-up, a
 * lifetime total and an earliest date separately would be three round trips over
 * the same rows, and they would disagree the moment a payment settled between
 * two of them.
 *
 * Read-only, like every other read on this screen: it never creates an invoice.
 */

/** Invoices are read in one page; a hostel bills ~40 residents a month. */
const MAX_INVOICES = 5000;

export type PeriodRow = {
  collected: number;
  due: number;
  /**
   * Invoices that still want a human: unpaid, overdue, or carrying a claim
   * nobody has reviewed. This is the number in the month picker's badge — the
   * whole reason to open a past month is that something in it is unfinished.
   */
  needsAttention: number;
  paid: number;
  period: string;
  total: number;
};

export type PeriodSummary = {
  /**
   * The first month the picker may reach — the month the hostel was approved.
   * Nothing financial can predate the hostel being allowed to take money.
   */
  earliestPeriod: string;
  months: PeriodRow[];
  /** Lifetime figures for this hostel, not for the selected month. */
  overall: {
    collected: number;
    due: number;
    outstanding: number;
    overdueResidents: number;
    paid: number;
    partial: number;
    pendingProofs: number;
    unpaid: number;
  };
};

function periodOf(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * When this hostel was approved to operate.
 *
 * There is no `approvedAt` on the hostel itself — approval writes
 * `HostelVerification.verifiedAt` — so that is the source, with `createdAt` as
 * the fallback for hostels approved before verification records existed.
 * `createdAt` is a safe floor either way: a hostel cannot have billed anyone
 * before it existed.
 */
async function approvalPeriod(hostelId: Types.ObjectId | string): Promise<string> {
  const [verification, hostel] = await Promise.all([
    HostelVerificationModel.findOne({ hostelId })
      .select("verifiedAt")
      .lean<{ verifiedAt?: Date } | null>(),
    HostelModel.findOne({ _id: hostelId })
      .select("createdAt")
      .lean<{ createdAt?: Date } | null>(),
  ]);

  const approved = verification?.verifiedAt ?? hostel?.createdAt;

  return approved ? periodOf(approved) : periodOf(new Date());
}

/**
 * Every month from `start` to `end` inclusive, newest first.
 *
 * Capped at 120. A hostel record with a bad `createdAt` would otherwise build a
 * dropdown with six hundred entries in it.
 */
function monthsBetween(start: string, end: string): string[] {
  const [startYear, startMonth] = start.split("-").map(Number);
  const periods: string[] = [];
  const cursor = new Date(Date.UTC(startYear!, startMonth! - 1, 1));

  while (periods.length < 120) {
    const period = periodOf(cursor);

    periods.push(period);

    if (period >= end) {
      break;
    }

    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return periods.reverse();
}

export async function getPeriodSummary(
  hostelId: Types.ObjectId | string,
): Promise<PeriodSummary> {
  await connectToDatabase();

  // Scoped to countable residents, not to the hostel alone. Without this the
  // badge counted a soft-deleted resident's open invoice while the table below
  // it — which filters properly — showed one row: the same August reading "1
  // resident" and "2 needing attention" on the same screen.
  const residentIds = await countableResidentIds(hostelId);

  const [earliestApproved, invoices, pendingProofs] = await Promise.all([
    approvalPeriod(hostelId),
    listRecentInvoices({ hostelId, residentIds }, MAX_INVOICES),
    PaymentEventModel.countDocuments({
      hostelId,
      residentId: { $in: residentIds },
      source: "RESIDENT_CLAIM",
      status: "PENDING",
    }),
  ]);

  // **A month with invoices is always reachable**, at both ends. A hostel whose
  // verification was recorded late would otherwise have real unpaid invoices
  // sitting behind a floor the picker will not cross; and rent billed ahead of
  // time — a hostel that issues September's invoices in August, which is
  // ordinary — would sit past a ceiling pinned to today. Either way the money
  // exists and the owner has no way to reach it.
  const periodsBilled = invoices.map((invoice) => invoice.period).sort();
  const earliestBilled = periodsBilled.at(0) ?? null;
  const latestBilled = periodsBilled.at(-1) ?? null;
  const current = periodOf(new Date());

  const earliestPeriod =
    earliestBilled && earliestBilled < earliestApproved
      ? earliestBilled
      : earliestApproved;
  const latestPeriod = latestBilled && latestBilled > current ? latestBilled : current;

  const byPeriod = new Map<string, PeriodRow>();

  for (const period of monthsBetween(earliestPeriod, latestPeriod)) {
    byPeriod.set(period, {
      collected: 0,
      due: 0,
      needsAttention: 0,
      paid: 0,
      period,
      total: 0,
    });
  }

  const overdueResidents = new Set<string>();
  const overall = {
    collected: 0,
    due: 0,
    outstanding: 0,
    overdueResidents: 0,
    paid: 0,
    partial: 0,
    pendingProofs,
    unpaid: 0,
  };

  for (const invoice of invoices) {
    const row = byPeriod.get(invoice.period) ?? {
      collected: 0,
      due: 0,
      needsAttention: 0,
      paid: 0,
      period: invoice.period,
      total: 0,
    };

    const unfinished = ["UNPAID", "OVERDUE", "PENDING_PROOF", "PARTIAL"].includes(
      invoice.status,
    );

    row.collected += invoice.paidAmount;
    row.due += invoice.dueAmount;
    row.total += 1;
    row.paid += invoice.status === "PAID" ? 1 : 0;
    row.needsAttention += unfinished ? 1 : 0;
    byPeriod.set(invoice.period, row);

    overall.collected += invoice.paidAmount;
    overall.due += invoice.dueAmount;
    overall.outstanding += Math.max(invoice.dueAmount - invoice.paidAmount, 0);
    overall.paid += invoice.status === "PAID" ? 1 : 0;
    overall.partial += invoice.status === "PARTIAL" ? 1 : 0;
    overall.unpaid +=
      invoice.status === "UNPAID" || invoice.status === "PENDING_PROOF" ? 1 : 0;

    if (invoice.status === "OVERDUE") {
      // Counted as *residents*, not invoices: three unpaid months is one person
      // to call, and the card says "Overdue Residents".
      overdueResidents.add(invoice.residentId);
    }
  }

  overall.overdueResidents = overdueResidents.size;

  return {
    earliestPeriod,
    months: [...byPeriod.values()].sort((left, right) =>
      right.period.localeCompare(left.period),
    ),
    overall,
  };
}
