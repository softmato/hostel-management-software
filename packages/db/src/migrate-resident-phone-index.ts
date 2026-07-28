/**
 * One-shot index migration: makes the resident phone-uniqueness index ignore
 * soft-deleted residents.
 *
 * `hostelId_1_phone_1` was created as a plain unique index, but deleting a
 * resident only sets `isDeleted: true` — the document stays. So a removed
 * resident kept their phone number reserved forever, and registering the same
 * person again failed with a raw `E11000 duplicate key` (surfacing as a 500).
 * This drops that index and recreates it with a partial filter on
 * `isDeleted: false`, which is what Resident.ts now declares.
 *
 * Usage: node --experimental-transform-types packages/db/src/migrate-resident-phone-index.ts
 * Reads MONGODB_URI from the repo-root .env, or from the environment if set.
 * Safe to run repeatedly — it is a no-op once the partial index is in place.
 * Pass --dry-run to print what would change without writing.
 */
// Driven through the raw driver rather than the Mongoose models: mongoose is
// CJS, so `node --experimental-transform-types` cannot resolve the named
// exports its model modules rely on.
import { existsSync } from "node:fs";
import path from "node:path";

import mongoose from "mongoose";

const INDEX_NAME = "hostelId_1_phone_1";

type IndexInfo = {
  key: Record<string, number>;
  name: string;
  partialFilterExpression?: Record<string, unknown>;
  unique?: boolean;
};

function isPartialOnLiveResidents(index: IndexInfo) {
  return index.partialFilterExpression?.isDeleted === false;
}

/**
 * Node does not read .env on its own, and requiring the caller to export the
 * URI first just turns a working command into "MONGODB_URI is not set". The
 * repo keeps a single .env at the root, two levels above this package.
 */
function loadRepoEnv() {
  if (process.env.MONGODB_URI) {
    return;
  }

  const envPath = path.resolve(import.meta.dirname, "../../../.env");

  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  loadRepoEnv();

  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set and no .env was found at the repo root.",
    );
  }

  await mongoose.connect(uri);

  const db = mongoose.connection.db;

  if (!db) {
    throw new Error("No database handle after connecting.");
  }

  const residents = db.collection("residents");

  // A document created before `isDeleted` existed has no such field, and a
  // partial index skips those entirely — which would silently drop uniqueness
  // for the oldest residents. Give them the schema default first.
  const missingFlag = await residents.countDocuments({
    isDeleted: { $exists: false },
  });

  if (missingFlag > 0) {
    console.log(`Residents without an isDeleted flag: ${missingFlag}`);

    if (!dryRun) {
      await residents.updateMany(
        { isDeleted: { $exists: false } },
        { $set: { isDeleted: false } },
      );
    }
  }

  const indexes = (await residents.indexes()) as unknown as IndexInfo[];
  const existing = indexes.find((index) => index.name === INDEX_NAME);

  if (existing && isPartialOnLiveResidents(existing)) {
    console.log(`${INDEX_NAME} is already partial — nothing to do.`);
    await mongoose.disconnect();
    return;
  }

  // Duplicates among live residents would make the new index fail to build, so
  // name them up front rather than dying on a driver error.
  const duplicates = await residents
    .aggregate([
      { $match: { isDeleted: false } },
      {
        $group: {
          _id: { hostelId: "$hostelId", phone: "$phone" },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

  if (duplicates.length > 0) {
    console.error(
      "Live residents share a phone within a hostel — resolve these before rerunning:",
    );
    for (const duplicate of duplicates) {
      console.error(
        `  hostel ${String(duplicate._id.hostelId)} phone ${String(duplicate._id.phone)} ×${duplicate.count}`,
      );
    }
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    console.log(
      existing
        ? `Would drop ${INDEX_NAME} and recreate it with partialFilterExpression { isDeleted: false }.`
        : `Would create ${INDEX_NAME} with partialFilterExpression { isDeleted: false }.`,
    );
    await mongoose.disconnect();
    return;
  }

  if (existing) {
    await residents.dropIndex(INDEX_NAME);
    console.log(`Dropped ${INDEX_NAME}.`);
  }

  await residents.createIndex(
    { hostelId: 1, phone: 1 },
    {
      name: INDEX_NAME,
      partialFilterExpression: { isDeleted: false },
      unique: true,
    },
  );
  console.log(`Recreated ${INDEX_NAME} as a partial unique index.`);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exitCode = 1;
});
