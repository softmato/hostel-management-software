/**
 * One-shot repair: makes each account's `hostelIds` match what it actually is at
 * each hostel.
 *
 * `User.hostelIds` is copied into every access token, and the tenant guards read
 * it from there. Two things left it out of step with the data:
 *
 * - **A hostel with nothing behind it.** Until `linkResidentAccount` was
 *   reordered, a resident intake promoted the account — adding the hostel — and
 *   only then noticed the person already lived somewhere else. The link was
 *   refused and the hostel stayed. That resident carries two hostels, and
 *   anything resolving "the" hostel as the only one on the token treats them as
 *   belonging to none.
 * - **A resident with no hostel at all.** A live, linked resident profile whose
 *   hostel is missing from the account: `findCurrentResident` refuses it, so
 *   every resident screen 404s.
 *
 * A hostel stays on an account that has any of, at that hostel: a resident row
 * linked to it (any status, not deleted — a moved-out resident still reads their
 * history), a staff membership that is not removed, guardian access that is
 * ACTIVE or USED, a cook roster entry that is not removed, or ownership of the
 * hostel. Anything else is removed. A missing hostel is added only for a live
 * (ACTIVE/PENDING) linked resident profile on a RESIDENT account, at a hostel
 * that is not archived.
 *
 * Platform accounts are never touched — no row above describes their scope.
 * Roles are not changed: an account left RESIDENT with no live profile is
 * `repair:archived-residents`'s job.
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
  throw new Error("MONGODB_URI is required to repair account hostel scope.");
}

const dryRun = process.argv.includes("--dry");
const emailArg = process.argv.find((arg) => arg.startsWith("--email="));
const onlyEmail = emailArg ? emailArg.slice("--email=".length).toLowerCase() : null;
const log = (message) => console.log(`${dryRun ? "[dry] " : ""}${message}`);

const PLATFORM_ROLES = ["SUPERADMIN", "PLATFORM_MODERATOR", "PLATFORM_AGENT"];
const LIVE_RESIDENT = ["ACTIVE", "PENDING"];

await mongoose.connect(process.env.MONGODB_URI);

const db = mongoose.connection.db;
const users = db.collection("users");
const residents = db.collection("residents");
const hostelMembers = db.collection("hostelmembers");
const guardianAccesses = db.collection("guardianaccesses");
const cookAccounts = db.collection("cookaccounts");
const hostels = db.collection("hostels");

const accounts = await users
  .find({
    $or: [{ "hostelIds.0": { $exists: true } }, { role: "RESIDENT" }],
    isDeleted: { $ne: true },
    role: { $nin: PLATFORM_ROLES },
    ...(onlyEmail ? { email: onlyEmail } : {}),
  })
  .project({ email: 1, hostelIds: 1, phone: 1, role: 1 })
  .toArray();

log(`Checking ${accounts.length} account(s).`);

const hostelNames = new Map();

async function nameOf(hostelId) {
  const key = String(hostelId);

  if (!hostelNames.has(key)) {
    const hostel = mongoose.Types.ObjectId.isValid(key)
      ? await hostels.findOne(
          { _id: new mongoose.Types.ObjectId(key) },
          { projection: { name: 1 } },
        )
      : null;

    hostelNames.set(key, hostel?.name?.trim() || `hostel ${key}`);
  }

  return hostelNames.get(key);
}

const plans = [];

for (const account of accounts) {
  const userId = account._id;
  const held = account.hostelIds ?? [];

  const [residentRows, members, guardianAccess, cooks, owned] = await Promise.all([
    residents
      .find({ isDeleted: { $ne: true }, userId })
      .project({ hostelId: 1, status: 1 })
      .toArray(),
    hostelMembers
      .find({ isDeleted: { $ne: true }, status: { $ne: "REMOVED" }, userId })
      .project({ hostelId: 1 })
      .toArray(),
    guardianAccesses
      .find({ status: { $in: ["ACTIVE", "USED"] }, userId })
      .project({ hostelId: 1 })
      .toArray(),
    cookAccounts
      .find({ status: { $ne: "REMOVED" }, userId })
      .project({ hostelId: 1 })
      .toArray(),
    hostels.find({ ownerId: userId }).project({ _id: 1 }).toArray(),
  ]);

  const keep = new Set(
    [
      ...residentRows.map((row) => row.hostelId),
      ...members.map((row) => row.hostelId),
      ...guardianAccess.map((row) => row.hostelId),
      ...cooks.map((row) => row.hostelId),
      ...owned.map((row) => row._id),
    ].map(String),
  );

  // The raw stored values, so the `$pull` matches whatever type each was saved as.
  const stray = held.filter((hostelId) => !keep.has(String(hostelId)));

  const heldIds = new Set(held.map(String));
  const liveHostelIds = [
    ...new Set(
      residentRows
        .filter((row) => LIVE_RESIDENT.includes(row.status))
        .map((row) => String(row.hostelId)),
    ),
  ].filter((hostelId) => !heldIds.has(hostelId));

  const openHostels =
    account.role === "RESIDENT" && liveHostelIds.length
      ? await hostels
          .find({
            _id: { $in: liveHostelIds.map((id) => new mongoose.Types.ObjectId(id)) },
            isDeleted: { $ne: true },
          })
          .project({ _id: 1 })
          .toArray()
      : [];
  const missing = openHostels.map((hostel) => hostel._id);

  if (stray.length === 0 && missing.length === 0) {
    continue;
  }

  plans.push({ account, missing, stray });
}

if (plans.length === 0) {
  log("Nothing to repair — every account's hostels match what it is at each.");
  await mongoose.disconnect();
  process.exit(0);
}

for (const { account, missing, stray } of plans) {
  const who = account.email ?? account.phone ?? String(account._id);

  for (const hostelId of stray) {
    log(`${who} (${account.role}): remove ${await nameOf(hostelId)} — nothing at that hostel`);

    /*
     * Reported, never decided here. The intake that stranded this hostel on
     * the account usually also left a live resident row there with no login
     * attached — somebody on that hostel's roll, possibly the same person who
     * lives elsewhere. Whether they really live there is the desk's call.
     */
    if (account.email && mongoose.Types.ObjectId.isValid(String(hostelId))) {
      const unlinked = await residents.findOne(
        {
          email: account.email.toLowerCase(),
          hostelId: new mongoose.Types.ObjectId(String(hostelId)),
          isDeleted: { $ne: true },
          status: { $in: [...LIVE_RESIDENT, "SUSPENDED"] },
          userId: { $exists: false },
        },
        { projection: { _id: 1, status: 1 } },
      );

      if (unlinked) {
        log(
          `  note: ${await nameOf(hostelId)} still has ${unlinked.status} resident ${unlinked._id} on this address with no login — that hostel decides whether they live there.`,
        );
      }
    }
  }

  for (const hostelId of missing) {
    log(`${who} (${account.role}): add ${await nameOf(hostelId)} — live resident profile there`);
  }
}

if (!dryRun) {
  for (const { account, missing, stray } of plans) {
    if (stray.length) {
      await users.updateOne({ _id: account._id }, { $pull: { hostelIds: { $in: stray } } });
    }

    if (missing.length) {
      await users.updateOne(
        { _id: account._id },
        { $addToSet: { hostelIds: { $each: missing } } },
      );
    }
  }
}

const removed = plans.reduce((sum, plan) => sum + plan.stray.length, 0);
const added = plans.reduce((sum, plan) => sum + plan.missing.length, 0);

log(
  `Repair complete. ${plans.length} account(s): ${removed} hostel(s) ${dryRun ? "would be" : ""} removed, ${added} ${dryRun ? "would be" : ""} added.`,
);
log("Anyone currently signed in picks up the change on their next token refresh.");

await mongoose.disconnect();
