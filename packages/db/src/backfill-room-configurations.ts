/**
 * One-shot data migration: copies per-room-type pricing from each hostel's
 * application snapshot onto the hostel record itself.
 *
 * Registrations before this change stored `roomConfigurations` only inside
 * HostelApplication.snapshot, so the public detail page had no real per-type
 * rents and interpolated them from pricing.monthlyRentMin/Max instead. This
 * lifts the submitted numbers onto Hostel.roomConfigurations so the page can
 * render what the owner actually entered.
 *
 * Usage: node --experimental-transform-types packages/db/src/backfill-room-configurations.ts
 * Requires MONGODB_URI in the environment (load the repo-root .env first).
 * Safe to run repeatedly — it only touches hostels with no roomConfigurations.
 * Pass --dry-run to print what would change without writing.
 */
// Driven through the raw driver rather than the Mongoose models: mongoose is
// CJS, so `node --experimental-transform-types` cannot resolve the named
// exports its model modules rely on. Every value written below is coerced by
// hand, which is what the model casting would have done anyway.
import mongoose from "mongoose";

const MEAL_INCLUSIONS = ["Included", "Not Included", "Optional"] as const;

type RoomConfiguration = {
  bedsPerRoom: number;
  mealInclusion: (typeof MEAL_INCLUSIONS)[number];
  monthlyRent: number;
  rooms: number;
  roomType: string;
  vacantBeds: number;
};

function toNumber(value: unknown) {
  const parsed = typeof value === "string" ? Number(value) : value;

  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function toMealInclusion(value: unknown): RoomConfiguration["mealInclusion"] {
  return MEAL_INCLUSIONS.includes(value as RoomConfiguration["mealInclusion"])
    ? (value as RoomConfiguration["mealInclusion"])
    : "Included";
}

/** Snapshots are Mixed, so every field is untrusted and has to be coerced. */
function normalizeConfigurations(raw: unknown): RoomConfiguration[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => {
      const config = entry as Record<string, unknown>;
      const roomType = typeof config?.roomType === "string" ? config.roomType.trim() : "";

      if (!roomType) {
        return null;
      }

      return {
        bedsPerRoom: toNumber(config.bedsPerRoom),
        mealInclusion: toMealInclusion(config.mealInclusion),
        monthlyRent: toNumber(config.monthlyRent),
        rooms: toNumber(config.rooms),
        roomType,
        vacantBeds: toNumber(config.vacantBeds),
      };
    })
    .filter((config): config is RoomConfiguration => config !== null);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const uri = process.env.MONGODB_URI ?? process.env.DATABASE_URL;

  if (!uri) {
    throw new Error("MONGODB_URI (or DATABASE_URL) is required to connect to MongoDB.");
  }

  await mongoose.connect(uri, { bufferCommands: false });

  const db = mongoose.connection.db;

  if (!db) {
    throw new Error("MongoDB connection did not expose a database handle.");
  }

  const hostelsCollection = db.collection("hostels");
  const applicationsCollection = db.collection("hostelapplications");

  const hostels = await hostelsCollection
    .find(
      {
        $or: [
          { roomConfigurations: { $exists: false } },
          { roomConfigurations: { $size: 0 } },
        ],
      },
      { projection: { _id: 1, name: 1, slug: 1 } },
    )
    .toArray();

  let migrated = 0;
  let skipped = 0;

  for (const hostel of hostels) {
    // The newest application that carries configurations wins — an owner who
    // resubmitted after a "needs more info" request has the current numbers
    // there, and status is irrelevant to which figures are most recent.
    const applications = await applicationsCollection
      .find({ hostelId: hostel._id }, { projection: { snapshot: 1 } })
      .sort({ createdAt: -1 })
      .toArray();

    const configurations = applications
      .map((application) =>
        normalizeConfigurations(application.snapshot?.roomConfigurations),
      )
      .find((configs) => configs.length > 0);

    if (!configurations) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(
        `[dry-run] ${hostel.slug}: ${configurations
          .map((config) => `${config.roomType}=${config.monthlyRent}`)
          .join(", ")}`,
      );
    } else {
      await hostelsCollection.updateOne(
        { _id: hostel._id },
        { $set: { roomConfigurations: configurations } },
      );
      console.log(`${hostel.slug}: backfilled ${configurations.length} room type(s)`);
    }

    migrated += 1;
  }

  console.log(
    `Room configuration backfill complete. ${migrated} hostel(s) ${
      dryRun ? "would be" : ""
    } updated, ${skipped} skipped (no snapshot data).`,
  );

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
