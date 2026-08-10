/**
 * Backfill `fileAssets.hostelId`.
 *
 * Block 0 item 0.1(b) of docs/FINANCE_IMPLEMENTATION_PLAN.md. The file-access
 * route is about to default-deny any private asset whose `hostelId` does not
 * match the caller's tenancy. Payment proofs — and every other asset presigned
 * before the presign route learned to record a hostel — currently have no
 * `hostelId` at all, so they must be labelled *before* the stricter check ships
 * or they become unreadable.
 *
 * Two passes, most authoritative first:
 *   1. Payment proofs: `paymentProofs.proofImageAssetId` -> that proof's
 *      `hostelId`. This is the finance-critical set and the reason 0.1 exists.
 *   2. Everything else still missing a `hostelId`, resolved from the asset's
 *      owner when that user belongs to exactly one hostel. An ambiguous owner
 *      (multi-hostel staff) or a platform user is left alone and reported —
 *      guessing a tenant is worse than an asset only its owner can read.
 *
 * Idempotent. Pass --dry-run to preview without writing:
 *
 *   npm --prefix apps/web run backfill:fileasset-hostel -- --dry-run
 *
 * Use that form, not the root `web:backfill:fileasset-hostel` alias — the extra
 * npm layer swallows the flag, and a silently-not-dry run is a real write.
 */
import nextEnv from "@next/env";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

nextEnv.loadEnvConfig(repoRoot);

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required to run the FileAsset hostel backfill.");
}

const dryRun = process.argv.includes("--dry-run") || process.argv.includes("--dry");
const log = (message) => console.log(`${dryRun ? "[dry] " : ""}${message}`);

await mongoose.connect(process.env.MONGODB_URI);

const db = mongoose.connection.db;
const fileAssets = db.collection("fileassets");
const paymentProofs = db.collection("paymentproofs");
const users = db.collection("users");
const hostels = db.collection("hostels");

const toObjectId = (value) => {
  if (!value) {
    return null;
  }

  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  const text = String(value);

  return mongoose.Types.ObjectId.isValid(text) ? new mongoose.Types.ObjectId(text) : null;
};

/** hostelId -> { proofs, owned } counts, for the per-hostel report. */
const assigned = new Map();

function record(hostelId, bucket) {
  const key = hostelId.toString();
  const row = assigned.get(key) ?? { owned: 0, proofs: 0 };
  row[bucket] += 1;
  assigned.set(key, row);
}

const before = await fileAssets.countDocuments({ hostelId: { $exists: false } });
log(`${before} file assets have no hostelId.`);

// ---------------------------------------------------------------- pass 1
// `proofImageAssetId` is a plain string, never a ref, so it is joined by hand.
const proofs = await paymentProofs
  .find({}, { projection: { hostelId: 1, proofImageAssetId: 1 } })
  .toArray();

let proofUpdates = 0;
let proofUnresolved = 0;

for (const proof of proofs) {
  const assetId = toObjectId(proof.proofImageAssetId);

  if (!assetId || !proof.hostelId) {
    proofUnresolved += 1;
    continue;
  }

  const result = dryRun
    ? await fileAssets.countDocuments({ _id: assetId, hostelId: { $exists: false } })
    : (
        await fileAssets.updateOne(
          { _id: assetId, hostelId: { $exists: false } },
          { $set: { hostelId: proof.hostelId } },
        )
      ).modifiedCount;

  if (result > 0) {
    proofUpdates += 1;
    record(proof.hostelId, "proofs");
  }
}

log(
  `Pass 1 — payment proofs: ${proofUpdates} assets labelled, ` +
    `${proofUnresolved} proofs with an unusable asset id or no hostel.`,
);

// ---------------------------------------------------------------- pass 2
const orphans = await fileAssets
  .find({ hostelId: { $exists: false } }, { projection: { ownerId: 1 } })
  .toArray();

const ownerIds = [
  ...new Map(
    orphans
      .map((asset) => toObjectId(asset.ownerId))
      .filter(Boolean)
      .map((id) => [id.toString(), id]),
  ).values(),
];

const owners = ownerIds.length
  ? await users
      .find({ _id: { $in: ownerIds } }, { projection: { hostelIds: 1 } })
      .toArray()
  : [];

const soleHostelByOwner = new Map(
  owners
    .filter((owner) => Array.isArray(owner.hostelIds) && owner.hostelIds.length === 1)
    .map((owner) => [owner._id.toString(), owner.hostelIds[0]]),
);

let ownerUpdates = 0;
let ownerAmbiguous = 0;

for (const asset of orphans) {
  const ownerId = toObjectId(asset.ownerId);
  const hostelId = ownerId ? soleHostelByOwner.get(ownerId.toString()) : null;

  if (!hostelId) {
    ownerAmbiguous += 1;
    continue;
  }

  if (!dryRun) {
    await fileAssets.updateOne({ _id: asset._id }, { $set: { hostelId } });
  }

  ownerUpdates += 1;
  record(hostelId, "owned");
}

log(
  `Pass 2 — sole-hostel owners: ${ownerUpdates} assets labelled, ` +
    `${ownerAmbiguous} left unlabelled (no owner, platform user, or multi-hostel staff).`,
);

// ---------------------------------------------------------------- report
const hostelNames = new Map(
  (
    await hostels
      .find(
        {
          _id: {
            $in: [...assigned.keys()].map(toObjectId).filter(Boolean),
          },
        },
        { projection: { name: 1 } },
      )
      .toArray()
  ).map((hostel) => [hostel._id.toString(), hostel.name]),
);

console.log("");
console.log("Hostel                                    proofs   owned   total");
console.log("---------------------------------------------------------------");

for (const [hostelId, row] of [...assigned.entries()].sort(
  (a, b) => b[1].proofs + b[1].owned - (a[1].proofs + a[1].owned),
)) {
  const name = (hostelNames.get(hostelId) ?? hostelId).slice(0, 38).padEnd(40);
  console.log(
    `${name}${String(row.proofs).padStart(6)}${String(row.owned).padStart(8)}` +
      `${String(row.proofs + row.owned).padStart(8)}`,
  );
}

const after = dryRun
  ? before - proofUpdates - ownerUpdates
  : await fileAssets.countDocuments({ hostelId: { $exists: false } });

console.log("");
log(`Assets without a hostelId: ${before} before -> ${after} after.`);

if (after > 0) {
  log(
    "Remaining assets stay readable by their owner and by SUPERADMIN only. " +
      "Re-run after any of their owners is attached to a hostel.",
  );
}

await mongoose.disconnect();
