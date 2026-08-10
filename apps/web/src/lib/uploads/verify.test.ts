/**
 * Upload verification — Block 0 item 0.3 of docs/FINANCE_IMPLEMENTATION_PLAN.md
 * (target §13.3, current §7.10).
 *
 * `mimeType` and `sizeBytes` reach the database as client assertions made before
 * any bytes exist. These tests pin the rule that the stored object is the
 * authority: a declaration that disagrees with what is actually in storage
 * invalidates the upload rather than being quietly corrected.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@/lib/r2", () => ({ getR2Client: () => ({ send: mocks.send }) }));

const { hashBytes, UploadVerificationError, verifyUploadedObject } =
  await import("@/lib/uploads/verify");

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The AWS client is command-dispatched, so the mock answers on the command's
 * class name — HEAD returns metadata, GET returns the body.
 */
function respondWith(head: { ContentLength?: number; ContentType?: string } | null) {
  mocks.send.mockImplementation(async (command: object) => {
    if (command.constructor.name === "HeadObjectCommand") {
      if (!head) {
        throw new Error("NotFound");
      }

      return head;
    }

    return { Body: { transformToByteArray: async () => PNG_BYTES } };
  });
}

const declared = {
  bucket: "uploads",
  declaredMimeType: "image/png",
  declaredSizeBytes: PNG_BYTES.length,
  key: "uploads/proof.png",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("verifyUploadedObject", () => {
  it("returns the stored type, size and content hash when they agree", async () => {
    respondWith({ ContentLength: PNG_BYTES.length, ContentType: "image/png" });

    // `bytes` came back with item 3.4: the caller derives a second, perceptual
    // fingerprint from them, and re-reading the object to do so would double the
    // storage round-trips on every upload.
    await expect(verifyUploadedObject(declared)).resolves.toEqual({
      bytes: Buffer.from(PNG_BYTES),
      contentHash: hashBytes(PNG_BYTES),
      mimeType: "image/png",
      sizeBytes: PNG_BYTES.length,
    });
  });

  it("ignores charset parameters on the stored content type", async () => {
    respondWith({
      ContentLength: PNG_BYTES.length,
      ContentType: "image/png; charset=binary",
    });

    await expect(verifyUploadedObject(declared)).resolves.toMatchObject({
      mimeType: "image/png",
    });
  });

  // The attack of current §7.10: declare an image, PUT an archive.
  it("rejects an object whose real type differs from the declared one", async () => {
    respondWith({ ContentLength: PNG_BYTES.length, ContentType: "application/zip" });

    await expect(verifyUploadedObject(declared)).rejects.toMatchObject({
      errorCode: "UPLOAD_TYPE_MISMATCH",
      status: 422,
    });
  });

  it("rejects an object whose real size differs from the declared one", async () => {
    respondWith({ ContentLength: 999_999, ContentType: "image/png" });

    await expect(verifyUploadedObject(declared)).rejects.toMatchObject({
      errorCode: "UPLOAD_SIZE_MISMATCH",
    });
  });

  it("rejects an object that is not in storage at all", async () => {
    respondWith(null);

    await expect(verifyUploadedObject(declared)).rejects.toBeInstanceOf(
      UploadVerificationError,
    );
    await expect(verifyUploadedObject(declared)).rejects.toMatchObject({
      errorCode: "UPLOAD_NOT_FOUND",
    });
  });

  // Re-running the platform policy against the *stored* values, not the
  // declared ones, is what makes a limit tightened after presign still bind.
  it("rejects a stored type the platform does not accept", async () => {
    respondWith({ ContentLength: PNG_BYTES.length, ContentType: "application/zip" });

    await expect(
      verifyUploadedObject({ ...declared, declaredMimeType: "application/zip" }),
    ).rejects.toMatchObject({ errorCode: "FILE_TYPE_NOT_ALLOWED" });
  });
});
