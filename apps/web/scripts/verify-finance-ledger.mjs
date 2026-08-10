/**
 * Re-check the finance ledger's invariants. Read-only, safe in production.
 *
 * Block 2 item 2.4 of docs/FINANCE_IMPLEMENTATION_PLAN.md (§7.2, §8.1). This is
 * the script the cutover gate is written against: "`verify-finance-ledger.mjs`
 * returning Δ = 0 for every hostel" is one of the two conditions on 2.8, so it
 * has to be runnable against production at any moment without a second thought.
 * It therefore only ever reads — no repairs, not even obvious ones. A drift is a
 * *finding*: something wrote where it should not have, and silently correcting it
 * would destroy the evidence of whatever did (target §10.1).
 *
 * Four checks, each of which can fail independently:
 *
 *   1. **Migration parity** (§7.2) — per hostel,
 *      `sum(Payment.paidAmount) == sum(SETTLED CREDIT) − sum(SETTLED DEBIT)`.
 *      Skipped once `Payment` is gone in 2.8, at which point there is nothing to
 *      compare against and the check reports "legacy ledger removed" instead of
 *      a spurious pass.
 *   2. **Conservation** (invariant 1) — every `InvoiceBalance.settledAmount`
 *      equals the sum of its invoice's settled events. This is the cache-versus-
 *      truth comparison, and the cache is always the one that is wrong.
 *   3. **Integrality** (invariant 2b) — every stored amount is a whole rupee.
 *      One fraction anywhere and the ledger's exactness claim is void.
 *   4. **Suspense** — settled events with no `invoiceId`. Not a failure: money
 *      that belongs to nobody yet is a normal operational state with its own
 *      screen (P5). Reported so the total is visible rather than invisible.
 *
 * Exits non-zero if 1, 2 or 3 finds anything, so it can gate a deploy.
 *
 *   npm --prefix apps/web run verify:finance-ledger
 *
 * Use that form, not the root alias — the extra npm layer swallows any flag.
 */
import nextEnv from "@next/env";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

nextEnv.loadEnvConfig(repoRoot);

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required to verify the finance ledger.");
}

/** Caps the per-finding output so a systemic break does not print a novel. */
const SAMPLE_LIMIT = 20;

await mongoose.connect(process.env.MONGODB_URI);

const db = mongoose.connection.db;
const collections = new Set(
  (await db.listCollections({}, { nameOnly: true }).toArray()).map((one) => one.name),
);

const hostels = db.collection("hostels");
const payments = db.collection("payments");
const invoices = db.collection("invoices");
const paymentEvents = db.collection("paymentevents");
const invoiceBalances = db.collection("invoicebalances");

const failures = [];

/* ------------------------------------------------ 1. migration parity, §7.2 */

const legacyPresent = collections.has("payments");
const parityRows = [];

if (legacyPresent) {
  const allHostels = await hostels.find({}, { projection: { name: 1 } }).toArray();

  for (const hostel of allHostels) {
    const [legacy] = await payments
      .aggregate([
        { $match: { hostelId: hostel._id } },
        { $group: { _id: null, count: { $sum: 1 }, paid: { $sum: "$paidAmount" } } },
      ])
      .toArray();

    const [ledger] = await paymentEvents
      .aggregate([
        { $match: { hostelId: hostel._id, status: "SETTLED" } },
        {
          $group: {
            _id: null,
            credit: {
              $sum: { $cond: [{ $eq: ["$direction", "CREDIT"] }, "$amount", 0] },
            },
            debit: {
              $sum: { $cond: [{ $eq: ["$direction", "DEBIT"] }, "$amount", 0] },
            },
          },
        },
      ])
      .toArray();

    const legacyPaid = legacy?.paid ?? 0;
    const ledgerPaid = (ledger?.credit ?? 0) - (ledger?.debit ?? 0);

    if ((legacy?.count ?? 0) === 0 && ledgerPaid === 0) {
      continue;
    }

    const delta = ledgerPaid - legacyPaid;

    parityRows.push({ delta, hostel: hostel.name, legacyPaid, ledgerPaid });

    if (delta !== 0) {
      failures.push(
        `PARITY  ${hostel.name}: legacy ${legacyPaid}, ledger ${ledgerPaid}, Δ ${delta}`,
      );
    }
  }
}

/* ------------------------------------------------------ 2. conservation, §8.1 */

const driftSamples = [];
let balancesChecked = 0;
let balancesDrifted = 0;

const balanceCursor = invoiceBalances.find(
  {},
  { projection: { invoiceId: 1, settledAmount: 1, version: 1 } },
);

while (await balanceCursor.hasNext()) {
  const balance = await balanceCursor.next();
  balancesChecked += 1;

  const [truth] = await paymentEvents
    .aggregate([
      { $match: { invoiceId: balance.invoiceId, status: "SETTLED" } },
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

  const settled = (truth?.credit ?? 0) - (truth?.debit ?? 0);

  if (settled !== balance.settledAmount) {
    balancesDrifted += 1;

    if (driftSamples.length < SAMPLE_LIMIT) {
      driftSamples.push(
        `invoice ${balance.invoiceId}: cached ${balance.settledAmount}, events ${settled}`,
      );
    }
  }
}

if (balancesDrifted > 0) {
  failures.push(
    `DRIFT   ${balancesDrifted} of ${balancesChecked} invoice balances disagree with their events`,
  );
}

/* -------------------------------------------------------- 3. integrality, ADR-1 */

/**
 * `$mod: [1, 0]` rather than a `$type` test: the schema stores whole rupees as
 * `Number`, so a fraction is still a valid double and only the remainder tells
 * them apart. `$expr` with `$isNumber` additionally catches a null that slipped
 * into a required amount.
 */
async function countFractional(collection, field) {
  return collection.countDocuments({
    $expr: {
      $and: [{ $isNumber: `$${field}` }, { $ne: [{ $mod: [`$${field}`, 1] }, 0] }],
    },
  });
}

const fractionalChecks = [
  ["Invoice.totalAmount", await countFractional(invoices, "totalAmount")],
  ["PaymentEvent.amount", await countFractional(paymentEvents, "amount")],
  ["InvoiceBalance.settledAmount", await countFractional(invoiceBalances, "settledAmount")],
];

for (const [label, count] of fractionalChecks) {
  if (count > 0) {
    failures.push(`AMOUNT  ${count} rows have a fractional ${label}`);
  }
}

/* ------------------------------------------------------------- 4. suspense, P5 */

const [suspense] = await paymentEvents
  .aggregate([
    { $match: { invoiceId: null, status: "SETTLED" } },
    { $group: { _id: null, amount: { $sum: "$amount" }, count: { $sum: 1 } } },
  ])
  .toArray();

/* ------------------------------------------------------------------- reporting */

console.log("");

if (!legacyPresent) {
  console.log("Parity: legacy `payments` collection removed — nothing to compare (post-2.8).");
} else if (parityRows.length === 0) {
  console.log("Parity: no hostel has any ledger history yet.");
} else {
  console.log("Hostel                                   legacy       ledger        Δ");
  console.log("---------------------------------------------------------------------");

  for (const row of parityRows) {
    console.log(
      `${String(row.hostel).slice(0, 34).padEnd(38)}` +
        `${String(row.legacyPaid).padStart(11)}` +
        `${String(row.ledgerPaid).padStart(13)}` +
        `${String(row.delta).padStart(9)}`,
    );
  }
}

console.log("");
console.log(`Conservation: ${balancesChecked} balances checked, ${balancesDrifted} drifted.`);

for (const sample of driftSamples) {
  console.log(`  ${sample}`);
}

if (balancesDrifted > driftSamples.length) {
  console.log(`  … and ${balancesDrifted - driftSamples.length} more.`);
}

console.log(
  `Integrality: ${fractionalChecks.map(([label, count]) => `${label} ${count}`).join(", ")}.`,
);
console.log(
  `Suspense: ${suspense?.count ?? 0} settled events unassigned to an invoice, ` +
    `NPR ${suspense?.amount ?? 0}.`,
);

await mongoose.disconnect();

console.log("");

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }

  console.error("");
  console.error(
    `${failures.length} finding(s). This is evidence, not a repair job — find what ` +
      "wrote where it should not have before touching any of it.",
  );
  process.exit(1);
}

console.log("All ledger invariants hold.");
