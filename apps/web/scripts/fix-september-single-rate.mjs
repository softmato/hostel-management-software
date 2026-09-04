/**
 * Corrects a typo on the rate card that governs September 2026.
 *
 * Education Light Hostel's card effective 2026-08-31 carries `SINGLE: 180000`.
 * The hostel charges 18,000 — its own listing said so, the card before it said
 * so, and the card after it says so. The extra zero was typed into a rate-card
 * editor that has never shown the listing price beside the box, and it invoiced
 * a resident 174,000 for a part month before anybody noticed.
 *
 * ## Why this is a script and not a new rate card
 *
 * A schedule is normally never edited, because invoices are explained by the
 * card they were priced from. Two things make this the exception:
 *
 *   - Nothing is left standing against it. The only invoice it ever priced has
 *     been voided, so no figure anywhere depends on 180,000 being readable.
 *   - It cannot be superseded. `createFeeSchedule` only opens cards for future
 *     months — deliberately, so a rate cannot change under residents who are
 *     already being billed — and the card after this one starts in October. From
 *     the product there is no way to reach September at all.
 *
 * A card that never legitimately meant 180,000 is a typo, not history, and the
 * immutability rule is there to protect real invoices rather than mistakes.
 *
 * Refuses to run if any invoice was priced from this card. Preview with
 *
 *   npm --prefix apps/web run fix:september-single-rate -- --dry-run
 */
import nextEnv from "@next/env";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

nextEnv.loadEnvConfig(repoRoot);

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required.");
}

const dryRun = process.argv.includes("--dry-run") || process.argv.includes("--dry");

const SCHEDULE_ID = "6a8d3a1852ba1417a31acf33";
const BED_TYPE = "SINGLE";
const WRONG = 180000;
const RIGHT = 18000;

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;
const scheduleId = new mongoose.Types.ObjectId(SCHEDULE_ID);

const schedule = await db.collection("feeschedules").findOne({ _id: scheduleId });

if (!schedule) {
  throw new Error(`Schedule ${SCHEDULE_ID} was not found.`);
}

console.log(`schedule ${SCHEDULE_ID}`);
console.log(`  effective ${schedule.effectiveFrom?.toISOString()} -> ${schedule.effectiveTo?.toISOString() ?? "open"}`);
console.log(`  rates now: ${schedule.rates.map((r) => `${r.roomType ?? r.bedType}=${r.monthlyAmount}`).join(", ")}`);

const target = schedule.rates.find((rate) => rate.bedType === BED_TYPE);

if (!target) {
  throw new Error(`No ${BED_TYPE} rate on this card — nothing to correct.`);
}

if (target.monthlyAmount === RIGHT) {
  console.log("Already correct. Nothing to do.");
  await mongoose.disconnect();
  process.exit(0);
}

if (target.monthlyAmount !== WRONG) {
  throw new Error(
    `Expected ${BED_TYPE} to be ${WRONG}, found ${target.monthlyAmount}. Refusing to guess.`,
  );
}

/*
 * An invoice priced from *this rate* would stop being explicable if the rate
 * changed underneath it.
 *
 * Narrowed to the one rate on purpose. A card carries several — and an admission
 * fee, and a deposit — so most invoices citing this `feeScheduleId` have nothing
 * to do with `SINGLE`: a Four Sharing rent and a 2,000 admission fee are
 * unaffected by a single-room typo, and refusing on their account would make
 * this correction impossible for no benefit. What matters is whether any live
 * line was computed from the number being changed.
 */
const citing = await db
  .collection("invoices")
  .find({ "lines.feeScheduleId": scheduleId, status: { $ne: "VOID" } })
  .project({ lines: 1, referenceCode: 1, status: 1, totalAmount: 1 })
  .toArray();

const affected = citing.filter((invoice) =>
  (invoice.lines ?? []).some(
    (line) =>
      String(line.feeScheduleId) === SCHEDULE_ID &&
      (line.bedType === BED_TYPE ||
        (target.roomType && line.description?.includes(target.roomType))),
  ),
);

console.log(
  `  invoices citing this card: ${citing.length} (${affected.length} priced from ${BED_TYPE})`,
);

if (affected.length > 0) {
  console.error("");
  console.error(`Refusing: live invoices were priced from the ${BED_TYPE} rate:`);
  for (const invoice of affected) {
    console.error(`  ${invoice.referenceCode} ${invoice.status} ${invoice.totalAmount}`);
  }
  console.error("Void or reverse them first, then re-run.");
  await mongoose.disconnect();
  process.exit(1);
}

const rates = schedule.rates.map((rate) =>
  rate.bedType === BED_TYPE ? { ...rate, monthlyAmount: RIGHT } : rate,
);

console.log("");
console.log(`  ${BED_TYPE}: ${WRONG} -> ${RIGHT}`);

if (dryRun) {
  console.log("[dry] nothing written");
  await mongoose.disconnect();
  process.exit(0);
}

await db.collection("feeschedules").updateOne({ _id: scheduleId }, { $set: { rates } });

await db.collection("auditlogs").insertOne({
  action: "FEE_SCHEDULE_CORRECTED",
  actorId: schedule.createdBy,
  entityId: SCHEDULE_ID,
  entityType: "FeeSchedule",
  hostelId: schedule.hostelId,
  metadata: {
    bedType: BED_TYPE,
    corrected: RIGHT,
    previous: WRONG,
    reason:
      "Typed with an extra zero; the hostel's listing, the preceding card and the following card all say 18000. The only invoice priced from it was voided first.",
  },
  createdAt: new Date(),
  updatedAt: new Date(),
});

const after = await db.collection("feeschedules").findOne({ _id: scheduleId });

console.log("");
console.log(`  rates now: ${after.rates.map((r) => `${r.roomType ?? r.bedType}=${r.monthlyAmount}`).join(", ")}`);
console.log("September is corrected. Re-bill any resident who needs it from the Money tab.");

await mongoose.disconnect();
