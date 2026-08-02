/**
 * Migration to the counts-only accommodation model.
 *
 * Rooms and beds used to be individual documents. They are now just numbers on
 * `hostel.roomConfigurations`: rooms per type, beds per room, and how many of
 * those beds are free. Residents point at a room type instead of a room and a
 * bed; maintenance requests carry a free-text location.
 *
 * Steps (idempotent — safe to re-run):
 *   1. resident.roomType  <- the roomType of their old room, then drop
 *      roomId/bedId
 *   2. maintenance.location <- "Room <n>" from its old roomId, then drop
 *      roomId/bedId
 *   3. recount vacantBeds per room type from live residents, so the counts
 *      agree with who is actually living there
 *   4. hostel.capacitySummary <- derived from roomConfigurations
 *   5. drop the rooms and beds collections
 *
 * Pass --dry to preview without writing.
 */
import nextEnv from "@next/env";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

nextEnv.loadEnvConfig(repoRoot);

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required to run the room-count migration.");
}

const dryRun = process.argv.includes("--dry");
const log = (message) => console.log(`${dryRun ? "[dry] " : ""}${message}`);

await mongoose.connect(process.env.MONGODB_URI);

const db = mongoose.connection.db;
const names = new Set((await db.listCollections().toArray()).map((c) => c.name));

// Room documents are the only way to recover what type a resident's room was,
// so read them before anything drops.
const rooms = names.has("rooms") ? await db.collection("rooms").find({}).toArray() : [];
const roomById = new Map(rooms.map((room) => [room._id.toString(), room]));

// 1. Residents -> roomType.
const residents = await db
  .collection("residents")
  .find({ roomType: { $exists: false } })
  .toArray();

let residentsMigrated = 0;
let residentsUnresolved = 0;

for (const resident of residents) {
  const room = resident.roomId ? roomById.get(resident.roomId.toString()) : null;
  const roomType = room?.roomType;

  if (!roomType) {
    residentsUnresolved += 1;
    continue;
  }

  if (!dryRun) {
    await db
      .collection("residents")
      .updateOne(
        { _id: resident._id },
        { $set: { roomType }, $unset: { bedId: "", roomId: "" } },
      );
  }

  residentsMigrated += 1;
}

log(`Residents given a roomType: ${residentsMigrated}`);

if (residentsUnresolved > 0) {
  // Without a room record there is nothing to derive the type from. Left for a
  // human rather than guessed at — a wrong type would corrupt the counts.
  log(
    `WARNING: ${residentsUnresolved} resident(s) have no resolvable room; set their roomType by hand.`,
  );
}

// 2. Maintenance requests -> free-text location.
const requests = await db
  .collection("maintenancerequests")
  .find({ roomId: { $exists: true } })
  .toArray();

for (const request of requests) {
  const room = roomById.get(request.roomId.toString());
  const location = room?.roomNumber ? `Room ${room.roomNumber}` : "";

  if (!dryRun) {
    await db
      .collection("maintenancerequests")
      .updateOne(
        { _id: request._id },
        { $set: { location }, $unset: { bedId: "", roomId: "" } },
      );
  }
}

log(`Maintenance requests given a location: ${requests.length}`);

// 3 + 4. Recount vacancy from who is actually living there, then derive totals.
const hostels = await db
  .collection("hostels")
  .find({ isDeleted: { $ne: true } })
  .toArray();

for (const hostel of hostels) {
  let configurations = hostel.roomConfigurations ?? [];

  // Hostels created before registration collected room configurations (the
  // demo-seeded ones) only ever had Room documents. Derive their room types
  // from those before the collection is dropped, or they end up with nothing.
  if (configurations.length === 0) {
    const hostelRooms = rooms.filter(
      (room) =>
        room.hostelId?.toString() === hostel._id.toString() &&
        room.isDeleted !== true &&
        room.status !== "INACTIVE",
    );
    const byType = new Map();

    for (const room of hostelRooms) {
      const key = room.roomType || "Standard";
      const existing = byType.get(key) ?? { bedsPerRoom: 0, rooms: 0 };

      existing.rooms += 1;
      existing.bedsPerRoom = Math.max(existing.bedsPerRoom, room.capacity ?? 1);
      byType.set(key, existing);
    }

    configurations = [...byType].map(([roomType, counts]) => ({
      bedsPerRoom: counts.bedsPerRoom,
      mealInclusion: "Included",
      monthlyRent: 0,
      rooms: counts.rooms,
      roomType,
      vacantBeds: 0,
    }));

    if (configurations.length > 0) {
      log(`${hostel.name}: derived ${configurations.length} room type(s) from rooms`);
    }
  }

  if (configurations.length === 0) {
    continue;
  }

  const occupancy = await db
    .collection("residents")
    .aggregate([
      {
        $match: {
          hostelId: hostel._id,
          isDeleted: { $ne: true },
          status: { $in: ["PENDING", "ACTIVE", "SUSPENDED"] },
        },
      },
      { $group: { _id: "$roomType", total: { $sum: 1 } } },
    ])
    .toArray();
  const occupiedByType = new Map(occupancy.map((row) => [row._id, row.total]));

  const next = configurations.map((config) => {
    const totalBeds = (config.rooms ?? 0) * Math.max(1, config.bedsPerRoom ?? 1);
    const occupied = occupiedByType.get(config.roomType) ?? 0;
    // The owner's declared vacancy already accounts for residents who predate
    // the system, so start from it rather than from the full bed count —
    // otherwise a hostel that told us "25 of 90 free" would suddenly advertise
    // all 90. Only fall back to totalBeds when no figure was ever declared.
    const declared = config.vacantBeds ?? totalBeds;

    return {
      ...config,
      vacantBeds: Math.max(0, Math.min(declared, totalBeds) - occupied),
    };
  });
  const capacitySummary = next.reduce(
    (summary, config) => ({
      totalBeds:
        summary.totalBeds + (config.rooms ?? 0) * Math.max(1, config.bedsPerRoom ?? 1),
      totalRooms: summary.totalRooms + (config.rooms ?? 0),
      vacantBeds: summary.vacantBeds + config.vacantBeds,
    }),
    { totalBeds: 0, totalRooms: 0, vacantBeds: 0 },
  );

  if (!dryRun) {
    await db
      .collection("hostels")
      .updateOne(
        { _id: hostel._id },
        { $set: { capacitySummary, roomConfigurations: next } },
      );
  }

  log(
    `${hostel.name}: ${capacitySummary.totalRooms} rooms, ${capacitySummary.totalBeds} beds, ${capacitySummary.vacantBeds} vacant`,
  );
}

// 5. Retire the collections.
for (const collectionName of ["rooms", "beds"]) {
  if (names.has(collectionName) && !dryRun) {
    await db.collection(collectionName).drop();
    log(`Dropped the ${collectionName} collection.`);
  } else if (names.has(collectionName)) {
    log(`Would drop the ${collectionName} collection.`);
  }
}

await mongoose.disconnect();
log("Room-count migration complete.");
