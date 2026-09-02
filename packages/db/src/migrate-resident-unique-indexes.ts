/**
 * Builds the resident uniqueness indexes the schema declares, for real.
 *
 * ## Why this exists rather than trusting Mongoose
 *
 * `Resident.ts` declares two partial unique indexes — `(hostelId, phone)` and
 * `(hostelId, email)` over live residents — and declaring one is not the same as
 * having one. Mongoose builds indexes in the background on first model use and
 * **swallows the failure**: the build emits an `index` event that nothing in
 * this app listens for. So a collection that already holds duplicates rejects
 * the build, nobody is told, and the constraint the service code believes in
 * simply is not there. Two residents on one mailbox is what that looks like from
 * the outside, months later.
 *
 * The service pre-checks both fields before it writes, but a pre-check is a
 * race, not a constraint: two intakes submitted at once both read "no conflict"
 * and both insert. The index is the thing that actually closes it.
 *
 * ## Why partial, and why the backfill
 *
 * Deletion is soft (`isDeleted`), so a plain unique index keeps a removed
 * resident's number reserved forever and makes re-registering the same person
 * fail with a raw `E11000` surfacing as a 500. The partial filter scopes
 * uniqueness to residents still on the roll.
 *
 * A document created before `isDeleted` existed has no such field, and a partial
 * filter on `isDeleted: false` skips those entirely — which would silently drop
 * uniqueness for the oldest residents, the ones most likely to have collected a
 * duplicate. They get the schema default first.
 *
 * `email` is optional, so its filter requires a string as well as a live record:
 * a plain sparse index would still let two residents share `null`, and a plain
 * unique one would forbid the second resident who simply has no email.
 *
 * Usage: node --experimental-transform-types packages/db/src/migrate-resident-unique-indexes.ts
 * Reads MONGODB_URI from the repo-root .env, or from the environment if set.
 * Safe to run repeatedly — it is a no-op once both partial indexes are in place.
 * Pass --dry-run to print what would change without writing.
 *
 * It refuses to build an index over existing duplicates and **names them**
 * instead, because the fix is a judgement call about people: which of the two
 * records is the real one. Delete the wrong one through the portal — that is a
 * soft delete, so it frees the number and the mailbox — and run this again.
 */
// Driven through the raw driver rather than the Mongoose models: mongoose is
// CJS, so `node --experimental-transform-types` cannot resolve the named
// exports its model modules rely on.
import { existsSync } from "node:fs";
import path from "node:path";

import mongoose from "mongoose";

type IndexInfo = {
  key: Record<string, number>;
  name: string;
  partialFilterExpression?: Record<string, unknown>;
  unique?: boolean;
};

/** One index this script owns, and everything that differs between the two. */
type UniqueIndexSpec = {
  /** The document field, for the duplicate report and the `$type` guard. */
  field: "email" | "phone";
  key: Record<string, number>;
  name: string;
  /**
   * True when the field is optional, so the filter must also require a string.
   * Without it two residents with no email both match and collide on `null`.
   */
  optional: boolean;
};

const SPECS: UniqueIndexSpec[] = [
  {
    field: "phone",
    key: { hostelId: 1, phone: 1 },
    name: "hostelId_1_phone_1",
    optional: false,
  },
  {
    field: "email",
    key: { hostelId: 1, email: 1 },
    name: "hostelId_1_email_1",
    optional: true,
  },
];

function filterFor(spec: UniqueIndexSpec): Record<string, unknown> {
  return spec.optional
    ? { isDeleted: false, [spec.field]: { $type: "string" } }
    : { isDeleted: false };
}

/**
 * Whether the index in the database is the one the schema asks for.
 *
 * Checks the `$type` guard as well as the live-records filter: an email index
 * built without it is unique over `null` too, which forbids the second resident
 * who simply has no address — a working index that breaks intake.
 */
function matchesSpec(index: IndexInfo, spec: UniqueIndexSpec): boolean {
  const filter = index.partialFilterExpression;

  if (!index.unique || filter?.isDeleted !== false) {
    return false;
  }

  return spec.optional ? filter[spec.field] !== undefined : filter[spec.field] === undefined;
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

/**
 * Live residents sharing a value within one hostel.
 *
 * Blanks are excluded rather than reported: an absent phone or email is not a
 * collision, it is a field nobody filled in, and the partial index will not
 * cover those rows either.
 */
async function findDuplicates(
  // The raw driver's collection, not Mongoose's — see the note at the top about
  // why this script goes around the models.
  residents: NonNullable<mongoose.Connection["db"]> extends { collection: (name: string) => infer C }
    ? C
    : never,
  spec: UniqueIndexSpec,
) {
  return residents
    .aggregate([
      { $match: { isDeleted: false, [spec.field]: { $nin: [null, ""], $type: "string" } } },
      {
        $group: {
          _id: { hostelId: "$hostelId", value: `$${spec.field}` },
          count: { $sum: 1 },
          names: { $push: { $concat: ["$firstName", " ", "$lastName"] } },
          residentIds: { $push: "$_id" },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  loadRepoEnv();

  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI is not set and no .env was found at the repo root.");
  }

  await mongoose.connect(uri);

  const db = mongoose.connection.db;

  if (!db) {
    throw new Error("No database handle after connecting.");
  }

  const residents = db.collection("residents");

  const missingFlag = await residents.countDocuments({ isDeleted: { $exists: false } });

  if (missingFlag > 0) {
    console.log(`Residents without an isDeleted flag: ${missingFlag}`);

    if (!dryRun) {
      await residents.updateMany(
        { isDeleted: { $exists: false } },
        { $set: { isDeleted: false } },
      );
      console.log("Backfilled isDeleted: false.");
    }
  }

  let blocked = false;

  for (const spec of SPECS) {
    const indexes = (await residents.indexes()) as unknown as IndexInfo[];
    const existing = indexes.find((index) => index.name === spec.name);

    if (existing && matchesSpec(existing, spec)) {
      console.log(`${spec.name} is already correct — nothing to do.`);
      continue;
    }

    // Duplicates would make the build fail, so name them up front rather than
    // dying on a driver error that says only "E11000".
    const duplicates = await findDuplicates(residents, spec);

    if (duplicates.length > 0) {
      blocked = true;
      console.error(
        // "an email", "a phone" — the field name is user-facing in this line,
        // and a wrong article in an error somebody reads at 11pm reads as a bug.
        `\nLive residents share ${spec.optional ? "an" : "a"} ${spec.field} within a hostel. ` +
          "Delete the wrong record through the portal, then rerun:",
      );

      for (const duplicate of duplicates) {
        console.error(
          `  hostel ${String(duplicate._id.hostelId)} · ${spec.field} ${String(
            duplicate._id.value,
          )} ×${duplicate.count}`,
        );
        for (const [at, residentId] of (duplicate.residentIds as unknown[]).entries()) {
          console.error(
            `      ${String(residentId)}  ${String((duplicate.names as unknown[])[at] ?? "")}`,
          );
        }
      }

      continue;
    }

    if (dryRun) {
      console.log(
        existing
          ? `Would drop ${spec.name} and recreate it with ${JSON.stringify(filterFor(spec))}.`
          : `Would create ${spec.name} with ${JSON.stringify(filterFor(spec))}.`,
      );
      continue;
    }

    if (existing) {
      await residents.dropIndex(spec.name);
      console.log(`Dropped ${spec.name}.`);
    }

    await residents.createIndex(spec.key, {
      name: spec.name,
      partialFilterExpression: filterFor(spec),
      unique: true,
    });
    console.log(`Created ${spec.name} as a partial unique index.`);
  }

  await mongoose.disconnect();

  if (blocked) {
    // Non-zero, so this cannot pass silently in a deploy step: an index that was
    // not built is a constraint the application code thinks it has.
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exitCode = 1;
});
