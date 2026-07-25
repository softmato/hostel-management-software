import { Types } from "mongoose";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  memberFind: vi.fn(),
  verifyAccessToken: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  ACCESS_TOKEN_COOKIE: "hostelhub_access_token",
  getBearerToken: (header: string | null) =>
    header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null,
  verifyAccessToken: mocks.verifyAccessToken,
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/HostelMember", () => ({
  HostelMemberModel: { find: mocks.memberFind },
}));

import { requireHostelCapability } from "@/lib/api-auth";

const HOSTEL_A = "64f0f0f0f0f0f0f0f0f0f0a1";
const HOSTEL_B = "64f0f0f0f0f0f0f0f0f0f0a2";

function request() {
  return new NextRequest("https://hostelhub.local/api/v1/hostel-admin/profile", {
    headers: { authorization: "Bearer token" },
  });
}

function signedInAs(role: Role, hostelIds: string[]) {
  mocks.verifyAccessToken.mockResolvedValue({
    hostelIds,
    role,
    sessionId: "session-1",
    sub: "64f0f0f0f0f0f0f0f0f0f0a4",
    tokenType: "access",
  });
}

function membershipsIn(hostelIds: string[]) {
  mocks.memberFind.mockReturnValue({
    lean: vi.fn().mockResolvedValue(
      hostelIds.map((id) => ({ hostelId: new Types.ObjectId(id) })),
    ),
    select: vi.fn().mockReturnThis(),
  });
}

describe("warden capability enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets a hostel admin through without consulting permissions", async () => {
    signedInAs(Role.HOSTEL_ADMIN, [HOSTEL_A]);

    const principal = await requireHostelCapability(request(), "editHostelProfile");

    expect(principal.role).toBe(Role.HOSTEL_ADMIN);
    expect(principal.hostelIds).toEqual([HOSTEL_A]);
    // Admins hold every capability implicitly — no lookup should happen.
    expect(mocks.memberFind).not.toHaveBeenCalled();
  });

  it("lets a warden through when the capability is granted", async () => {
    signedInAs(Role.WARDEN, [HOSTEL_A]);
    membershipsIn([HOSTEL_A]);

    const principal = await requireHostelCapability(request(), "manageFood");

    expect(principal.hostelIds).toEqual([HOSTEL_A]);
    expect(mocks.memberFind).toHaveBeenCalledWith(
      expect.objectContaining({ permissions: "manageFood", status: "ACTIVE" }),
    );
  });

  it("rejects a warden whose flag is unchecked", async () => {
    signedInAs(Role.WARDEN, [HOSTEL_A]);
    membershipsIn([]);

    await expect(
      requireHostelCapability(request(), "editHostelProfile"),
    ).rejects.toMatchObject({ errorCode: "CAPABILITY_DENIED", status: 403 });
  });

  it("narrows a multi-hostel warden to only the hostels granting the capability", async () => {
    signedInAs(Role.WARDEN, [HOSTEL_A, HOSTEL_B]);
    membershipsIn([HOSTEL_B]);

    const principal = await requireHostelCapability(request(), "verifyPayments");

    // Services scope every query by principal.hostelIds, so dropping HOSTEL_A
    // here is what actually prevents the warden from touching it.
    expect(principal.hostelIds).toEqual([HOSTEL_B]);
  });

  it("still rejects a non-staff role before any permission lookup", async () => {
    signedInAs(Role.RESIDENT, [HOSTEL_A]);

    await expect(requireHostelCapability(request(), "manageFood")).rejects.toMatchObject(
      { status: 403 },
    );
    expect(mocks.memberFind).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    mocks.verifyAccessToken.mockRejectedValue(new Error("bad token"));

    await expect(requireHostelCapability(request(), "manageFood")).rejects.toMatchObject(
      { status: 401 },
    );
  });
});
