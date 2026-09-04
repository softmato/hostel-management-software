/**
 * Removes the stray INVITED warden row on siddthecoder@gmail.com.
 *
 * Two User rows share that address: an INVITED WARDEN created 2026-07-25 that
 * has never been signed in to (no lastLoginAt, no sessions, no OAuth link, no
 * resident profile), and the PUBLIC Google account the person actually uses.
 * `findOne({ email })` reached the warden row first, so `registerOrUpgradeUserByEmail`
 * refused to make them a resident and their portal never appeared.
 *
 * Soft-delete, matching what the app writes everywhere else, so the row stays
 * recoverable. The PUBLIC account is not touched.
 */
import fs from "node:fs";
import mongoose from "mongoose";

const env = fs.readFileSync(new URL("../../../.env", import.meta.url), "utf8");
const read = (key) => {
  const line = env.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).replace(/^["']|["']$/g, "").trim() : undefined;
};
await mongoose.connect(read("MONGODB_URI"));
const db = mongoose.connection.db;
const oid = (v) => new mongoose.Types.ObjectId(v);

const WARDEN_USER = oid("6a643e4e4332576c131cda07");
const ACTOR = oid("6a620908d7542793c7450eb5");

const before = await db.collection("users").findOne({ _id: WARDEN_USER });
if (!before) throw new Error("warden row not found — nothing to clean");
if (before.lastLoginAt) throw new Error("this account has been signed in to; refusing to remove it");

const sessions = await db.collection("sessions").countDocuments({ userId: WARDEN_USER, revokedAt: null });
if (sessions > 0) throw new Error(`this account has ${sessions} live sessions; refusing to remove it`);

const now = new Date();

const users = await db.collection("users").updateOne(
  { _id: WARDEN_USER },
  { $set: { isDeleted: true, deletedAt: now, deletedBy: ACTOR, status: "SUSPENDED" } },
);

const members = await db.collection("hostelmembers").updateMany(
  { userId: WARDEN_USER, isDeleted: { $ne: true } },
  { $set: { isDeleted: true, deletedAt: now, deletedBy: ACTOR, status: "REMOVED", updatedBy: ACTOR } },
);

await db.collection("auditlogs").insertOne({
  action: "USER_ACCOUNT_REMOVED",
  actorId: ACTOR,
  entityId: WARDEN_USER.toString(),
  entityType: "User",
  hostelId: oid("6a6436961ec53ea7716309cf"),
  metadata: {
    email: before.email,
    previousRole: before.role,
    previousStatus: before.status,
    reason:
      "Duplicate never-signed-in warden invitation on a mailbox that already had a public account; it blocked resident linking.",
  },
  createdAt: now,
  updatedAt: now,
});

console.log("user rows updated:", users.modifiedCount);
console.log("memberships stood down:", members.modifiedCount);

const remaining = await db
  .collection("users")
  .find({ email: "siddthecoder@gmail.com", isDeleted: { $ne: true } })
  .project({ email: 1, role: 1, status: 1 })
  .toArray();
console.log("remaining live accounts on that address:", JSON.stringify(remaining));

await mongoose.disconnect();
