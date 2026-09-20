/**
 * Copies every collection from `MONGODB_URI` to `MONGODB_URI_TARGET`, for the
 * Atlas move (docs/PERFORMANCE.md §1.2).
 *
 * ## Why this exists instead of `mongodump | mongorestore`
 *
 * The plan said to use MongoDB's own tools, and for a large or unusual database
 * that is still the right answer. It was changed for two reasons that both
 * happen to hold here: the Database Tools are a separate install that is not on
 * this machine, and the source is **111 plain collections, 15 MB, no views, no
 * timeseries, no capped collections and no per-collection options** — verified
 * before this was written, not assumed.
 *
 * The usual argument for `mongodump` is fidelity, and it does not apply to a
 * driver-to-driver copy: documents are never serialised to JSON, so `ObjectId`,
 * `Date`, `Decimal128` and `Binary` come off the cursor as themselves and go
 * back down the wire unchanged. The other argument is indexes, and those are
 * copied explicitly below.
 *
 * If the source ever grows a view or a timeseries collection, this refuses
 * rather than skipping it quietly — see the type check.
 *
 * ## What protects you
 *
 * Nothing here verifies its own work; `compare-clusters.mjs` does that, and it
 * is the thing that decides whether the switch is safe. Run it after.
 *
 * Usage (from the repo root):
 *
 *   npm run web:migrate:cluster -- --dry-run
 *   npm run web:migrate:cluster
 *
 * `--force` allows a non-empty target. It does not empty it first — it inserts
 * alongside what is there, which is almost never what you want. The refusal
 * exists because a cluster created with "Preload sample dataset" left on is not
 * empty, and that is the common case.
 */
import nextEnv from "@next/env";
import { MongoClient } from "mongodb";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

nextEnv.loadEnvConfig(repoRoot);

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

const sourceUri = process.env.MONGODB_URI;
const targetUri = process.env.MONGODB_URI_TARGET;

if (!sourceUri || !targetUri) {
  throw new Error("MONGODB_URI and MONGODB_URI_TARGET are both required in the root .env.");
}

if (sourceUri === targetUri) {
  throw new Error("Source and target are the same cluster — refusing to run.");
}

/** Rows per `insertMany`. Small enough to stay well inside the 16 MB command cap. */
const BATCH = 1000;

const sourceClient = new MongoClient(sourceUri);
const targetClient = new MongoClient(targetUri);

try {
  await Promise.all([sourceClient.connect(), targetClient.connect()]);

  const sourceDb = sourceClient.db();
  const targetDb = targetClient.db();

  console.log(`source: ${sourceDb.databaseName}`);
  console.log(`target: ${targetDb.databaseName}${dryRun ? "  (dry run)" : ""}\n`);

  const collections = (await sourceDb.listCollections().toArray()).filter(
    (entry) => !entry.name.startsWith("system."),
  );

  // A view or a timeseries collection needs its definition recreated, not its
  // documents copied. Rather than copy one wrongly, stop and say so.
  const unsupported = collections.filter((entry) => entry.type && entry.type !== "collection");

  if (unsupported.length > 0) {
    throw new Error(
      `Source holds non-plain collections this script cannot copy faithfully: ${unsupported
        .map((entry) => `${entry.name} (${entry.type})`)
        .join(", ")}. Use mongodump/mongorestore instead.`,
    );
  }

  const existing = (await targetDb.listCollections({}, { nameOnly: true }).toArray()).filter(
    (entry) => !entry.name.startsWith("system."),
  );

  if (existing.length > 0 && !force) {
    throw new Error(
      `Target is not empty — ${existing.length} collection(s) already there ` +
        `(${existing.slice(0, 5).map((entry) => entry.name).join(", ")}...). ` +
        `Drop them, or pass --force to insert alongside them.`,
    );
  }

  let totalDocs = 0;
  let totalIndexes = 0;

  for (const { name } of collections) {
    const from = sourceDb.collection(name);
    const to = targetDb.collection(name);
    const expected = await from.countDocuments();

    if (dryRun) {
      const indexes = await from.indexes();
      console.log(
        `would copy ${name.padEnd(30)} ${String(expected).padStart(7)} docs, ${indexes.length - 1} index(es)`,
      );
      totalDocs += expected;
      continue;
    }

    // Created explicitly so an empty source collection still exists on the
    // target: the app's own startup index builds expect them, and a missing
    // collection reads differently from an empty one when you are diffing.
    await targetDb.createCollection(name).catch(() => {});

    let copied = 0;
    let batch = [];

    for await (const doc of from.find({})) {
      batch.push(doc);

      if (batch.length >= BATCH) {
        // `ordered: false` for throughput; it still throws at the end if any
        // document failed, so nothing is lost silently.
        await to.insertMany(batch, { ordered: false });
        copied += batch.length;
        batch = [];
      }
    }

    if (batch.length > 0) {
      await to.insertMany(batch, { ordered: false });
      copied += batch.length;
    }

    // Indexes after the documents: building them once over a full collection is
    // cheaper than maintaining them through every insert. `_id_` is created by
    // the server. `v` and `ns` are server bookkeeping and are rejected as index
    // options if echoed back.
    const specs = (await from.indexes())
      .filter((index) => index.name !== "_id_")
      .map(({ v, ns, ...spec }) => spec);

    if (specs.length > 0) {
      await to.createIndexes(specs);
    }

    totalDocs += copied;
    totalIndexes += specs.length;

    console.log(
      `${copied === expected ? "ok  " : "WARN"} ${name.padEnd(30)} ${String(copied).padStart(7)} docs, ${specs.length} index(es)`,
    );
  }

  console.log(
    `\n${dryRun ? "Would copy" : "Copied"} ${collections.length} collections, ${totalDocs} documents` +
      (dryRun ? "." : `, ${totalIndexes} indexes.`),
  );

  if (!dryRun) {
    console.log("\nNow verify:  npm run web:compare:clusters");
  }
} finally {
  await Promise.allSettled([sourceClient.close(), targetClient.close()]);
}
