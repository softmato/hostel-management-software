/**
 * Puts the plan trial back to three days, and repairs what the wrong number
 * wrote.
 *
 * ## What happened
 *
 * `operations.subscriptionDueGraceDays` is the plan trial: how long a hostel the
 * field team files can run before its plan payment is due. The product is three
 * days — filed on Bhadra 26, pay by Bhadra 29. It was saved as 15 on 2026-09-09,
 * and every team registration since carries a due fifteen days out: the hostel
 * filed on Bhadra 26 was told "pay by Aswin 10".
 *
 * Separately, a team hostel's plan never started until its balance cleared, so
 * those same hostels have been live with no period on the subscription at all
 * and the billing screen had nothing to count "days left" from. The code now
 * starts the plan the moment a hostel is filed; this gives the ones already
 * filed the period they would have had.
 *
 * ## What it changes
 *
 * 1. The setting, back to 3.
 * 2. Every open plan invoice: `dueAt` to the end of the Nepal day three days
 *    after it was issued, and the subscription's `dueBy` with it. The period the
 *    invoice pays for is recorded on it (`periodStart` / `periodEnd`).
 * 3. A team-filed subscription with no period running gets one, from the day
 *    it was filed.
 *
 * Every change is audit-logged with the value it replaced, so any of it can be
 * put back by hand. Idempotent — a second run finds nothing to do. Preview with
 *
 *   npm --prefix apps/web run repair:plan-trial -- --dry-run
 */
import nextEnv from "@next/env";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  bsMonthsEnd,
  formatBsDate,
  hostelDayEnd,
} from "../../../packages/shared/src/calendar/bs.ts";

const dirname = path.dirname(fileURLToPath(import.meta.url));

nextEnv.loadEnvConfig(path.resolve(dirname, "../../.."));

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required.");
}

const dryRun = process.argv.includes("--dry-run") || process.argv.includes("--dry");
const TRIAL_DAYS = 3;
const REASON =
  "The plan trial is three days; the operations setting had been saved as 15, and team-filed hostels had been live with no plan period.";

await mongoose.connect(process.env.MONGODB_URI);

const db = mongoose.connection.db;
const at = new Date();
const bs = (value) => (value ? formatBsDate(value) : "—");

function audit(action, entityType, entityId, hostelId, metadata) {
  return db.collection("auditlogs").insertOne({
    action,
    actorId: null,
    actorType: "SYSTEM",
    createdAt: at,
    entityId: String(entityId),
    entityType,
    hostelId: hostelId ?? null,
    metadata: { ...metadata, reason: REASON },
    updatedAt: at,
  });
}

/* ── 1. The setting ──────────────────────────────────────────────────────── */

const settings = db.collection("platformsettings");
const operations = await settings.findOne({ key: "operations" });
const grace = operations?.value?.subscriptionDueGraceDays;

if (operations && grace !== undefined && grace !== TRIAL_DAYS) {
  console.log(`operations.subscriptionDueGraceDays: ${grace} -> ${TRIAL_DAYS}`);

  if (!dryRun) {
    await settings.updateOne(
      { _id: operations._id },
      { $set: { "value.subscriptionDueGraceDays": TRIAL_DAYS } },
    );
    await audit("OPERATIONS_CONFIG_CORRECTED", "PlatformSetting", operations._id, null, {
      corrected: TRIAL_DAYS,
      field: "subscriptionDueGraceDays",
      previous: grace,
    });
  }
} else {
  console.log(`operations.subscriptionDueGraceDays is already ${grace ?? `${TRIAL_DAYS} (default)`}`);
}

/* ── 2 and 3. Open invoices, and the subscriptions behind them ───────────── */

const invoices = await db
  .collection("subscriptioninvoices")
  .find({ status: { $in: ["OPEN", "PARTIAL"] } })
  .sort({ issuedAt: 1 })
  .toArray();

console.log(`\n${invoices.length} open plan invoice(s)`);

let changed = 0;

for (const invoice of invoices) {
  const issuedAt = invoice.issuedAt ?? invoice.createdAt;
  const subscription = await db
    .collection("hostelsubscriptions")
    .findOne({ _id: invoice.subscriptionId });
  const hostel = await db
    .collection("hostels")
    .findOne({ _id: invoice.hostelId }, { projection: { name: 1, status: 1 } });

  const dueAt = hostelDayEnd(issuedAt, TRIAL_DAYS);
  const periodStart = invoice.periodStart ?? issuedAt;
  const periodEnd = invoice.periodEnd ?? bsMonthsEnd(issuedAt, invoice.cycleMonths || 1);

  const invoiceSet = {};

  if (invoice.dueAt?.getTime() !== dueAt.getTime()) invoiceSet.dueAt = dueAt;
  if (!invoice.periodEnd) Object.assign(invoiceSet, { periodEnd, periodStart });

  const subscriptionSet = {};

  if (subscription?.dueBy && subscription.dueBy.getTime() !== dueAt.getTime()) {
    subscriptionSet.dueBy = dueAt;
  }

  // A team hostel is live from the moment it is filed; its plan runs from then.
  if (invoice.source === "TEAM" && subscription && !subscription.currentPeriodEnd) {
    Object.assign(subscriptionSet, { activatedAt: periodStart, currentPeriodEnd: periodEnd });
  }

  console.log(
    `\n${invoice.invoiceNumber} ${invoice.status} ${invoice.source} — ${hostel?.name ?? invoice.hostelId} (${hostel?.status ?? "?"})`,
  );
  console.log(`  issued  ${bs(issuedAt)}`);
  console.log(
    `  due     ${bs(invoice.dueAt)} -> ${bs(dueAt)}${invoiceSet.dueAt ? "" : "  (unchanged)"}`,
  );

  if (subscriptionSet.dueBy) {
    console.log(`  sub     dueBy ${bs(subscription.dueBy)} -> ${bs(dueAt)}`);
  }

  if (subscriptionSet.currentPeriodEnd) {
    console.log(`  plan    from ${bs(periodStart)} through ${bs(periodEnd)}`);
  }

  if (invoice.softmatoInvoiceNo && invoiceSet.dueAt) {
    console.log(`  note    Softmato's ${invoice.softmatoInvoiceNo} still prints the old due date`);
  }

  const touchesInvoice = Object.keys(invoiceSet).length > 0;
  const touchesSubscription = Object.keys(subscriptionSet).length > 0;

  if (!touchesInvoice && !touchesSubscription) continue;

  changed += 1;

  if (dryRun) continue;

  if (touchesInvoice) {
    await db
      .collection("subscriptioninvoices")
      .updateOne({ _id: invoice._id }, { $set: invoiceSet });
  }

  if (touchesSubscription) {
    await db
      .collection("hostelsubscriptions")
      .updateOne({ _id: subscription._id }, { $set: subscriptionSet });
  }

  await audit("SUBSCRIPTION_TRIAL_CORRECTED", "SubscriptionInvoice", invoice._id, invoice.hostelId, {
    corrected: { ...invoiceSet, ...subscriptionSet },
    invoiceNumber: invoice.invoiceNumber,
    previous: {
      activatedAt: subscription?.activatedAt ?? null,
      currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      dueAt: invoice.dueAt ?? null,
      dueBy: subscription?.dueBy ?? null,
    },
  });
}

console.log(
  dryRun
    ? `\n[dry] ${changed} invoice(s) would change; nothing written`
    : `\n${changed} invoice(s) corrected.`,
);

await mongoose.disconnect();
