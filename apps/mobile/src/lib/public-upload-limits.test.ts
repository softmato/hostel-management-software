import { describe, expect, it } from "vitest";

import {
  formatMegabytes,
  PUBLIC_UPLOAD_MAX_BYTES,
  publicUploadError,
} from "@/lib/public-upload-limits";

/**
 * These mirror `ALLOWED_TYPES` and `MAX_SIZE` in
 * `apps/web/src/app/api/v1/public/files/upload/route.ts`. If that handler's
 * limits change and these do not, the failure mode is a registration form that
 * lets a file through and gets a 422 back after uploading all of it.
 */
describe("publicUploadError", () => {
  it("passes the types the route accepts", () => {
    for (const mimeType of [
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
      "text/plain",
    ]) {
      expect(publicUploadError({ mimeType, sizeBytes: 1024 })).toBeNull();
    }
  });

  it("names the format it is refusing, rather than listing the ones it wants", () => {
    // The iPhone case: `resolveMimeType` reports HEIC for a file picked from
    // Files rather than Photos, and the server's own sentence never mentions it.
    expect(publicUploadError({ mimeType: "image/heic", sizeBytes: 1024 })).toContain(
      "image/heic",
    );
  });

  it("rejects an empty or unreadable file before it is sent", () => {
    expect(publicUploadError({ mimeType: "image/jpeg", sizeBytes: 0 })).toMatch(/empty/i);
  });

  it("accepts a file exactly at the cap and refuses one byte over", () => {
    expect(
      publicUploadError({ mimeType: "image/jpeg", sizeBytes: PUBLIC_UPLOAD_MAX_BYTES }),
    ).toBeNull();
    expect(
      publicUploadError({
        mimeType: "image/jpeg",
        sizeBytes: PUBLIC_UPLOAD_MAX_BYTES + 1,
      }),
    ).toMatch(/5 MB/);
  });

  it("says how big the file actually is, so the advice is actionable", () => {
    expect(
      publicUploadError({ mimeType: "image/jpeg", sizeBytes: 9 * 1024 * 1024 }),
    ).toContain("9.0 MB");
  });
});

describe("formatMegabytes", () => {
  it("keeps one decimal, so 5.4 MB does not print as '5 MB' against a 5 MB limit", () => {
    expect(formatMegabytes(5.4 * 1024 * 1024)).toBe("5.4 MB");
  });
});
