/**
 * Seed each hostel's first `FeeSchedule` from its room configurations.
 *
 * Block 1 item 1.3 / §7.3 of docs/FINANCE_IMPLEMENTATION_PLAN.md. A de-facto
 * rate card already exists — `hostel.roomConfigurations[].monthlyRent`, rendered
 * today as the "Fee Plans" page (D2) — so the first schedule is built from it
 * rather than from an empty screen the owner has to fill in twice.
 *
 * After this, the two diverge on purpose: `roomConfigurations[].monthlyRent`
 * stays the **public listing price**, `FeeSchedule` becomes the **billing
 * price**. They must not be auto-synced.
 *
 * Three passes:
 *   1. One open `FeeSchedule` per hostel, rates keyed by
 *      `normalizeBedType(roomType)`. Unmappable room types are **reported, not
 *      guessed** — the owner resolves them in the editor, and until then those
 *      residents fail billing with BED_TYPE_NOT_PRICED, visibly. A loud failure
 *      beats a silent wrong rate.
 *   2. `resident.bedType` <- normalizeBedType(resident.roomType), where it maps.
 *   3. `resident.monthlyFee` -> null where it already equals the scheduled rate
 *      for that resident's bed type, so the schedule governs going forward.
 *      A fee that differs is **kept as an override** with an explanatory reason
 *      rather than being overwritten — it may well be a real arrangement.
 *
 * Idempotent: a hostel with an open schedule is skipped. Preview with
 *
 *   npm --prefix apps/web run seed:fee-schedules -- --dry-run
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
  throw new Error("MONGODB_URI is required to seed fee schedules.");
}

const dryRun = process.argv.includes("--dry-run") || process.argv.includes("--dry");
const log = (message) => console.log(`${dryRun ? "[dry] " : ""}${message}`);

/**
 * Mirror of `modules/finance/bed-type.ts`. Duplicated because these scripts are
 * plain `.mjs` run by node with no TypeScript loader — the mapping table is
 * covered by `bed-type.test.ts`, and any change there must be echoed here.
 */
const BED_TYPE_BY_KEY = new Map();

function normalizeKey(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function register(bedType, ...spellings) {
  for (const spelling of spellings) {
    BED_TYPE_BY_KEY.set(normalizeKey(spelling), bedType);
  }
}

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
register("DORMITORY", "Dormitory", "Dorm", "Dorm Bed", "DORMITORY");

const COUNTED = /^(\d{1,2})(SEATER|SHARING|SHARED|BED|BEDS|PERSON|PAX)$/;
const BY_OCCUPANCY = {
  1: "SINGLE",
  2: "DOUBLE_SHARING",
  3: "TRIPLE_SHARING",
  4: "FOUR_SHARING",
};

function normalizeBedType(roomType) {
  const key = normalizeKey(roomType);

  if (!key) {
    return null;
  }

  if (BED_TYPE_BY_KEY.has(key)) {
    return BED_TYPE_BY_KEY.get(key);
  }

  const counted = COUNTED.exec(key);

  if (counted) {
    const occupancy = Number(counted[1]);

    return occupancy >= 5 ? "DORMITORY" : (BY_OCCUPANCY[occupancy] ?? null);
  }

  return null;
}

await mongoose.connect(process.env.MONGODB_URI);

const db = mongoose.connection.db;
const hostels = db.collection("hostels");
const residents = db.collection("residents");
const feeSchedules = db.collection("feeschedules");

const effectiveFrom = new Date(
  Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
);

const all = await hostels
  .find({}, { projection: { admissionFee: 1, name: 1, roomConfigurations: 1 } })
  .toArray();

let seeded = 0;
let skipped = 0;
const unmappable = new Map();
const rows = [];

for (const hostel of all) {
  const existing = await feeSchedules.findOne({
    effectiveTo: null,
    hostelId: hostel._id,
  });

  if (existing) {
    skipped += 1;
    continue;
  }

  const rates = new Map();

  for (const config of hostel.roomConfigurations ?? []) {
    const bedType = normalizeBedType(config.roomType);
    const monthlyRent = config.monthlyRent;

    if (!bedType) {
      const list = unmappable.get(hostel.name) ?? new Set();
      list.add(config.roomType);
      unmappable.set(hostel.name, list);
      continue;
    }

    if (!Number.isFinite(monthlyRent) || monthlyRent <= 0) {
      continue;
    }

    // Two spellings of one bed type ("Two Sharing" and "Double Sharing") can
    // both be configured. Highest wins, and the divergence is reported.
    const rounded = Math.round(monthlyRent);
    rates.set(bedType, Math.max(rates.get(bedType) ?? 0, rounded));
  }

  if (rates.size === 0) {
    rows.push({ hostel: hostel.name, note: "no priced room types", rates: 0 });
    continue;
  }

  if (!dryRun) {
    await feeSchedules.insertOne({
      admissionFee: Number.isFinite(hostel.admissionFee)
        ? Math.round(hostel.admissionFee)
        : undefined,
      createdAt: new Date(),
      effectiveFrom,
      effectiveTo: null,
      hostelId: hostel._id,
      rates: [...rates].map(([bedType, monthlyAmount]) => ({
        bedType,
        currency: "NPR",
        monthlyAmount,
      })),
      updatedAt: new Date(),
    });
  }

  seeded += 1;
  rows.push({
    hostel: hostel.name,
    note: [...rates].map(([type, amount]) => `${type} ${amount}`).join(", "),
    rates: rates.size,
  });
}

console.log("");
console.log("Hostel                                  rates  detail");
console.log("------------------------------------------------------------------");

for (const row of rows) {
  console.log(
    `${String(row.hostel).slice(0, 36).padEnd(38)}${String(row.rates).padStart(5)}  ${row.note}`,
  );
}

log(`\nSeeded ${seeded} schedules, skipped ${skipped} hostels that already had one.`);

if (unmappable.size > 0) {
  console.log("");
  log("Room types with no bed-type mapping — resolve these in the fee editor:");

  for (const [hostel, types] of unmappable) {
    log(`  ${hostel}: ${[...types].join(", ")}`);
  }

  log("Residents on those room types will fail billing with BED_TYPE_NOT_PRICED.");
}

/* ---------------------------------------------------- residents: bedType */

const residentRows = await residents
  .find(
    { isDeleted: { $ne: true } },
    { projection: { bedType: 1, hostelId: 1, monthlyFee: 1, roomType: 1 } },
  )
  .toArray();

let bedTypeSet = 0;
let bedTypeUnmapped = 0;
let demoted = 0;
let keptAsOverride = 0;

const scheduleByHostel = new Map();

for (const resident of residentRows) {
  const bedType = resident.bedType ?? normalizeBedType(resident.roomType);

  if (!bedType) {
    bedTypeUnmapped += 1;
    continue;
  }

  if (!resident.bedType) {
    if (!dryRun) {
      await residents.updateOne({ _id: resident._id }, { $set: { bedType } });
    }

    bedTypeSet += 1;
  }

  const hostelKey = resident.hostelId?.toString();

  if (!scheduleByHostel.has(hostelKey)) {
    scheduleByHostel.set(
      hostelKey,
      await feeSchedules.findOne({ effectiveTo: null, hostelId: resident.hostelId }),
    );
  }

  const schedule = scheduleByHostel.get(hostelKey);
  const rate = schedule?.rates?.find((entry) => entry.bedType === bedType);

  if (!rate || resident.monthlyFee === null || resident.monthlyFee === undefined) {
    continue;
  }

  if (resident.monthlyFee === rate.monthlyAmount) {
    // Matches the schedule, so the per-resident number carries no information.
    if (!dryRun) {
      await residents.updateOne({ _id: resident._id }, { $set: { monthlyFee: null } });
    }

    demoted += 1;
  } else if (resident.monthlyFee > 0) {
    // Differs — it may be a real arrangement, so it is kept and explained
    // rather than overwritten.
    if (!dryRun) {
      await residents.updateOne(
        { _id: resident._id },
        {
          $set: {
            feeOverrideReason: "migrated from per-resident fee",
            feeOverrideSetAt: new Date(),
          },
        },
      );
    }

    keptAsOverride += 1;
  } else {
    // Zero with a schedule available is the "billed nothing, nobody noticed"
    // case, not a deliberate free stay. The schedule takes over.
    if (!dryRun) {
      await residents.updateOne({ _id: resident._id }, { $set: { monthlyFee: null } });
    }

    demoted += 1;
  }
}

console.log("");
log(`Residents: bedType set on ${bedTypeSet}, unmappable ${bedTypeUnmapped}.`);
log(`Fees: ${demoted} demoted to the schedule, ${keptAsOverride} kept as overrides.`);

await mongoose.disconnect();
