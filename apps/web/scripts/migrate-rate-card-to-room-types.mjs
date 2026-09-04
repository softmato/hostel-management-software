/**
 * Re-keys every rate card on `roomType`, then writes each hostel's listing from
 * its card.
 *
 * ## Why
 *
 * A price used to live in three places a human could type into —
 * `FeeSchedule.rates[].monthlyAmount`, `Hostel.roomConfigurations[].monthlyRent`
 * and `Hostel.pricing.monthlyRentMin/Max` — and nothing compared them. The rate
 * card was keyed by `bedType`, a five-value enum derived from free text; the
 * listing was keyed by the free text itself. They could not be reconciled one to
 * one, so both had to exist, and they drifted: one hostel advertised a single
 * room at 18,000, had 180,000 on its card, and invoiced a resident 174,000.
 *
 * The card is now the single source and the listing is projected from it. This
 * brings existing data to that shape.
 *
 * ## What it does
 *
 *   1. For every schedule, gives each rate the hostel's own `roomType` string,
 *      matched through `normalizeBedType`. A room type the card does not price
 *      gains a rate from its listed rent, so nothing that was billable stops
 *      being billable.
 *   2. For every hostel with an open schedule, writes that schedule's rents onto
 *      `roomConfigurations[].monthlyRent` and recomputes
 *      `pricing.monthlyRentMin/Max` and `pricing.admissionFee`.
 *
 * ## What it refuses to do
 *
 * Guess. A bed type that matches two of a hostel's room types — `"Private"` and
 * `"Single Room"` are both `SINGLE` — is **reported, not split**: the rate stays
 * keyed by bed type, `rateForRoomType` still prices it, and a human decides
 * which room type it belonged to. Silently picking one is the class of mistake
 * this whole change removes.
 *
 * Closed (historical) schedules are re-keyed too, because an invoice raised in
 * March must stay explicable, but their hostels' listings are written only from
 * the **open** card.
 *
 * Idempotent. Preview first:
 *
 *   npm --prefix apps/web run migrate:rate-card-room-types -- --dry-run
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
const log = (message) => console.log(`${dryRun ? "[dry] " : ""}${message}`);

/**
 * Mirror of `modules/finance/bed-type.ts`, for the same reason
 * `seed-fee-schedules.mjs` carries one: these scripts are plain `.mjs` run by
 * node with no TypeScript loader. The table there is covered by
 * `bed-type.test.ts`; any change to it must be echoed here.
 */
const EXACT = new Map();

const normalizeKey = (value) =>
  String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

const register = (bedType, ...spellings) => {
  for (const spelling of spellings) {
    EXACT.set(normalizeKey(spelling), bedType);
  }
};

register(
  "SINGLE",
  "Single",
  "Single Room",
  "Single Occupancy",
  "Private",
  "Private Room",
  "One Seater",
  "1 Seater",
  "ONE_SEATER",
);
register(
  "DOUBLE_SHARING",
  "Double",
  "Double Sharing",
  "Double Room",
  "Two Sharing",
  "Twin Sharing",
  "Two Seater",
  "2 Seater",
  "TWO_SEATER",
);
register(
  "TRIPLE_SHARING",
  "Triple",
  "Triple Sharing",
  "Three Sharing",
  "Three Seater",
  "3 Seater",
  "THREE_SEATER",
);
register(
  "FOUR_SHARING",
  "Four Sharing",
  "Four Seater",
  "Quad",
  "Quad Sharing",
  "4 Seater",
  "FOUR_SEATER",
);
register("DORMITORY", "Dormitory", "Dorm", "Hostel Bed", "Bunk");

const normalizeBedType = (roomType) => EXACT.get(normalizeKey(roomType)) ?? null;

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;

const hostels = await db
  .collection("hostels")
  .find({ isDeleted: { $ne: true } })
  .project({ name: 1, pricing: 1, roomConfigurations: 1 })
  .toArray();

let ratesKeyed = 0;
let ratesAdded = 0;
let schedulesTouched = 0;
let listingsProjected = 0;
const ambiguous = [];

for (const hostel of hostels) {
  const configurations = hostel.roomConfigurations ?? [];
  const schedules = await db
    .collection("feeschedules")
    .find({ hostelId: hostel._id })
    .sort({ effectiveFrom: -1 })
    .toArray();

  if (schedules.length === 0) {
    continue;
  }

  for (const schedule of schedules) {
    let changed = false;
    const rates = [];

    for (const rate of schedule.rates ?? []) {
      if (rate.roomType) {
        rates.push(rate);
        continue;
      }

      const candidates = configurations.filter(
        (configuration) => normalizeBedType(configuration.roomType) === rate.bedType,
      );

      if (candidates.length === 1) {
        rates.push({ ...rate, roomType: candidates[0].roomType });
        ratesKeyed += 1;
        changed = true;
        continue;
      }

      if (candidates.length > 1) {
        // Reported, not split. A human decides which room type this rate was.
        ambiguous.push({
          bedType: rate.bedType,
          hostel: hostel.name,
          roomTypes: candidates.map((configuration) => configuration.roomType),
        });
      }

      rates.push(rate);
    }

    /*
     * A room type the card never priced, but the owner listed a rent against.
     * Under bed-type keying those residents billed `MANUAL` off the listing;
     * folding the figure into the card keeps them billing the same amount from
     * the source everything now reads.
     */
    const keyed = new Set(rates.filter((r) => r.roomType).map((r) => normalizeKey(r.roomType)));

    for (const configuration of configurations) {
      if (
        configuration.roomType &&
        typeof configuration.monthlyRent === "number" &&
        configuration.monthlyRent > 0 &&
        !keyed.has(normalizeKey(configuration.roomType))
      ) {
        rates.push({
          bedType: normalizeBedType(configuration.roomType),
          currency: hostel.pricing?.currency ?? "NPR",
          monthlyAmount: configuration.monthlyRent,
          roomType: configuration.roomType,
        });
        ratesAdded += 1;
        changed = true;
      }
    }

    if (!changed) {
      continue;
    }

    schedulesTouched += 1;
    log(
      `${hostel.name}: schedule ${schedule._id} -> ${rates
        .map((r) => `${r.roomType ?? r.bedType}=${r.monthlyAmount}`)
        .join(", ")}`,
    );

    if (!dryRun) {
      await db
        .collection("feeschedules")
        .updateOne({ _id: schedule._id }, { $set: { rates } });
    }
  }

  // The listing follows the open card, and only the open one.
  const open = await db
    .collection("feeschedules")
    .findOne({ effectiveTo: null, hostelId: hostel._id });

  if (!open) {
    continue;
  }

  const rateByKey = new Map(
    (open.rates ?? [])
      .filter((rate) => rate.roomType)
      .map((rate) => [normalizeKey(rate.roomType), rate.monthlyAmount]),
  );

  const roomConfigurations = configurations.map((configuration) => {
    const rent = rateByKey.get(normalizeKey(configuration.roomType));

    return rent === undefined ? configuration : { ...configuration, monthlyRent: rent };
  });

  const rents = roomConfigurations
    .map((configuration) => configuration.monthlyRent)
    .filter((rent) => typeof rent === "number" && rent > 0);

  const set = { roomConfigurations };

  if (rents.length > 0) {
    set["pricing.monthlyRentMin"] = Math.min(...rents);
    set["pricing.monthlyRentMax"] = Math.max(...rents);
  }

  if (typeof open.admissionFee === "number") {
    set["pricing.admissionFee"] = open.admissionFee;
  }

  const before = configurations
    .map((c) => `${c.roomType}=${c.monthlyRent}`)
    .join(", ");
  const after = roomConfigurations
    .map((c) => `${c.roomType}=${c.monthlyRent}`)
    .join(", ");

  if (before !== after) {
    log(`${hostel.name}: listing ${before}  ->  ${after}`);
  }

  listingsProjected += 1;

  if (!dryRun) {
    await db.collection("hostels").updateOne({ _id: hostel._id }, { $set: set });
  }
}

console.log("");
console.log(`schedules updated:     ${schedulesTouched}`);
console.log(`rates given a room type: ${ratesKeyed}`);
console.log(`rates added from listing: ${ratesAdded}`);
console.log(`listings projected:    ${listingsProjected}`);

if (ambiguous.length > 0) {
  console.log("");
  console.log("NEEDS A HUMAN — one bed type matches several room types:");
  for (const entry of ambiguous) {
    console.log(`  ${entry.hostel}: ${entry.bedType} -> ${entry.roomTypes.join(" / ")}`);
  }
  console.log("Open the rate card for those hostels and enter a rate per room type.");
}

await mongoose.disconnect();
