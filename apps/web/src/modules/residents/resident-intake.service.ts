import { Types } from "mongoose";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { normalizeBedType } from "@/modules/finance/bed-type";
import {
  computeInvoiceAmount,
  type FeeScheduleRecord,
  getEffectiveSchedule,
} from "@/modules/finance/fee-schedule.service";
import { allocateReferenceCode } from "@/modules/finance/reference-sequence.service";
import { isActiveReferralCode } from "@/modules/referrals/referral.service";
import { HostelModel } from "@hostel/db/models/Hostel";
import { InvoiceModel } from "@hostel/db/models/Invoice";
import type { BedType } from "@hostel/shared/types/bed-type";

/**
 * What a resident is quoted at the door, and the one-off invoice that follows.
 *
 * ## The price is not an input
 *
 * Registering somebody used to mean typing their rent into a box on the intake
 * form, prefilled from the room type and editable afterwards. That is the same
 * mistake `Resident.monthlyFee` documents at length: an unexplained number that
 * outranks the rate card forever, entered by whoever happened to be at the desk.
 * So the quote is computed **here**, from the schedule in force on the move-in
 * date, and the screens render it as a fact rather than a field. A negotiated
 * rate is still possible — it is a per-resident override, set deliberately on
 * the resident's own screen with a reason attached, which is exactly the ritual
 * that makes it explicable later.
 *
 * That also settles who may see it. The rate card itself is behind
 * `viewPayments`, which a warden does not have by default, and a warden who
 * cannot read the card is precisely the person who must not be asked to type a
 * rent. Quoting server-side lets `registerResidents` be the only capability the
 * intake screen needs.
 *
 * ## The referral discount comes off the admission fee, and nothing else
 *
 * A referral is a one-time thank-you for bringing somebody in. Discounting the
 * rent would make the referred resident permanently cheaper than the person in
 * the next bed, and would put a discount into the monthly billing run that
 * nothing there knows how to end. The admission fee is a single charge on a
 * single day, which is the shape a one-time reward actually has.
 *
 * ## The first month is not a whole month
 *
 * Somebody admitted on the 20th owes twenty-nine days of rent for that month and
 * a full month thereafter, and the person at the desk has to be able to say the
 * figure out loud before the resident signs anything. `firstMonth` is that
 * figure, computed by the **same** `computeInvoiceAmount` the billing run uses —
 * not a second implementation of the proration rule that agrees with it until
 * the day it does not. The quote and the invoice are therefore the same
 * arithmetic on the same rate card, which is the only way the number on the
 * screen and the number on the bill are guaranteed to match.
 *
 * It is `null` when there is no rent to prorate (`rentBasis: "UNPRICED"`), for
 * the same reason `monthlyRent` is: a confident zero is worse than an admitted
 * gap.
 *
 * ## Unpriced is a state, not a zero
 *
 * A hostel with no rate card covering the move-in date, or a room type that maps
 * to no bed type, gets `rentBasis: "UNPRICED"` and a null rent — never a
 * confident zero. The screen says the rent will be set by the rate card, and the
 * intake still goes through: the alternative is refusing to admit a paying
 * resident because finance has not been configured yet.
 */

export type RentBasis = "ROOM_CONFIGURATION" | "SCHEDULE" | "UNPRICED";

/**
 * What the move-in month costs, as distinct from what a month costs.
 *
 * `prorated` is the flag a screen branches on rather than comparing `amount`
 * against `monthlyRent` itself: they are equal for anybody moving in on the 1st,
 * and a first-month row that disappears on the 1st of the month is a row nobody
 * can explain.
 */
export type FirstMonthCharge = {
  /** Rupees owed for the move-in month — the whole rent when they arrive on the 1st. */
  amount: number;
  /** Days they are actually resident for, inclusive of the move-in day. */
  billableDays: number;
  /** Length of the move-in month, so the screen can say "12 of 31 days". */
  daysInMonth: number;
  /** `2026-08` — the period the invoice will carry. */
  period: string;
  /** False when they arrive on the 1st and owe the full month. */
  prorated: boolean;
};

export type IntakeQuote = {
  /** Before the referral discount. */
  admissionFee: number;
  /** What is actually collected at the door: fee less discount, never below 0. */
  admissionPayable: number;
  bedType: BedType | null;
  currency: string;
  depositAmount: number;
  /** The rate card this came from, for the invoice line to point at. */
  feeScheduleId: string | null;
  /** Null when there is no rent to prorate. See `FirstMonthCharge`. */
  firstMonth: FirstMonthCharge | null;
  /** Null when nothing prices this room type — see `rentBasis`. */
  monthlyRent: number | null;
  referral: {
    /** True only when a code was given *and* it is live in this hostel. */
    applied: boolean;
    code: string | null;
    discount: number;
    /** Why a code was not applied, for the field to say so under itself. */
    reason: string | null;
  };
  rentBasis: RentBasis;
  roomType: string;
};

export type QuoteInput = {
  moveInDate?: Date | null;
  referralCode?: string | null;
  roomType: string;
};

type RoomConfiguration = { monthlyRent?: number; roomType: string };

type HostelPricing = {
  pricing?: { admissionFee?: number; currency?: string };
  referencePrefix?: string;
  roomConfigurations?: RoomConfiguration[];
};

/** "YYYY-MM" for the month a move-in falls in, in UTC like every other period. */
export function periodOfDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * The whole quote as arithmetic, with every lookup already done.
 *
 * Split out so the rules are testable without a database — a discount larger
 * than the fee, a schedule that prices four bed types but not this one, a room
 * type nobody has costed. Each of those is a real intake somebody will do.
 */
export function quoteIntake(input: {
  hostel: HostelPricing | null;
  moveInDate?: Date | null;
  referralCode?: string | null;
  /** Whether the code above is live in this hostel. Resolved by the caller. */
  referralCodeActive: boolean;
  roomType: string;
  schedule: FeeScheduleRecord | null;
}): IntakeQuote {
  const bedType = normalizeBedType(input.roomType);
  const rate = bedType
    ? input.schedule?.rates.find((entry) => entry.bedType === bedType)
    : undefined;

  /*
   * The rate card first, the room's own `monthlyRent` only as a fallback. They
   * disagree often — `roomConfigurations` is the listing price the owner typed
   * when they signed up and rarely revisits, while the schedule is what billing
   * actually charges. Quoting the listing price at the door and then invoicing
   * the scheduled one is how a resident ends up arguing with their first bill.
   */
  const configured = input.hostel?.roomConfigurations?.find(
    (entry) => entry.roomType === input.roomType,
  );

  const { monthlyRent, rentBasis } = rate
    ? { monthlyRent: rate.monthlyAmount, rentBasis: "SCHEDULE" as const }
    : configured?.monthlyRent
      ? {
          monthlyRent: configured.monthlyRent,
          rentBasis: "ROOM_CONFIGURATION" as const,
        }
      : { monthlyRent: null, rentBasis: "UNPRICED" as const };

  const admissionFee =
    input.schedule?.admissionFee ?? input.hostel?.pricing?.admissionFee ?? 0;

  const code = input.referralCode?.trim().toUpperCase() || null;
  const offered = input.schedule?.referralAdmissionDiscount ?? 0;

  /*
   * Capped at the fee even though the validation refuses a larger discount when
   * the card is written. A card saved before that rule existed, or one whose
   * admission fee was later lowered without the discount following it, would
   * otherwise quote a negative amount payable — an invoice that owes the
   * resident money for moving in.
   */
  const discount = code && input.referralCodeActive ? Math.min(offered, admissionFee) : 0;

  return {
    admissionFee,
    admissionPayable: admissionFee - discount,
    bedType,
    currency: input.hostel?.pricing?.currency ?? "NPR",
    depositAmount: input.schedule?.depositAmount ?? 0,
    feeScheduleId: input.schedule?._id?.toString() ?? null,
    firstMonth: quoteFirstMonth(monthlyRent, input.moveInDate),
    monthlyRent,
    referral: {
      applied: discount > 0,
      code,
      discount,
      reason: referralReason({
        active: input.referralCodeActive,
        admissionFee,
        code,
        offered,
      }),
    },
    rentBasis,
    roomType: input.roomType,
  };
}

/**
 * The move-in month priced through the billing run's own rule.
 *
 * Deliberately thin: every judgement about what a partial month costs — how days
 * are counted, which end is inclusive, what rounding does — lives in
 * `computeInvoiceAmount` and is asserted by `fee-schedule.test.ts`. Repeating any
 * of it here would create a second answer to the same question, and the quote is
 * the half a resident reads before they agree to it.
 *
 * A move-in date in a **past** month is still priced against that month, not
 * against today: the invoice `createResident` raises carries that period, and a
 * quote describing a different month than the bill would be worse than no quote.
 */
function quoteFirstMonth(
  monthlyRent: number | null,
  moveInDate: Date | null | undefined,
): FirstMonthCharge | null {
  if (monthlyRent === null) {
    return null;
  }

  const start = moveInDate ?? new Date();
  const period = periodOfDate(start);

  try {
    const charge = computeInvoiceAmount(monthlyRent, start, null, period);

    return {
      amount: charge.amount,
      billableDays: charge.billableDays,
      // `prorationBasis` is `"12/31 days"` or null; the denominator is the one
      // number the screen needs that the charge does not carry on its own.
      daysInMonth: daysInPeriod(period),
      period,
      prorated: charge.prorationBasis !== null,
    };
  } catch {
    // `computeInvoiceAmount` refuses a rate that is not whole rupees. A rate card
    // that cannot be prorated must not take the whole quote down with it — the
    // rent, the deposit and the admission fee are all still true.
    return null;
  }
}

/** Days in a `YYYY-MM`, without reaching for the finance module's bounds type. */
function daysInPeriod(period: string) {
  const [year, month] = period.split("-").map(Number);

  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The sentence printed under the referral field.
 *
 * A code that is valid but earns nothing is the case worth naming: the hostel
 * has set no discount, the referrer is still credited, and a screen that said
 * nothing would read as though the code had failed.
 */
function referralReason(input: {
  active: boolean;
  admissionFee: number;
  code: string | null;
  offered: number;
}) {
  if (!input.code) {
    return null;
  }

  if (!input.active) {
    return "That code is not active in this hostel.";
  }

  if (input.admissionFee <= 0) {
    return "This hostel charges no admission fee, so there is nothing to discount. The referrer is still credited.";
  }

  if (input.offered <= 0) {
    return "This hostel offers no referral discount. The referrer is still credited.";
  }

  return null;
}

export async function getIntakeQuote(
  hostelId: Types.ObjectId | string,
  input: QuoteInput,
): Promise<IntakeQuote> {
  await connectToDatabase();

  const moveInDate = input.moveInDate ?? new Date();

  const [hostel, schedule, referralCodeActive] = await Promise.all([
    HostelModel.findById(hostelId)
      .select("pricing roomConfigurations")
      .lean<HostelPricing | null>(),
    getEffectiveSchedule(hostelId, periodOfDate(moveInDate)),
    input.referralCode?.trim()
      ? isActiveReferralCode(input.referralCode, new Types.ObjectId(hostelId.toString()))
      : Promise.resolve(false),
  ]);

  return quoteIntake({
    hostel,
    moveInDate,
    referralCode: input.referralCode,
    referralCodeActive,
    roomType: input.roomType,
    schedule: schedule ?? null,
  });
}

export type AdmissionInvoiceResult =
  | { raised: false; reason: string }
  | { amount: number; invoiceId: string; raised: true; referenceCode: string };

/**
 * The admission fee as an actual obligation on the resident's ledger.
 *
 * `period: null`, because an admission fee belongs to no month — the invoice's
 * unique double-billing index excludes null periods for exactly this shape of
 * one-off charge, and `receipt.service` already knows a receipt for one covers
 * no span.
 *
 * The discount is a **negative line, not a smaller fee**. Both numbers survive
 * on the invoice that way, so a resident asking why they paid less than the
 * advertised admission fee is answered by their own invoice rather than by
 * somebody's memory of a conversation at the desk.
 *
 * **Nothing here may fail the registration.** The resident exists, their bed is
 * spent and their referral is linked by the time this runs; throwing would leave
 * a registered resident behind an error message saying they were not registered.
 * A hostel with no reference prefix — the one real failure — gets a reason back
 * and the fee is collected the way it was before this existed.
 */
export async function raiseAdmissionInvoice(input: {
  dueDate: Date;
  hostelId: Types.ObjectId | string;
  principal: ApiPrincipal;
  quote: IntakeQuote;
  residentId: Types.ObjectId;
}): Promise<AdmissionInvoiceResult> {
  if (input.quote.admissionFee <= 0) {
    return { raised: false, reason: "NO_ADMISSION_FEE" };
  }

  try {
    const hostel = await HostelModel.findById(input.hostelId)
      .select("referencePrefix")
      .lean<HostelPricing | null>();

    const referenceCode = await allocateReferenceCode(
      input.hostelId,
      hostel?.referencePrefix,
    );

    const lines: {
      amount: number;
      basis: string;
      description: string;
      feeScheduleId?: string;
    }[] = [
      {
        amount: input.quote.admissionFee,
        // A fee taken from the rate card is SCHEDULE; one falling back to the
        // hostel's listed pricing is MANUAL, because no schedule stands behind
        // it and the invoice should not claim one does.
        basis: input.quote.feeScheduleId ? "SCHEDULE" : "MANUAL",
        description: "Admission fee",
        feeScheduleId: input.quote.feeScheduleId ?? undefined,
      },
    ];

    if (input.quote.referral.discount > 0) {
      lines.push({
        amount: -input.quote.referral.discount,
        basis: "CREDIT",
        description: `Referral discount — code ${input.quote.referral.code}`,
      });
    }

    const invoice = (await InvoiceModel.create({
      createdBy: input.principal.userId,
      currency: input.quote.currency,
      dueDate: input.dueDate,
      hostelId: input.hostelId,
      kind: "ADMISSION_FEE",
      lines,
      period: null,
      referenceCode,
      residentId: input.residentId,
      status: "OPEN",
      totalAmount: input.quote.admissionPayable,
    })) as unknown as { _id: Types.ObjectId };

    return {
      amount: input.quote.admissionPayable,
      invoiceId: invoice._id.toString(),
      raised: true,
      referenceCode,
    };
  } catch (error) {
    return {
      raised: false,
      reason: error instanceof Error ? error.message : "ADMISSION_INVOICE_FAILED",
    };
  }
}
