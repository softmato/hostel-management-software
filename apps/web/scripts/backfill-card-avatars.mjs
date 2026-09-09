/**
 * Point stored card-photo avatars at the per-user route.
 *
 * `User.image` used to be set to `/api/v1/users/resident-identity/photo?v=…`
 * when somebody put a photo on their ID card. That route serves **the caller's
 * own** face and carries no id, so the value was only ever correct for the
 * person it belonged to: every other screen that draws that avatar — a resident
 * row, a community post, a roster — was asking for a photo of whoever was
 * reading. It now stores `/api/v1/users/:userId/avatar?v=…`, and this rewrites
 * the rows written before that.
 *
 * The version query is preserved where there is one, because it is what makes a
 * replaced photo bypass a browser cache; rows without one are given the
 * profile's `photoUpdatedAt`, falling back to `1`.
 *
 * Only the legacy self-photo path is touched. An avatar from anywhere else — a
 * Google sign-in, say — is the user's own and is left alone, reported at the
 * end.
 *
 * Idempotent. Dry by default; pass --apply to write:
 *
 *   npm --prefix apps/web run backfill:card-avatars
 *   npm --prefix apps/web run backfill:card-avatars -- --apply
 */
import nextEnv from "@next/env";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

nextEnv.loadEnvConfig(repoRoot);

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required to run the card avatar backfill.");
}

const apply = process.argv.includes("--apply");
const log = (message) => console.log(`${apply ? "" : "[dry] "}${message}`);

const LEGACY_PATH = "/api/v1/users/resident-identity/photo";

await mongoose.connect(process.env.MONGODB_URI);

const db = mongoose.connection.db;
const users = await db
  .collection("users")
  .find(
    { image: { $regex: `^${LEGACY_PATH.replace(/\//g, "\\/")}` } },
    { projection: { email: 1, image: 1, name: 1 } },
  )
  .toArray();

let rewritten = 0;
let skipped = 0;

for (const user of users) {
  const query = user.image.includes("?") ? user.image.slice(user.image.indexOf("?")) : "";
  let version = new URLSearchParams(query).get("v");

  if (!version) {
    const profile = await db
      .collection("userresidentprofiles")
      .findOne({ userId: user._id }, { projection: { photoUpdatedAt: 1 } });

    version = profile?.photoUpdatedAt
      ? String(new Date(profile.photoUpdatedAt).getTime())
      : "1";
  }

  const next = `/api/v1/users/${user._id.toString()}/avatar?v=${version}`;

  if (next === user.image) {
    skipped += 1;
    continue;
  }

  rewritten += 1;
  log(`  ${user.email ?? user.name ?? user._id}: ${user.image} -> ${next}`);

  if (apply) {
    await db.collection("users").updateOne({ _id: user._id }, { $set: { image: next } });
  }
}

const otherAvatars = await db
  .collection("users")
  .countDocuments({ image: { $nin: [null, ""], $not: new RegExp(`^${LEGACY_PATH}`) } });

console.log("");
log(`legacy card avatars found: ${users.length}`);
log(`rewritten: ${rewritten}`);
log(`already correct: ${skipped}`);
log(`avatars from elsewhere, left alone: ${otherAvatars}`);

if (!apply && rewritten > 0) {
  console.log("\nNothing was written. Re-run with --apply to persist.");
}

await mongoose.disconnect();
