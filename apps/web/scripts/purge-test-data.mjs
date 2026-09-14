/**
 * Erases test data: every hostel except the kept one(s), and every account not
 * on an explicit keep list, with what belongs to them. `audit-test-data.mjs` is
 * the read-only look that decides the lists; this acts on them.
 *
 * ## What goes
 *
 * 1. **Test hostels** — every row scoped to one, and the hostel is pulled out of
 *    the `hostelIds` arrays of rows that survive. The same reach as
 *    `purgeHostel`, but read from the schemas rather than a list.
 * 2. **Test accounts** — the account, and every row that *is* theirs: a
 *    reference through `userId`, `authorId`, `ownerId`, `applicantId`,
 *    `reportedBy`, `triggeredBy` or `acceptedUserId`. A row that only records
 *    what they did (`createdBy`, `reviewedBy`, `actorId`…) is someone else's
 *    record and stays, pointing at nobody — `account-purge.service.ts` makes the
 *    same split.
 * 3. **Rows naming a test account by address only** — guardian contacts,
 *    inquiries, OTP challenges, invites, OAuth links. At a kept hostel never a
 *    resident or guardian contact, nor a row that also carries a kept account's
 *    address; and never an address a kept account uses.
 * 4. **Children** of anything erased — a row whose top-level scalar reference
 *   points at an erased row (`GuardianPermission.guardianAccessId`,
 *   `InquiryNote.inquiryId`, `Invoice.residentId`…), repeated until nothing new
 *   turns up — plus the stored files erased rows point at, bytes in R2 first.
 * 5. **Collections no model describes** — dropped.
 *
 * ## What never goes
 *
 * `AuditLog`, which gets one more row recording this run. At a kept hostel: the
 * hostel, its settings, documents, verification, subscription, payment profile,
 * application, cook roster and files — those are the hostel's, whoever's id is
 * on them. A kept hostel's owner or the last superadmin who can sign in cannot
 * be on the delete side; the run refuses.
 *
 * ## Safety
 *
 * Dry run unless `--confirm` repeats the plan's fingerprint exactly, so a plan
 * that changed since you read it does not run. Before any write, every row about
 * to be deleted or edited is saved as Extended JSON under `--backup-dir`
 * (default: the OS temp dir), and `--restore=<dir>` puts it back. Bytes deleted
 * from R2 are the one thing a restore cannot return.
 *
 *   npm --prefix apps/web run purge:test-data -- --keep-hostel=<slug|id> --keep-email=a@x.com,b@x.com
 *   npm --prefix apps/web run purge:test-data -- …same flags… --confirm=<fingerprint>
 *   npm --prefix apps/web run purge:test-data -- --restore=<backup dir>
 *
 * Afterwards run `repair:account-hostels`.
 */
import nextEnv from "@next/env";
import mongoose from "mongoose";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadModelCatalogue, repoRoot } from "./model-catalogue.mjs";

nextEnv.loadEnvConfig(repoRoot);

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required to purge test data.");
}

const args = process.argv.slice(2);
const valueOf = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const listOf = (name) =>
  (valueOf(name) ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

const { EJSON } = mongoose.mongo.BSON;
const idKey = (value) => String(value);
const fail = async (message) => {
  console.error(`\nRefusing: ${message}`);
  await mongoose.disconnect();
  process.exit(1);
};

/* ------------------------------------------------------------------ rules */

/** A row that *is* the person's. Top-level paths only. */
const OWNER_FIELDS = new Set(["acceptedUserId", "applicantId", "authorId", "ownerId", "reportedBy", "triggeredBy", "userId"]);

/** Records of who did something. The row belongs to someone else and stays. */
const ACTOR_FIELDS = new Set([
  "acknowledgedBy", "actorId", "agentId", "announcedBy", "approvedBy", "byUserId", "changedBy",
  "checkedBy", "collectedBy", "completedBy", "confirmedBy", "contactedBy", "createdBy", "decidedBy",
  "deletedBy", "feeOverrideSetBy", "hiddenBy", "infoRequestedBy", "invitedBy", "issuedBy",
  "overriddenBy", "placedBy", "recordedBy", "requestedBy", "resolvedBy", "reviewedBy", "revokedBy",
  "selectedBy", "submittedBy", "submittedByAgentId", "updatedBy", "uploadedBy", "usedBy",
  "verifiedBy", "voidedBy",
]);

/** Staff notes on a hostel's own threads: the thread is the hostel's, not the author's. */
const ACTOR_OVERRIDES = new Set(["InquiryNote.authorId", "MaintenanceComment.authorId"]);

/** A pointer on a row that stays: cleared, not deleted. */
const CLEARED = new Set(["HostelSettings.cookUserId"]);

/** At a kept hostel these are the hostel's, whoever's id is on them. */
const HOSTEL_OWNED = new Set([
  "CookAccount", "FileAsset", "Hostel", "HostelApplication", "HostelDocument",
  "HostelPaymentProfile", "HostelSettings", "HostelSubscription", "HostelVerification",
]);

/** Rows that can name a person by address alone. */
const CONTACT_KEYED = ["Guardian", "Inquiry", "OAuthAccount", "OtpChallenge", "PlatformAdminInvite", "Resident", "TemporaryCredential"];

const RETAINED = new Set(["AuditLog"]);

/* --------------------------------------------------------------- restore */

const catalogue = await loadModelCatalogue();
const byName = Object.fromEntries(catalogue.map((entry) => [entry.name, entry]));

mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);
await mongoose.connect(process.env.MONGODB_URI, { autoCreate: false, autoIndex: false });

const db = mongoose.connection.db;
const coll = (name) => db.collection(byName[name].collection);

const restoreDir = valueOf("restore");

if (restoreDir) {
  const root = path.resolve(restoreDir);
  const read = async (sub) =>
    (await readdir(path.join(root, sub)).catch(() => [])).map((file) => ({
      collection: file.replace(/\.json$/, ""),
      file: path.join(root, sub, file),
    }));

  for (const { collection, file } of await read("deleted")) {
    const docs = EJSON.parse(await readFile(file, "utf8"), { relaxed: false });
    let inserted = 0;

    for (let i = 0; i < docs.length; i += 500) {
      try {
        inserted += (await db.collection(collection).insertMany(docs.slice(i, i + 500), { ordered: false })).insertedCount;
      } catch (error) {
        // Already there from an earlier restore: skip those, keep the rest.
        inserted += error.result?.insertedCount ?? 0;
        if (error.code !== 11000 && !error.writeErrors) throw error;
      }
    }

    console.log(`restored ${collection}: ${inserted}/${docs.length}`);
  }

  for (const { collection, file } of await read("modified")) {
    const docs = EJSON.parse(await readFile(file, "utf8"), { relaxed: false });

    if (docs.length) {
      await db.collection(collection).bulkWrite(
        docs.map((doc) => ({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } })),
      );
    }

    console.log(`reverted ${collection}: ${docs.length}`);
  }

  console.log("Restore complete. Files deleted from R2 are not recoverable.");
  await mongoose.disconnect();
  process.exit(0);
}

/* ------------------------------------------------------------------ inputs */

const keepHostelArgs = listOf("keep-hostel");
const keepEmails = listOf("keep-email");

if (!keepHostelArgs.length || !keepEmails.length) {
  await fail("pass --keep-hostel=<slug|id> and --keep-email=<list>. A purge assumes nothing.");
}

const unclassified = catalogue.flatMap((entry) =>
  RETAINED.has(entry.name)
    ? []
    : entry.userPaths
        .map((ref) => `${entry.name}.${ref.path}`)
        .filter((key, i) => {
          const ref = entry.userPaths[i];
          return !CLEARED.has(key) && !ACTOR_OVERRIDES.has(key) && !OWNER_FIELDS.has(ref.leaf) && !ACTOR_FIELDS.has(ref.leaf);
        }),
);

if (unclassified.length) {
  await fail(`these User references are in no rule list — add each to OWNER_FIELDS or ACTOR_FIELDS:\n  ${unclassified.join("\n  ")}`);
}

const hostels = await coll("Hostel").find({}).project({ name: 1, ownerId: 1, slug: 1 }).toArray();
const keptHostels = [];

for (const query of keepHostelArgs) {
  const match = hostels.filter((hostel) => idKey(hostel._id) === query || hostel.slug?.toLowerCase() === query);
  if (match.length !== 1) await fail(`--keep-hostel=${query} matches ${match.length} hostels; use the exact slug or id.`);
  keptHostels.push(match[0]);
}

const keptKeys = new Set(keptHostels.map((hostel) => idKey(hostel._id)));
const purgeHostels = hostels.filter((hostel) => !keptKeys.has(idKey(hostel._id)));
const purgeHostelIds = purgeHostels.map((hostel) => hostel._id);

const users = await coll("User")
  .find({})
  .project({ email: 1, isDeleted: 1, passwordHash: 1, phone: 1, role: 1 })
  .toArray();
const keepIds = new Set();

for (const email of keepEmails) {
  const matches = users.filter((user) => user.email?.toLowerCase() === email);
  const live = matches.filter((user) => !user.isDeleted);
  const pick = live.length ? live : matches;

  if (pick.length !== 1) await fail(`--keep-email ${email} matches ${pick.length} accounts.`);
  keepIds.add(idKey(pick[0]._id));
}

for (const hostel of keptHostels) {
  if (!keepIds.has(idKey(hostel.ownerId))) await fail(`${hostel.name}'s owner is not on --keep-email.`);
}

const keptUsers = users.filter((user) => keepIds.has(idKey(user._id)));
const deleteUsers = users.filter((user) => !keepIds.has(idKey(user._id)));
const deleteIds = deleteUsers.map((user) => user._id);
const oauthKeys = new Set(
  (await coll("OAuthAccount").find({ userId: { $in: keptUsers.map((u) => u._id) } }).project({ userId: 1 }).toArray()).map((row) =>
    idKey(row.userId),
  ),
);
const signIn = (user) =>
  [user.passwordHash ? "password" : null, oauthKeys.has(idKey(user._id)) ? "OAuth" : null].filter(Boolean).join(" + ") || "NO SIGN-IN";

if (!keptUsers.some((user) => user.role === "SUPERADMIN" && signIn(user) !== "NO SIGN-IN")) {
  await fail("no kept SUPERADMIN has a password or an OAuth link — nobody could sign in to the platform afterwards.");
}

/* -------------------------------------------------------------------- plan */

/** model name → row key → { id, atKept, reason } */
const doomed = new Map();
/** { name, filter, update } applied to rows that survive */
const edits = [];
const protectedAtKept = {};

function mark(name, rows, reason) {
  if (!doomed.has(name)) doomed.set(name, new Map());

  const bucket = doomed.get(name);
  let added = 0;

  for (const row of rows) {
    const key = idKey(row.id);
    if (!bucket.has(key)) {
      bucket.set(key, { ...row, reason });
      added += 1;
    }
  }

  return added;
}

async function rowsOf(entry, filter) {
  const hostelPath = entry.hostelRef && !entry.hostelRef.isArray ? entry.hostelRef.path : null;
  const docs = await db
    .collection(entry.collection)
    .find(filter)
    .project(hostelPath ? { [hostelPath]: 1 } : { _id: 1 })
    .toArray();

  return docs.map((doc) => ({ atKept: hostelPath ? keptKeys.has(idKey(doc[hostelPath])) : false, id: doc._id }));
}

function valuesAt(doc, dotted) {
  let current = [doc];

  for (const part of dotted.split(".")) {
    current = current.flatMap((value) => (value == null ? [] : Array.isArray(value[part]) ? value[part] : [value[part]]));
  }

  return current.filter((value) => value != null);
}

// 1. Test hostels.
for (const entry of catalogue) {
  if (RETAINED.has(entry.name) || !entry.hostelRef || !purgeHostelIds.length) continue;

  const { isArray, path: hostelPath } = entry.hostelRef;

  if (isArray) {
    edits.push({ filter: { [hostelPath]: { $in: purgeHostelIds } }, name: entry.name, update: { $pull: { [hostelPath]: { $in: purgeHostelIds } } } });
  } else {
    mark(entry.name, await rowsOf(entry, { [hostelPath]: { $in: purgeHostelIds } }), "test hostel");
  }
}

// A row that only mentions a test hostel (`lastSharedWithHostelId`) keeps the row and loses the mention.
for (const entry of catalogue) {
  if (RETAINED.has(entry.name)) continue;

  for (const ref of entry.refs) {
    if (ref.ref !== "Hostel" || ref.path === entry.hostelRef?.path || ref.path.includes(".") || !purgeHostelIds.length) continue;

    const filter = { [ref.path]: { $in: purgeHostelIds } };
    edits.push({ filter, name: entry.name, update: ref.isArray ? { $pull: filter } : { $unset: { [ref.path]: "" } } });
  }
}

// 2. Test accounts, and the rows that are theirs.
mark("User", deleteIds.map((id) => ({ atKept: false, id })), "test account");

const actorRefs = [];

for (const entry of catalogue) {
  if (RETAINED.has(entry.name) || entry.name === "User") continue;

  for (const ref of entry.userPaths) {
    const key = `${entry.name}.${ref.path}`;
    const filter = { [ref.path]: { $in: deleteIds } };

    if (CLEARED.has(key)) {
      edits.push({ filter, name: entry.name, update: { $unset: { [ref.path]: "" } } });
    } else if (ACTOR_FIELDS.has(ref.leaf) || ACTOR_OVERRIDES.has(key) || ref.path.includes(".")) {
      actorRefs.push({ entry, filter, key });
    } else {
      const rows = await rowsOf(entry, filter);
      const shielded = rows.filter((row) => row.atKept && HOSTEL_OWNED.has(entry.name));

      if (shielded.length) protectedAtKept[key] = shielded.length;
      mark(entry.name, rows.filter((row) => !shielded.includes(row)), `account's own (${ref.path})`);
    }
  }
}

// 3. Rows naming a test account by address only.
const keptEmails = new Set(keptUsers.map((u) => u.email?.toLowerCase()).filter(Boolean));
const keptPhones = new Set(keptUsers.map((u) => u.phone).filter(Boolean));
const emails = [...new Set(deleteUsers.map((u) => u.email?.toLowerCase()).filter((e) => e && !keptEmails.has(e)))];
const phones = [...new Set(deleteUsers.map((u) => u.phone).filter((p) => p && !keptPhones.has(p)))];
const exactly = (value) => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
let residentsLeftByAddress = 0;

for (const name of CONTACT_KEYED) {
  const entry = byName[name];
  if (!entry) continue;

  for (const field of name === "OtpChallenge" ? ["identifier"] : entry.contactPaths) {
    const isPhone = /phone/i.test(field);
    const values = isPhone ? phones : emails;
    if (!values.length) continue;

    const filter = { [field]: { $in: isPhone ? values : values.map(exactly) } };
    const rows = await rowsOf(entry, filter);
    const docs = await db.collection(entry.collection).find(filter).project(Object.fromEntries(entry.contactPaths.map((p) => [p, 1]))).toArray();
    const sharesKeptAddress = new Set(
      docs
        .filter((doc) => entry.contactPaths.some((p) => keptEmails.has(String(doc[p]).toLowerCase()) || keptPhones.has(doc[p])))
        .map((doc) => idKey(doc._id)),
    );
    // At a kept hostel a resident or their guardian contact is the hostel's record, and a
    // row that also carries a kept account's address is about that account.
    const spared = rows.filter(
      (row) => row.atKept && (name === "Resident" || name === "Guardian" || sharesKeptAddress.has(idKey(row.id))),
    );

    residentsLeftByAddress += spared.length;
    mark(name, rows.filter((row) => !spared.includes(row)), `address of a test account (${field})`);
  }
}

// 4. Children of erased rows, and the files erased rows point at.
const cascaded = new Map();
let grew = true;

while (grew) {
  grew = false;

  for (const [parent, bucket] of [...doomed]) {
    const seen = cascaded.get(parent) ?? new Set();
    const fresh = [...bucket.values()].filter((row) => !seen.has(idKey(row.id)));

    if (!fresh.length) continue;

    fresh.forEach((row) => seen.add(idKey(row.id)));
    cascaded.set(parent, seen);

    const ids = fresh.map((row) => row.id);

    // A file going does not take the row that displays it; a user or hostel's children were found above.
    if (!["FileAsset", "Hostel", "User"].includes(parent)) {
      for (const child of catalogue) {
        if (RETAINED.has(child.name) || child.name === "User") continue;

        for (const ref of child.refs) {
          if (ref.ref !== parent || ref.isArray || ref.path.includes(".")) continue;

          const rows = (await rowsOf(child, { [ref.path]: { $in: ids } })).filter(
            (row) => !(row.atKept && HOSTEL_OWNED.has(child.name)),
          );

          if (mark(child.name, rows, `belongs to an erased ${parent}`)) grew = true;
        }
      }
    }

    const fileRefs = byName[parent].refs.filter((ref) => ref.ref === "FileAsset");

    if (fileRefs.length) {
      const docs = await db
        .collection(byName[parent].collection)
        .find({ _id: { $in: ids } })
        .project(Object.fromEntries(fileRefs.map((ref) => [ref.path, 1])))
        .toArray();
      const fileIds = docs.flatMap((doc) => fileRefs.flatMap((ref) => valuesAt(doc, ref.path)));

      if (fileIds.length && mark("FileAsset", await rowsOf(byName.FileAsset, { _id: { $in: fileIds } }), `file of an erased ${parent}`)) {
        grew = true;
      }
    }
  }
}

// Last line of defence: nothing kept is on the delete side, whatever the rules above did.
for (const key of doomed.get("Hostel")?.keys() ?? []) if (keptKeys.has(key)) await fail("a kept hostel ended up in the plan.");
for (const key of doomed.get("User")?.keys() ?? []) if (keepIds.has(key)) await fail("a kept account ended up in the plan.");

// 5. Collections no model describes.
const modelled = new Set(catalogue.map((entry) => entry.collection));
const legacy = [];

for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
  if (!modelled.has(name) && !name.startsWith("system.")) {
    legacy.push({ count: await db.collection(name).countDocuments(), name });
  }
}

/* ----------------------------------------------------------- consequences */

const doomedIds = (name) => [...(doomed.get(name)?.values() ?? [])].map((row) => row.id);

// Kept accounts' own rows swept up by a cascade — should be empty; read it if not.
const keptLosses = {};

for (const [name] of doomed) {
  if (name === "User" || !byName[name].userPaths.some((ref) => ref.path === "userId")) continue;

  const n = await db.collection(byName[name].collection).countDocuments({
    _id: { $in: doomedIds(name) },
    userId: { $in: keptUsers.map((u) => u._id) },
  });

  if (n) keptLosses[name] = n;
}

const dangling = {};

for (const { entry, filter, key } of actorRefs) {
  const erased = new Set(doomedIds(entry.name).map(idKey));
  const n = (await db.collection(entry.collection).find(filter).project({ _id: 1 }).toArray()).filter(
    (doc) => !erased.has(idKey(doc._id)),
  ).length;

  if (n) dangling[key] = n;
}

const editCounts = [];

for (const edit of edits) {
  const erased = doomedIds(edit.name);
  const n = await db.collection(byName[edit.name].collection).countDocuments({ ...edit.filter, _id: { $nin: erased } });
  if (n) editCounts.push({ ...edit, count: n });
}

const fileRows = doomedIds("FileAsset").length
  ? await coll("FileAsset")
      .find({ _id: { $in: doomedIds("FileAsset") } })
      .project({ bucket: 1, key: 1, sizeBytes: 1, variants: 1 })
      .toArray()
  : [];
const objectKeys = fileRows.flatMap((file) =>
  file.bucket ? [file.key, ...(file.variants ?? []).map((v) => v.key)].filter(Boolean).map((key) => ({ bucket: file.bucket, key })) : [],
);

/* ------------------------------------------------------------------ report */

const totalRows = [...doomed.values()].reduce((sum, bucket) => sum + bucket.size, 0);
const fingerprint = `${deleteUsers.length}-${purgeHostels.length}-${totalRows}-${legacy.length}`;
const line = (text = "") => console.log(text);
const byCount = (record) => Object.entries(record).sort((a, b) => b[1] - a[1]);

line(`\nKEEP  ${keptHostels.map((h) => `${h.name} [${h.slug}]`).join(", ")}`);
for (const user of keptUsers) line(`  ${(user.email ?? user.phone).padEnd(52)} ${user.role.padEnd(12)} sign-in: ${signIn(user)}`);

line(`\nDELETE ${deleteUsers.length} accounts`);
for (const user of [...deleteUsers].sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""))) {
  line(`  ${(user.email ?? user.phone ?? idKey(user._id)).padEnd(52)} ${user.role}${user.isDeleted ? " (soft-deleted)" : ""}`);
}

line(`\nPURGE ${purgeHostels.length} hostels: ${purgeHostels.map((h) => h.name).join(", ")}`);

line(`\nROWS DELETED — ${totalRows}`);
for (const [name, bucket] of [...doomed].filter(([, b]) => b.size).sort((a, b) => b[1].size - a[1].size)) {
  const atKept = [...bucket.values()].filter((row) => row.atKept);
  const reasons = byCount(
    atKept.reduce((acc, row) => ({ ...acc, [row.reason]: (acc[row.reason] ?? 0) + 1 }), {}),
  );
  line(`  ${name.padEnd(28)} ${String(bucket.size).padStart(5)}${atKept.length ? `   at kept hostel ${atKept.length}: ${reasons.map(([r, n]) => `${r} ${n}`).join(", ")}` : ""}`);
}

line(`\nROWS EDITED`);
for (const edit of editCounts) line(`  ${edit.name} ${JSON.stringify(Object.keys(edit.update)[0])} ${Object.keys(Object.values(edit.update)[0])[0]}: ${edit.count}`);

line(`\nCOLLECTIONS DROPPED: ${legacy.map((c) => `${c.name} (${c.count})`).join(", ") || "none"}`);
line(`R2 OBJECTS DELETED: ${objectKeys.length} (${(fileRows.reduce((s, f) => s + (f.sizeBytes ?? 0), 0) / 1048576).toFixed(1)} MB)`);

if (Object.keys(protectedAtKept).length) {
  line(`\nKEPT — the hostel's own rows carrying a test account's id: ${byCount(protectedAtKept).map(([k, n]) => `${k} ${n}`).join(", ")}`);
}
if (residentsLeftByAddress) line(`KEPT — kept-hostel resident, guardian and inquiry rows sharing a test address: ${residentsLeftByAddress}`);
line(`\nKEPT ACCOUNTS LOSING OWN ROWS: ${byCount(keptLosses).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`);

const danglingTotal = Object.values(dangling).reduce((s, n) => s + n, 0);
line(`SURVIVING ROWS LEFT POINTING AT A DELETED ACCOUNT (who-did-what): ${danglingTotal}${danglingTotal ? ` — ${byCount(dangling).slice(0, 8).map(([k, n]) => `${k} ${n}`).join(", ")}` : ""}`);

// --show=Guardian,Notification prints each row of those models the plan erases, and why.
for (const name of (valueOf("show") ?? "").split(",").filter(Boolean)) {
  const bucket = doomed.get(name);
  if (!bucket?.size) continue;

  line(`\n${name} rows erased:`);
  const docs = await db.collection(byName[name].collection).find({ _id: { $in: doomedIds(name) } }).toArray();

  for (const doc of docs) {
    const row = bucket.get(idKey(doc._id));
    const owner = keptUsers.find((u) => idKey(u._id) === idKey(doc.userId));
    const brief = Object.fromEntries(
      Object.entries(doc).filter(([k, v]) => !["_id", "__v", "createdAt", "updatedAt"].includes(k) && v != null && (typeof v !== "object" || v instanceof mongoose.Types.ObjectId)),
    );
    line(`  ${row.reason}${row.atKept ? " [kept hostel]" : ""}${owner ? ` [KEPT ${owner.email}]` : ""}  ${JSON.stringify(brief).slice(0, 240)}`);
  }
}

if (valueOf("confirm") !== fingerprint) {
  line(`\nDry run — nothing changed. To carry out exactly this plan, add:  --confirm=${fingerprint}`);
  await mongoose.disconnect();
  process.exit(0);
}

/* ----------------------------------------------------------------- execute */

if (objectKeys.length && !(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY)) {
  await fail("R2 credentials are missing; the files would be orphaned.");
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = path.resolve(valueOf("backup-dir") ?? path.join(os.tmpdir(), `test-data-purge-${stamp}`));
const chunks = (list, size = 500) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

await mkdir(path.join(backupDir, "deleted"), { recursive: true });
await mkdir(path.join(backupDir, "modified"), { recursive: true });

// Back up everything first; a short backup stops the run before any write.
for (const [name] of doomed) {
  const ids = doomedIds(name);
  if (!ids.length) continue;
  const docs = [];
  for (const part of chunks(ids)) docs.push(...(await db.collection(byName[name].collection).find({ _id: { $in: part } }).toArray()));
  if (docs.length !== ids.length) await fail(`backup of ${name} read ${docs.length} of ${ids.length} rows.`);
  await writeFile(path.join(backupDir, "deleted", `${byName[name].collection}.json`), EJSON.stringify(docs, { relaxed: false }));
}

for (const { name } of legacy) {
  const docs = await db.collection(name).find({}).toArray();
  await writeFile(path.join(backupDir, "deleted", `${name}.json`), EJSON.stringify(docs, { relaxed: false }));
}

const modifiedByCollection = new Map();
for (const edit of editCounts) {
  const collection = byName[edit.name].collection;
  const docs = await db.collection(collection).find({ ...edit.filter, _id: { $nin: doomedIds(edit.name) } }).toArray();
  const bucket = modifiedByCollection.get(collection) ?? new Map();
  for (const doc of docs) if (!bucket.has(idKey(doc._id))) bucket.set(idKey(doc._id), doc);
  modifiedByCollection.set(collection, bucket);
}
for (const [collection, bucket] of modifiedByCollection) {
  await writeFile(path.join(backupDir, "modified", `${collection}.json`), EJSON.stringify([...bucket.values()], { relaxed: false }));
}

line(`\nBackup written: ${backupDir}`);

// Bytes before the rows that name them — an object nothing points at is never found again.
const { deleteFromR2 } = objectKeys.length ? await import("@/lib/r2") : {};
let objectsFailed = 0;

for (const { bucket, key } of objectKeys) {
  try {
    await deleteFromR2(bucket, key);
  } catch {
    objectsFailed += 1;
  }
}

let deleted = 0;
for (const [name] of doomed) {
  for (const part of chunks(doomedIds(name))) {
    deleted += (await db.collection(byName[name].collection).deleteMany({ _id: { $in: part } })).deletedCount;
  }
}

for (const edit of editCounts) {
  await db.collection(byName[edit.name].collection).updateMany(edit.filter, edit.update);
}

for (const { name } of legacy) await db.collection(name).drop();

const now = new Date();
await coll("AuditLog").insertOne({
  action: "TEST_DATA_PURGED",
  createdAt: now,
  entityType: "Platform",
  metadata: {
    accountsDeleted: deleteUsers.length,
    backupDir,
    collectionsDropped: legacy.map((c) => c.name),
    hostelsPurged: purgeHostels.map((h) => ({ id: idKey(h._id), name: h.name, slug: h.slug })),
    keptAccounts: keptUsers.map((u) => idKey(u._id)),
    keptHostels: keptHostels.map((h) => idKey(h._id)),
    objectsDeleted: objectKeys.length - objectsFailed,
    objectsFailed,
    rowsDeleted: deleted,
  },
  updatedAt: now,
});

line(`Deleted ${deleted} rows, ${deleteUsers.length} accounts, ${purgeHostels.length} hostels; dropped ${legacy.length} collections; R2 ${objectKeys.length - objectsFailed} deleted, ${objectsFailed} failed.`);
line(`Undo the database side with: --restore=${backupDir}`);
line("Next: npm --prefix apps/web run repair:account-hostels");

await mongoose.disconnect();
