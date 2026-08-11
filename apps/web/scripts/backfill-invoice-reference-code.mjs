/**
 * Give every open invoice a reference code.
 *
 * `backfill-hostel-reference-prefix.mjs` gave each *hostel* its prefix, and
 * `runBillingCycle` has allocated a code for every invoice it has issued since.
 * What neither covered is the invoices that already existed when that landed:
 * they carry `referenceCode: null` forever, and the resident's pay screen can
 * only tell them "this invoice has no reference code, write your name in the
 * remarks instead" — which is precisely the manual matching the whole reference
 * scheme exists to remove (target §5.2).
 *
 * **Only invoices that can still be paid are touched.** A settled or voided
 * invoice gets nothing: nobody is going to quote its code, and minting one would
 * burn a sequence number and put an unfamiliar code on a receipt that has
 * already been issued.
 *
 * Codes come from the same atomic counter the live path uses
 * (`ReceiptCounter{kind: "REFERENCE", period: "LIFETIME"}`), so a backfill
 * running while somebody bills a month cannot hand out a duplicate. Oldest
 * invoice first, so the numbers read in the order the debts were incurred.
 *
 * Idempotent — an invoice that already has a code is left alone, because a code
 * never changes once issued (§5.2): the resident may have written it on a bank
 * transfer that has not arrived yet. Preview with
 *
 *   npm --prefix apps/web run backfill:invoice-reference -- --dry-run
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
  throw new Error("MONGODB_URI is required to backfill invoice reference codes.");
}

const dryRun = process.argv.includes("--dry-run") || process.argv.includes("--dry");
const log = (message) => console.log(`${dryRun ? "[dry] " : ""}${message}`);

/** Mirror of `reference-code.ts`. Kept in step by `reference-code.test.ts`. */
const SYMBOLS = "0123456789ABCDEFGHJKMNPQRSTVWXY";
const MODULUS = SYMBOLS.length; // 31, prime
const SEQ_LENGTH = 4;
const MAX_SEQUENCE = MODULUS ** SEQ_LENGTH - 1;

function encodeSequence(sequence) {
  let remaining = sequence;
  let encoded = "";

  for (let index = 0; index < SEQ_LENGTH; index += 1) {
    encoded = SYMBOLS[remaining % MODULUS] + encoded;
    remaining = Math.floor(remaining / MODULUS);
  }

  return encoded;
}

/**
 * Weighted checksum, modulo 31 — an exact mirror of `checkCharacter` in
 * `reference-code.ts`.
 *
 * **The two halves are valued differently and must stay that way.** A prefix
 * letter counts as its position in the alphabet (`A` = 0), because the prefix is
 * a human mnemonic using all 26 letters. A sequence character counts as its
 * index in the 31-symbol code alphabet (`A` = 10). Collapsing the two into one
 * loop — the obvious simplification — silently produces codes whose own check
 * character fails to validate, which no test of this script would catch but
 * every statement match afterwards would.
 *
 * `reference-code.test.ts` asserts this mirror agrees with the real one.
 */
function checkCharacter(prefix, encoded) {
  let total = 0;
  let weight = 1;

  for (const letter of prefix) {
    const value = letter.charCodeAt(0) - 65;

    if (value < 0 || value > 25) {
      return null;
    }

    total += value * weight;
    weight += 1;
  }

  for (const character of encoded) {
    const value = SYMBOLS.indexOf(character);

    if (value < 0) {
      return null;
    }

    total += value * weight;
    weight += 1;
  }

  return SYMBOLS[total % MODULUS];
}

function generateReferenceCode(prefix, sequence) {
  const encoded = encodeSequence(sequence);
  const check = checkCharacter(prefix, encoded);

  return check ? `${prefix}-${encoded}-${check}` : null;
}

await mongoose.connect(process.env.MONGODB_URI);

const db = mongoose.connection.db;
const invoices = db.collection("invoices");
const hostels = db.collection("hostels");
const counters = db.collection("receiptcounters");

// `OPEN`, `PARTIAL` and `OVERDUE` are the statuses that still owe something.
// `PAID`, `VOID` and `WRITTEN_OFF` are settled history and are left untouched.
const PAYABLE = ["OPEN", "PARTIAL", "OVERDUE"];

const pending = await invoices
  .find(
    {
      $or: [{ referenceCode: null }, { referenceCode: { $exists: false } }],
      status: { $in: PAYABLE },
    },
    { projection: { hostelId: 1, period: 1, status: 1, totalAmount: 1 } },
  )
  .sort({ _id: 1 })
  .toArray();

if (pending.length === 0) {
  log("Every payable invoice already has a reference code. Nothing to do.");
  await mongoose.disconnect();
  process.exit(0);
}

const hostelIds = [...new Set(pending.map((invoice) => String(invoice.hostelId)))];
const hostelDocs = await hostels
  .find(
    { _id: { $in: hostelIds.map((id) => new mongoose.Types.ObjectId(id)) } },
    { projection: { name: 1, referencePrefix: 1 } },
  )
  .toArray();

const hostelById = new Map(hostelDocs.map((hostel) => [String(hostel._id), hostel]));

let assigned = 0;
let blocked = 0;
const rows = [];

for (const invoice of pending) {
  const hostel = hostelById.get(String(invoice.hostelId));
  const prefix = hostel?.referencePrefix;

  // A hostel with no prefix cannot have a code minted for it. Reported rather
  // than guessed at: the prefix backfill is the thing that fixes this, and
  // inventing one here would risk colliding with what that script would pick.
  if (!prefix || !/^[A-Z]{3}$/.test(prefix)) {
    blocked += 1;
    rows.push({
      code: "— hostel has no reference prefix",
      hostel: hostel?.name ?? String(invoice.hostelId),
      period: invoice.period,
    });
    continue;
  }

  let code = null;

  if (dryRun) {
    // Shown as the shape it will take. The real sequence is only known once the
    // counter is incremented, which a dry run must not do.
    code = `${prefix}-????-?`;
  } else {
    const counter = await counters.findOneAndUpdate(
      { hostelId: invoice.hostelId, kind: "REFERENCE", period: "LIFETIME" },
      { $inc: { sequence: 1 } },
      { returnDocument: "after", upsert: true },
    );

    const sequence = counter?.sequence ?? counter?.value?.sequence ?? 1;

    if (sequence > MAX_SEQUENCE) {
      blocked += 1;
      rows.push({
        code: "— hostel has exhausted its sequence",
        hostel: hostel.name,
        period: invoice.period,
      });
      continue;
    }

    code = generateReferenceCode(prefix, sequence);

    if (!code) {
      blocked += 1;
      rows.push({
        code: "— prefix outside the code alphabet",
        hostel: hostel.name,
        period: invoice.period,
      });
      continue;
    }

    await invoices.updateOne(
      // Re-checked in the filter, not just in the query above: a concurrent
      // billing run may have given this invoice a code since we read it, and a
      // code never changes once issued.
      {
        _id: invoice._id,
        $or: [{ referenceCode: null }, { referenceCode: { $exists: false } }],
      },
      { $set: { referenceCode: code } },
    );
  }

  assigned += 1;
  rows.push({ code, hostel: hostel.name, period: invoice.period });
}

console.log("");
console.log("Hostel                                period     code");
console.log("------------------------------------------------------------------");

for (const row of rows) {
  console.log(
    `${String(row.hostel).slice(0, 36).padEnd(38)}${String(row.period ?? "—").padEnd(11)}${row.code}`,
  );
}

console.log("");
log(`Assigned ${assigned}, could not assign ${blocked}.`);

if (blocked > 0) {
  log("Run backfill:reference-prefix first, then re-run this.");
}

await mongoose.disconnect();
