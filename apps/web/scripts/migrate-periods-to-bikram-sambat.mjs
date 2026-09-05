/**
 * Re-key every invoice from a Gregorian month to the Bikram Sambat one.
 *
 * ## What changed under these rows
 *
 * A billing period used to be a Gregorian month — `2026-08` — and the screens
 * printed a Nepali name over it by working out which BS month covered most of
 * that span. The arithmetic underneath was the wrong month's: Bhadra 2083 runs
 * 17 August to 16 September 2026 and has 31 days, so a resident admitted on
 * Bhadra 19 owed 13 of 31 days and was billed 28 of September's 30.
 *
 * Billing now keys on the BS month directly (`2083-05`). Rows written before
 * that still carry Gregorian keys, and every reader in the product tells the two
 * apart by the year — the calendars are 57 years apart and nothing this product
 * bills sits near the boundary — so nothing is *broken* until this runs. What is
 * wrong is subtler and worth fixing: the old rows sort into the same column as
 * the new ones and read as a different calendar, and the double-billing index is
 * keyed on `period`, so a month re-billed after the change would not collide
 * with its own pre-change invoice.
 *
 * ## The mapping is the label the resident already saw
 *
 * Each invoice takes the BS month that covered the majority of its Gregorian
 * one — which is exactly what `formatPeriodBs` was drawing on that invoice
 * before this. So no resident's statement changes wording; only the key does.
 *
 * **Amounts are not recomputed.** They are snapshots, and a settled invoice's
 * figure is what somebody actually paid. Re-prorating history onto BS bounds
 * would rewrite bills people have receipts for.
 *
 * ## Collisions are reported, never resolved
 *
 * Two consecutive Gregorian months can land on one BS month, and the unique
 * `(hostelId, residentId, period, kind)` index would refuse the second write.
 * That is a real double-billing question — which of two rent invoices is this
 * resident's Bhadra rent? — and it is not a script's to answer. Those rows are
 * listed and left alone.
 *
 * Fee schedules are deliberately untouched: `effectiveFrom` is a date, not a
 * period key, and `getEffectiveSchedule` is a range query that answers correctly
 * whatever day a card starts on. Pulling old cards back to a BS month start
 * would extend them backwards over months they never priced.
 *
 * Idempotent — a row already carrying a BS key is skipped. Preview with
 *
 *   npm --prefix apps/web run migrate:bs-periods -- --dry-run
 *
 * Use that form, not the root alias — the extra npm layer swallows the flag.
 */
import nextEnv from "@next/env";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  bsPeriodOf,
  formatBsPeriod,
  isBsPeriod,
} from "../../../packages/shared/src/calendar/bs.ts";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

nextEnv.loadEnvConfig(repoRoot);

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required to migrate invoice periods.");
}

const dryRun = process.argv.includes("--dry-run") || process.argv.includes("--dry");
const log = (message) => console.log(`${dryRun ? "[dry] " : ""}${message}`);

/**
 * The BS month that covers most of a Gregorian one.
 *
 * Counted day by day rather than taken from the 15th, because BS month lengths
 * vary from 29 to 32 days per year and the boundary does not sit in the same
 * place twice. Ties keep the month the period started in, matching the strict
 * comparison every other majority walk in this codebase uses.
 */
function bsMajorityPeriod(period) {
  const match = /^(\d{4})-(\d{2})$/.exec(period ?? "");

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const tally = new Map();

  for (let day = 1; day <= days; day += 1) {
    const key = bsPeriodOf(new Date(Date.UTC(year, month - 1, day)));

    tally.set(key, (tally.get(key) ?? 0) + 1);
  }

  let winner = null;

  for (const [key, count] of tally) {
    if (!winner || count > winner.count) {
      winner = { count, key };
    }
  }

  return winner?.key ?? null;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const invoices = mongoose.connection.collection("invoices");

  const rows = await invoices
    .find(
      { period: { $type: "string" } },
      { projection: { hostelId: 1, kind: 1, period: 1, residentId: 1, status: 1 } },
    )
    .sort({ _id: 1 })
    .toArray();

  const legacy = rows.filter((row) => !isBsPeriod(row.period));

  log(`${rows.length} invoice(s) with a period; ${legacy.length} still Gregorian.`);

  if (legacy.length === 0) {
    log("Nothing to migrate.");

    return;
  }

  /*
   * Every key that will exist once this finishes — the BS rows already present
   * plus the ones about to be written. Checked before any write so a collision
   * is reported rather than half-applied.
   */
  const occupied = new Set(
    rows
      .filter((row) => isBsPeriod(row.period) && row.status !== "VOID")
      .map((row) => slot(row, row.period)),
  );

  const planned = [];
  const collisions = [];

  for (const row of legacy) {
    const target = bsMajorityPeriod(row.period);

    if (!target) {
      collisions.push({ reason: "UNCONVERTIBLE", row, target: null });
      continue;
    }

    const key = slot(row, target);

    // VOID rows are outside the unique index and cannot collide with anything.
    if (row.status !== "VOID" && occupied.has(key)) {
      collisions.push({ reason: "PERIOD_TAKEN", row, target });
      continue;
    }

    if (row.status !== "VOID") {
      occupied.add(key);
    }

    planned.push({ row, target });
  }

  const moves = new Map();

  for (const { row, target } of planned) {
    const label = `${row.period} → ${target} (${formatBsPeriod(target)})`;

    moves.set(label, (moves.get(label) ?? 0) + 1);
  }

  for (const [label, count] of [...moves].sort()) {
    log(`  ${label}: ${count} invoice(s)`);
  }

  if (collisions.length > 0) {
    console.warn(
      `\n${collisions.length} invoice(s) left alone — resolve these by hand:`,
    );

    for (const { reason, row, target } of collisions) {
      console.warn(
        `  ${row._id} resident=${row.residentId} ${row.kind} ${row.period}` +
          ` → ${target ?? "?"}  [${reason}]`,
      );
    }
  }

  if (dryRun) {
    log(`\nWould re-key ${planned.length} invoice(s). No writes made.`);

    return;
  }

  let written = 0;

  for (const { row, target } of planned) {
    await invoices.updateOne({ _id: row._id }, { $set: { period: target } });
    written += 1;
  }

  log(`\nRe-keyed ${written} invoice(s).`);
}

/** The unique index's own tuple, as a string. */
function slot(row, period) {
  return `${row.hostelId}|${row.residentId}|${period}|${row.kind}`;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
