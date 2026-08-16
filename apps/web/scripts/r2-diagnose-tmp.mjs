import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import mongoose from "mongoose";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."));

await mongoose.connect(process.env.MONGODB_URI);
const col = mongoose.connection.db.collection("fileassets");
const base = process.env.R2_PUBLIC_URL.replace(/\/+$/, "");

const ids = [
  "6a681104ec06f6c562c2cf10",
  "6a681107ec06f6c562c2cf13",
  "6a681116ec06f6c562c2cf19",
  "6a681133ec06f6c562c2cf24",
];

for (const id of ids) {
  const row = await col.findOne({ _id: new mongoose.Types.ObjectId(id) });

  if (!row) {
    console.log(`${id}: ROW NOT FOUND`);
    continue;
  }

  console.log(`\n${id}`);
  console.log(`  accessLevel : ${row.accessLevel}`);
  console.log(`  bucket      : ${row.bucket}`);
  console.log(`  key         : ${row.key}`);
  console.log(`  publicUrl   : ${row.publicUrl ?? "(none)"}`);
  console.log(`  variants    : ${(row.variants ?? []).map((v) => `${v.variant}=${v.key}`).join(", ") || "(none)"}`);

  const url = `${base}/${row.key}`;
  const res = await fetch(url, { method: "GET" });
  console.log(`  GET ${url}`);
  console.log(`  -> HTTP ${res.status} ${res.headers.get("content-type") ?? ""}`);

  for (const v of row.variants ?? []) {
    const vres = await fetch(`${base}/${v.key}`, { method: "GET" });
    console.log(`  variant ${v.variant} -> HTTP ${vres.status}  ${v.key}`);
  }
}

await mongoose.disconnect();
