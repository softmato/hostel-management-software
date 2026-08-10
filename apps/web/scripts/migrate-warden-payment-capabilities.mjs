/**
 * Split `verifyPayments` into the six payment capabilities.
 *
 * Block 0 item 0.5 of docs/FINANCE_IMPLEMENTATION_PLAN.md (§7.5, D7, target
 * §13.4). Permissions are stored as an array of enabled keys on
 * `HostelMember.permissions`, so splitting one key into six is a rewrite of
 * every row that holds it — not a code-only change. A warden whose row is not
 * migrated keeps working through the deprecated alias in
 * `lib/warden-capability.ts`, but only until that alias is removed.
 *
 * `verifyPayments` -> ["viewPayments", "approvePayments", "recordCash"].
 *
 * `reversePayments`, `manageFeeSchedule` and `managePaymentProfile` are granted
 * to **nobody**. They travelled with `verifyPayments` by accident — a default
 * warden could rewrite any payment amount on their first day (current §6.1) —
 * and the hostel owner holds them by role, not by grant.
 *
 * Idempotent. Preview without writing:
 *
 *   npm --prefix apps/web run migrate:payment-caps -- --dry-run
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
  throw new Error("MONGODB_URI is required to run the payment capability migration.");
}

const dryRun = process.argv.includes("--dry-run") || process.argv.includes("--dry");
const log = (message) => console.log(`${dryRun ? "[dry] " : ""}${message}`);

const REPLACEMENTS = ["viewPayments", "approvePayments", "recordCash"];

await mongoose.connect(process.env.MONGODB_URI);

const db = mongoose.connection.db;
const members = db.collection("hostelmembers");
const hostels = db.collection("hostels");

const holders = await members
  .find(
    { permissions: "verifyPayments" },
    { projection: { hostelId: 1, permissions: 1 } },
  )
  .toArray();

log(`${holders.length} members hold verifyPayments.`);

/** hostelId -> { migrated, alreadySplit } */
const byHostel = new Map();
let migrated = 0;

for (const member of holders) {
  const current = new Set(member.permissions ?? []);
  const next = new Set(current);

  next.delete("verifyPayments");

  for (const key of REPLACEMENTS) {
    next.add(key);
  }

  if (!dryRun) {
    await members.updateOne({ _id: member._id }, { $set: { permissions: [...next] } });
  }

  migrated += 1;

  const key = member.hostelId?.toString() ?? "(no hostel)";
  const row = byHostel.get(key) ?? { granted: new Set(), members: 0 };
  row.members += 1;
  for (const added of REPLACEMENTS) {
    if (!current.has(added)) {
      row.granted.add(added);
    }
  }
  byHostel.set(key, row);
}

// Nobody should end up holding a restricted key by way of this migration; this
// counts any that already exist so an unexpected grant is visible, not silent.
const restricted = await members.countDocuments({
  permissions: {
    $in: ["reversePayments", "manageFeeSchedule", "managePaymentProfile"],
  },
});

const hostelNames = new Map(
  (
    await hostels
      .find(
        {
          _id: {
            $in: [...byHostel.keys()]
              .filter((id) => mongoose.Types.ObjectId.isValid(id))
              .map((id) => new mongoose.Types.ObjectId(id)),
          },
        },
        { projection: { name: 1 } },
      )
      .toArray()
  ).map((hostel) => [hostel._id.toString(), hostel.name]),
);

console.log("");
console.log("Hostel                                  members  newly granted");
console.log("--------------------------------------------------------------");

for (const [hostelId, row] of byHostel) {
  const name = (hostelNames.get(hostelId) ?? hostelId).slice(0, 36).padEnd(38);
  console.log(
    `${name}${String(row.members).padStart(7)}  ${[...row.granted].join(", ") || "-"}`,
  );
}

const remaining = dryRun
  ? holders.length
  : await members.countDocuments({ permissions: "verifyPayments" });

console.log("");
log(`Migrated ${migrated} members. Rows still holding verifyPayments: ${remaining}.`);
log(
  `Members holding a restricted payment capability: ${restricted} ` +
    "(expected 0 — the owner holds those by role).",
);

await mongoose.disconnect();
