/**
 * Move registration documents out of the public bucket.
 *
 * Until 2026-09-15, `POST /public/files/upload` wrote every registration
 * document to the public bucket, owners' citizenship scans included, and the
 * application stored the resulting permanent, unsigned URL. For each such
 * document this script:
 *
 * 1. copies the object into the private bucket under `registration-documents/`;
 * 2. points a PRIVATE `REGISTRATION_DOCUMENT` FileAsset at the copy, owned by
 *    the document's owner, reusing the row the upload created when one exists;
 * 3. sets `fileAssetId` and removes `fileUrl` on `hosteldocuments`,
 *    `serviceproviderdocuments` and `hostelapplications.snapshot.documents[]`.
 *
 * ## Where the bytes are read from
 *
 * A URL on the public bucket's own hosts (`--from`, the old r2.dev origin, and
 * the current `R2_PUBLIC_URL`) names its key directly. Older rows still carry
 * the address of the bucket the project borrowed before 2026-08-16. Those files
 * were copied into the public bucket under the project prefix and their
 * FileAsset rows record where, so a row whose key ends in the same file name is
 * the source. Every source is checked to exist before anything is written, in a
 * dry run too. A URL with no source is reported and left alone.
 *
 * ## What it never does
 *
 * It never deletes a public copy. That would permanently delete data, so every
 * address that still serves the file is listed at the end for a person to
 * remove. Until then those URLs keep working for anyone who holds one.
 *
 * A row that already has `fileAssetId` and no `fileUrl` is not touched, and a
 * URL that appears twice (the document row and its application snapshot) is
 * copied once. Dry by default:
 *
 *   npm --prefix apps/web run migrate:registration-documents -- --from=https://pub-<id>.r2.dev
 *   npm --prefix apps/web run migrate:registration-documents -- --from=https://pub-<id>.r2.dev --apply
 */
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import nextEnv from "@next/env";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

nextEnv.loadEnvConfig(repoRoot);

for (const name of [
  "MONGODB_URI",
  "R2_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_PUBLIC",
  "R2_BUCKET_PRIVATE",
]) {
  if (!process.env[name]) {
    throw new Error(`${name} is required to run the registration document migration.`);
  }
}

const apply = process.argv.includes("--apply");
const log = (message) => console.log(`${apply ? "" : "[dry] "}${message}`);

const trimOrigin = (value) => (value ?? "").trim().replace(/\/+$/, "");
const origins = [
  trimOrigin(process.argv.find((arg) => arg.startsWith("--from="))?.slice("--from=".length)),
  trimOrigin(process.env.R2_PUBLIC_URL),
].filter(Boolean);

const publicBucket = process.env.R2_BUCKET_PUBLIC;
const privateBucket = process.env.R2_BUCKET_PRIVATE;
const keyPrefix = (process.env.R2_KEY_PREFIX ?? "").replace(/^\/+|\/+$/g, "");

const s3 = new S3Client({
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  endpoint: process.env.R2_ENDPOINT,
  maxAttempts: 3,
  region: "auto",
});

await mongoose.connect(process.env.MONGODB_URI);

const db = mongoose.connection.db;
const fileAssets = db.collection("fileassets");

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where the bytes behind a stored URL can be read in the public bucket, or null. */
async function sourceOf(url) {
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) {
    return null;
  }

  const bareUrl = url.split(/[?#]/)[0];
  const origin = origins.find((candidate) => bareUrl.startsWith(`${candidate}/`));

  if (origin) {
    const key = decodeURIComponent(bareUrl.slice(origin.length + 1));
    return { asset: await fileAssets.findOne({ bucket: publicBucket, key }), key };
  }

  const fileName = decodeURIComponent(bareUrl.split("/").pop() ?? "");

  if (!fileName) {
    return null;
  }

  const asset = await fileAssets.findOne({
    bucket: publicBucket,
    key: new RegExp(`(^|/)${escapeRegex(fileName)}$`),
  });

  return asset ? { asset, key: asset.key } : null;
}

function privateKeyFor(publicKey) {
  const extension = publicKey.split(".").pop()?.toLowerCase() || "bin";
  const bare = `registration-documents/${randomUUID()}.${extension}`;

  return keyPrefix ? `${keyPrefix}/${bare}` : bare;
}

log(`database: ${db.databaseName}`);
log(`public bucket hosts: ${origins.join(", ") || "(none — pass --from)"}`);
console.log("");

/** Stored URL → the FileAsset now holding its bytes, so a URL is copied once. */
const moved = new Map();
const leftAlone = [];

async function moveUrl(url, ownerId, label) {
  if (moved.has(url)) {
    return moved.get(url).assetId;
  }

  const source = await sourceOf(url);

  if (!source) {
    leftAlone.push(`${label}: ${url}`);
    return null;
  }

  try {
    await s3.send(new HeadObjectCommand({ Bucket: publicBucket, Key: source.key }));
  } catch {
    leftAlone.push(`${label}: ${publicBucket}/${source.key} is not in the bucket`);
    return null;
  }

  const existing = source.asset;
  const assetId = existing?._id ?? new mongoose.Types.ObjectId();
  const privateKey = privateKeyFor(source.key);

  log(`  ${label}: ${publicBucket}/${source.key} -> ${privateBucket}/${privateKey}`);

  if (apply) {
    const object = await s3.send(new GetObjectCommand({ Bucket: publicBucket, Key: source.key }));
    const body = Buffer.from(await object.Body.transformToByteArray());
    const mimeType = object.ContentType || existing?.mimeType || "application/octet-stream";

    await s3.send(
      new PutObjectCommand({
        Body: body,
        Bucket: privateBucket,
        ContentType: mimeType,
        Key: privateKey,
      }),
    );
    // Refuse to repoint any row at a copy that is not actually there.
    await s3.send(new HeadObjectCommand({ Bucket: privateBucket, Key: privateKey }));

    const now = new Date();
    const fields = {
      accessLevel: "PRIVATE",
      bucket: privateBucket,
      isDeleted: false,
      key: privateKey,
      kind: "REGISTRATION_DOCUMENT",
      ownerId,
      status: "ACTIVE",
      updatedAt: now,
    };

    if (existing) {
      await fileAssets.updateOne(
        { _id: existing._id },
        {
          $set: {
            ...fields,
            // Without it the abandoned-upload sweep would soft-delete the row.
            ...(existing.uploadCompletedAt ? {} : { uploadCompletedAt: now }),
          },
          $unset: { deletedAt: "", publicUrl: "" },
        },
      );
    } else {
      await fileAssets.insertOne({
        _id: assetId,
        ...fields,
        createdAt: now,
        fileName: source.key.split("/").pop(),
        mimeType,
        sizeBytes: body.length,
        storageProvider: "CLOUDFLARE_R2",
        uploadCompletedAt: now,
        variants: [],
      });
    }
  }

  moved.set(url, { assetId, publicKey: source.key, url });
  return assetId;
}

const hostelDocuments = await db
  .collection("hosteldocuments")
  .find({ fileUrl: { $nin: [null, ""], $type: "string" } })
  .toArray();

for (const document of hostelDocuments) {
  const assetId = await moveUrl(
    document.fileUrl,
    document.ownerId,
    `hostel document ${document._id} (${document.documentType})`,
  );

  if (assetId && apply) {
    await db
      .collection("hosteldocuments")
      .updateOne({ _id: document._id }, { $set: { fileAssetId: assetId }, $unset: { fileUrl: "" } });
  }
}

const providerDocuments = await db
  .collection("serviceproviderdocuments")
  .find({ fileUrl: { $nin: [null, ""], $type: "string" } })
  .toArray();

for (const document of providerDocuments) {
  const provider = await db
    .collection("serviceproviders")
    .findOne({ _id: document.providerId }, { projection: { userId: 1 } });

  if (!provider?.userId) {
    leftAlone.push(`provider document ${document._id}: the provider has no account to own it`);
    continue;
  }

  const assetId = await moveUrl(
    document.fileUrl,
    provider.userId,
    `provider document ${document._id} (${document.documentType})`,
  );

  if (assetId && apply) {
    await db
      .collection("serviceproviderdocuments")
      .updateOne({ _id: document._id }, { $set: { fileAssetId: assetId }, $unset: { fileUrl: "" } });
  }
}

const applications = await db
  .collection("hostelapplications")
  .find({ "snapshot.documents.fileUrl": { $type: "string" } })
  .toArray();

for (const application of applications) {
  let changed = false;
  const next = [];

  for (const [index, document] of (application.snapshot?.documents ?? []).entries()) {
    const assetId = document.fileUrl
      ? await moveUrl(
          document.fileUrl,
          application.applicantId,
          `application ${application._id} document ${index} (${document.documentType})`,
        )
      : null;

    if (!assetId) {
      next.push(document);
      continue;
    }

    const { fileUrl: _fileUrl, ...rest } = document;
    next.push({ ...rest, fileAssetId: assetId });
    changed = true;
  }

  if (changed && apply) {
    await db
      .collection("hostelapplications")
      .updateOne({ _id: application._id }, { $set: { "snapshot.documents": next } });
  }
}

console.log("");
log(`files moved to the private bucket: ${moved.size}`);

if (leftAlone.length > 0) {
  log("left alone:");
  for (const line of leftAlone) {
    log(`  ${line}`);
  }
}

if (moved.size > 0) {
  console.log("");

  if (apply) {
    console.log("These addresses still serve the files publicly. Delete them once the documents open from private storage:");
    for (const { publicKey, url } of moved.values()) {
      console.log(`  ${publicBucket}/${publicKey}`);

      if (!origins.some((origin) => url.startsWith(`${origin}/`))) {
        console.log(`    and the copy in the borrowed bucket: ${url}`);
      }
    }
  } else {
    console.log("Nothing was written. Re-run with --apply to move them.");
  }
}

await mongoose.disconnect();
