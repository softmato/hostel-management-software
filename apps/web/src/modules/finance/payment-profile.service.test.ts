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
  readEvidenceText: vi.fn(),
  readStoredObject: vi.fn(),
}));

// The QR read is a real network fetch and a real recogniser. Both are stubbed
// here so these tests describe the *decision* — what may overwrite what — rather
// than tesseract's accuracy, which `qr-payee.test.ts` covers on fixed text.
vi.mock("@/lib/uploads/verify", () => ({ readStoredObject: mocks.readStoredObject }));
vi.mock("@/modules/finance/evidence-ocr", () => ({
  readEvidenceText: mocks.readEvidenceText,
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
    lean({
      _id: assetId,
      bucket: "hostel-files",
      hostelId,
      key: `qr/${assetId}.png`,
      mimeType: "image/png",
      uploadCompletedAt: new Date(),
    }),
  );
  mocks.readStoredObject.mockResolvedValue(Buffer.from("qr"));
  mocks.readEvidenceText.mockResolvedValue(
    ["Scan & Pay", "Merchant Name: GREEN VIEW HOSTEL", "eSewa ID: 9801234567"].join("\n"),
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

  /**
   * A QR poster prints the account number beside the code, so a hostel that
   * uploaded one has already given us an identifier — this is what makes the
   * common QR-only hostel verifiable without it typing anything.
   */
  it("is payee-verifiable from the number read off the QR", async () => {
    mocks.profileFindOne.mockReturnValue(
      lean({ qrPayeeNumber: "9801234567", qrPayeeSource: "OCR", staticQrAssetId: assetId }),
    );

    expect((await getPaymentProfile(hostelId)).payeeVerifiable).toBe(true);
  });

  /**
   * The one case the admin banner exists for: a poster nothing could read. The
   * hostel collects money perfectly well and yet no receipt can be matched back
   * to it, so `usable` and `payeeVerifiable` have to be able to disagree — if
   * they ever collapse into one flag, the hostel that needs the ask stops
   * getting it.
   */
  it("is usable but not payee-verifiable when the QR could not be read", async () => {
    mocks.profileFindOne.mockReturnValue(lean({ staticQrAssetId: assetId }));

    const view = await getPaymentProfile(hostelId);

    expect(view.usable).toBe(true);
    expect(view.payeeVerifiable).toBe(false);
  });

  it("is payee-verifiable once an account identifier is on the profile", async () => {
    mocks.profileFindOne.mockReturnValue(lean({ khaltiId: "9800000000" }));

    expect((await getPaymentProfile(hostelId)).payeeVerifiable).toBe(true);
  });

  it("does not count an account name as a credential", async () => {
    // Names match by token against the hostel's own name, which every hostel
    // has — counting them here would report every profile as verifiable.
    mocks.profileFindOne.mockReturnValue(
      lean({ bankAccountName: "Green View Hostel", bankName: "NIC Asia" }),
    );

    expect((await getPaymentProfile(hostelId)).payeeVerifiable).toBe(false);
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

  it("stores the payee identity read off a newly uploaded QR", async () => {
    await updatePaymentProfile(
      hostelId,
      { staticQrAssetId: assetId.toString() },
      principal,
    );

    const { $set } = mocks.profileFindOneAndUpdate.mock.calls[0][1];

    expect($set.qrPayeeName).toBe("GREEN VIEW HOSTEL");
    expect($set.qrPayeeNumber).toBe("9801234567");
    expect($set.qrPayeeSource).toBe("OCR");
  });

  it("saves the QR anyway when nothing could read it", async () => {
    // The whole point of the silent-failure contract: a hostel must never be
    // unable to publish its QR because a recogniser did not load. It simply
    // gets asked for the two fields on the setup screen.
    mocks.readEvidenceText.mockResolvedValue(null);

    await updatePaymentProfile(
      hostelId,
      { staticQrAssetId: assetId.toString() },
      principal,
    );

    const { $set } = mocks.profileFindOneAndUpdate.mock.calls[0][1];

    expect($set.staticQrAssetId).toEqual(assetId);
    expect($set.qrPayeeName).toBeNull();
  });

  it("does not let a re-read overwrite what an admin typed", async () => {
    // The admin was looking at the physical poster; the recogniser was looking
    // at a JPEG of it. Same QR, so the stored answer stands.
    mocks.profileFindOne.mockReturnValue(
      lean({
        qrPayeeName: "SUNRISE HOSTEL",
        qrPayeeNumber: "0010012345678",
        qrPayeeSource: "MANUAL",
        staticQrAssetId: assetId,
      }),
    );

    await updatePaymentProfile(
      hostelId,
      { staticQrAssetId: assetId.toString() },
      principal,
    );

    const { $set } = mocks.profileFindOneAndUpdate.mock.calls[0][1];

    expect($set).not.toHaveProperty("qrPayeeName");
    expect($set).not.toHaveProperty("qrPayeeNumber");
  });

  it("marks a typed name and number as MANUAL", async () => {
    await updatePaymentProfile(
      hostelId,
      { qrPayeeName: "GREEN VIEW HOSTEL", qrPayeeNumber: "9801234567" },
      principal,
    );

    expect(mocks.profileFindOneAndUpdate.mock.calls[0][1].$set.qrPayeeSource).toBe(
      "MANUAL",
    );
  });

  it("forgets a read identity when the QR is removed", async () => {
    // The poster is no longer this hostel's registered account, so matching
    // receipts against what it said would verify money sent somewhere else.
    mocks.profileFindOne.mockReturnValue(
      lean({ qrPayeeNumber: "9801234567", qrPayeeSource: "OCR", staticQrAssetId: assetId }),
    );

    await updatePaymentProfile(hostelId, { staticQrAssetId: null }, principal);

    const { $set } = mocks.profileFindOneAndUpdate.mock.calls[0][1];

    expect($set.staticQrAssetId).toBeNull();
    expect($set.qrPayeeNumber).toBeNull();
    expect($set.qrPayeeSource).toBeNull();
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
