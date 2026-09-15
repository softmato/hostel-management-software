/**
 * Move stored public-bucket URLs off Cloudflare's r2.dev address and onto the
 * bucket's custom domain.
 *
 * `R2_PUBLIC_URL` used to be `https://pub-….r2.dev`. Two writers baked that
 * origin into rows:
 * - hostel photo uploads, in `hostels.photos[].url`;
 * - the platform's plan-payment QR, in `platformsettings` → `value.collectionQrUrl`.
 *
 * Cloudflare rate-limits r2.dev and says it is not for production, so these rows
 * move to whatever `R2_PUBLIC_URL` names now. Both hosts serve the same bucket,
 * so every row works before and after the rewrite. Only the host the page asks
 * for changes.
 *
 * Deliberately left alone:
 * - `auditlogs`. They record what was set at the time.
 * - `hosteldocuments.fileUrl` and `hostelapplications.snapshot.documents[].fileUrl`.
 *   These are registration documents (citizenship scans) that should not be
 *   public at all. They move to the private bucket in their own migration.
 *   Putting them on a second public hostname would widen the exposure, not fix it.
 *
 * Only URLs whose origin is exactly `--from` are rewritten; the key path, query
 * and hash are kept. Idempotent. Dry by default:
 *
 *   npm --prefix apps/web run backfill:r2-public-origin -- --from=https://pub-<id>.r2.dev
 *   npm --prefix apps/web run backfill:r2-public-origin -- --from=https://pub-<id>.r2.dev --apply
 */
import nextEnv from "@next/env";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

nextEnv.loadEnvConfig(repoRoot);

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required to run the R2 public origin backfill.");
}

const apply = process.argv.includes("--apply");
const log = (message) => console.log(`${apply ? "" : "[dry] "}${message}`);

const trimOrigin = (value) => (value ?? "").trim().replace(/\/+$/, "");
const from = trimOrigin(
  process.argv.find((arg) => arg.startsWith("--from="))?.slice("--from=".length),
);
const to = trimOrigin(process.env.R2_PUBLIC_URL);

if (!/^https:\/\/pub-[a-z0-9]+\.r2\.dev$/i.test(from)) {
  throw new Error("--from must be the old r2.dev origin, e.g. --from=https://pub-<id>.r2.dev");
}

if (!/^https:\/\/[^/]+$/i.test(to) || /\.r2\.dev$/i.test(to)) {
  throw new Error(`R2_PUBLIC_URL must be the bucket's custom domain, not r2.dev (got "${to}").`);
}

/** The same object on the new origin, or null when this URL is not ours to touch. */
function moved(url) {
  if (typeof url !== "string" || !url.startsWith(`${from}/`)) {
    return null;
  }

  return `${to}${url.slice(from.length)}`;
}

const fromPattern = new RegExp(`^${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`);

await mongoose.connect(process.env.MONGODB_URI);

const db = mongoose.connection.db;
log(`database: ${db.databaseName}`);
log(`${from} -> ${to}`);
console.log("");

let photosRewritten = 0;
const hostels = await db
  .collection("hostels")
  .find({ "photos.url": fromPattern }, { projection: { name: 1, slug: 1, photos: 1 } })
  .toArray();

for (const hostel of hostels) {
  const next = (hostel.photos ?? []).map((photo) => {
    const url = moved(photo.url);

    if (!url) {
      return photo;
    }

    photosRewritten += 1;
    log(`  hostel ${hostel.slug ?? hostel.name}: ${photo.url} -> ${url}`);
    return { ...photo, url };
  });

  if (apply) {
    await db.collection("hostels").updateOne({ _id: hostel._id }, { $set: { photos: next } });
  }
}

let qrRewritten = 0;
const settings = await db
  .collection("platformsettings")
  .find({ "value.collectionQrUrl": fromPattern }, { projection: { key: 1, value: 1 } })
  .toArray();

for (const setting of settings) {
  const current = setting.value.collectionQrUrl;
  const url = moved(current);

  if (!url) {
    continue;
  }

  qrRewritten += 1;
  log(`  platform setting ${setting.key}: ${current} -> ${url}`);

  if (apply) {
    await db
      .collection("platformsettings")
      .updateOne(
        { _id: setting._id, "value.collectionQrUrl": current },
        { $set: { "value.collectionQrUrl": url } },
      );
  }
}

console.log("");
log(`hostel photos rewritten: ${photosRewritten} across ${hostels.length} hostel(s)`);
log(`collection QR rewritten: ${qrRewritten}`);

if (!apply && photosRewritten + qrRewritten > 0) {
  console.log("\nNothing was written. Re-run with --apply to persist.");
}

await mongoose.disconnect();
