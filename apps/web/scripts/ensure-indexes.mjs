/**
 * Builds every index a schema declares that the database does not have yet.
 *
 * The app no longer does this on connect (`autoIndex: false` in
 * `packages/db/src/connection.ts`), so run this after a change adds or alters
 * an index — a unique index that is never built is a rule nobody enforces.
 *
 * Only ever creates. An index the schemas no longer declare is listed, not
 * dropped. Preview with
 *
 *   npm --prefix apps/web run db:indexes -- --dry-run
 */
import nextEnv from "@next/env";
import mongoose from "mongoose";

import { loadModelCatalogue, repoRoot } from "./model-catalogue.mjs";

nextEnv.loadEnvConfig(repoRoot);

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required.");
}

const dryRun = process.argv.includes("--dry-run");

await loadModelCatalogue();
await mongoose.connect(process.env.MONGODB_URI, { autoCreate: false, autoIndex: false });

let failed = 0;

for (const model of Object.values(mongoose.models).sort((a, b) => a.modelName.localeCompare(b.modelName))) {
  const { toCreate, toDrop } = await model.diffIndexes();

  for (const name of toDrop) {
    console.log(`${model.modelName}: not in the schema, left alone — ${name}`);
  }

  if (!toCreate.length) {
    continue;
  }

  console.log(`${model.modelName}: ${dryRun ? "would create" : "creating"} ${JSON.stringify(toCreate)}`);

  if (!dryRun) {
    await model.createIndexes().catch((error) => {
      failed += 1;
      console.error(`${model.modelName}: ${error.message}`);
    });
  }
}

await mongoose.disconnect();

if (failed) {
  console.error(`${failed} model(s) failed — a unique index usually fails on rows that already break it.`);
  process.exitCode = 1;
} else {
  console.log(dryRun ? "Dry run — nothing written." : "Indexes are up to date.");
}
