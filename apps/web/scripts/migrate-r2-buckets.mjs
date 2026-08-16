/**
 * Move this project's stored objects off the borrowed QuestionCall bucket and
 * into the company's own public/private pair.
 *
 * Three things change at once, and they have to change together:
 *
 *   1. **Account.** Every object lives in `question-call-storage`, on another
 *      project's Cloudflare account, under credentials this repo borrowed. The
 *      new account has its own token.
 *   2. **Bucket.** One bucket held public and private objects side by side. It
 *      had public access enabled so gallery photos could be served, which meant
 *      a payment proof was fetchable unsigned by anyone who had ever seen a
 *      presigned URL for it — the key is in the path, and stripping the
 *      signature left a link that never expired. Objects now go to
 *      `R2_BUCKET_PUBLIC` or `R2_BUCKET_PRIVATE` by their `accessLevel`, and the
 *      private bucket has no public base URL for that trick to fall back on.
 *   3. **Key.** The buckets are shared with the company's other projects, so
 *      every key gains the `R2_KEY_PREFIX` folder.
 *
 * **Copy, never move.** Nothing is deleted from the source. It is not our
 * bucket to prune, and a failed migration must leave the old copy readable.
 *
 * **Row and object move together.** `fileAssets.bucket` and `.key` are only
 * rewritten once the bytes are confirmed at the destination, so an interrupted
 * run leaves rows pointing at objects that still exist rather than at ones that
 * do not. Re-running resumes: a destination object that is already there is
 * counted and skipped rather than re-uploaded.
 *
 * **Old credentials** come from `OLD_R2_*` if set. Otherwise they are read from
 * the commented-out `# R2_*` lines left in `.env` when the new values replaced
 * them — which is where they are after a normal key swap, and why this script
 * can be run without pasting secrets back onto a command line.
 *
 *   npm --prefix apps/web run migrate:r2-buckets -- --dry-run
 *   npm --prefix apps/web run migrate:r2-buckets
 *
 * Use that form, not a root alias — the extra npm layer swallows the flag, and
 * a silently-not-dry run is a real write.
 */
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import nextEnv from "@next/env";
import mongoose from "mongoose";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

nextEnv.loadEnvConfig(repoRoot);

const dryRun = process.argv.includes("--dry-run") || process.argv.includes("--dry");

/**
 * Reads a variable from the commented-out block in `.env`.
 *
 * Deliberately narrow: only `# NAME=value` with nothing but whitespace before
 * the `#`, so a sentence in a comment that happens to mention a variable name
 * cannot be mistaken for a credential.
 */
function commentedEnv(name) {
  try {
    const raw = readFileSync(path.join(repoRoot, ".env"), "utf8");
    const match = raw.match(new RegExp(`^\\s*#\\s*${name}\\s*=\\s*(.*)$`, "m"));

    return match ? match[1].trim().replace(/^["']|["']$/g, "") : undefined;
  } catch {
    return undefined;
  }
}

function oldSetting(name) {
  return process.env[`OLD_${name}`] ?? commentedEnv(name);
}

const source = {
  accessKeyId: oldSetting("R2_ACCESS_KEY_ID"),
  bucket: oldSetting("R2_BUCKET_NAME"),
  endpoint: oldSetting("R2_ENDPOINT"),
  secretAccessKey: oldSetting("R2_SECRET_ACCESS_KEY"),
};

const target = {
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  endpoint: process.env.R2_ENDPOINT,
  prefix: (process.env.R2_KEY_PREFIX ?? "").replace(/^\/+|\/+$/g, ""),
  privateBucket: process.env.R2_BUCKET_PRIVATE,
  publicBase: process.env.R2_PUBLIC_URL,
  publicBucket: process.env.R2_BUCKET_PUBLIC,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
};

for (const [label, value] of [
  ["MONGODB_URI", process.env.MONGODB_URI],
  ["old R2_ENDPOINT", source.endpoint],
  ["old R2_ACCESS_KEY_ID", source.accessKeyId],
  ["old R2_SECRET_ACCESS_KEY", source.secretAccessKey],
  ["old R2_BUCKET_NAME", source.bucket],
  ["R2_BUCKET_PUBLIC", target.publicBucket],
  ["R2_BUCKET_PRIVATE", target.privateBucket],
]) {
  if (!value) {
    throw new Error(
      `${label} is required to migrate R2 buckets. Old values are read from OLD_* or the commented "# R2_*" lines in .env.`,
    );
  }
}

function clientFor({ accessKeyId, endpoint, secretAccessKey }) {
  return new S3Client({
    credentials: { accessKeyId, secretAccessKey },
    endpoint,
    maxAttempts: 3,
    region: "auto",
    requestHandler: { requestTimeout: 60_000 },
  });
}

const sourceClient = clientFor(source);
const targetClient = clientFor(target);

function targetKey(key) {
  const bare = String(key).replace(/^\/+/, "");

  if (!target.prefix || bare === target.prefix || bare.startsWith(`${target.prefix}/`)) {
    return bare;
  }

  return `${target.prefix}/${bare}`;
}

function bucketFor(accessLevel) {
  return accessLevel === "PUBLIC" ? target.publicBucket : target.privateBucket;
}

async function existsAtTarget(bucket, key) {
  try {
    await targetClient.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") {
      return false;
    }

    throw error;
  }
}

/**
 * Existence check that does **not** open the body.
 *
 * A dry run only needs to know whether the object is there. Issuing a
 * `GetObject` for that leaves a response stream nobody reads, and the socket
 * stays open until the request timeout fires — which turned a preview of 103
 * rows into a sixty-second stall per row.
 */
async function existsAtSource(key) {
  try {
    await sourceClient.send(new HeadObjectCommand({ Bucket: source.bucket, Key: key }));
    return true;
  } catch (error) {
    if (
      error?.$metadata?.httpStatusCode === 404 ||
      error?.name === "NoSuchKey" ||
      error?.name === "NotFound"
    ) {
      return false;
    }

    throw error;
  }
}

async function readSource(key) {
  try {
    return await sourceClient.send(
      new GetObjectCommand({ Bucket: source.bucket, Key: key }),
    );
  } catch (error) {
    if (
      error?.$metadata?.httpStatusCode === 404 ||
      error?.name === "NoSuchKey" ||
      error?.name === "NotFound"
    ) {
      return null;
    }

    throw error;
  }
}

/** Returns "copied" | "already-there" | "missing-in-source". */
async function copyObject(key, bucket, fallbackMimeType) {
  const destination = targetKey(key);

  if (await existsAtTarget(bucket, destination)) {
    return "already-there";
  }

  if (dryRun) {
    return (await existsAtSource(key)) ? "copied" : "missing-in-source";
  }

  const object = await readSource(key);

  if (!object) {
    return "missing-in-source";
  }

  const body = Buffer.from(await object.Body.transformToByteArray());

  await targetClient.send(
    new PutObjectCommand({
      Body: body,
      Bucket: bucket,
      ContentType: object.ContentType ?? fallbackMimeType ?? "application/octet-stream",
      Key: destination,
    }),
  );

  // Read back rather than trusting the write: this is the only moment both
  // copies exist and can be compared, and the row is about to stop pointing at
  // the original. A short object that silently truncated would otherwise be
  // discovered by a resident whose payment proof no longer opens.
  const written = await targetClient.send(
    new HeadObjectCommand({ Bucket: bucket, Key: destination }),
  );

  if (Number(written.ContentLength) !== body.length) {
    throw new Error(
      `Size mismatch for ${destination}: wrote ${body.length}, storage reports ${written.ContentLength}`,
    );
  }

  return "copied";
}

await mongoose.connect(process.env.MONGODB_URI);

const assets = mongoose.connection.db.collection("fileassets");
const rows = await assets.find({ bucket: source.bucket }).toArray();

console.log(
  `${dryRun ? "[dry-run] " : ""}${rows.length} asset row(s) in "${source.bucket}"`,
);
console.log(
  `  -> public  : ${target.publicBucket}/${target.prefix}/…\n  -> private : ${target.privateBucket}/${target.prefix}/…`,
);

const tally = {
  alreadyThere: 0,
  copied: 0,
  failed: 0,
  missingInSource: 0,
  rowsUpdated: 0,
  variantsCopied: 0,
};
const missing = [];
const failures = [];

let processed = 0;

for (const row of rows) {
  const bucket = bucketFor(row.accessLevel);
  processed += 1;

  // Progress goes to stderr so a run that is piped somewhere still shows it,
  // and so the summary on stdout stays machine-readable.
  process.stderr.write(`  [${processed}/${rows.length}] ${row.accessLevel} ${row.key}
`);

  try {
    const primary = await copyObject(row.key, bucket, row.mimeType);

    if (primary === "missing-in-source") {
      tally.missingInSource += 1;
      missing.push({ completed: Boolean(row.uploadCompletedAt), key: row.key });
      continue;
    }

    if (primary === "copied") {
      tally.copied += 1;
    } else {
      tally.alreadyThere += 1;
    }

    const variants = Array.isArray(row.variants) ? row.variants : [];
    const nextVariants = [];

    for (const variant of variants) {
      const outcome = await copyObject(variant.key, bucket, variant.mimeType);

      if (outcome === "copied") {
        tally.variantsCopied += 1;
      }

      // A variant that never made it to storage is dropped from the row rather
      // than carried forward pointing at a bucket we can no longer read. The
      // original is intact, so the asset still renders — just without that size.
      if (outcome !== "missing-in-source") {
        nextVariants.push({ ...variant, key: targetKey(variant.key) });
      }
    }

    const update = {
      bucket,
      key: targetKey(row.key),
      variants: nextVariants,
    };

    if (row.accessLevel === "PUBLIC" && row.publicUrl && target.publicBase) {
      update.publicUrl = `${target.publicBase.replace(/\/+$/, "")}/${targetKey(row.key)}`;
    }

    if (!dryRun) {
      await assets.updateOne({ _id: row._id }, { $set: update });
    }

    tally.rowsUpdated += 1;
  } catch (error) {
    tally.failed += 1;
    failures.push({ error: error.message, id: String(row._id), key: row.key });
  }
}

console.log("\n--- result ---");
console.log(`objects copied        : ${tally.copied}`);
console.log(`variants copied       : ${tally.variantsCopied}`);
console.log(`already at destination: ${tally.alreadyThere}`);
console.log(`missing in source     : ${tally.missingInSource}`);
console.log(`rows repointed        : ${tally.rowsUpdated}`);
console.log(`failed                : ${tally.failed}`);

if (missing.length > 0) {
  const reservations = missing.filter((entry) => !entry.completed).length;
  console.log(
    `\n${missing.length} object(s) had no bytes in the source bucket; ${reservations} of those are presigns that were never completed, which is the expected shape. Their rows are left pointing at the old bucket rather than at a location with nothing in it.`,
  );
}

if (failures.length > 0) {
  console.log("\nfailures:");
  for (const failure of failures.slice(0, 20)) {
    console.log(`  ${failure.id} ${failure.key}: ${failure.error}`);
  }
}

await mongoose.disconnect();

if (tally.failed > 0) {
  process.exitCode = 1;
}
