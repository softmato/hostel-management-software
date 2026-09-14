/**
 * Read-only audit: which hostels and accounts are real, and which are left over
 * from testing. Changes nothing — it only runs `find` and `aggregate`.
 *
 * Everything outside the kept hostel(s) is sorted into three piles:
 *
 * - **KEEP** — a SUPERADMIN, or an account that *is* something at a kept hostel:
 *   its owner, a staff member not removed, a resident row, guardian access that
 *   is ACTIVE or USED, a cook not removed.
 * - **REVIEW** — a human has to decide: a platform moderator or field agent, a
 *   service-provider profile, a tie to a kept hostel that is only historical
 *   (removed staff, revoked guardian, a stray `hostelIds` entry), or no tie at
 *   all but rows in the kept hostel's records that point at the account.
 * - **DELETE** — none of the above.
 *
 * Every hostel not kept is listed for purging with its document and file counts.
 *
 * ## How references are found
 *
 * Not from a hand-kept list. Every model in `packages/db/src/models` is loaded
 * and its schema walked for paths with `ref: "User"` or `ref: "Hostel"`
 * (subdocuments and arrays included), so a model added later is counted without
 * anyone remembering to add it here. Rows that name a person only by email or
 * phone — no id — are counted separately, because an id-based purge misses them.
 *
 * Usage (from the repo root):
 *
 *   npm --prefix apps/web run audit:test-data
 *   npm --prefix apps/web run audit:test-data -- --keep-hostel="education light"
 *
 *   --keep-hostel=<name fragment | slug | id>  repeatable; default "education light"
 *   --keep-email=a@x.com,b@x.com               force KEEP
 *   --delete-email=a@x.com                     force DELETE (test logins inside a kept hostel)
 *   --out=<path>                               JSON report; default the OS temp dir
 *
 * The console gets the summary; the JSON report has every row count per account
 * and per hostel. It holds names, emails and phones — keep it out of the repo.
 */
import nextEnv from "@next/env";
import mongoose from "mongoose";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadModelCatalogue, repoRoot } from "./model-catalogue.mjs";

nextEnv.loadEnvConfig(repoRoot);

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required to audit test data.");
}

const args = process.argv.slice(2);
const listArg = (name) =>
  args
    .filter((arg) => arg.startsWith(`--${name}=`))
    .flatMap((arg) => arg.slice(name.length + 3).split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

const keepHostelArgs = listArg("keep-hostel");
const keepHostelQueries = keepHostelArgs.length ? keepHostelArgs : ["education light"];
const forcedKeep = new Set(listArg("keep-email"));
const forcedDelete = new Set(listArg("delete-email"));
const outArg = args.find((arg) => arg.startsWith("--out="));
const outPath = outArg
  ? path.resolve(outArg.slice("--out=".length))
  : path.join(os.tmpdir(), `test-data-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);

const catalogue = await loadModelCatalogue();

const byName = Object.fromEntries(catalogue.map((entry) => [entry.name, entry]));

/* ---------------------------------------------------------------- database */

// A schema-bearing model on a live connection builds its indexes by default.
// This audit must not write anything, index builds included.
mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);
await mongoose.connect(process.env.MONGODB_URI, { autoCreate: false, autoIndex: false });

const db = mongoose.connection.db;
const coll = (modelName) => db.collection(byName[modelName].collection);
const idKey = (value) => String(value);

/* ----------------------------------------------------------------- hostels */

const hostels = await coll("Hostel")
  .find({})
  .project({ createdAt: 1, isDeleted: 1, name: 1, ownerId: 1, slug: 1, status: 1 })
  .toArray();

const keptHostels = hostels.filter((hostel) =>
  keepHostelQueries.some(
    (query) =>
      idKey(hostel._id) === query ||
      hostel.slug?.toLowerCase() === query ||
      hostel.name?.toLowerCase().includes(query),
  ),
);

if (keptHostels.length === 0) {
  console.error(`No hostel matches ${keepHostelQueries.map((q) => `"${q}"`).join(", ")}. Hostels in this database:`);
  for (const hostel of hostels) console.error(`  ${hostel.name}  (slug ${hostel.slug}, id ${hostel._id})`);
  await mongoose.disconnect();
  process.exit(1);
}

const keptIds = keptHostels.map((hostel) => hostel._id);
const keptKeys = new Set(keptIds.map(idKey));
const hostelName = new Map(hostels.map((hostel) => [idKey(hostel._id), hostel.name]));

/** Documents per hostel, per collection. */
const hostelCounts = new Map(hostels.map((hostel) => [idKey(hostel._id), {}]));
const hostelFiles = new Map();

for (const entry of catalogue) {
  const ref = entry.hostelRef;

  if (!ref || entry.name === "Hostel") continue;

  const rows = await coll(entry.name)
    .aggregate([
      { $match: { [ref.path]: { $exists: true, $ne: null } } },
      ...(ref.isArray ? [{ $unwind: `$${ref.path}` }] : []),
      { $group: { _id: `$${ref.path}`, bytes: { $sum: { $ifNull: ["$sizeBytes", 0] } }, n: { $sum: 1 } } },
    ])
    .toArray();

  for (const row of rows) {
    const counts = hostelCounts.get(idKey(row._id));

    if (!counts) continue; // points at a hostel that no longer exists

    counts[entry.name] = row.n;

    if (entry.name === "FileAsset") {
      hostelFiles.set(idKey(row._id), { bytes: row.bytes, files: row.n });
    }
  }
}

/* ---------------------------------------------------------------- accounts */

const users = await coll("User")
  .find({})
  .project({ createdAt: 1, email: 1, hostelIds: 1, isDeleted: 1, lastLoginAt: 1, name: 1, phone: 1, role: 1, status: 1 })
  .toArray();

/**
 * For every account: how many rows point at it through each `User` reference,
 * and how many of those rows belong to a kept hostel. One aggregate per
 * reference path, over the whole collection.
 */
const footprint = new Map(users.map((user) => [idKey(user._id), {}]));
const orphanUserRefs = {};

for (const entry of catalogue) {
  for (const ref of entry.userPaths) {
    const hostel = entry.hostelRef;
    const atKept = !hostel
      ? false
      : hostel.isArray
        ? { $gt: [{ $size: { $setIntersection: [{ $ifNull: [`$${hostel.path}`, []] }, keptIds] } }, 0] }
        : { $in: [{ $ifNull: [`$${hostel.path}`, null] }, keptIds] };

    // For a path inside an array of subdocuments, `$a.b` is already an array.
    const nested = ref.path.includes(".");

    const rows = await coll(entry.name)
      .aggregate([
        { $match: { [ref.path]: { $exists: true, $ne: null } } },
        { $project: { atKept: atKept === false ? { $literal: false } : atKept, u: `$${ref.path}` } },
        ...(ref.isArray || nested ? [{ $unwind: "$u" }] : []),
        ...(ref.isArray && nested ? [{ $unwind: "$u" }] : []),
        { $group: { _id: { atKept: "$atKept", u: "$u" }, n: { $sum: 1 } } },
      ])
      .toArray();

    const key = `${entry.name}.${ref.path}`;

    for (const row of rows) {
      const bucket = footprint.get(idKey(row._id.u));

      if (!bucket) {
        orphanUserRefs[key] = (orphanUserRefs[key] ?? 0) + row.n;
        continue;
      }

      bucket[key] ??= { atKept: 0, total: 0 };
      bucket[key].total += row.n;
      if (row._id.atKept) bucket[key].atKept += row.n;
    }
  }
}

/* What each account actually *is* at a kept hostel — the rows that grant scope. */
const [owners, residentRows, memberRows, guardianRows, cookRows, providerRows] = await Promise.all([
  Promise.resolve(keptHostels.map((hostel) => ({ hostelId: hostel._id, userId: hostel.ownerId }))),
  coll("Resident").find({ hostelId: { $in: keptIds }, userId: { $ne: null } }).project({ hostelId: 1, isDeleted: 1, status: 1, userId: 1 }).toArray(),
  coll("HostelMember").find({ hostelId: { $in: keptIds } }).project({ hostelId: 1, isDeleted: 1, role: 1, status: 1, userId: 1 }).toArray(),
  coll("GuardianAccess").find({ hostelId: { $in: keptIds }, userId: { $ne: null } }).project({ hostelId: 1, status: 1, userId: 1 }).toArray(),
  coll("CookAccount").find({ hostelId: { $in: keptIds }, userId: { $ne: null } }).project({ hostelId: 1, status: 1, userId: 1 }).toArray(),
  coll("ServiceProvider").find({ userId: { $ne: null } }).project({ fullName: 1, isDeleted: 1, status: 1, userId: 1 }).toArray(),
]);

const ties = new Map();
const tie = (userId, live, label) => {
  const key = idKey(userId);
  if (!ties.has(key)) ties.set(key, []);
  ties.get(key).push({ label, live });
};

for (const row of owners) tie(row.userId, true, `owner of ${hostelName.get(idKey(row.hostelId))}`);
for (const row of residentRows) tie(row.userId, !row.isDeleted, `resident ${row.status}${row.isDeleted ? " (deleted)" : ""}`);
for (const row of memberRows) tie(row.userId, !row.isDeleted && row.status !== "REMOVED", `staff ${row.role} ${row.status}${row.isDeleted ? " (deleted)" : ""}`);
for (const row of guardianRows) tie(row.userId, ["ACTIVE", "USED"].includes(row.status), `guardian ${row.status}`);
for (const row of cookRows) tie(row.userId, row.status !== "REMOVED", `cook ${row.status}`);

const providers = new Map(providerRows.map((row) => [idKey(row.userId), row]));

/* ------------------------------------------------------------ classifying */

const accounts = users.map((user) => {
  const key = idKey(user._id);
  const email = user.email?.toLowerCase() ?? null;
  const own = ties.get(key) ?? [];
  const refs = footprint.get(key) ?? {};
  const rowsTotal = Object.values(refs).reduce((sum, ref) => sum + ref.total, 0);
  const rowsAtKept = Object.values(refs).reduce((sum, ref) => sum + ref.atKept, 0);
  const strayKept = (user.hostelIds ?? []).some((id) => keptKeys.has(idKey(id)));
  // An archived hostel is already pulled off its owner's `hostelIds`, so ownership is read from the hostel.
  const otherHostels = [
    ...new Set([
      ...(user.hostelIds ?? []).map(idKey),
      ...hostels.filter((hostel) => idKey(hostel.ownerId) === key).map((hostel) => idKey(hostel._id)),
    ]),
  ]
    .filter((id) => !keptKeys.has(id))
    .map((id) => hostelName.get(id) ?? `missing hostel ${id}`);
  const provider = providers.get(key);

  let verdict;
  let why;

  if (email && forcedDelete.has(email)) {
    [verdict, why] = ["DELETE", "--delete-email"];
  } else if (email && forcedKeep.has(email)) {
    [verdict, why] = ["KEEP", "--keep-email"];
  } else if (user.role === "SUPERADMIN") {
    [verdict, why] = ["KEEP", "platform superadmin"];
  } else if (own.some((t) => t.live)) {
    [verdict, why] = ["KEEP", own.filter((t) => t.live).map((t) => t.label).join("; ")];
  } else if (user.role === "PLATFORM_MODERATOR" || user.role === "PLATFORM_AGENT") {
    [verdict, why] = ["REVIEW", `${user.role} — real field team or a test login?`];
  } else if (own.length) {
    [verdict, why] = ["REVIEW", `only a past tie to the kept hostel: ${own.map((t) => t.label).join("; ")}`];
  } else if (strayKept) {
    [verdict, why] = ["REVIEW", "kept hostel is on the account but nothing backs it"];
  } else if (rowsAtKept > 0) {
    [verdict, why] = ["REVIEW", `no tie, but ${rowsAtKept} row(s) in the kept hostel's records point at it`];
  } else if (provider && !provider.isDeleted) {
    [verdict, why] = ["REVIEW", `service provider "${provider.fullName}" ${provider.status}`];
  } else {
    [verdict, why] = ["DELETE", otherHostels.length ? `only at ${otherHostels.join(", ")}` : "no hostel"];
  }

  return {
    createdAt: user.createdAt ?? null,
    email: user.email ?? null,
    id: key,
    isDeleted: Boolean(user.isDeleted),
    lastLoginAt: user.lastLoginAt ?? null,
    name: user.name ?? null,
    otherHostels,
    phone: user.phone ?? null,
    references: refs,
    role: user.role,
    rowsAtKept,
    rowsTotal,
    status: user.status ?? null,
    verdict,
    why,
  };
});

const deleting = accounts.filter((account) => account.verdict === "DELETE");

/* Rows that name a to-be-deleted person by email or phone only. */
const deleteEmails = [...new Set(deleting.map((a) => a.email).filter(Boolean))];
const deletePhones = [...new Set(deleting.map((a) => a.phone).filter(Boolean))];
const contactRows = {};

for (const entry of catalogue) {
  if (entry.name === "User") continue;

  for (const field of entry.contactPaths) {
    const values = /phone/i.test(field) ? deletePhones : deleteEmails;

    if (!values.length) continue;

    const filter = /email/i.test(field)
      ? { [field]: { $in: values.map((v) => new RegExp(`^${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")) } }
      : { [field]: { $in: values } };
    const total = await coll(entry.name).countDocuments(filter);
    const atKept =
      total && entry.hostelRef && !entry.hostelRef.isArray
        ? await coll(entry.name).countDocuments({ ...filter, [entry.hostelRef.path]: { $in: keptIds } })
        : 0;

    if (total) contactRows[`${entry.name}.${field}`] = { atKept, total };
  }
}

/* Kept hostel records that point at accounts being deleted. */
const keptRowsOfDeleted = {};

for (const account of deleting) {
  for (const [key, ref] of Object.entries(account.references)) {
    if (ref.atKept) keptRowsOfDeleted[key] = (keptRowsOfDeleted[key] ?? 0) + ref.atKept;
  }
}

/* Collections in the database no model describes — an id-based purge never sees them. */
const modelled = new Set(catalogue.map((entry) => entry.collection));
const unmodelled = {};

for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
  if (!modelled.has(name) && !name.startsWith("system.")) {
    unmodelled[name] = await db.collection(name).estimatedDocumentCount();
  }
}

const loginlessAtKept = await coll("Resident").countDocuments({
  hostelId: { $in: keptIds },
  isDeleted: { $ne: true },
  userId: { $in: [null] },
});

await mongoose.disconnect();

/* ------------------------------------------------------------------ report */

const sum = (counts) => Object.values(counts).reduce((total, n) => total + n, 0);
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const day = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "—");
const topRefs = (refs, field) =>
  Object.entries(refs)
    .filter(([, ref]) => ref[field] > 0)
    .sort((a, b) => b[1][field] - a[1][field])
    .slice(0, 4)
    .map(([key, ref]) => `${key} ${ref[field]}`)
    .join(", ");

const hostelReport = hostels.map((hostel) => {
  const key = idKey(hostel._id);
  const counts = hostelCounts.get(key) ?? {};
  const owner = users.find((user) => idKey(user._id) === idKey(hostel.ownerId));

  return {
    createdAt: hostel.createdAt ?? null,
    documents: sum(counts),
    documentsByCollection: counts,
    files: hostelFiles.get(key) ?? { bytes: 0, files: 0 },
    id: key,
    isDeleted: Boolean(hostel.isDeleted),
    name: hostel.name,
    owner: owner ? owner.email ?? owner.phone ?? idKey(owner._id) : `missing user ${hostel.ownerId}`,
    slug: hostel.slug,
    status: hostel.status ?? null,
    verdict: keptKeys.has(key) ? "KEEP" : "PURGE",
  };
});

const line = (text = "") => console.log(text);

line(`\nKept hostel(s): ${keptHostels.map((h) => `${h.name} (${h.slug})`).join(", ")}`);

line(`\nHOSTELS — ${hostels.length}`);
for (const hostel of [...hostelReport].sort((a, b) => a.verdict.localeCompare(b.verdict) || a.name.localeCompare(b.name))) {
  line(
    `  ${hostel.verdict.padEnd(6)} ${hostel.name}  [${hostel.slug}]  owner ${hostel.owner}  created ${day(hostel.createdAt)}${hostel.isDeleted ? "  ARCHIVED" : ""}` +
      `  — ${hostel.documents} docs, ${hostel.files.files} files (${mb(hostel.files.bytes)})`,
  );
}

const counts = { DELETE: 0, KEEP: 0, REVIEW: 0 };
for (const account of accounts) counts[account.verdict] += 1;

line(`\nACCOUNTS — ${accounts.length}: KEEP ${counts.KEEP} · REVIEW ${counts.REVIEW} · DELETE ${counts.DELETE}`);

for (const verdict of ["KEEP", "REVIEW", "DELETE"]) {
  const group = accounts.filter((a) => a.verdict === verdict).sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));

  if (!group.length) continue;

  line(`\n${verdict}`);
  for (const a of group) {
    line(
      `  ${(a.email ?? a.phone ?? a.id).padEnd(38)} ${a.role.padEnd(18)} created ${day(a.createdAt)} login ${day(a.lastLoginAt)}${a.isDeleted ? " (soft-deleted)" : ""}`,
    );
    line(`      ${a.why}`);
    if (verdict !== "KEEP" && a.rowsTotal) {
      line(`      ${a.rowsTotal} row(s) point at it${a.rowsAtKept ? `, ${a.rowsAtKept} in the kept hostel: ${topRefs(a.references, "atKept")}` : `: ${topRefs(a.references, "total")}`}`);
    }
  }
}

const printCounts = (title, record) => {
  const entries = Object.entries(record).sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) return;
  line(`\n${title}`);
  for (const [key, value] of entries) {
    line(`  ${key}: ${typeof value === "object" ? `${value.total}${value.atKept ? ` (${value.atKept} in the kept hostel)` : ""}` : value}`);
  }
};

printCounts("KEPT HOSTEL ROWS THAT POINT AT DELETE ACCOUNTS — stay unless you decide otherwise", keptRowsOfDeleted);
printCounts("ROWS NAMING DELETE ACCOUNTS BY EMAIL/PHONE ONLY — an id-based purge misses these", contactRows);
printCounts("USER REFERENCES ALREADY POINTING AT NO ACCOUNT", orphanUserRefs);
printCounts("COLLECTIONS NO MODEL DESCRIBES", unmodelled);

if (loginlessAtKept) {
  line(`\nNote: the kept hostel has ${loginlessAtKept} resident row(s) with no login. They are not accounts, so this audit does not judge them.`);
}

await writeFile(
  outPath,
  JSON.stringify(
    {
      accounts,
      contactRows,
      generatedAt: new Date().toISOString(),
      hostels: hostelReport,
      keptHostels: keptHostels.map((h) => ({ id: idKey(h._id), name: h.name, slug: h.slug })),
      keptRowsOfDeleted,
      loginlessResidentsAtKept: loginlessAtKept,
      orphanUserRefs,
      referenceMap: catalogue.map((e) => ({
        collection: e.collection,
        hostelPath: e.hostelRef?.path ?? null,
        model: e.name,
        userPaths: e.userPaths.map((p) => p.path),
      })),
      unmodelledCollections: unmodelled,
    },
    null,
    2,
  ),
);

line(`\nFull report: ${outPath}`);
line("Nothing was changed.");

// An address in a forced list that matches no account is a typo.
for (const email of [...forcedKeep, ...forcedDelete]) {
  if (!users.some((user) => user.email?.toLowerCase() === email)) {
    line(`Warning: ${email} matches no account.`);
  }
}
