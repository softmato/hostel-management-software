import { Schema, model, models } from "mongoose";

import {
  currencyField,
  FinanceModelError,
  positiveWholeRupees,
} from "@hostel/db/models/finance-fields";

/**
 * One attempt to pay, which becomes the settlement record when it succeeds.
 * **The only thing in this system that writes money** (ADR-2, target §4.1).
 *
 * Every balance is `sum(settled events)`. There is no mutable amount anywhere
 * that a human can type over, which is the whole point: the current `paidAmount`
 * can be wrong and nothing can detect it (current §2.1).
 *
 * `invoiceId` and `residentId` are **nullable on purpose**. Money arrives that
 * belongs to nobody yet — a bank credit with no reference and no claim — and
 * that is a normal operational state with its own screen, not an error to be
 * swallowed (P5, target §7 Tier D).
 */

const paymentEventSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    invoiceId: { ref: "Invoice", default: null, type: Schema.Types.ObjectId },
    residentId: { ref: "Resident", default: null, type: Schema.Types.ObjectId },
    referenceCode: { type: String, default: null, trim: true, uppercase: true },

    amount: { ...positiveWholeRupees, required: true },
    currency: currencyField,
    /** DEBIT is used only for reversals (target §9.3). */
    direction: {
      type: String,
      enum: ["CREDIT", "DEBIT"],
      default: "CREDIT",
      required: true,
    },

    source: {
      type: String,
      enum: [
        "GATEWAY_WEBHOOK",
        "GATEWAY_POLL",
        "STATEMENT_IMPORT",
        "RESIDENT_CLAIM",
        "CASH_ENTRY",
        "ADJUSTMENT",
      ],
      required: true,
    },
    provider: {
      type: String,
      enum: ["FONEPAY", "ESEWA", "KHALTI", "BANK", "CASH", "NONE"],
      default: "NONE",
    },
    providerTxnId: { type: String, default: null, trim: true },
    /**
     * Which statement upload produced this event (target §11.5).
     *
     * A real field rather than a key inside `rawPayload` because the whole
     * reconciliation screen is one query by it — "show me the three buckets of
     * *this* import" — and a Mixed subpath cannot be indexed usefully. Null for
     * every event that did not come from a statement.
     */
    statementImportId: {
      ref: "StatementImport",
      default: null,
      type: Schema.Types.ObjectId,
    },

    /**
     * How strongly this is believed (P4). Only `GATEWAY_VERIFIED` may settle
     * without a human; `MANUAL_REVIEW` records that one made the call.
     */
    confirmation: {
      type: String,
      enum: [
        "UNCONFIRMED",
        "MANUAL_REVIEW",
        "STATEMENT_MATCH",
        "GATEWAY_VERIFIED",
      ],
      default: "UNCONFIRMED",
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "SETTLED", "FAILED", "EXPIRED", "REJECTED", "REVERSED"],
      default: "PENDING",
      required: true,
    },

    evidenceAssetId: {
      ref: "FileAsset",
      default: null,
      type: Schema.Types.ObjectId,
    },
    /** Content or perceptual hash of the evidence, hostel-scoped (target §8.1). */
    evidenceHash: { type: String, default: null, trim: true },
    /** The webhook body, statement row or form body, verbatim. Always stored. */
    rawPayload: { type: Schema.Types.Mixed, default: {} },
    /** Deterministic, never random — see plan §5.2. Unique platform-wide. */
    idempotencyKey: { type: String, required: true, trim: true },

    /** When the money actually moved, per the provider. */
    occurredAt: { type: Date, default: Date.now },
    /** When we learned about it. Differs from the above by however long the lag was. */
    observedAt: { type: Date, default: Date.now },
    settledAt: Date,
    expiresAt: Date,

    reversedByEventId: {
      ref: "PaymentEvent",
      default: null,
      type: Schema.Types.ObjectId,
    },
    reversesEventId: {
      ref: "PaymentEvent",
      default: null,
      type: Schema.Types.ObjectId,
    },

    /**
     * Non-blocking notes for the human reviewer (plan item 3.4), e.g.
     * `SIMILAR_EVIDENCE` when a perceptual hash is close to an earlier claim's.
     *
     * Deliberately **not** a status: a flag never rejects anything and never
     * changes a balance. A perceptual match is evidence that two screenshots
     * look alike, which a resident re-cropping the same transfer produces
     * innocently — so it may only put a note in front of someone who can look
     * at both images.
     */
    reviewFlags: { type: [String], default: [] },

    createdBy: { ref: "User", type: Schema.Types.ObjectId },
    reviewedBy: { ref: "User", type: Schema.Types.ObjectId },
    reviewedAt: Date,
    rejectionReason: { type: String, trim: true },
  },
  { timestamps: true },
);

/**
 * The financial fields of a settled event. Changing any of these after
 * settlement rewrites history rather than recording it.
 */
export const FROZEN_EVENT_FIELDS = [
  "amount",
  "direction",
  "invoiceId",
  "confirmation",
] as const;

function immutabilityError() {
  return new FinanceModelError(
    "A settled payment event cannot be modified. Write a reversing event instead.",
    "SETTLED_EVENT_IMMUTABLE",
    500,
  );
}

/**
 * Which frozen fields a save would rewrite on an already-settled event.
 *
 * Exported and pure so the rule can be tested directly. `statusAtLoad` is what
 * separates "already settled" from "settling right now": both end at
 * `SETTLED`, and only the first is forbidden.
 */
export function frozenFieldsTouchedOnSave(
  statusAtLoad: string | undefined,
  modifiedPaths: string[],
): string[] {
  if (statusAtLoad !== "SETTLED") {
    return [];
  }

  return modifiedPaths.filter((path) =>
    FROZEN_EVENT_FIELDS.includes(path as (typeof FROZEN_EVENT_FIELDS)[number]),
  );
}

/**
 * Whether an update payload would rewrite a frozen field on a settled event.
 *
 * Inspects the **payload**, not a loaded document, so it cannot be evaded by a
 * filter that simply does not mention `status`. An update is allowed only when
 * its filter pins status to something other than SETTLED — which is how a
 * PENDING event legitimately becomes one.
 */
export function updateViolatesImmutability(
  filter: Record<string, unknown>,
  update: Record<string, unknown> | null,
): boolean {
  if (!update) {
    return false;
  }

  const assignments = {
    ...(update as Record<string, Record<string, unknown>>).$set,
    ...(update as Record<string, Record<string, unknown>>).$inc,
    ...Object.fromEntries(
      Object.entries(update).filter(([key]) => !key.startsWith("$")),
    ),
  };

  const touched = FROZEN_EVENT_FIELDS.filter((field) => field in assignments);

  if (touched.length === 0) {
    return false;
  }

  const filterStatus = filter.status;

  return !(typeof filterStatus === "string" && filterStatus !== "SETTLED");
}

/**
 * ADR-2, enforced at the model layer rather than in the service.
 *
 * Service-layer enforcement is defeated by one forgotten `updateOne` in a future
 * feature, and the whole ledger's credibility rests on this holding — so it sits
 * where every write path must pass through it. Reaching this is a bug, never a
 * user error, which is why it is a 500.
 *
 * The single permitted write to a settled event is `reversedByEventId`: pointing
 * at the event that reversed it touches no financial field (target §9.3).
 */
type StatusCarrier = { _statusAtLoad?: string; status?: string };

/**
 * The status the document had when it was read.
 *
 * Needed because "already settled" and "settling right now" both end with
 * `status === "SETTLED"`, and only the first is forbidden — a PENDING event
 * legitimately sets `confirmation` and `settledAt` as it settles.
 */
paymentEventSchema.post("init", function rememberStatus(this: StatusCarrier) {
  this._statusAtLoad = this.status;
});

paymentEventSchema.pre("save", function guardSettled() {
  const event = this as unknown as StatusCarrier & {
    isNew: boolean;
    modifiedPaths(): string[];
  };

  if (event.isNew) {
    return;
  }

  if (
    frozenFieldsTouchedOnSave(event._statusAtLoad, event.modifiedPaths())
      .length > 0
  ) {
    throw immutabilityError();
  }
});

/**
 * The same guard for the update path, which does not run `pre('save')`.
 *
 * Checks the *update payload* rather than the document, so it cannot be evaded
 * by a filter that does not mention status: any update that both sets a frozen
 * field and could match a settled event is refused.
 */
function guardUpdate(this: {
  getFilter(): Record<string, unknown>;
  getUpdate(): Record<string, unknown> | null;
}) {
  if (updateViolatesImmutability(this.getFilter(), this.getUpdate())) {
    throw immutabilityError();
  }
}

paymentEventSchema.pre("findOneAndUpdate", guardUpdate);
paymentEventSchema.pre("updateOne", guardUpdate);
paymentEventSchema.pre("updateMany", guardUpdate);

/* -------------------------------------------------------------------------- */
/*    Indexes. These are the fraud controls, not optimisations (target §4.1).  */
/* -------------------------------------------------------------------------- */

/**
 * The single most important index in the system. Every ingestion path derives a
 * deterministic key (plan §5.2), so a retried webhook, a re-uploaded overlapping
 * statement and a double-tapped submit collapse to a no-op **by construction**,
 * not by a check somebody has to remember to write.
 */
paymentEventSchema.index({ idempotencyKey: 1 }, { unique: true });

/** Kills transaction-ID reuse — half of current §7.2. */
paymentEventSchema.index(
  { hostelId: 1, provider: 1, providerTxnId: 1 },
  {
    partialFilterExpression: { providerTxnId: { $type: "string" } },
    unique: true,
  },
);

/**
 * Kills screenshot reuse — the other half. Hostel-scoped deliberately: two
 * residents in different hostels may legitimately have visually similar
 * screenshots, and comparing across hostels is a privacy leak (target §8.1).
 */
paymentEventSchema.index(
  { hostelId: 1, evidenceHash: 1 },
  {
    partialFilterExpression: { evidenceHash: { $type: "string" } },
    unique: true,
  },
);

paymentEventSchema.index({ invoiceId: 1, status: 1 });
/** The reconciliation screen's one query: every event of a given import. */
paymentEventSchema.index(
  { statementImportId: 1 },
  { partialFilterExpression: { statementImportId: { $type: "objectId" } } },
);
paymentEventSchema.index({ hostelId: 1, status: 1, occurredAt: -1 });
paymentEventSchema.index({ referenceCode: 1 });
/** Drives the expiry sweep (target §6.5). */
paymentEventSchema.index(
  { status: 1, expiresAt: 1 },
  { partialFilterExpression: { expiresAt: { $type: "date" } } },
);

export const PaymentEventModel =
  models.PaymentEvent || model("PaymentEvent", paymentEventSchema);
