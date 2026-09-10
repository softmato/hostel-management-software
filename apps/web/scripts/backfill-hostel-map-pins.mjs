/**
 * Put every already-published hostel on the map.
 *
 * Until registration learned to geocode, `geocodeAndCacheHostel` ran from
 * exactly two places — the hostel admin's own profile save and the nightly
 * sweep — so every hostel filed by the team desk or approved from the public
 * queue went live with `location.lat` unset and `nearbyPlaces` empty. Their
 * public pages show a dashed box reading "the exact location appears once the
 * hostel admin saves an address", which is the listing telling a visitor nobody
 * has finished setting this hostel up.
 *
 * New registrations no longer land in that state. This is for the ones that
 * already did. The nightly sweep would get to them eventually — five at a time,
 * and only if the cron is registered — which is not a repair, it is a wait.
 *
 * It applies the same `resolveHostelGeo` rule the app does, so a MANUAL pin an
 * owner placed themselves is never moved; only the nearby cache is filled in
 * around it. The write goes through the raw driver rather than the model,
 * because Node's ESM loader does not see `models` among mongoose's CommonJS
 * exports and every model file in `packages/db` imports it by name.
 *
 * Dry by default; pass --apply to write:
 *
 *   npm --prefix apps/web run backfill:hostel-map-pins
 *   npm --prefix apps/web run backfill:hostel-map-pins -- --apply
 *   npm --prefix apps/web run backfill:hostel-map-pins -- --apply --slug study-sanjal-hostel-narephat
 *
 * Paced at one hostel every two seconds: Nominatim's usage policy is one
 * request a second and the public Overpass endpoint throttles harder than that
 * (ARCHITECTURE.md §4.7). A backfill that ignores it gets the platform's User-
 * Agent banned, which breaks the picker for everybody.
 */
import nextEnv from "@next/env";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveHostelGeo } from "@/lib/maps/hostel-geo";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

nextEnv.loadEnvConfig(repoRoot);

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required to run the hostel map pin backfill.");
}

const apply = process.argv.includes("--apply");
const slugIndex = process.argv.indexOf("--slug");
const onlySlug = slugIndex === -1 ? null : process.argv[slugIndex + 1];
const log = (message) => console.log(`${apply ? "" : "[dry] "}${message}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await mongoose.connect(process.env.MONGODB_URI);

/*
 * A hostel needs this pass if it has no coordinates at all, or has them but has
 * never had its nearby list built. The second case is real: a hostel whose
 * owner pinned the map from the profile screen before the nearby cache existed
 * has a map and an empty "What's nearby".
 */
const db = mongoose.connection.db;
const hostels = await db
  .collection("hostels")
  .find(
    {
      isDeleted: false,
      status: { $in: ["APPROVED", "PUBLISHED"] },
      ...(onlySlug ? { slug: onlySlug } : {}),
      $or: [
        { "location.lat": { $exists: false } },
        { "location.lat": null },
        { nearbyPlacesLastUpdated: { $exists: false } },
      ],
    },
    { projection: { location: 1, name: 1, slug: 1 } },
  )
  .toArray();

log(`${hostels.length} hostel(s) without a usable map.`);

let placed = 0;
let failed = 0;

for (let index = 0; index < hostels.length; index += 1) {
  const hostel = hostels[index];
  const label = hostel.slug ?? hostel.name ?? String(hostel._id);

  if (!apply) {
    log(
      `  would place ${label} (${hostel.location?.area ?? "?"}, ` +
        `${hostel.location?.city ?? "?"})`,
    );
  } else {
    const result = await resolveHostelGeo(hostel.location).catch((error) => {
      console.error(`  ${label}: ${error instanceof Error ? error.message : error}`);

      return null;
    });

    if (result) {
      await db.collection("hostels").updateOne({ _id: hostel._id }, { $set: result.set });
      placed += 1;
      log(
        `  ${label}: ${result.source.toLowerCase()} pin, ${result.precision}, ` +
          `${result.nearbyCount} place(s) nearby`,
      );
    } else {
      failed += 1;
      // No coordinates and no address the geocoder recognises. Somebody has to
      // place this pin by hand — say which hostel, so somebody can.
      log(`  ${label}: could not be placed — needs a pin from the profile screen`);
    }
  }

  if (index < hostels.length - 1) {
    await sleep(2000);
  }
}

if (apply) {
  log(`Placed ${placed}, could not place ${failed}.`);
} else {
  log("Nothing written. Re-run with --apply.");
}

await mongoose.disconnect();
