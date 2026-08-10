/**
 * Assign every hostel a reference prefix.
 *
 * Block 1 item 1.5 of docs/FINANCE_IMPLEMENTATION_PLAN.md (target §5.1). The
 * prefix opens every reference code the hostel issues — `RUP` in `RUP-4821-K` —
 * and must be **unique platform-wide**, because a code is parsed without a
 * database lookup and the prefix is the only part that says whose it is.
 *
 * Derived from the hostel name, then disambiguated by walking a deterministic
 * sequence of alternatives. Deterministic matters: re-running this must give
 * every hostel the prefix it already has, since a changed prefix would orphan
 * every code a resident has already written on a bank transfer.
 *
 * Idempotent — a hostel that already has one is left alone. Preview with
 *
 *   npm --prefix apps/web run backfill:reference-prefix -- --dry-run
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
  throw new Error("MONGODB_URI is required to backfill reference prefixes.");
}

const dryRun = process.argv.includes("--dry-run") || process.argv.includes("--dry");
const log = (message) => console.log(`${dryRun ? "[dry] " : ""}${message}`);

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Mirror of `deriveHostelPrefix` in modules/finance/reference-code.ts. */
function deriveHostelPrefix(hostelName, attempt = 0) {
  const letters = String(hostelName ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  const base = (letters.slice(0, 3) || "HST").padEnd(3, "X");

  if (attempt === 0) {
    return base;
  }

  return `${base.slice(0, 2)}${LETTERS[(attempt - 1) % LETTERS.length]}`;
}

await mongoose.connect(process.env.MONGODB_URI);

const db = mongoose.connection.db;
const hostels = db.collection("hostels");

// Oldest first, so an established hostel keeps the obvious prefix and a newer
// one with a similar name takes the disambiguated variant.
const all = await hostels
  .find({}, { projection: { name: 1, referencePrefix: 1 } })
  .sort({ _id: 1 })
  .toArray();

const taken = new Set(
  all.map((hostel) => hostel.referencePrefix).filter((prefix) => Boolean(prefix)),
);

let assigned = 0;
let existing = 0;
let exhausted = 0;
const rows = [];

for (const hostel of all) {
  if (hostel.referencePrefix) {
    existing += 1;
    continue;
  }

  let prefix = null;

  // 26 alternatives per stem; beyond that the name is unusable and a human
  // picks one. Reporting that beats inventing an unreadable prefix.
  for (let attempt = 0; attempt <= LETTERS.length; attempt += 1) {
    const candidate = deriveHostelPrefix(hostel.name, attempt);

    if (!taken.has(candidate)) {
      prefix = candidate;
      break;
    }
  }

  if (!prefix) {
    exhausted += 1;
    rows.push({ name: hostel.name, prefix: "— no free prefix, assign by hand" });
    continue;
  }

  taken.add(prefix);
  assigned += 1;
  rows.push({ name: hostel.name, prefix });

  if (!dryRun) {
    await hostels.updateOne({ _id: hostel._id }, { $set: { referencePrefix: prefix } });
  }
}

console.log("");
console.log("Hostel                                  prefix   sample code");
console.log("------------------------------------------------------------------");

for (const row of rows) {
  const sample = /^[A-Z]{3}$/.test(row.prefix) ? `${row.prefix}-0001-?` : "";
  console.log(
    `${String(row.name).slice(0, 36).padEnd(38)}${row.prefix.padEnd(9)}${sample}`,
  );
}

console.log("");
log(`Assigned ${assigned}, already had one ${existing}, could not assign ${exhausted}.`);

const remaining = dryRun
  ? all.length - existing - assigned
  : await hostels.countDocuments({ referencePrefix: { $exists: false } });

log(`Hostels still without a prefix: ${remaining}.`);

if (remaining > 0) {
  log("Those hostels cannot issue invoices until a prefix is assigned.");
}

await mongoose.disconnect();
