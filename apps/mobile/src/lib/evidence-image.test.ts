import { describe, expect, it } from "vitest";

import { EVIDENCE_MAX_EDGE, prepareEvidenceForUpload } from "@/lib/evidence-image";

/**
 * The decisions that must hold with or without the native module.
 *
 * `expo-image-manipulator` cannot load under node, so every case here runs the
 * path a binary built before it was added takes — which is exactly the path that
 * must never lose a resident their file. What is asserted is therefore the whole
 * safety contract: the original comes back untouched unless resizing both
 * applies and succeeds.
 */
describe("prepareEvidenceForUpload", () => {
  it("leaves a PDF alone — its text layer is the best evidence we accept", async () => {
    const picked = {
      fileName: "receipt.pdf",
      mimeType: "application/pdf",
      uri: "file:///tmp/receipt.pdf",
    };

    await expect(prepareEvidenceForUpload(picked)).resolves.toEqual(picked);
  });

  it("leaves a screenshot already under the limit alone", async () => {
    // The size the web form actually receives — resizing it could only invent
    // detail and cost bytes.
    const picked = {
      fileName: "shot.png",
      height: 620,
      mimeType: "image/png",
      uri: "file:///tmp/shot.png",
      width: 460,
    };

    await expect(prepareEvidenceForUpload(picked)).resolves.toEqual(picked);
  });

  it("keeps an image exactly on the limit", async () => {
    const picked = {
      height: EVIDENCE_MAX_EDGE,
      mimeType: "image/jpeg",
      uri: "file:///tmp/edge.jpg",
      width: EVIDENCE_MAX_EDGE,
    };

    await expect(prepareEvidenceForUpload(picked)).resolves.toEqual(picked);
  });

  it("returns the original when the manipulator is unavailable", async () => {
    // The camera frame that started all this: 3456 × 4608, far over the limit.
    // An older binary still uploads it rather than failing the attach.
    const picked = {
      fileName: "IMG_0001.jpg",
      height: 4608,
      mimeType: "image/jpeg",
      uri: "file:///tmp/IMG_0001.jpg",
      width: 3456,
    };

    await expect(prepareEvidenceForUpload(picked)).resolves.toEqual(picked);
  });

  it("does not touch a file it cannot identify as a raster image", async () => {
    const picked = { mimeType: undefined, uri: "content://media/document/4821" };

    await expect(prepareEvidenceForUpload(picked)).resolves.toEqual(picked);
  });

  it("recognises an image by extension when the picker reports no type", async () => {
    // Identified as resizable, over the limit, and still returned intact because
    // the manipulator is absent — the fallback, reached through the other branch.
    const picked = {
      height: 3000,
      mimeType: undefined,
      uri: "file:///tmp/receipt.JPEG?v=2",
      width: 4000,
    };

    await expect(prepareEvidenceForUpload(picked)).resolves.toEqual(picked);
  });
});
