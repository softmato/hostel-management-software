import { Types } from "mongoose";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { formatBsPeriod, hostelPeriodOf } from "@/lib/hostel-day";
import { FinanceServiceError } from "@/modules/finance/finance.errors";
import {
  applyConcessionToIssuedInvoices,
  type ConcessionBackfill,
} from "@/modules/finance/rent-concession-backfill";
import { RentConcessionModel } from "@hostel/db/models/RentConcession";

/**
 * A month at reduced rent — the festival discount (Dashain at half fee).
 *
 * The rate card stays exactly as it is; this sits on top of it for one Bikram
 * Sambat month. See {@link RentConcessionModel} for why it is not a second rate
 * card, and `resolveMonthlyCharge` for the one place the percentage is applied.
 *
 * ## A month already billed is corrected, not refused
 *
 * `cron/billing-cycle` issues a month's invoices on its first day and a hostel
 * rarely decides Dashain a month ahead, so the common case is a discount arriving
 * after the bills. Saving one therefore walks that month's issued invoices and
 * adds a negative line to each — see {@link applyConcessionToIssuedInvoices} for
 * why a line rather than an edit, and what happens to money already paid.
 *
 * Set *before* the month's run, there is nothing to walk and the run prices
 * everybody at the reduced rent directly. Both paths end at the same number; only
 * the shape of the invoice differs, and the second one keeps a record of the
 * correction that the first has no need for.
 */

export type RentConcessionRecord = {
  _id: Types.ObjectId;
  percentOff: number;
  period: string;
  reason?: string;
};

export type RentConcessionRow = {
  _id: string;
  /** "Aswin 2083" — the month as an owner reads it. */
  label: string;
  percentOff: number;
  period: string;
  reason: string | null;
  /** `past` months are already billed; `current` is this month; `upcoming` later. */
  standing: "current" | "past" | "upcoming";
};

export async function listRentConcessions(
  hostelId: Types.ObjectId | string,
): Promise<RentConcessionRow[]> {
  await connectToDatabase();

  const rows = await RentConcessionModel.find({ hostelId })
    .sort({ period: -1 })
    .lean<RentConcessionRecord[]>();

  const now = hostelPeriodOf(new Date());

  return rows.map((row) => ({
    _id: row._id.toString(),
    label: formatBsPeriod(row.period) || row.period,
    percentOff: row.percentOff,
    period: row.period,
    reason: row.reason || null,
    standing:
      row.period === now ? "current" : row.period < now ? "past" : "upcoming",
  }));
}

/**
 * The percentage off for one month, or 0.
 *
 * Returns a plain number rather than the row, because that is all the pricing
 * path may be trusted with: a caller holding the document could reach for
 * `reason` to decide something, and the reason is words for a resident, not a
 * rule. One read per billing run, not one per resident.
 */
export async function getRentConcession(
  hostelId: Types.ObjectId | string,
  period: string,
): Promise<{ percentOff: number; reason: string | null }> {
  await connectToDatabase();

  const row = await RentConcessionModel.findOne({ hostelId, period })
    .select("percentOff reason")
    .lean<{ percentOff: number; reason?: string } | null>();

  return { percentOff: row?.percentOff ?? 0, reason: row?.reason || null };
}

/**
 * Sets (or replaces) the discount for one month, and corrects any bills already
 * issued for it.
 *
 * An upsert rather than create-plus-edit: there is one discount per month by
 * index, and "50% in Dashain, no — make it 40%" is a correction to one fact, not
 * a second fact. The backfill is keyed the same way, so the correction moves the
 * line on each invoice instead of stacking a second discount on it.
 *
 * The row is written **before** the invoices are touched. A crash between the two
 * leaves the discount recorded and some bills uncorrected, which the next save
 * fixes by re-running over all of them; the other order would leave money taken
 * off bills with nothing on record saying why.
 */
export async function saveRentConcession(
  hostelId: Types.ObjectId | string,
  input: { percentOff: number; period: string; reason?: string },
  principal?: ApiPrincipal,
): Promise<RentConcessionRow & { applied: ConcessionBackfill }> {
  await connectToDatabase();

  const reason = input.reason?.trim();

  await RentConcessionModel.updateOne(
    { hostelId, period: input.period },
    {
      $set: { percentOff: input.percentOff, ...(reason ? { reason } : {}) },
      $setOnInsert: { createdBy: principal?.userId, hostelId, period: input.period },
      /*
       * `$unset` rather than setting `undefined`. Mongoose strips undefined out
       * of an update, so a save that cleared the box would have left the old word
       * on the row — and "Dashain" printed on a bill the owner has since decided
       * is not a Dashain discount is the one thing a reason must not do.
       */
      ...(reason ? {} : { $unset: { reason: "" } }),
    },
    { runValidators: true, upsert: true },
  );

  const rows = await listRentConcessions(hostelId);
  const saved = rows.find((row) => row.period === input.period);

  if (!saved) {
    throw new FinanceServiceError(
      "The discount could not be saved.",
      "RENT_CONCESSION_NOT_FOUND",
    );
  }

  const applied = await applyConcessionToIssuedInvoices({
    hostelId,
    percentOff: input.percentOff,
    period: input.period,
    principal,
    reason: reason ?? null,
  });

  return { ...saved, applied };
}

/**
 * Removes a month's discount and puts the unpaid bills for it back to full rent.
 *
 * "Unpaid" is the whole qualification, and it is the rule the backfill enforces:
 * an invoice with money settled against it keeps its discount, because a resident
 * who has already part-paid a bill they were told was halved cannot be sent a
 * larger one, and because the credit that discount generated may already have
 * been spent on the following month. `invoicesKept` counts those, so the screen
 * can say how many stayed rather than implying the month was fully reversed.
 */
export async function deleteRentConcession(
  hostelId: Types.ObjectId | string,
  id: string,
): Promise<{ deletedId: string; restored: ConcessionBackfill }> {
  await connectToDatabase();

  const deleted = await RentConcessionModel.findOneAndDelete({
    _id: id,
    hostelId,
  }).lean<RentConcessionRecord | null>();

  if (!deleted) {
    throw new FinanceServiceError("That discount was not found.", "RENT_CONCESSION_NOT_FOUND");
  }

  const restored = await applyConcessionToIssuedInvoices({
    hostelId,
    percentOff: 0,
    period: deleted.period,
    reason: null,
  });

  return { deletedId: deleted._id.toString(), restored };
}
