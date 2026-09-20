/**
 * Read-only diff of two MongoDB clusters, for the Atlas move.
 *
 * The copy itself is `mongodump` | `mongorestore` — MongoDB's own tools already
 * carry indexes, collation and BSON types across, and a hand-written copier
 * would only be a worse version of them. What they do *not* give you is a
 * verdict, and "the restore printed no errors" is not one: a restore that
 * silently skipped a collection, or one that ran against a target somebody had
 * already half-seeded, looks exactly like a clean one on stdout.
 *
 * So this is the check, and it is the only thing standing between a switched
 * `MONGODB_URI` and a production hostel whose invoices did not come across.
 * It compares, per collection:
 *
 *   - presence on both sides
 *   - `countDocuments()` — the real count, not `estimatedDocumentCount()`, which
 *     reads collection metadata and is allowed to be stale
 *   - index names, because an index that failed to build is invisible until the
 *     query that needed it starts doing a collection scan in production
 *
 * Nothing is written. Run it before the env switch and again after, and treat a
 * non-zero exit as "do not switch".
 *
 * Usage (from the repo root), with the new cluster's URI:
 *
 *   npm --prefix apps/web run compare:clusters -- --target="mongodb+srv://..."
 *
 * The source is `MONGODB_URI` from the root `.env` unless `--source=` is given.
 */
import nextEnv from "@next/env";
import { MongoClient } from "mongodb";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

nextEnv.loadEnvConfig(repoRoot);

function arg(name) {
  const match = process.argv.find((entry) => entry.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : null;
}

const sourceUri = arg("source") ?? process.env.MONGODB_URI;
// `MONGODB_URI_OLD` is the last fallback on purpose. After the cutover the
// target of interest is the cluster traffic just left, and the alternative is
// pasting a production URI — password and all — onto a command line, where it
// lands in shell history.
const targetUri =
  arg("target") ?? process.env.MONGODB_URI_TARGET ?? process.env.MONGODB_URI_OLD;

if (!sourceUri || !targetUri) {
  throw new Error(
    "Both clusters are required: --source= (or MONGODB_URI) and --target= (or MONGODB_URI_TARGET / MONGODB_URI_OLD).",
  );
}

if (sourceUri === targetUri) {
  throw new Error("Source and target are the same cluster — nothing to compare.");
}

/** `{ name -> { count, indexes } }` for every non-system collection. */
async function readCluster(uri) {
  const client = new MongoClient(uri);

  try {
    await client.connect();

    const db = client.db();
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    const summary = new Map();

    for (const { name } of collections) {
      // `system.*` is the server's own bookkeeping and never crosses in a dump.
      if (name.startsWith("system.")) {
        continue;
      }

      const collection = db.collection(name);
      const indexes = await collection.indexes();

      summary.set(name, {
        count: await collection.countDocuments(),
        indexes: indexes.map((index) => index.name).sort(),
      });
    }

    return { dbName: db.databaseName, summary };
  } finally {
    await client.close();
  }
}

const [source, target] = await Promise.all([
  readCluster(sourceUri),
  readCluster(targetUri),
]);

console.log(`source db: ${source.dbName}  (${source.summary.size} collections)`);
console.log(`target db: ${target.dbName}  (${target.summary.size} collections)\n`);

if (source.dbName !== target.dbName) {
  // Not fatal on its own — the path segment of the URI names it — but it is the
  // most common reason a restore "worked" and the app then saw an empty database.
  console.log(
    `! database names differ (${source.dbName} vs ${target.dbName}). Check the /dbname in both URIs.\n`,
  );
}

const names = [...new Set([...source.summary.keys(), ...target.summary.keys()])].sort();
const problems = [];

for (const name of names) {
  const from = source.summary.get(name);
  const to = target.summary.get(name);

  if (!from) {
    // Extra rows on the target are as bad as missing ones: it means the restore
    // landed on a cluster that was not empty.
    problems.push(`${name}: present on target only (${to.count} docs) — target was not empty`);
    continue;
  }

  if (!to) {
    problems.push(`${name}: MISSING on target (${from.count} docs on source)`);
    continue;
  }

  if (from.count !== to.count) {
    problems.push(`${name}: ${from.count} docs on source, ${to.count} on target`);
  }

  const missingIndexes = from.indexes.filter((index) => !to.indexes.includes(index));

  if (missingIndexes.length > 0) {
    problems.push(`${name}: indexes missing on target — ${missingIndexes.join(", ")}`);
  }

  console.log(
    `${from.count === to.count && missingIndexes.length === 0 ? "ok  " : "DIFF"} ${name.padEnd(28)} ${String(from.count).padStart(7)} -> ${String(to.count).padStart(7)}  (${to.indexes.length} indexes)`,
  );
}

/*
 * The summary is deliberately a finding rather than an instruction.
 *
 * It used to say "DO NOT switch MONGODB_URI", which was right for exactly one
 * run — the one before the cutover. This script's second job is the run *after*
 * it, comparing the live cluster against the one traffic just left, and there a
 * difference is the expected result: it is the window between the copy and the
 * redeploy, made visible. Reading "DO NOT switch" at that point means reaching
 * for an alarm about something that has already happened and is already known.
 *
 * The exit code still carries the verdict, so anything scripting this keeps
 * working: non-zero means the two clusters are not identical, which is all this
 * can honestly claim without knowing which direction the traffic is flowing.
 */
if (problems.length === 0) {
  console.log(`\n${source.dbName} and ${target.dbName} are identical.`);
  console.log("Before the cutover, that means it is safe to switch MONGODB_URI.");
  process.exit(0);
}

console.log(`\n${problems.length} difference(s), ${source.dbName} -> ${target.dbName}:\n`);

for (const problem of problems) {
  console.log(`  - ${problem}`);
}

console.log(
  "\nBefore the cutover this blocks the switch. After it, these are rows the old",
);
console.log(
  "cluster took while traffic was still pointed at it — decide per collection",
);
console.log("whether any of them are worth recovering.");

process.exit(1);
