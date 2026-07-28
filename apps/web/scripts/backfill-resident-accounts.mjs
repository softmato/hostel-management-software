/**
 * Backfill for residents registered before account auto-linking existed.
 *
 * Registering a resident now promotes their existing account to RESIDENT and
 * stores `resident.userId`, so they sign in normally and land on their resident
 * dashboard. Residents created before that shipped are ACTIVE on paper while
 * their account is still PUBLIC — logging in drops them on the public home page.
 *
 * This finds those residents and links them, using the same rules as the live
 * code path:
 *   - only accounts that already exist are promoted; no account is ever created
 *     and no credentials are ever issued (residents get no temp passwords)
 *   - PUBLIC -> RESIDENT only. An account already holding another role
 *     (hostel admin, warden, superadmin) is left alone and reported
 *   - one live resident profile per account, so nobody ends up on two beds
 *   - passwords and Google links are untouched
 *
 * Pass --dry to preview. Pass --email=someone@example.com to limit it to one.
 */
import nextEnv from "@next/env";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

nextEnv.loadEnvConfig(repoRoot);

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required to backfill resident accounts.");
}

const dryRun = process.argv.includes("--dry");
const emailArg = process.argv.find((arg) => arg.startsWith("--email="));
const onlyEmail = emailArg ? emailArg.slice("--email=".length).toLowerCase() : null;
const log = (message) => console.log(`${dryRun ? "[dry] " : ""}${message}`);

await mongoose.connect(process.env.MONGODB_URI);

const db = mongoose.connection.db;
const residents = db.collection("residents");
const users = db.collection("users");
const hostels = db.collection("hostels");

// Unlinked residents who are meant to have portal access. PENDING residents are
// deliberately skipped: they have not been activated by anyone yet.
const candidates = await residents
  .find({
    email: { $exists: true, $nin: [null, ""] },
    isDeleted: false,
    status: "ACTIVE",
    userId: { $exists: false },
    ...(onlyEmail ? { email: onlyEmail } : {}),
  })
  .toArray();

log(`Found ${candidates.length} active resident(s) with no linked account.`);

const summary = { linked: 0, noAccount: 0, otherRole: 0, alreadyLinked: 0 };

for (const resident of candidates) {
  const email = String(resident.email).trim().toLowerCase();
  const name = `${resident.firstName ?? ""} ${resident.lastName ?? ""}`.trim();
  const account = await users.findOne({ email, isDeleted: { $ne: true } });

  if (!account) {
    summary.noAccount += 1;
    log(`SKIP ${name} <${email}> — no account yet; they need QR activation.`);
    continue;
  }

  if (account.role !== "PUBLIC" && account.role !== "RESIDENT") {
    summary.otherRole += 1;
    log(`SKIP ${name} <${email}> — account is ${account.role}; left untouched.`);
    continue;
  }

  const conflicting = await residents.findOne({
    _id: { $ne: resident._id },
    isDeleted: false,
    status: { $in: ["ACTIVE", "PENDING"] },
    userId: account._id,
  });

  if (conflicting) {
    summary.alreadyLinked += 1;
    log(`SKIP ${name} <${email}> — account already linked to another resident.`);
    continue;
  }

  const hostel = await hostels.findOne(
    { _id: resident.hostelId },
    { projection: { name: 1 } },
  );

  if (!dryRun) {
    await residents.updateOne(
      { _id: resident._id },
      { $set: { userId: account._id, updatedAt: new Date() } },
    );
    await users.updateOne(
      { _id: account._id },
      {
        $addToSet: { hostelIds: resident.hostelId },
        $set: { role: "RESIDENT", updatedAt: new Date() },
      },
    );
    await db.collection("auditlogs").insertOne({
      action: "RESIDENT_ACCOUNT_LINKED",
      createdAt: new Date(),
      entityId: String(resident._id),
      entityType: "Resident",
      hostelId: resident.hostelId,
      metadata: { backfill: true, email },
    });
  }

  summary.linked += 1;
  log(`LINK ${name} <${email}> -> ${hostel?.name ?? "unknown hostel"} (RESIDENT).`);
}

console.log(
  `\n${dryRun ? "[dry] " : ""}Done. linked=${summary.linked} noAccount=${summary.noAccount} otherRole=${summary.otherRole} alreadyLinked=${summary.alreadyLinked}`,
);
console.log(
  "Anyone linked must sign out and back in — the role is baked into their existing session token.",
);

await mongoose.disconnect();
