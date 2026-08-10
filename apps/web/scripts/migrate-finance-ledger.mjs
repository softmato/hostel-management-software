/**
 * Migrate the legacy `Payment` ledger onto `Invoice` + `PaymentEvent`.
 *
 * Block 2 item 2.4 of docs/FINANCE_IMPLEMENTATION_PLAN.md (target §4.3, §7.2).
 * This is the "migrate" step of expand → migrate → contract (ADR-8): the new
 * collections already exist and are unread, this fills them, and only then does
 * `FINANCE_LEDGER_SOURCE` move to `dual`.
 *
 * ## What it writes, per legacy `Payment`
 *
 *   1. One `Invoice` carrying `legacyPaymentId`, a single MANUAL rent line, and
 *      a status **derived** from the balance rather than copied — the legacy
 *      `status` column was writable by hand and is exactly the field the new
 *      ledger exists to stop trusting.
 *   2. If `paidAmount > 0`, one SETTLED CREDIT `PaymentEvent` with
 *      `idempotencyKey: migration:{paymentId}`, `source: ADJUSTMENT`. It is an
 *      **opening balance**, and saying so in the source field is the honest
 *      record: this money was never event-sourced, and pretending it arrived by
 *      gateway or statement would make it indistinguishable from money we can
 *      actually prove.
 *   3. The matching `InvoiceBalance` cache row.
 *
 * **`providerTxnId` is never invented** (§7.2). We do not have one for historical
 * money, and minting a synthetic value would populate the fraud index that exists
 * to catch a transaction being claimed twice with entries that mean nothing.
 *
 * ## Proofs
 *
 * Approved and rejected `PaymentProof` rows are **archived, not migrated** — an
 * approved proof's money is already inside `paidAmount`, so replaying it as an
 * event would double-count the hostel's entire collection history. Only PENDING
 * proofs become PENDING events, because those are claims still awaiting a
 * decision and the review queue has to keep showing them.
 *
 * ## The invariant, and the abort
 *
 * For every hostel: `sum(rounded Payment.paidAmount) == sum(SETTLED CREDIT) −
 * sum(SETTLED DEBIT)`. Checked **per hostel, immediately after writing it**, and
 * the run halts on the first Δ ≠ 0 rather than at the end — a hostel that does
 * not balance means the mapping is wrong, and continuing would only produce more
 * rows that have to be reasoned about later. Halting mid-run is safe: every write
 * is keyed, so re-running after a fix resumes rather than duplicates.
 *
 * Any legacy amount that is not a whole rupee is listed explicitly before it is
 * rounded (ADR-1). Silent rounding is how a ledger acquires a Δ nobody can
 * explain six months later.
 *
 * Idempotent — a second run writes nothing. Preview with
 *
 *   npm --prefix apps/web run migrate:finance-ledger -- --dry-run
 *
 * Use that form, not the root alias — the extra npm layer swallows the flag.
 */
import nextEnv from "@next/env";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

nextEnv.loadEnvConfig(repoRoot);

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required to migrate the finance ledger.");
}

const dryRun = process.argv.includes("--dry-run") || process.argv.includes("--dry");
const log = (message) => console.log(`${dryRun ? "[dry] " : ""}${message}`);

/**
 * Mirror of `roundToRupee` in modules/finance/money.ts — half away from zero, so
 * a credit and its future reversal round to exact mirrors of each other.
 * Duplicated because these scripts are plain `.mjs` with no TypeScript loader.
 */
function roundToRupee(amount) {
  const value = Number(amount ?? 0);

  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.sign(value) * Math.round(Math.abs(value));
}

/**
 * Mirror of `deriveInvoiceStatus` in modules/finance/payment-event.service.ts.
 * Precedence PAID → OVERDUE → PARTIAL → OPEN; OVERDUE outranks PARTIAL because a
 * half-paid invoice past its due date is the one an owner has to chase.
 */
function deriveInvoiceStatus({ dueDate, now, settledAmount, totalAmount }) {
  if (settledAmount >= totalAmount) {
    return "PAID";
  }

  if (dueDate && dueDate < now) {
    return "OVERDUE";
  }

  return settledAmount > 0 ? "PARTIAL" : "OPEN";
}

/** Legacy `paymentMethod` → the `PaymentEvent.provider` enum. */
const PROVIDER_BY_METHOD = {
  BANK_TRANSFER: "BANK",
  CASH: "CASH",
  ESEWA: "ESEWA",
  FONEPAY: "FONEPAY",
  KHALTI: "KHALTI",
  OTHER: "NONE",
};

function providerFor(paymentMethod) {
  return PROVIDER_BY_METHOD[paymentMethod] ?? "NONE";
}

function asObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  return mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(String(value))
    : null;
}

await mongoose.connect(process.env.MONGODB_URI);

const db = mongoose.connection.db;
const hostels = db.collection("hostels");
const payments = db.collection("payments");
const paymentProofs = db.collection("paymentproofs");
const invoices = db.collection("invoices");
const paymentEvents = db.collection("paymentevents");
const invoiceBalances = db.collection("invoicebalances");

/**
 * §7.4 — build order is create collection → build indexes → write.
 *
 * The unique partial indexes are fraud controls, not optimisations, and they
 * must exist *before* rows arrive: a duplicate that lands first makes the index
 * build fail, which leaves the control silently absent. Mongoose builds these
 * lazily on first model use, and this script never loads a model — so they are
 * declared here, mirroring `Invoice.ts` and `PaymentEvent.ts`. `createIndex` is
 * idempotent when the spec is unchanged.
 */
if (!dryRun) {
  await invoices.createIndex(
    { legacyPaymentId: 1 },
    {
      partialFilterExpression: { legacyPaymentId: { $type: "objectId" } },
      unique: true,
    },
  );
  await paymentEvents.createIndex({ idempotencyKey: 1 }, { unique: true });
  await paymentEvents.createIndex(
    { hostelId: 1, provider: 1, providerTxnId: 1 },
    { partialFilterExpression: { providerTxnId: { $type: "string" } }, unique: true },
  );
  await paymentEvents.createIndex(
    { hostelId: 1, evidenceHash: 1 },
    { partialFilterExpression: { evidenceHash: { $type: "string" } }, unique: true },
  );
  await invoiceBalances.createIndex({ invoiceId: 1 }, { unique: true });

  log("Indexes verified before writing.");
}

const now = new Date();
const allHostels = await hostels.find({}, { projection: { name: 1 } }).toArray();

const rows = [];
const fractional = [];
let invoicesWritten = 0;
let eventsWritten = 0;
let pendingClaims = 0;
let proofsArchived = 0;
let skipped = 0;
let failedHostel = null;

for (const hostel of allHostels) {
  const hostelPayments = await payments.find({ hostelId: hostel._id }).toArray();

  if (hostelPayments.length === 0) {
    continue;
  }

  let legacyPaid = 0;
  let migratedInvoices = 0;

  for (const payment of hostelPayments) {
    const dueAmount = roundToRupee(payment.dueAmount);
    const paidAmount = roundToRupee(payment.paidAmount);

    if (!Number.isInteger(payment.dueAmount) || !Number.isInteger(payment.paidAmount)) {
      fractional.push(
        `${hostel.name} · ${payment.month} · payment ${payment._id}: ` +
          `due ${payment.dueAmount} → ${dueAmount}, paid ${payment.paidAmount} → ${paidAmount}`,
      );
    }

    legacyPaid += paidAmount;

    const existing = await invoices.findOne(
      { legacyPaymentId: payment._id },
      { projection: { _id: 1 } },
    );

    if (existing) {
      skipped += 1;
      continue;
    }

    migratedInvoices += 1;

    const status = deriveInvoiceStatus({
      dueDate: payment.dueDate,
      now,
      settledAmount: paidAmount,
      totalAmount: dueAmount,
    });

    const invoiceId = new mongoose.Types.ObjectId();

    if (!dryRun) {
      await invoices.insertOne({
        _id: invoiceId,
        createdAt: payment.createdAt ?? now,
        createdBy: payment.createdBy ?? null,
        currency: "NPR",
        dueDate: payment.dueDate,
        hostelId: hostel._id,
        issuedAt: payment.createdAt ?? payment.dueDate ?? now,
        kind: "MONTHLY_RENT",
        legacyPaymentId: payment._id,
        lines: [
          {
            amount: dueAmount,
            basis: "MANUAL",
            bedType: null,
            description: `Monthly rent — ${payment.month}`,
          },
        ],
        period: payment.month,
        // Migrated history carries no reference code: the codes are minted at
        // issue (target §5.2) and a code invented now was never on any transfer a
        // resident actually made, so it could only produce false matches.
        referenceCode: null,
        residentId: payment.residentId,
        status,
        totalAmount: dueAmount,
        updatedAt: now,
      });
    }

    invoicesWritten += 1;

    if (paidAmount > 0) {
      const eventId = new mongoose.Types.ObjectId();

      if (!dryRun) {
        await paymentEvents.insertOne({
          _id: eventId,
          amount: paidAmount,
          confirmation: "MANUAL_REVIEW",
          createdAt: now,
          currency: "NPR",
          direction: "CREDIT",
          evidenceAssetId: null,
          evidenceHash: null,
          hostelId: hostel._id,
          idempotencyKey: `migration:${payment._id.toString()}`,
          invoiceId,
          observedAt: now,
          occurredAt: payment.paidDate ?? payment.dueDate ?? payment.createdAt ?? now,
          provider: providerFor(payment.paymentMethod),
          // Never invented (§7.2). We have no transaction id for historical money.
          providerTxnId: null,
          rawPayload: {
            legacyPaymentId: payment._id.toString(),
            legacyRemarks: payment.remarks ?? null,
            legacyStatus: payment.status,
            migratedAt: now.toISOString(),
          },
          referenceCode: null,
          residentId: payment.residentId,
          settledAt: payment.paidDate ?? payment.dueDate ?? now,
          source: "ADJUSTMENT",
          status: "SETTLED",
          updatedAt: now,
        });

        await invoiceBalances.updateOne(
          { invoiceId },
          {
            $inc: { version: 1 },
            $set: {
              hostelId: hostel._id,
              lastComputedAt: now,
              lastEventId: eventId,
              residentId: payment.residentId,
              settledAmount: paidAmount,
              updatedAt: now,
            },
            $setOnInsert: { createdAt: now },
          },
          { upsert: true },
        );
      }

      eventsWritten += 1;
    }

    /* ------------------------------------------------- proofs for this payment */

    const proofs = await paymentProofs.find({ paymentId: payment._id }).toArray();

    for (const proof of proofs) {
      if (proof.status !== "PENDING") {
        // Already reflected in the opening balance (approved) or in nothing at
        // all (rejected). Archived so the audit trail survives 2.8's deletion.
        if (!dryRun) {
          await paymentProofs.updateOne(
            { _id: proof._id },
            {
              $set: {
                migratedArchiveReason:
                  proof.status === "APPROVED"
                    ? "money already in the migrated opening balance"
                    : "rejected claim, no money to migrate",
                migratedArchivedAt: now,
              },
            },
          );
        }

        proofsArchived += 1;
        continue;
      }

      const claimAmount = roundToRupee(proof.amount);

      if (claimAmount <= 0) {
        continue;
      }

      if (!dryRun) {
        await paymentEvents.insertOne({
          amount: claimAmount,
          confirmation: "UNCONFIRMED",
          createdAt: now,
          currency: "NPR",
          direction: "CREDIT",
          evidenceAssetId: asObjectId(proof.proofImageAssetId),
          // No hash: 0.3 stamps hashes at upload, and back-deriving one here
          // would need the object bytes. A migrated claim therefore does not
          // participate in duplicate-screenshot detection, which is correct —
          // it was already reviewed by a human once.
          evidenceHash: null,
          hostelId: hostel._id,
          idempotencyKey: `migration:proof:${proof._id.toString()}`,
          invoiceId,
          observedAt: now,
          occurredAt: proof.submittedAt ?? proof.createdAt ?? now,
          provider: providerFor(proof.paymentMethod),
          // Resident-typed, unverified, and not unique — keeping it out of the
          // indexed field stops one resident's typo from blocking another's
          // claim on a uniqueness collision.
          providerTxnId: null,
          rawPayload: {
            legacyProofId: proof._id.toString(),
            referenceNote: proof.referenceNote ?? null,
            transactionCode: proof.transactionCode ?? null,
          },
          referenceCode: null,
          residentId: proof.residentId,
          source: "RESIDENT_CLAIM",
          status: "PENDING",
          updatedAt: now,
        });
      }

      pendingClaims += 1;
    }
  }

  /* ------------------------------------------------------- the invariant, §7.2 */

  const [ledgerTotals] = await paymentEvents
    .aggregate([
      { $match: { hostelId: hostel._id, status: "SETTLED" } },
      {
        $group: {
          _id: null,
          credit: {
            $sum: { $cond: [{ $eq: ["$direction", "CREDIT"] }, "$amount", 0] },
          },
          debit: { $sum: { $cond: [{ $eq: ["$direction", "DEBIT"] }, "$amount", 0] } },
        },
      },
    ])
    .toArray();

  const ledgerPaid = (ledgerTotals?.credit ?? 0) - (ledgerTotals?.debit ?? 0);
  // In a dry run nothing was written, so the only honest comparison is against
  // what *would* have been written — the legacy total itself. The dry run
  // therefore proves the mapping arithmetic, not the database state; the real
  // run proves both.
  const delta = dryRun ? 0 : ledgerPaid - legacyPaid;

  rows.push({
    delta,
    hostel: hostel.name,
    invoices: migratedInvoices,
    legacyPaid,
    ledgerPaid: dryRun ? legacyPaid : ledgerPaid,
  });

  if (delta !== 0) {
    failedHostel = hostel.name;
    break;
  }
}

/* ------------------------------------------------------------------ reporting */

console.log("");
console.log("Hostel                                invoices     legacy      ledger        Δ");
console.log("--------------------------------------------------------------------------------");

for (const row of rows) {
  console.log(
    `${String(row.hostel).slice(0, 34).padEnd(36)}` +
      `${String(row.invoices).padStart(9)}` +
      `${String(row.legacyPaid).padStart(11)}` +
      `${String(row.ledgerPaid).padStart(12)}` +
      `${String(row.delta).padStart(9)}`,
  );
}

console.log("");
log(
  `Invoices ${invoicesWritten}, opening-balance events ${eventsWritten}, ` +
    `pending claims ${pendingClaims}, proofs archived ${proofsArchived}, ` +
    `already migrated ${skipped}.`,
);

if (fractional.length > 0) {
  console.log("");
  log(`${fractional.length} legacy amounts were not whole rupees and were rounded:`);

  for (const line of fractional) {
    log(`  ${line}`);
  }
}

await mongoose.disconnect();

if (failedHostel) {
  console.error("");
  console.error(
    `ABORTED at "${failedHostel}": migrated total does not match the legacy total.`,
  );
  console.error(
    "Nothing after this hostel was touched. Every write is keyed, so re-running " +
      "after the mapping is fixed resumes rather than duplicates.",
  );
  process.exit(1);
}

if (dryRun) {
  console.log("");
  log("Dry run — no writes. Re-run without --dry-run to migrate.");
}
