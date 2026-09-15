import { createHmac, timingSafeEqual } from "node:crypto";

import { Types } from "mongoose";

import { FileAssetModel } from "@hostel/db/models/FileAsset";

/**
 * Registration documents: the citizenship scans, licences and PAN certificates
 * a hostel owner or a tradesperson attaches before anyone has reviewed them.
 *
 * ## Private, and still readable by the reviewer
 *
 * They used to go to the public bucket. The reasoning was that a platform
 * reviewer has no relationship to the applicant, so the file could not be
 * authorised against them. But `files/{assetId}/url` has always let platform
 * roles read any asset, so that reasoning did not hold. What it produced was an
 * owner's citizenship card at a permanent, unsigned URL that anyone holding the
 * link could open. Now the bytes live in the private bucket and are read
 * through the signed route: by the owner, by the platform, and by nobody else.
 *
 * ## Why an upload carries a claim token
 *
 * The upload happens before the application exists, often before the account
 * does, so the `FileAsset` is written with no owner. Submitting the application
 * attaches it, and attaching it grants read access, because the read route
 * authorises on `ownerId`. ObjectIds are close to sequential (a timestamp, a
 * per-process value and a counter). Accepting a bare id would let an applicant
 * name a file uploaded moments before theirs and become its owner. The token is
 * an HMAC of the id, and only the upload response ever contains it.
 *
 * ## Why a claimed document gets no `hostelId`
 *
 * `files/{assetId}/url` also opens an asset to everyone scoped to its hostel:
 * wardens, cooks, residents. An owner's citizenship card is not theirs to read.
 */

const CLAIM_CONTEXT = "registration-document";

function claimSecret() {
  const secret = process.env.JWT_ACCESS_SECRET;

  if (!secret) {
    throw new Error("JWT_ACCESS_SECRET must be set to sign registration document claims.");
  }

  return secret;
}

export function issueDocumentClaimToken(assetId: string) {
  return createHmac("sha256", claimSecret())
    .update(`${CLAIM_CONTEXT}:${assetId}`)
    .digest("base64url");
}

export function isValidDocumentClaimToken(assetId: string, token: string) {
  const given = Buffer.from(token);
  const want = Buffer.from(issueDocumentClaimToken(assetId));

  // `timingSafeEqual` throws on a length mismatch, which is already a reject.
  return given.length === want.length && timingSafeEqual(given, want);
}

export class RegistrationDocumentError extends Error {
  constructor(
    message: string,
    public errorCode = "REGISTRATION_DOCUMENT_INVALID",
    public status = 422,
  ) {
    super(message);
  }
}

type SubmittedDocument = {
  claimToken: string;
  documentType: string;
  fileAssetId: string;
};

/**
 * Attaches each uploaded document to `ownerId` and returns what may be stored.
 *
 * Call it before the application is written, so a rejected document never
 * leaves a half-created hostel or provider behind. Safe to repeat for the same
 * owner: a retried submission re-claims the files it already holds.
 */
export async function claimRegistrationDocuments(
  documents: SubmittedDocument[],
  ownerId: Types.ObjectId | string,
) {
  const owner = new Types.ObjectId(String(ownerId));
  const claimed: Array<{ documentType: string; fileAssetId: Types.ObjectId }> = [];

  for (const document of documents) {
    if (!isValidDocumentClaimToken(document.fileAssetId, document.claimToken)) {
      throw new RegistrationDocumentError(
        `"${document.documentType}" could not be verified. Upload it again.`,
      );
    }

    const asset = await FileAssetModel.findOneAndUpdate(
      {
        _id: document.fileAssetId,
        $or: [{ ownerId: { $exists: false } }, { ownerId: null }, { ownerId: owner }],
        accessLevel: "PRIVATE",
        isDeleted: false,
        kind: "REGISTRATION_DOCUMENT",
        status: "ACTIVE",
      },
      { $set: { ownerId: owner, updatedBy: owner } },
      { new: true },
    )
      .select("_id")
      .lean<{ _id: Types.ObjectId } | null>();

    if (!asset) {
      throw new RegistrationDocumentError(
        `"${document.documentType}" is no longer available. Upload it again.`,
      );
    }

    claimed.push({ documentType: document.documentType, fileAssetId: asset._id });
  }

  return claimed;
}
