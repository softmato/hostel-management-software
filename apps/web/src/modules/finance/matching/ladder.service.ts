import { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { extractReferenceCodes } from "@/modules/finance/reference-code";
import {
  type MatchCandidate,
  type ScoredCandidate,
  rankCandidates,
} from "@/modules/finance/matching/scoring";
import type { StatementRow } from "@/modules/finance/statements/parsers/types";
import { InvoiceBalanceModel } from "@hostel/db/models/InvoiceBalance";
import { InvoiceModel } from "@hostel/db/models/Invoice";
import { PaymentEventModel } from "@hostel/db/models/PaymentEvent";
import { ResidentModel } from "@hostel/db/models/Resident";

/**
 * The matching ladder, tiers B–E (target §7).
 *
 * Every ingested credit runs this in order and the first match wins. The tier
 * reached is what decides whether money settles without a human, which makes the
 * boundary between B and C the most consequential line in the finance module:
 *
 * - **B — `STATEMENT_MATCH`.** A valid reference code naming an invoice of *this*
 *   hostel, for no more than that invoice owes. Auto-settles. Safe because the
 *   code carries a check character (P2/ADR-7): a mistyped one does not validate,
 *   so a false B is not a typo, it is a forgery.
 * - **C — `SUGGESTED`.** Everything that merely looks right — a claim whose
 *   transaction id equals a real one, a name that resembles a resident, an amount
 *   that equals what somebody owes. **Never auto-settles**, no matter how strong.
 *   A confident wrong guess here credits one resident's payment to another and is
 *   discovered a month later by the person who did not get credited.
 * - **D — `UNMATCHED`.** Real money belonging to nobody yet. A first-class state
 *   with its own list, never swept under a "misc" invoice (P5).
 * - **E — `ORPHAN_CLAIM`.** A resident's claim with no money behind it in any
 *   statement we hold.
 *
 * `classifyCredit` is **pure** — context in, tier out — so the rules above are
 * testable without a database, which is why the loader is a separate function.
 */

export type LadderInvoice = MatchCandidate & {
  dueDate: Date | null;
  totalAmount: number;
};

export type LadderClaim = {
  amount: number;
  eventId: string;
  invoiceId: string | null;
  occurredAt: Date;
  period: string | null;
  residentId: string;
  residentName: string;
  /** Resident-typed and unverified — see `claim.service.ts`. */
  transactionCode: string | null;
};

export type MatchContext = {
  /** Pending resident claims, keyed by normalised transaction code. */
  claimsByTxnId: Map<string, LadderClaim>;
  claims: LadderClaim[];
  /** Every open invoice of this hostel, keyed by its reference code. */
  invoicesByCode: Map<string, LadderInvoice>;
  openInvoices: LadderInvoice[];
};

export type CreditClassification =
  | {
      /** Present for C(a): a resident already claimed this exact transaction. */
      claim?: LadderClaim;
      suggestions: ScoredCandidate[];
      tier: "C";
      why: string;
    }
  | { invoice: LadderInvoice; referenceCode: string; tier: "B"; why: string }
  | { tier: "D"; why: string };

/** Transaction codes are compared without case, spacing or punctuation. */
export function normalizeTxnId(value: string | null | undefined): string {
  return (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Which tier a credit reaches. Pure.
 *
 * The order of the checks *is* the ladder, and it is not an optimisation: a row
 * that qualifies for B must never be scored for C, because a scored suggestion
 * asks the owner to confirm something the reference code already established.
 */
export function classifyCredit(
  row: Pick<
    StatementRow,
    "amount" | "counterpartyName" | "occurredAt" | "providerTxnId" | "remarks"
  >,
  context: MatchContext,
): CreditClassification {
  // ---- Tier B: a valid reference code, this hostel's invoice, within what it owes.
  const codes = [
    ...extractReferenceCodes(row.remarks),
    // Some providers put the remark in the counterparty field when the payer
    // used a bank's "purpose" box, so it is searched too.
    ...extractReferenceCodes(row.counterpartyName),
  ];
  const referencedInvoices = codes
    .map((code) => context.invoicesByCode.get(code))
    .filter((invoice): invoice is LadderInvoice => Boolean(invoice));

  // Exactly one, deliberately. Two valid codes in one remark is a resident
  // paying two months at once (target §16.2), which needs a split this block
  // does not implement — so it drops to a suggestion rather than guessing which
  // invoice gets the money.
  const referenced = referencedInvoices.length === 1 ? referencedInvoices[0]! : null;

  if (referenced && row.amount <= referenced.outstanding) {
    return {
      invoice: referenced,
      referenceCode: referenced.referenceCode!,
      tier: "B",
      why: `reference ${referenced.referenceCode} — ${referenced.residentName}, ${referenced.period}`,
    };
  }

  // ---- Tier C(a): a pending claim naming exactly this transaction.
  const claim = context.claimsByTxnId.get(normalizeTxnId(row.providerTxnId));

  if (claim) {
    return {
      claim,
      suggestions: [],
      tier: "C",
      why: `${claim.residentName} claimed this exact transaction${
        claim.amount === row.amount ? "" : `, but for ${claim.amount.toLocaleString("en-IN")}`
      }`,
    };
  }

  // ---- Tier C(b): amount, name and time similarity.
  const suggestions = rankCandidates(
    {
      amount: row.amount,
      counterpartyName: row.counterpartyName,
      occurredAt: row.occurredAt,
      // A code that validated but carried too much money for the invoice it
      // named is still the strongest evidence available about whose money this
      // is — it just cannot settle without a decision about the excess.
      referencedInvoice: referenced
        ? { invoiceId: referenced.invoiceId, residentId: referenced.residentId }
        : null,
    },
    context.openInvoices,
  );

  if (suggestions.length > 0) {
    return { suggestions, tier: "C", why: suggestions[0]!.why };
  }

  // ---- Tier D: real money, nobody it plausibly belongs to.
  return {
    tier: "D",
    why: row.counterpartyName
      ? `from "${row.counterpartyName}" — no reference, no claim, no close match`
      : "no reference, no claim, no close match",
  };
}

/**
 * Claims with no money behind them — Tier E (target §7).
 *
 * Measured against the statement rows just read, **not** against all time: a
 * claim submitted after this statement's period ended has not had its chance to
 * appear yet, and flagging it would train the owner to ignore the bucket. The
 * grace period is the statement's own end date.
 */
export function findOrphanClaims(
  context: MatchContext,
  rows: StatementRow[],
  periodEnd: Date | null,
): { claim: LadderClaim; nearest: StatementRow | null; why: string }[] {
  const seen = new Set(rows.map((row) => normalizeTxnId(row.providerTxnId)));
  const credits = rows.filter((row) => row.direction === "CREDIT");

  return context.claims
    .filter((claim) => {
      if (seen.has(normalizeTxnId(claim.transactionCode))) {
        return false;
      }

      // Claimed after the statement was cut: not yet evidence of anything.
      return !periodEnd || claim.occurredAt <= periodEnd;
    })
    .map((claim) => {
      const nearest = nearestByAmount(claim.amount, credits);

      return {
        claim,
        nearest,
        why: nearest
          ? `claims ${claim.amount.toLocaleString("en-IN")} — closest real credit is ${nearest.amount.toLocaleString(
              "en-IN",
            )} on ${nearest.occurredAt.toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            })}`
          : `claims ${claim.amount.toLocaleString("en-IN")}${
              claim.transactionCode ? `, txn ${claim.transactionCode}` : ""
            } — not in this statement`,
      };
    });
}

function nearestByAmount(amount: number, rows: StatementRow[]): StatementRow | null {
  let best: StatementRow | null = null;
  let bestGap = Number.POSITIVE_INFINITY;

  for (const row of rows) {
    const gap = Math.abs(row.amount - amount);

    if (gap < bestGap) {
      bestGap = gap;
      best = row;
    }
  }

  return best;
}

/**
 * Loads everything the ladder needs for one hostel, in three queries.
 *
 * Read once per import rather than per row: a statement of 84 rows against 41
 * residents would otherwise be several hundred round trips, and the context does
 * not change while a single file is being read.
 */
export async function loadMatchContext(
  hostelId: Types.ObjectId | string,
): Promise<MatchContext> {
  await connectToDatabase();

  const invoices = await InvoiceModel.find({
    hostelId,
    status: { $in: ["OPEN", "PARTIAL", "OVERDUE"] },
  })
    .select("dueDate period referenceCode residentId totalAmount")
    .lean<
      {
        _id: Types.ObjectId;
        dueDate?: Date;
        period?: string | null;
        referenceCode?: string | null;
        residentId: Types.ObjectId;
        totalAmount: number;
      }[]
    >();

  const claimEvents = await PaymentEventModel.find({
    hostelId,
    source: "RESIDENT_CLAIM",
    status: "PENDING",
  })
    .select("amount invoiceId occurredAt rawPayload residentId")
    .lean<
      {
        _id: Types.ObjectId;
        amount: number;
        invoiceId?: Types.ObjectId | null;
        occurredAt: Date;
        rawPayload?: { transactionCode?: string | null };
        residentId?: Types.ObjectId | null;
      }[]
    >();

  const residentIds = [
    ...invoices.map((invoice) => invoice.residentId),
    ...claimEvents.map((event) => event.residentId).filter(Boolean),
  ];

  const [residents, balances] = await Promise.all([
    ResidentModel.find({ _id: { $in: residentIds } })
      .select("firstName lastName roomNumber roomType")
      .lean<
        {
          _id: Types.ObjectId;
          firstName?: string;
          lastName?: string;
          roomNumber?: string;
          roomType?: string;
        }[]
      >(),
    InvoiceBalanceModel.find({
      invoiceId: { $in: invoices.map((invoice) => invoice._id) },
    })
      .select("invoiceId settledAmount")
      .lean<{ invoiceId: Types.ObjectId; settledAmount?: number }[]>(),
  ]);

  const nameById = new Map(
    residents.map((resident) => [
      resident._id.toString(),
      [resident.firstName, resident.lastName].filter(Boolean).join(" ").trim(),
    ]),
  );
  const bedById = new Map(
    residents.map((resident) => [
      resident._id.toString(),
      [resident.roomType, resident.roomNumber && `room ${resident.roomNumber}`]
        .filter(Boolean)
        .join(" · "),
    ]),
  );
  const settledByInvoice = new Map(
    balances.map((balance) => [
      balance.invoiceId.toString(),
      balance.settledAmount ?? 0,
    ]),
  );

  const openInvoices: LadderInvoice[] = invoices.map((invoice) => ({
    bedLabel: bedById.get(invoice.residentId.toString()) ?? null,
    dueDate: invoice.dueDate ?? null,
    invoiceId: invoice._id.toString(),
    outstanding: Math.max(
      0,
      invoice.totalAmount - (settledByInvoice.get(invoice._id.toString()) ?? 0),
    ),
    period: invoice.period ?? "",
    referenceCode: invoice.referenceCode ?? null,
    residentId: invoice.residentId.toString(),
    residentName: nameById.get(invoice.residentId.toString()) ?? "Unknown resident",
    totalAmount: invoice.totalAmount,
  }));

  const claims: LadderClaim[] = claimEvents.map((event) => ({
    amount: event.amount,
    eventId: event._id.toString(),
    invoiceId: event.invoiceId?.toString() ?? null,
    occurredAt: event.occurredAt,
    period:
      openInvoices.find((invoice) => invoice.invoiceId === event.invoiceId?.toString())
        ?.period ?? null,
    residentId: event.residentId?.toString() ?? "",
    residentName: nameById.get(event.residentId?.toString() ?? "") ?? "Unknown resident",
    transactionCode: event.rawPayload?.transactionCode ?? null,
  }));

  return {
    claims,
    // A claim with no transaction code cannot be keyed, and must not collapse
    // every such claim onto the empty string.
    claimsByTxnId: new Map(
      claims
        .filter((claim) => normalizeTxnId(claim.transactionCode) !== "")
        .map((claim) => [normalizeTxnId(claim.transactionCode), claim]),
    ),
    invoicesByCode: new Map(
      openInvoices
        .filter((invoice) => invoice.referenceCode)
        .map((invoice) => [invoice.referenceCode!, invoice]),
    ),
    openInvoices,
  };
}
