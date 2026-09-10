import nextEnv from "@next/env";
import mongoose from "mongoose";
nextEnv.loadEnvConfig(process.cwd() + "/../..");
await mongoose.connect(process.env.MONGODB_URI);
const h = await mongoose.connection.db.collection("hostels").findOne(
  { slug: "study-sanjal-hostel-narephat" },
  { projection: { slug: 1, location: 1, nearbyPlacesLastUpdated: 1, nearbyPlaces: 1 } },
);
console.log(JSON.stringify({ slug: h.slug, location: h.location, nearbyCount: (h.nearbyPlaces||[]).length, updated: h.nearbyPlacesLastUpdated }, null, 2));
await mongoose.disconnect();
