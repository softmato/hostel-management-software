/**
 * Payment profile service — Block 3 item 3.1 of
 * docs/FINANCE_IMPLEMENTATION_PLAN.md (target §11.8).
 *
 * Two things are worth testing here and the rest is field copying: that a hostel
 * which has never opened the form still gets a complete, honest answer (`usable:
 * false`, not a blank card), and that the QR image cannot be borrowed from
 * another hostel — which would redirect money rather than merely leak a file.
 */
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiPrincipal } from "@/lib/api-auth";
import { Role } from "@/lib/roles";

const mocks = vi.hoisted(() => ({
  assetFindOne: vi.fn(),
  audit: vi.fn(),
  profileFindOne: vi.fn(),
  profileFindOneAndUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/modules/finance/audit-finance", () => ({ auditFinanceAction: mocks.audit }));

vi.mock("@hostel/db/models/FileAsset", () => ({
  FileAssetModel: { findOne: mocks.assetFindOne },
}));

vi.mock("@hostel/db/models/HostelPaymentProfile", async () => {
  const actual = await vi.importActual<
    typeof import("@hostel/db/models/HostelPaymentProfile")
  >("@hostel/db/models/HostelPaymentProfile");

  return {
    ...actual,
    HostelPaymentProfileModel: {
      findOne: mocks.profileFindOne,
      findOneAndUpdate: mocks.profileFindOneAndUpdate,
    },
  };
});

const { getPaymentProfile, updatePaymentProfile } = await import(
  "./payment-profile.service"
);

const hostelId = new Types.ObjectId();
const otherHostelId = new Types.ObjectId();
const assetId = new Types.ObjectId();

const principal = {
  hostelIds: [hostelId.toString()],
  role: Role.HOSTEL_ADMIN,
  userId: new Types.ObjectId().toString(),
} as unknown as ApiPrincipal;

/** Every model call in this service is `.lean()`-terminated. */
function lean<T>(value: T) {
  return { lean: () => Promise.resolve(value) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profileFindOne.mockReturnValue(lean(null));
  mocks.profileFindOneAndUpdate.mockReturnValue(lean({ cashApprovalThreshold: 20000 }));
  mocks.assetFindOne.mockReturnValue(
    lean({ _id: assetId, hostelId, uploadCompletedAt: new Date() }),
  );
});

describe("getPaymentProfile", () => {
  it("answers for a hostel that has never opened the form", async () => {
    const view = await getPaymentProfile(hostelId);

    // Not null and not a partial object: the pay screen branches on `usable`,
    // and an absent profile has to reach it as a complete "not set up yet".
    expect(view.usable).toBe(false);
    expect(view.tier).toBe("TIER_0");
    expect(view.cashApprovalThreshold).toBe(20000);
    expect(view.statementCadenceDays).toBe(7);
    expect(view.esewaId).toBeNull();
  });

  it("is usable once any one payment method is present", async () => {
    mocks.profileFindOne.mockReturnValue(lean({ esewaId: "9800000000" }));

    expect((await getPaymentProfile(hostelId)).usable).toBe(true);
  });

  it("is not usable with a display name alone", async () => {
    mocks.profileFindOne.mockReturnValue(lean({ displayName: "Green View Hostel" }));

    expect((await getPaymentProfile(hostelId)).usable).toBe(false);
  });

  it("stays TIER_0 while the gateway is only half configured", async () => {
    mocks.profileFindOne.mockReturnValue(
      lean({ esewaId: "9800000000", gatewayProvider: "FONEPAY" }),
    );

    expect((await getPaymentProfile(hostelId)).tier).toBe("TIER_0");
  });
});

describe("updatePaymentProfile", () => {
  it("upserts, so the first save needs no prior row", async () => {
    await updatePaymentProfile(hostelId, { esewaId: "9800000000" }, principal);

    const [filter, update, options] = mocks.profileFindOneAndUpdate.mock.calls[0];

    expect(filter).toEqual({ hostelId });
    expect(update.$set.esewaId).toBe("9800000000");
    expect(options.upsert).toBe(true);
  });

  it("writes only the fields the form sent", async () => {
    await updatePaymentProfile(hostelId, { bankName: "NIC Asia" }, principal);

    const [, update] = mocks.profileFindOneAndUpdate.mock.calls[0];

    // An absent key must not become a null: a form that renders one section
    // would otherwise wipe the sections it does not show.
    expect(update.$set).not.toHaveProperty("esewaId");
    expect(update.$set).not.toHaveProperty("staticQrAssetId");
  });

  it("clears a field that was explicitly sent as null", async () => {
    await updatePaymentProfile(hostelId, { esewaId: null }, principal);

    expect(mocks.profileFindOneAndUpdate.mock.calls[0][1].$set.esewaId).toBeNull();
  });

  it("rejects a QR image belonging to another hostel", async () => {
    mocks.assetFindOne.mockReturnValue(
      lean({ _id: assetId, hostelId: otherHostelId, uploadCompletedAt: new Date() }),
    );

    await expect(
      updatePaymentProfile(hostelId, { staticQrAssetId: assetId.toString() }, principal),
    ).rejects.toMatchObject({ errorCode: "ASSET_NOT_OWNED" });

    expect(mocks.profileFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects a QR image whose upload was never verified", async () => {
    mocks.assetFindOne.mockReturnValue(lean({ _id: assetId, hostelId }));

    await expect(
      updatePaymentProfile(hostelId, { staticQrAssetId: assetId.toString() }, principal),
    ).rejects.toMatchObject({ errorCode: "ASSET_UPLOAD_INCOMPLETE" });
  });

  it("removes the QR when it is sent as null, without touching the asset check", async () => {
    await updatePaymentProfile(hostelId, { staticQrAssetId: null }, principal);

    expect(mocks.assetFindOne).not.toHaveBeenCalled();
    expect(
      mocks.profileFindOneAndUpdate.mock.calls[0][1].$set.staticQrAssetId,
    ).toBeNull();
  });

  it("audits the cash threshold as the amount before and after", async () => {
    mocks.profileFindOne.mockReturnValue(lean({ cashApprovalThreshold: 20000 }));
    mocks.profileFindOneAndUpdate.mockReturnValue(lean({ cashApprovalThreshold: 5000 }));

    await updatePaymentProfile(hostelId, { cashApprovalThreshold: 5000 }, principal);

    expect(mocks.audit).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({
        action: "PAYMENT_PROFILE_UPDATED",
        amountAfter: 5000,
        amountBefore: 20000,
      }),
    );
  });
});
