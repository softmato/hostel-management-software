/**
 * Private file access — Block 0 item 0.1 of docs/FINANCE_IMPLEMENTATION_PLAN.md.
 *
 * The authorization decision for a private asset lives in the route handler
 * itself, not in a service, so this suite is route-level: it drives the two
 * handlers directly with a mocked principal, model and storage layer. That is a
 * deliberate exception to the service-boundary convention used elsewhere —
 * testing one layer down would test nothing, because there is no layer down.
 *
 * The property under test is **default-deny**: access must be granted by a
 * positive reason (owner, same hostel, platform), never by the absence of one.
 * The bug this replaces granted access whenever `hostelId` was missing, and
 * payment proofs never had one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { Role } from "@/lib/roles";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findOne: vi.fn(),
  loadApiPrincipal: vi.fn(),
  presignedReadUrl: vi.fn(),
  presignedUploadUrl: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ loadApiPrincipal: mocks.loadApiPrincipal }));

vi.mock("@hostel/db/models/FileAsset", () => ({
  FileAssetModel: { create: mocks.create, findOne: mocks.findOne },
}));

vi.mock("@/lib/r2", () => ({
  // Mirrors the real split: anything not PUBLIC belongs in the bucket with no
  // public base URL. Named distinctly so an assertion on the chosen bucket
  // cannot pass by accident.
  bucketForAccessLevel: (accessLevel: string) =>
    accessLevel === "PUBLIC" ? "test-public-bucket" : "test-private-bucket",
  generateFileKey: (prefix: string, name: string) => `${prefix}/${name}`,
  getPresignedReadUrl: mocks.presignedReadUrl,
  getPresignedUploadUrl: mocks.presignedUploadUrl,
}));

const { GET } = await import("./[assetId]/url/route");
const { POST } = await import("./presign/route");

const HOSTEL_A = "6600000000000000000000a1";
const HOSTEL_B = "6600000000000000000000b2";
const RESIDENT_USER = "770000000000000000000001";
const STAFF_USER = "770000000000000000000002";

function readRequest() {
  return { url: "http://localhost/api/v1/files/asset-1/url" } as unknown as NextRequest;
}

function presignRequest(body: Record<string, unknown>) {
  return { json: async () => body } as unknown as NextRequest;
}

/** A payment proof owned by a resident of hostel A. */
function proofAsset(overrides: Record<string, unknown> = {}) {
  return {
    _id: "asset-1",
    accessLevel: "PRIVATE",
    hostelId: HOSTEL_A,
    key: "uploads/proof.png",
    ownerId: RESIDENT_USER,
    variants: [],
    ...overrides,
  };
}

async function readAs(
  principal: { hostelIds: string[]; role: Role; userId: string } | null,
  asset: Record<string, unknown>,
) {
  mocks.loadApiPrincipal.mockResolvedValue(principal);
  mocks.findOne.mockResolvedValue(asset);

  return GET(readRequest(), { params: Promise.resolve({ assetId: "asset-1" }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.presignedReadUrl.mockResolvedValue("https://r2.example.test/signed");
  mocks.presignedUploadUrl.mockResolvedValue("https://r2.example.test/put");
  mocks.create.mockImplementation(async (doc: Record<string, unknown>) => ({
    ...doc,
    _id: { toString: () => "new-asset" },
  }));
});

describe("GET /api/v1/files/[assetId]/url", () => {
  it("lets the owner read their own asset", async () => {
    const response = await readAs(
      { hostelIds: [HOSTEL_A], role: Role.RESIDENT, userId: RESIDENT_USER },
      proofAsset(),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://r2.example.test/signed");
  });

  it("lets staff of the same hostel read it", async () => {
    const response = await readAs(
      { hostelIds: [HOSTEL_A], role: Role.HOSTEL_ADMIN, userId: STAFF_USER },
      proofAsset(),
    );

    expect(response.status).toBe(302);
  });

  it("denies staff of another hostel", async () => {
    const response = await readAs(
      { hostelIds: [HOSTEL_B], role: Role.HOSTEL_ADMIN, userId: STAFF_USER },
      proofAsset(),
    );

    expect(response.status).toBe(403);
    expect(mocks.presignedReadUrl).not.toHaveBeenCalled();
  });

  // The live defect: an unlabelled asset used to satisfy the condition for
  // everyone, so any authenticated user could read any resident's screenshot.
  it("denies a non-owner when the asset has no hostelId", async () => {
    const response = await readAs(
      { hostelIds: [HOSTEL_B], role: Role.HOSTEL_ADMIN, userId: STAFF_USER },
      proofAsset({ hostelId: undefined }),
    );

    expect(response.status).toBe(403);
  });

  it("denies a hostel-less principal when the asset has no hostelId", async () => {
    const response = await readAs(
      { hostelIds: [], role: Role.GUARDIAN, userId: "770000000000000000000003" },
      proofAsset({ hostelId: undefined }),
    );

    expect(response.status).toBe(403);
  });

  it("lets SUPERADMIN read an unlabelled asset", async () => {
    const response = await readAs(
      { hostelIds: [], role: Role.SUPERADMIN, userId: "770000000000000000000004" },
      proofAsset({ hostelId: undefined }),
    );

    expect(response.status).toBe(302);
  });

  it("requires authentication for a private asset", async () => {
    const response = await readAs(null, proofAsset());

    expect(response.status).toBe(401);
  });
});

describe("POST /api/v1/files/presign", () => {
  const proofBody = {
    fileName: "proof.png",
    kind: "PAYMENT_PROOF",
    mimeType: "image/png",
    sizeBytes: 1024,
  };

  it("stores the caller's hostelId on a payment-proof asset", async () => {
    mocks.loadApiPrincipal.mockResolvedValue({
      hostelIds: [HOSTEL_A],
      role: Role.RESIDENT,
      userId: RESIDENT_USER,
    });

    const response = await POST(presignRequest(proofBody));

    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ hostelId: HOSTEL_A, ownerId: RESIDENT_USER }),
    );
  });

  it("refuses a financial upload whose hostel cannot be resolved", async () => {
    mocks.loadApiPrincipal.mockResolvedValue({
      hostelIds: [HOSTEL_A, HOSTEL_B],
      role: Role.HOSTEL_ADMIN,
      userId: STAFF_USER,
    });

    const response = await POST(presignRequest(proofBody));

    expect(response.status).toBe(422);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("accepts an explicit hostelId the caller can reach", async () => {
    mocks.loadApiPrincipal.mockResolvedValue({
      hostelIds: [HOSTEL_A, HOSTEL_B],
      role: Role.HOSTEL_ADMIN,
      userId: STAFF_USER,
    });

    const response = await POST(presignRequest({ ...proofBody, hostelId: HOSTEL_B }));

    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ hostelId: HOSTEL_B }),
    );
  });

  it("rejects an explicit hostelId the caller cannot reach", async () => {
    mocks.loadApiPrincipal.mockResolvedValue({
      hostelIds: [HOSTEL_A],
      role: Role.HOSTEL_ADMIN,
      userId: STAFF_USER,
    });

    const response = await POST(presignRequest({ ...proofBody, hostelId: HOSTEL_B }));

    expect(response.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("still allows a non-financial upload with no resolvable hostel", async () => {
    mocks.loadApiPrincipal.mockResolvedValue({
      hostelIds: [],
      role: Role.SUPERADMIN,
      userId: "770000000000000000000004",
    });

    const response = await POST(
      presignRequest({ fileName: "logo.png", mimeType: "image/png", sizeBytes: 512 }),
    );

    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ hostelId: undefined }),
    );
  });

  /**
   * The bucket split is the thing standing between a payment proof and a
   * permanent unsigned URL, so it is asserted on the row that gets written and
   * on the presign that gets signed — not merely on the helper in isolation.
   *
   * A regression here does not fail loudly: the upload still succeeds, the
   * proof is simply readable by anyone holding the key, forever.
   */
  it("presigns a payment proof into the private bucket", async () => {
    mocks.loadApiPrincipal.mockResolvedValue({
      hostelIds: [HOSTEL_A],
      role: Role.RESIDENT,
      userId: RESIDENT_USER,
    });

    const response = await POST(presignRequest({ ...proofBody, hostelId: HOSTEL_A }));

    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ accessLevel: "PRIVATE", bucket: "test-private-bucket" }),
    );
    /*
     * Three arguments, and the missing fourth is the point: the size is not
     * handed to the signer. SigV4 would bind it as an exact `content-length`
     * the client has to reproduce byte for byte, which broke every upload whose
     * declared size differed from the bytes actually sent. It is enforced
     * instead where the real object can be read, at `/complete`.
     */
    expect(mocks.presignedUploadUrl).toHaveBeenCalledWith(
      "test-private-bucket",
      expect.any(String),
      expect.any(String),
    );
  });

  it("defaults an unlabelled upload to the private bucket", async () => {
    mocks.loadApiPrincipal.mockResolvedValue({
      hostelIds: [],
      role: Role.SUPERADMIN,
      userId: "770000000000000000000004",
    });

    await POST(
      presignRequest({ fileName: "logo.png", mimeType: "image/png", sizeBytes: 512 }),
    );

    // Default-deny applies to placement too: an upload that does not say it is
    // public must not land in the bucket that serves anything unsigned.
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ accessLevel: "PRIVATE", bucket: "test-private-bucket" }),
    );
  });

  it("presigns an explicitly public upload into the public bucket", async () => {
    mocks.loadApiPrincipal.mockResolvedValue({
      hostelIds: [],
      role: Role.SUPERADMIN,
      userId: "770000000000000000000004",
    });

    await POST(
      presignRequest({
        accessLevel: "PUBLIC",
        fileName: "gallery.png",
        mimeType: "image/png",
        sizeBytes: 512,
      }),
    );

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ accessLevel: "PUBLIC", bucket: "test-public-bucket" }),
    );
  });
});
