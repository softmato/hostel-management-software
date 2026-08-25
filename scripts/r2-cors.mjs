#!/usr/bin/env node
/**
 * Reads — and, with `--apply`, writes — the CORS configuration of the two R2
 * buckets.
 *
 * A presigned upload is a request the browser sends *directly* to R2, so R2 is
 * the origin that has to answer the preflight. Nothing in this repo can make
 * that happen: with no CORS rules on the bucket the PUT is blocked before it
 * leaves the page, which is what "No 'Access-Control-Allow-Origin' header is
 * present" means. The rule below is the missing half.
 *
 * The buckets are shared with the company's other projects, so this never
 * blindly overwrites: existing rules are preserved and only the rule carrying
 * our own ID is replaced.
 *
 *   node scripts/r2-cors.mjs            # show current config, change nothing
 *   node scripts/r2-cors.mjs --apply    # merge our rule in
 *
 * Origins come from R2_CORS_ORIGINS (comma-separated) when set, otherwise from
 * APP_URL plus localhost.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  S3Client,
  GetBucketCorsCommand,
  PutBucketCorsCommand,
} from "@aws-sdk/client-s3";

const RULE_ID = "hostelhub-web-uploads";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadRootEnv() {
  let raw;
  try {
    raw = readFileSync(resolve(root, ".env"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

function origins() {
  const configured = process.env.R2_CORS_ORIGINS;
  const list = configured
    ? configured.split(",")
    : [process.env.APP_URL ?? "", "http://localhost:3000"];

  return [...new Set(list.map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean))];
}

function rule() {
  return {
    ID: RULE_ID,
    AllowedOrigins: origins(),
    // PUT for the presigned upload, GET/HEAD so a presigned read can be fetched
    // by script (an <img> tag needs no CORS, but XHR/fetch does).
    AllowedMethods: ["GET", "HEAD", "PUT"],
    AllowedHeaders: ["*"],
    // The uploader reads the ETag back to confirm what R2 stored.
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3600,
  };
}

async function currentRules(client, bucket) {
  try {
    const result = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
    return result.CORSRules ?? [];
  } catch (error) {
    if (error?.name === "NoSuchCORSConfiguration") return [];
    throw error;
  }
}

async function main() {
  loadRootEnv();

  const apply = process.argv.includes("--apply");
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const buckets = [process.env.R2_BUCKET_PUBLIC, process.env.R2_BUCKET_PRIVATE];

  if (!endpoint || !accessKeyId || !secretAccessKey || buckets.some((b) => !b)) {
    throw new Error(
      "R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_PUBLIC and R2_BUCKET_PRIVATE must be set",
    );
  }

  const client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  console.log(`Origins: ${origins().join(", ")}\n`);

  for (const bucket of buckets) {
    const existing = await currentRules(client, bucket);
    console.log(`── ${bucket}`);
    console.log(`   current: ${existing.length ? JSON.stringify(existing) : "(none)"}`);

    if (!apply) {
      console.log("   would set: " + JSON.stringify([...existing.filter((r) => r.ID !== RULE_ID), rule()]));
      continue;
    }

    const merged = [...existing.filter((r) => r.ID !== RULE_ID), rule()];
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: { CORSRules: merged },
      }),
    );
    console.log(`   applied: ${JSON.stringify(await currentRules(client, bucket))}`);
  }

  if (!apply) console.log("\nDry run. Re-run with --apply to write these rules.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
