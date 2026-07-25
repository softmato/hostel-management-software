import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  connectToDatabase: vi.fn(),
  hostelFindOne: vi.fn(),
  platformSettingFindOne: vi.fn(),
  qrCreate: vi.fn(),
  qrUpdateMany: vi.fn(),
  residentFindOne: vi.fn(),
  sendEmail: vi.fn(),
  storePublicAsset: vi.fn(),
  userFindOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@/lib/public-upload", () => ({ storePublicAsset: mocks.storePublicAsset }));

vi.mock("@/modules/auth/auth.service", () => ({ issueSessionForUser: vi.fn() }));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: { create: mocks.auditCreate },
}));

vi.mock("@hostel/db/models/QRActivation", () => ({
  QRActivationModel: {
    create: mocks.qrCreate,
    findOne: vi.fn(),
    updateMany: mocks.qrUpdateMany,
    updateOne: vi.fn(),
  },
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: { find: vi.fn(), findOne: mocks.residentFindOne, findOneAndUpdate: vi.fn() },
}));

vi.mock("@hostel/db/models/Hostel", () => ({
  HostelModel: { findOne: mocks.hostelFindOne },
}));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: { find: vi.fn(), findOne: mocks.userFindOne, findOneAndUpdate: vi.fn() },
}));

vi.mock("@hostel/db/models/HostelMember", () => ({
  HostelMemberModel: { find: vi.fn() },
}));

vi.mock("@hostel/db/models/PlatformSetting", () => ({
  PlatformSettingModel: { findOne: mocks.platformSettingFindOne },
}));

vi.mock("@hostel/shared/email/sender", () => ({ sendEmail: mocks.sendEmail }));

import { generateActivationCode } from "@/modules/residents/activation.service";

const hostelId = "64f0f0f0f0f0f0f0f0f0f0a1";
const residentId = "64f0f0f0f0f0f0f0f0f0f0a3";

const staffPrincipal = {
  hostelIds: [hostelId],
  role: Role.HOSTEL_ADMIN,
  sessionId: "session-1",
  userId: "64f0f0f0f0f0f0f0f0f0f0a4",
};

function leanResult<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value) };
}

function queryResult<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
  };
}

function residentRecord(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(residentId),
    bedId: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a6"),
    depositAmount: 0,
    email: "asha@example.com",
    firstName: "Asha",
    hostelId: new Types.ObjectId(hostelId),
    lastName: "Rai",
    moveInDate: new Date("2030-01-01T00:00:00.000Z"),
    phone: "9800000000",
    roomId: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a5"),
    status: "PENDING",
    ...overrides,
  };
}

describe("activation code delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.platformSettingFindOne.mockReturnValue(leanResult(null));
    mocks.hostelFindOne.mockReturnValue(queryResult({ name: "Sunrise Hostel" }));
    mocks.residentFindOne.mockReturnValue(leanResult(residentRecord()));
    mocks.userFindOne.mockReturnValue(leanResult(null));
    mocks.storePublicAsset.mockResolvedValue("https://cdn.example.com/qr.png");
    mocks.sendEmail.mockResolvedValue({ sent: true });
    mocks.qrCreate.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({ ...input, _id: new Types.ObjectId() }),
    );
  });

  it("defaults the expiry to the configured qrActivationExpiryDays", async () => {
    const before = Date.now();

    const result = await generateActivationCode(residentId, { sendEmail: true }, staffPrincipal);

    const expiresAt = new Date(result.activation.expiresAt).getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;

    expect(expiresAt - before).toBeGreaterThan(sevenDays - 60_000);
    expect(expiresAt - before).toBeLessThan(sevenDays + 60_000);
  });

  it("honours a stored expiry override", async () => {
    mocks.platformSettingFindOne.mockReturnValue(
      leanResult({ key: "operations", value: { qrActivationExpiryDays: 2 } }),
    );
    const before = Date.now();

    const result = await generateActivationCode(residentId, { sendEmail: true }, staffPrincipal);

    const expiresAt = new Date(result.activation.expiresAt).getTime();
    const twoDays = 2 * 24 * 60 * 60 * 1000;

    expect(expiresAt - before).toBeLessThan(twoDays + 60_000);
  });

  it("emails the resident with the QR image and the fallback code", async () => {
    const result = await generateActivationCode(residentId, { sendEmail: true }, staffPrincipal);

    expect(result.delivery).toMatchObject({ sent: true, to: "asha@example.com" });

    const email = mocks.sendEmail.mock.calls[0][0];
    expect(email.html).toContain("https://cdn.example.com/qr.png");
    expect(email.html).toContain(result.activation.code);
    expect(email.html).toContain("/resident-activation?code=");
  });

  it("still issues a code when the resident has no email", async () => {
    mocks.residentFindOne.mockReturnValue(leanResult(residentRecord({ email: undefined })));

    const result = await generateActivationCode(residentId, { sendEmail: true }, staffPrincipal);

    expect(result.activation.code).toHaveLength(8);
    expect(result.delivery).toMatchObject({ sent: false, reason: "no_resident_email" });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("skips delivery entirely when the admin opts out", async () => {
    const result = await generateActivationCode(
      residentId,
      { sendEmail: false },
      staffPrincipal,
    );

    expect(result.delivery).toMatchObject({ sent: false, reason: "email_suppressed" });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
