/**
 * One-shot repair: hands the PUBLIC role back to accounts stranded on RESIDENT.
 *
 * Deleting a resident now returns the linked account to its plain public role
 * (see `deleteResident` -> `demoteToPublicAccount`). Residents deleted before
 * that shipped left their account holding the RESIDENT role with no resident
 * profile behind it, which is the worst of both worlds: every resident screen
 * 404s, and signing in still routes them to the resident dashboard.
 *
 * This finds accounts whose role says RESIDENT but which have no ACTIVE or
 * PENDING resident profile, and puts them back to ACTIVE/PUBLIC. It also
 * un-archives accounts that a short-lived earlier version of the fix locked
 * out entirely.
 *
 * Pass --dry to preview. Pass --email=someone@example.com to scope the run.
 * Safe to run repeatedly.
 */
import nextEnv from "@next/env";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

nextEnv.loadEnvConfig(repoRoot);

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required to repair stranded resident accounts.");
}

const dryRun = process.argv.includes("--dry");
const emailArg = process.argv.find((arg) => arg.startsWith("--email="));
const onlyEmail = emailArg ? emailArg.slice("--email=".length).toLowerCase() : null;
const log = (message) => console.log(`${dryRun ? "[dry] " : ""}${message}`);

await mongoose.connect(process.env.MONGODB_URI);

const db = mongoose.connection.db;
const users = db.collection("users");
const residents = db.collection("residents");

const candidates = await users
  .find({
    isDeleted: { $ne: true },
    role: "RESIDENT",
    ...(onlyEmail ? { email: onlyEmail } : {}),
  })
  .toArray();

log(`Checking ${candidates.length} RESIDENT-role account(s).`);

const stranded = [];

for (const user of candidates) {
  // The same test the live delete path uses: someone still registered anywhere
  // keeps the role.
  const liveProfiles = await residents.countDocuments({
    isDeleted: false,
    status: { $in: ["ACTIVE", "PENDING"] },
    userId: user._id,
  });

  if (liveProfiles === 0) {
    stranded.push(user);
  }
}

if (stranded.length === 0) {
  log("Nothing to repair — every RESIDENT-role account has a live profile.");
  await mongoose.disconnect();
  process.exit(0);
}

for (const user of stranded) {
  log(
    `restore ${user.email ?? user.phone ?? user._id}: ${user.status}/RESIDENT -> ACTIVE/PUBLIC`,
  );
}

if (!dryRun) {
  await users.updateMany(
    { _id: { $in: stranded.map((user) => user._id) } },
    { $set: { role: "PUBLIC", status: "ACTIVE" } },
  );
}

log(`Repair complete. ${stranded.length} account(s) ${dryRun ? "would be" : ""} restored.`);
log("Anyone currently signed in picks up the new role on their next token refresh.");

await mongoose.disconnect();
