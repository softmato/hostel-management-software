/**
 * Reports residents sharing one email address inside a hostel.
 *
 * `Resident` now carries a unique partial index on `{ hostelId, email }` — the
 * rule that should always have existed, because `email` is what
 * `linkResidentAccount` turns into a login and one account may hold only one
 * live resident profile. Mongo will refuse to *build* that index while duplicate
 * rows are still on the roll, and it refuses quietly: the index simply never
 * appears and the service-level check stays the only guard.
 *
 * So this is a read. It finds the pairs, prints them with enough detail to tell
 * which is the real registration, and stops. Deciding which duplicate to remove
 * is the hostel's call, not a script's — the wrong one may be the record their
 * invoices hang off.
 *
 * Once the roll is clean, restarting the app builds the index.
 *
 * Pass --hostel=<id> to scope the run.
 */
import nextEnv from "@next/env";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

nextEnv.loadEnvConfig(repoRoot);

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required to inspect the resident roll.");
}

const hostelArg = process.argv.find((arg) => arg.startsWith("--hostel="));
const onlyHostel = hostelArg ? hostelArg.slice("--hostel=".length) : null;

await mongoose.connect(process.env.MONGODB_URI);

const db = mongoose.connection.db;

const groups = await db
  .collection("residents")
  .aggregate([
    {
      $match: {
        email: { $type: "string", $ne: "" },
        isDeleted: { $ne: true },
        ...(onlyHostel ? { hostelId: new mongoose.Types.ObjectId(onlyHostel) } : {}),
      },
    },
    {
      $group: {
        _id: { email: "$email", hostelId: "$hostelId" },
        residents: {
          $push: {
            createdAt: "$createdAt",
            id: "$_id",
            name: { $concat: ["$firstName", " ", "$lastName"] },
            phone: "$phone",
            status: "$status",
            userId: "$userId",
          },
        },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ])
  .toArray();

if (groups.length === 0) {
  console.log("No duplicate resident emails. The unique index can build.");
} else {
  console.log(`${groups.length} email(s) held by more than one resident:\n`);

  for (const group of groups) {
    console.log(`hostel ${group._id.hostelId}  ${group._id.email}`);

    for (const resident of group.residents) {
      const linked = resident.userId ? "linked" : "NOT linked";
      const created = resident.createdAt?.toISOString?.() ?? "unknown";

      console.log(
        `  ${resident.id}  ${resident.name}  ${resident.phone}  ` +
          `${resident.status}  ${linked}  created ${created}`,
      );
    }

    console.log("");
  }

  console.log(
    "The one that is NOT linked is usually the accidental second registration —\n" +
      "an account can only hold one live resident profile, so the duplicate never\n" +
      "got a login. Remove it from the portal (Residents -> the row -> delete),\n" +
      "which soft-deletes it and frees both the phone and the email.",
  );
}

await mongoose.disconnect();
