/**
 * One-off: take archived hostels off every account that still lists them.
 *
 * `archivePlatformHostel` now pulls the hostel from `User.hostelIds` as it
 * archives it. Hostels archived before that change left the id behind, and each
 * of those owners has been minted a token carrying it ever since — which the
 * app reads as "this person manages several hostels" and answers with the
 * generic dashboard. `requireHostelStaffPrincipal` already filters archived ids
 * per request, so nothing is *broken* by the leftovers any more; this is so the
 * tokens themselves are right, and `sessionStale` rotates them on next open.
 *
 * Dry run by default — prints what it would change and writes nothing.
 *
 *   node scripts/prune-archived-hostel-refs.mjs           # report
 *   node scripts/prune-archived-hostel-refs.mjs --apply   # write
 *
 * Reads MONGODB_URI from the root `.env`, the single env file (see one-env-file).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import mongoose from "mongoose";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = readFileSync(path.resolve(here, "../../../.env"), "utf8");
const uri = env
  .match(/^MONGODB_URI=(.*)$/m)?.[1]
  ?.trim()
  .replace(/^["']|["']$/g, "");

if (!uri) {
  console.error("MONGODB_URI is not set in the root .env.");
  process.exit(1);
}

const apply = process.argv.includes("--apply");

await mongoose.connect(uri);

const db = mongoose.connection.db;
const archived = await db
  .collection("hostels")
  .find({ isDeleted: true })
  .project({ _id: 1, name: 1 })
  .toArray();

const archivedIds = archived.map((hostel) => hostel._id);
const affected = await db
  .collection("users")
  .find({ hostelIds: { $in: archivedIds } })
  .project({ email: 1, hostelIds: 1 })
  .toArray();

const names = new Map(archived.map((hostel) => [String(hostel._id), hostel.name]));

for (const user of affected) {
  const stale = user.hostelIds
    .map(String)
    .filter((id) => names.has(id))
    .map((id) => `${names.get(id)} (${id})`);

  console.log(`${user.email}: ${stale.join(", ")}`);
}

console.log(
  `\n${affected.length} account(s) list ${archivedIds.length} archived hostel(s).`,
);

if (apply && affected.length > 0) {
  const result = await db
    .collection("users")
    .updateMany(
      { hostelIds: { $in: archivedIds } },
      { $pull: { hostelIds: { $in: archivedIds } } },
    );

  console.log(`Updated ${result.modifiedCount} account(s).`);
} else if (!apply) {
  console.log("Dry run — nothing written. Re-run with --apply to change them.");
}

await mongoose.disconnect();
