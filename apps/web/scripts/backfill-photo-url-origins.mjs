/**
 * Strip the baked-in origin from stored hostel photo URLs.
 *
 * The admin photo uploaders persisted `${window.location.origin}/api/v1/files/
 * :id/url`. Uploads made from a dev machine therefore stored
 * `http://localhost:3000/...` in the database, and once the site was deployed
 * every visitor's browser tried to fetch hostel imagery from *their own*
 * machine — blocked as a loopback/CORS violation, so the public listing and
 * detail pages showed no photos at all. The uploaders now store a relative
 * path; this repairs the rows written before that.
 *
 * Only URLs whose path is the file route are rewritten, and the origin is the
 * only thing dropped. That distinction matters: the demo hostels carry
 * `https://images.unsplash.com/...` photos with no `fileAssetId`, and a blanket
 * "strip the origin" pass would turn those into dead relative links. Any
 * absolute URL that is not the file route is left untouched and reported.
 *
 * Idempotent — rows already relative are skipped. Dry by default; pass --apply
 * to write:
 *
 *   npm --prefix apps/web run backfill:photo-url-origins
 *   npm --prefix apps/web run backfill:photo-url-origins -- --apply
 *
 * Applied to the `hostelhub` database on 2026-08-17: 16 rows across one hostel.
 */
import nextEnv from "@next/env";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

nextEnv.loadEnvConfig(repoRoot);

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required to run the photo URL origin backfill.");
}

const apply = process.argv.includes("--apply");
const log = (message) => console.log(`${apply ? "" : "[dry] "}${message}`);

/** `/api/v1/files/:assetId/url`, optionally with a ?variant= query. */
const FILE_ROUTE = /^\/api\/v1\/files\/[a-f0-9]{24}\/url$/i;

/**
 * The relative equivalent, or null when this URL is not ours to touch.
 * Query and hash are preserved — `?variant=THUMBNAIL` is meaningful.
 */
function toRelative(rawUrl) {
  if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (!FILE_ROUTE.test(parsed.pathname)) {
    return null;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

await mongoose.connect(process.env.MONGODB_URI);

const db = mongoose.connection.db;
const hostels = await db
  .collection("hostels")
  .find({ "photos.0": { $exists: true } }, { projection: { name: 1, slug: 1, photos: 1 } })
  .toArray();

let scanned = 0;
let rewritten = 0;
let alreadyRelative = 0;
const untouched = new Map();
let hostelsChanged = 0;

for (const hostel of hostels) {
  const photos = hostel.photos ?? [];
  let changed = false;

  const next = photos.map((photo) => {
    scanned += 1;
    const url = photo.url ?? "";

    if (url.startsWith("/")) {
      alreadyRelative += 1;
      return photo;
    }

    const relative = toRelative(url);
    if (!relative) {
      if (url) {
        const origin = (() => {
          try {
            return new URL(url).origin;
          } catch {
            return "(unparseable)";
          }
        })();
        untouched.set(origin, (untouched.get(origin) ?? 0) + 1);
      }
      return photo;
    }

    rewritten += 1;
    changed = true;
    log(`  ${hostel.slug ?? hostel.name}: ${url} -> ${relative}`);
    return { ...photo, url: relative };
  });

  if (!changed) {
    continue;
  }

  hostelsChanged += 1;

  if (apply) {
    await db
      .collection("hostels")
      .updateOne({ _id: hostel._id }, { $set: { photos: next } });
  }
}

console.log("");
log(`hostels scanned: ${hostels.length}`);
log(`photo rows scanned: ${scanned}`);
log(`rewritten to relative: ${rewritten} across ${hostelsChanged} hostel(s)`);
log(`already relative: ${alreadyRelative}`);

if (untouched.size) {
  log("left untouched (not the file route):");
  for (const [origin, count] of untouched) {
    log(`  ${origin} x${count}`);
  }
}

if (!apply && rewritten > 0) {
  console.log("\nNothing was written. Re-run with --apply to persist.");
}

await mongoose.disconnect();
