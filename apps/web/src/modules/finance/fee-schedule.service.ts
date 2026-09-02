import { Types } from "mongoose";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { auditFinanceAction } from "@/modules/finance/audit-finance";
import { normalizeBedType } from "@/modules/finance/bed-type";
import { FinanceServiceError } from "@/modules/finance/finance.errors";
import { assertWholeRupees, prorate } from "@/modules/finance/money";
import { FeeScheduleModel } from "@hostel/db/models/FeeSchedule";
import type { BedType } from "@hostel/shared/types/bed-type";
import type {
  FeeScheduleCloseInput,
  FeeScheduleCreateInput,
} from "@/modules/finance/fee-schedule.validation";

/**
 * The rate card: what a resident is charged, and for how much of the month
 * (target §3.3–§3.5).
 *
 * This module answers one question — "how much does this resident owe for this
 * period?" — and answers it in exactly one way. The current system asks it in
 * three places that disagree (current §5.1 A1/A2/A3), which is why the same
 * resident can be billed differently depending on which screen an admin opened
 * first.
 */

export type FeeScheduleRate = {
  bedType: BedType;
  currency?: string;
  monthlyAmount: number;
};

export type FeeScheduleRecord = {
  _id: Types.ObjectId;
  admissionFee?: number;
  depositAmount?: number;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  hostelId: Types.ObjectId;
  rates: FeeScheduleRate[];
  /** Comes off `admissionFee` for a referred resident. Never off the rent. */
  referralAdmissionDiscount?: number;
};

/** The subset of a resident this module needs. */
export type BillableResident = {
  _id: Types.ObjectId;
  bedType?: BedType | null;
  monthlyFee?: number | null;
  moveInDate?: Date | null;
  moveOutDate?: Date | null;
  roomType?: string | null;
};

/**
 * Where the number on a rent line came from.
 *
 * `MANUAL` is the hostel's **listed** price for that room type — the figure the
 * owner typed into their room configuration when they signed up. It is the same
 * word `raiseAdmissionInvoice` already uses for a fee that fell back to the
 * listing: no rate card stands behind the line, and the invoice must not claim
 * one does by carrying a `feeScheduleId` it does not have.
 */
export type ChargeBasis = "OVERRIDE" | "SCHEDULE" | "MANUAL";

export type ResolvedCharge = {
  amount: number;
  basis: ChargeBasis;
  bedType: BedType | null;
  feeScheduleId: Types.ObjectId | null;
};

/**
 * The rents an owner typed into their own room configuration, keyed by the room
 * type string the resident record carries.
 *
 * Keyed on the literal `roomType`, deliberately, and **not** on a bed type. A
 * hostel whose only room type is the string `"Shared"` has no bed type at all —
 * `normalizeBedType` cannot say how many people share one — and §7.3 is right
 * that guessing a bed type is not allowed. But it does not follow that the rent
 * is unknown: the owner stated it against that exact string, and matching the
 * string is not a guess about anything.
 *
 * Zero and missing are the same thing here, matching `quoteIntake`: a room
 * configuration with no rent on it has not been priced, and billing somebody
 * nothing is the failure mode this whole module exists to prevent.
 */
export type ListedRoomRates = ReadonlyMap<string, number>;

export function listedRoomRates(
  roomConfigurations:
    | { monthlyRent?: number | null; roomType?: string | null }[]
    | null
    | undefined,
): ListedRoomRates {
  const rates = new Map<string, number>();

  for (const room of roomConfigurations ?? []) {
    if (room?.roomType && typeof room.monthlyRent === "number" && room.monthlyRent > 0) {
      rates.set(room.roomType, room.monthlyRent);
    }
  }

  return rates;
}

/** UTC bounds so a billing run gives the same answer wherever it executes. */
export function periodBounds(period: string) {
  const [year, month] = period.split("-").map(Number);

  if (!year || !month || month < 1 || month > 12) {
    throw new FinanceServiceError(
      `Period must be YYYY-MM, received ${period}.`,
      "FEE_SCHEDULE_MISSING",
    );
  }

  return {
    daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
    end: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
    start: new Date(Date.UTC(year, month - 1, 1)),
  };
}

/**
 * The schedule in force during `period`.
 *
 * A schedule covers the period if it began on or before the period ends and had
 * not closed before the period began — so a schedule that starts mid-month
 * governs that whole month. Splitting a month across two rate cards is a
 * product decision nobody has asked for, and would make an invoice's single
 * `feeScheduleId` a lie.
 */
export async function getEffectiveSchedule(
  hostelId: Types.ObjectId | string,
  period: string,
): Promise<FeeScheduleRecord | null> {
  const { end, start } = periodBounds(period);

  return FeeScheduleModel.findOne({
    effectiveFrom: { $lte: end },
    hostelId,
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: start } }],
  })
    .sort({ effectiveFrom: -1 })
    .lean<FeeScheduleRecord | null>();
}

/**
 * The resident's bed type for pricing.
 *
 * `Resident.bedType` is authoritative when set, but it is a new nullable field
 * that nothing backfills (item 1.1), so this falls back to normalising
 * `roomType` — which is the free text the hostel actually maintains. Null means
 * unmappable, and the caller must fail rather than pick a rate.
 */
export function resolveBedType(resident: BillableResident): BedType | null {
  return resident.bedType ?? normalizeBedType(resident.roomType);
}

/**
 * What this resident is charged per month (target §3.4).
 *
 * **Never returns zero as a fallback.** The current implementation's
 * `resident.monthlyFee || input.defaultAmount || 0` chain (current §5.1 A2)
 * means a misconfigured resident is billed nothing and nobody finds out until
 * someone asks in November. Both failure modes here are errors carrying the
 * resident's id, so the billing run reports them per resident and the owner sees
 * "3 residents could not be billed".
 */
export function resolveMonthlyCharge(
  resident: BillableResident,
  schedule: FeeScheduleRecord | null,
  listed: ListedRoomRates = new Map(),
): ResolvedCharge {
  // A per-resident override wins outright, and does not need a schedule: this
  // covers the long-staying resident on an old rate and the negotiated discount
  // (target §3.3). Zero is a legitimate override — a staff member's child — so
  // this tests for null, not for falsiness. That distinction is the whole bug.
  if (resident.monthlyFee !== null && resident.monthlyFee !== undefined) {
    return {
      amount: assertWholeRupees(resident.monthlyFee, "monthly fee override"),
      basis: "OVERRIDE",
      bedType: resolveBedType(resident),
      feeScheduleId: null,
    };
  }

  const bedType = resolveBedType(resident);
  const rate =
    schedule && bedType
      ? schedule.rates.find((entry) => entry.bedType === bedType)
      : undefined;

  if (rate) {
    return {
      amount: assertWholeRupees(rate.monthlyAmount, "scheduled rate"),
      basis: "SCHEDULE",
      bedType,
      feeScheduleId: schedule?._id ?? null,
    };
  }

  /*
   * The room's own listed rent, and only after the rate card has been asked.
   *
   * This is the same fallback `quoteIntake` already applies, in the same order
   * and for the same stated reason — and the two disagreeing is what this
   * closes. The intake screen quoted the listed price at the door, priced the
   * move-in month from it and printed the figure the warden read out; then the
   * billing run refused the resident because no `FeeSchedule` existed, and the
   * Money tab said **Not billed** with no amount and no reason, for ever.
   * Nothing chased it, because nothing was owed. A hostel that has never opened
   * the rate-card screen — which is most of them on the day they start — could
   * not bill a single resident.
   *
   * The line records `MANUAL` and carries no `feeScheduleId`, so an invoice
   * priced this way is distinguishable from one the rate card produced. That
   * distinction is the honest half: the amount is real and the resident owes it,
   * but no schedule stands behind it, and the owner is still better off writing
   * a rate card.
   */
  const listedRent = resident.roomType ? listed.get(resident.roomType) : undefined;

  if (listedRent !== undefined) {
    return {
      amount: assertWholeRupees(listedRent, "listed room rate"),
      basis: "MANUAL",
      bedType,
      feeScheduleId: null,
    };
  }

  if (!schedule) {
    throw new FinanceServiceError(
      "No fee schedule covers this period, and this room type has no listed rent.",
      "FEE_SCHEDULE_MISSING",
    );
  }

  if (!bedType) {
    throw new FinanceServiceError(
      `Room type ${JSON.stringify(resident.roomType ?? null)} does not map to a bed type, and has no listed rent.`,
      "BED_TYPE_NOT_PRICED",
    );
  }

  throw new FinanceServiceError(
    `The fee schedule has no rate for ${bedType}.`,
    "BED_TYPE_NOT_PRICED",
  );
}

export type InvoiceAmount = {
  amount: number;
  billableDays: number;
  prorationBasis: string | null;
};

/**
 * The one proration rule (target §3.5).
 *
 * Days are counted inclusively in UTC. Note this prorates **move-out** as well,
 * which the current system does not do at all — a resident leaving on the 8th is
 * currently charged the whole month.
 *
 * `prorationBasis` is the human explanation carried onto the invoice line, so a
 * resident asking "why is this less than usual?" is answered by the invoice
 * rather than by the hostel owner.
 */
export function computeInvoiceAmount(
  monthlyCharge: number,
  moveInDate: Date | null | undefined,
  moveOutDate: Date | null | undefined,
  period: string,
): InvoiceAmount {
  assertWholeRupees(monthlyCharge, "monthly charge");

  const { daysInMonth, end, start } = periodBounds(period);

  if (moveInDate && moveInDate > end) {
    return { amount: 0, billableDays: 0, prorationBasis: "not yet resident" };
  }

  if (moveOutDate && moveOutDate < start) {
    return { amount: 0, billableDays: 0, prorationBasis: "already moved out" };
  }

  const billableStart = moveInDate && moveInDate > start ? moveInDate : start;
  const billableEnd = moveOutDate && moveOutDate < end ? moveOutDate : end;

  if (billableEnd < billableStart) {
    return { amount: 0, billableDays: 0, prorationBasis: "no billable days" };
  }

  const billableDays = countDaysInclusive(billableStart, billableEnd);
  const amount = prorate(monthlyCharge, billableDays, daysInMonth);

  if (billableDays >= daysInMonth) {
    return { amount, billableDays, prorationBasis: null };
  }

  return {
    amount,
    billableDays,
    prorationBasis: `${billableDays}/${daysInMonth} days`,
  };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Calendar days from `from` to `to`, both included. */
function countDaysInclusive(from: Date, to: Date) {
  const startDay = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const endDay = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());

  return Math.floor((endDay - startDay) / MS_PER_DAY) + 1;
}

/* -------------------------------------------------------------------------- */
/*                                    CRUD                                    */
/* -------------------------------------------------------------------------- */

export async function listFeeSchedules(hostelId: Types.ObjectId | string) {
  await connectToDatabase();

  return FeeScheduleModel.find({ hostelId })
    .sort({ effectiveFrom: -1 })
    .lean<FeeScheduleRecord[]>();
}

export async function getOpenFeeSchedule(hostelId: Types.ObjectId | string) {
  await connectToDatabase();

  return FeeScheduleModel.findOne({
    effectiveTo: null,
    hostelId,
  }).lean<FeeScheduleRecord | null>();
}

/**
 * Opens a new schedule, closing the current one the day before it starts.
 *
 * Never an edit (target §3.3): the previous rates stay readable, so a historical
 * invoice can be explained rather than merely trusted. The close-then-open order
 * matters — the partial unique index permits only one open row per hostel, so
 * opening first would be rejected by the database.
 */
export async function createFeeSchedule(
  hostelId: Types.ObjectId | string,
  input: FeeScheduleCreateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const current = await FeeScheduleModel.findOne({
    effectiveTo: null,
    hostelId,
  }).lean<FeeScheduleRecord | null>();

  if (current) {
    if (input.effectiveFrom <= current.effectiveFrom) {
      throw new FinanceServiceError(
        "A new schedule must start after the current one.",
        "FEE_SCHEDULE_MISSING",
      );
    }

    await FeeScheduleModel.updateOne(
      { _id: current._id },
      { $set: { effectiveTo: dayBefore(input.effectiveFrom) } },
    );
  }

  const created = (await FeeScheduleModel.create({
    admissionFee: input.admissionFee,
    createdBy: principal.userId,
    depositAmount: input.depositAmount,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: null,
    hostelId,
    rates: input.rates,
    referralAdmissionDiscount: input.referralAdmissionDiscount,
  })) as unknown as FeeScheduleRecord;

  // A rate card is what every future invoice is computed from, so a change to
  // it is a finance action even though no money moves today.
  await auditFinanceAction(principal, {
    action: "FEE_SCHEDULE_CREATED",
    amountAfter: totalOfRates(input.rates),
    amountBefore: current ? totalOfRates(current.rates) : 0,
    entityId: created._id,
    entityType: "FeeSchedule",
    hostelId,
    source: "FEE_SCHEDULE_EDITOR",
  });

  return created;
}

export async function closeFeeSchedule(
  hostelId: Types.ObjectId | string,
  scheduleId: string,
  input: FeeScheduleCloseInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const schedule = await FeeScheduleModel.findOne({
    _id: scheduleId,
    hostelId,
  }).lean<FeeScheduleRecord | null>();

  if (!schedule) {
    throw new FinanceServiceError("Fee schedule was not found.", "FEE_SCHEDULE_MISSING");
  }

  if (input.effectiveTo < schedule.effectiveFrom) {
    throw new FinanceServiceError(
      "A schedule cannot close before it starts.",
      "FEE_SCHEDULE_MISSING",
    );
  }

  await FeeScheduleModel.updateOne(
    { _id: schedule._id },
    { $set: { effectiveTo: input.effectiveTo } },
  );

  await auditFinanceAction(principal, {
    action: "FEE_SCHEDULE_CLOSED",
    amountAfter: 0,
    amountBefore: totalOfRates(schedule.rates),
    entityId: schedule._id,
    entityType: "FeeSchedule",
    hostelId,
    source: "FEE_SCHEDULE_EDITOR",
  });

  return { ...schedule, effectiveTo: input.effectiveTo };
}

/**
 * Sum of the rate card. Not a price anyone pays — it is the auditable "what
 * changed" figure for a rate-card edit, which `auditFinanceAction` requires.
 */
function totalOfRates(rates: FeeScheduleRate[]) {
  return rates.reduce((total, rate) => total + rate.monthlyAmount, 0);
}

function dayBefore(date: Date) {
  return new Date(date.getTime() - MS_PER_DAY);
}
