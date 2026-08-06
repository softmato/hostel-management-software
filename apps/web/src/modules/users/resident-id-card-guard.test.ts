import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

/**
 * A provider's ID card carries the *same* `HH-…` number their resident card
 * did — approval re-skins the card, it does not mint a new number. Nothing
 * about the string itself says which card it is, so `lookupResidentProfile` is
 * the only thing stopping a hostel from scanning the electrician who came to
 * fix a tap and registering him as a resident.
 *
 * These tests pin that guard. If it is ever removed, the failure is silent in
 * the UI — the lookup simply succeeds and prefills a registration form.
 */

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  profileFindOne: vi.fn(),
  providerFindOne: vi.fn(),
  userFindById: vi.fn(),
  userFindOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: {
    exists: vi.fn(),
    findById: mocks.userFindById,
    findOne: mocks.userFindOne,
    findOneAndUpdate: vi.fn(),
    updateOne: vi.fn(),
  },
}));

vi.mock("@hostel/db/models/ServiceProvider", () => ({
  ServiceProviderModel: { findOne: mocks.providerFindOne },
}));

vi.mock("@hostel/db/models/UserResidentProfile", () => ({
  UserResidentProfileModel: {
    findOne: mocks.profileFindOne,
    findOneAndUpdate: vi.fn(),
    updateOne: vi.fn(),
  },
}));

vi.mock("@hostel/db/models/AuditLog", () => ({ AuditLogModel: { create: vi.fn() } }));
vi.mock("@hostel/db/models/Notification", () => ({
  NotificationModel: { create: vi.fn().mockResolvedValue(null) },
}));
vi.mock("@hostel/db/models/FileAsset", () => ({ FileAssetModel: { findOne: vi.fn() } }));
vi.mock("@hostel/db/models/HostelPageView", () => ({
  HostelPageViewModel: { countDocuments: vi.fn() },
}));
vi.mock("@hostel/db/models/Inquiry", () => ({ InquiryModel: { countDocuments: vi.fn() } }));
vi.mock("@/lib/r2", () => ({ getPresignedReadUrl: vi.fn() }));
vi.mock("@/lib/personal-data-crypto", () => ({
  decryptPersonalData: () => ({
    fullName: "Siddhant Yadav",
    gender: "MALE",
    guardianName: "Ram",
    guardianPhone: "9800000001",
    guardianRelation: "Father",
    primaryEmail: "sidd@example.com",
    primaryPhone: "9800000000",
  }),
  encryptPersonalData: (value: unknown) => JSON.stringify(value),
}));

const { lookupResidentProfile } = await import(
  "@/modules/users/resident-identity.service"
);

const RESIDENT_ID = "HH-GBKM-45QW";
const userId = new Types.ObjectId();

const principal = {
  hostelIds: [new Types.ObjectId().toString()],
  role: Role.HOSTEL_ADMIN,
  userId: new Types.ObjectId().toString(),
};

/** `.select(…).lean()` chains, the shape the service calls models with. */
function chain(value: unknown) {
  return { lean: () => Promise.resolve(value), select: () => chain(value) };
}

beforeEach(() => {
  vi.clearAllMocks();

  mocks.userFindOne.mockReturnValue(
    chain({ _id: userId, email: "sidd@example.com", name: "Sidd", userResidentId: RESIDENT_ID }),
  );
  mocks.userFindById.mockReturnValue(chain({ role: Role.PUBLIC }));
  mocks.profileFindOne.mockReturnValue(
    chain({
      _id: new Types.ObjectId(),
      completedAt: new Date(),
      encryptedData: "{}",
      sharingEnabled: true,
      userId,
    }),
  );
});

describe("lookupResidentProfile card-type guard", () => {
  it("refuses an approved service provider's card", async () => {
    mocks.providerFindOne.mockReturnValue(chain({ category: "ELECTRICIAN" }));

    await expect(lookupResidentProfile(RESIDENT_ID, principal)).rejects.toThrow(
      /service provider ID card/i,
    );
  });

  it("refuses a hostel owner's card", async () => {
    mocks.userFindById.mockReturnValue(chain({ role: Role.HOSTEL_ADMIN }));
    mocks.providerFindOne.mockReturnValue(chain(null));

    await expect(lookupResidentProfile(RESIDENT_ID, principal)).rejects.toThrow(
      /hostel owner ID card/i,
    );
  });

  it("still resolves an ordinary resident's card", async () => {
    mocks.providerFindOne.mockReturnValue(chain(null));

    const result = await lookupResidentProfile(RESIDENT_ID, principal);

    expect(result.residentId).toBe(RESIDENT_ID);
    // The prefill splits the stored full name into the registration form's
    // first/last fields, so this also confirms real profile data came back.
    expect(result.prefill.resident.firstName).toBe("Siddhant");
  });

  it("refuses a provider before disclosing anything about the person", async () => {
    // The rejection must come from the card type, not from a later check — a
    // provider with sharing off and an incomplete profile must not produce a
    // different, more informative error.
    mocks.providerFindOne.mockReturnValue(chain({ category: "PLUMBER" }));
    mocks.profileFindOne.mockReturnValue(chain(null));

    await expect(lookupResidentProfile(RESIDENT_ID, principal)).rejects.toThrow(
      /service provider ID card/i,
    );
  });
});
