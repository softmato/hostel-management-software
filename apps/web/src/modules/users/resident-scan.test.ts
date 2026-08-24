import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

/**
 * The scan endpoint is `lookupResidentProfile`'s opposite, and every test here
 * pins one of the refusals it deliberately does *not* make.
 *
 * That distinction is invisible from the outside — both take an `HH-…` string
 * and hand back a person — so it is exactly the kind of thing a later "let's
 * share the guard between them" refactor would collapse, turning a corridor
 * screen into one that says "that is a service provider ID card" about a
 * resident's own electrician brother.
 */

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  complaintCount: vi.fn(),
  complaintFind: vi.fn(),
  contactFind: vi.fn(),
  guardianFind: vi.fn(),
  hostelFindById: vi.fn(),
  ledger: vi.fn(),
  nightFindOne: vi.fn(),
  notificationCreate: vi.fn(),
  profileFindOne: vi.fn(),
  profileUpdateOne: vi.fn(),
  providerFindOne: vi.fn(),
  residentFindOne: vi.fn(),
  userFindById: vi.fn(),
  userFindOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/lib/r2", () => ({ getPresignedReadUrl: vi.fn() }));

vi.mock("@/lib/personal-data-crypto", () => ({
  decryptPersonalData: () => ({
    bloodGroup: "O+",
    dietaryPreference: "VEG",
    fullName: "Siddhant Yadav",
    gender: "MALE",
    guardianName: "Ram Yadav",
    guardianPhone: "9800000001",
    guardianRelation: "Father",
    interests: [],
    occupation: "STUDENT",
    primaryEmail: "sidd@example.com",
    primaryPhone: "9800000000",
  }),
  encryptPersonalData: (value: unknown) => JSON.stringify(value),
}));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: {
    exists: vi.fn(),
    findById: mocks.userFindById,
    findOne: mocks.userFindOne,
  },
}));
vi.mock("@hostel/db/models/ServiceProvider", () => ({
  ServiceProviderModel: { findOne: mocks.providerFindOne },
}));
vi.mock("@hostel/db/models/UserResidentProfile", () => ({
  UserResidentProfileModel: {
    findOne: mocks.profileFindOne,
    updateOne: mocks.profileUpdateOne,
  },
}));
vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: { create: mocks.auditCreate },
}));
vi.mock("@hostel/db/models/Notification", () => ({
  NotificationModel: { create: mocks.notificationCreate },
}));
vi.mock("@hostel/db/models/FileAsset", () => ({ FileAssetModel: { findOne: vi.fn() } }));
vi.mock("@hostel/db/models/HostelPageView", () => ({
  HostelPageViewModel: { countDocuments: vi.fn() },
}));
vi.mock("@hostel/db/models/Inquiry", () => ({ InquiryModel: { countDocuments: vi.fn() } }));
vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: { findOne: mocks.residentFindOne },
}));
vi.mock("@hostel/db/models/Guardian", () => ({
  GuardianModel: { find: mocks.guardianFind },
}));
vi.mock("@hostel/db/models/EmergencyContact", () => ({
  EmergencyContactModel: { find: mocks.contactFind },
}));
vi.mock("@hostel/db/models/NightStatus", () => ({
  NightStatusModel: { findOne: mocks.nightFindOne },
}));
vi.mock("@hostel/db/models/Complaint", () => ({
  ComplaintModel: { countDocuments: mocks.complaintCount, find: mocks.complaintFind },
}));
vi.mock("@hostel/db/models/Hostel", () => ({
  HostelModel: { findById: mocks.hostelFindById },
}));
vi.mock("@/modules/finance/resident-ledger.service", () => ({
  getResidentLedger: mocks.ledger,
}));

const { scanResidentForHostel } = await import("@/modules/users/resident-scan.service");

const RESIDENT_ID = "HH-GBKM-45QW";
const userId = new Types.ObjectId();
const hostelId = new Types.ObjectId();
const residentRowId = new Types.ObjectId();

const principal = {
  hostelIds: [hostelId.toString()],
  role: Role.HOSTEL_ADMIN,
  userId: new Types.ObjectId().toString(),
};

/** Every `.select().sort().limit().lean()` chain the service builds. */
function chain(value: unknown) {
  const link: Record<string, unknown> = {
    lean: () => Promise.resolve(value),
  };

  for (const method of ["limit", "select", "sort"]) {
    link[method] = () => link;
  }

  return link;
}

function residentRow() {
  return {
    _id: residentRowId,
    createdAt: new Date("2026-01-04"),
    depositAmount: 5000,
    email: "sidd@example.com",
    firstName: "Siddhant",
    hostelId,
    lastName: "Yadav",
    monthlyFee: null,
    moveInDate: new Date("2026-01-05"),
    phone: "9800000000",
    residentType: "STUDENT",
    roomType: "DOUBLE",
    status: "ACTIVE",
    userId,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  mocks.userFindOne.mockReturnValue(
    chain({
      _id: userId,
      email: "sidd@example.com",
      name: "Sidd",
      userResidentId: RESIDENT_ID,
    }),
  );
  mocks.userFindById.mockReturnValue(chain({ role: Role.PUBLIC }));
  mocks.providerFindOne.mockReturnValue(chain(null));
  mocks.profileFindOne.mockReturnValue(
    chain({
      _id: new Types.ObjectId(),
      completedAt: new Date(),
      encryptedData: "{}",
      sharingEnabled: true,
      userId,
    }),
  );
  mocks.profileUpdateOne.mockResolvedValue({});
  mocks.auditCreate.mockResolvedValue({});
  mocks.notificationCreate.mockResolvedValue({});

  mocks.residentFindOne.mockReturnValue(chain(residentRow()));
  mocks.hostelFindById.mockReturnValue(chain({ name: "Everest Boys" }));
  mocks.guardianFind.mockReturnValue(chain([]));
  mocks.contactFind.mockReturnValue(chain([]));
  mocks.nightFindOne.mockReturnValue(chain(null));
  mocks.complaintFind.mockReturnValue(chain([]));
  mocks.complaintCount.mockResolvedValue(0);
  mocks.ledger.mockResolvedValue(null);
});

describe("scanResidentForHostel", () => {
  it("does not refuse a service provider's card the way the lookup does", async () => {
    // `lookupResidentProfile` throws here on purpose — you cannot admit an
    // electrician as a tenant. Reading a card in a corridor is a different
    // question, and refusing it would leave a warden staring at an error for a
    // card that scanned perfectly.
    mocks.providerFindOne.mockReturnValue(chain({ category: "ELECTRICIAN" }));

    const result = await scanResidentForHostel(RESIDENT_ID, principal);

    expect(result.account.cardType).toBe("SERVICE_PROVIDER");
    expect(result.account.cardRole).toBe("Electrician");
    expect(result.profile?.fullName).toBe("Siddhant Yadav");
  });

  it("keeps the hostel's own record when the holder has sharing switched off", async () => {
    // The switch governs *their* portable profile. It cannot take a hostel's
    // own tenancy row away from the hostel that wrote it.
    mocks.profileFindOne.mockReturnValue(
      chain({
        _id: new Types.ObjectId(),
        completedAt: new Date(),
        encryptedData: "{}",
        sharingEnabled: false,
        userId,
      }),
    );

    const result = await scanResidentForHostel(RESIDENT_ID, principal);

    expect(result.profile).toBeNull();
    expect(result.profileNotice).toMatch(/sharing off/i);
    expect(result.membership?.resident.roomType).toBe("DOUBLE");
    // Nothing of theirs was read, so nothing is announced to them.
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });

  it("says so when the tenancy was matched on a phone number rather than an account", async () => {
    // The normal case for anyone registered at the desk: no activation code was
    // ever redeemed, so there is no user id on the row to match against.
    mocks.residentFindOne
      .mockReturnValueOnce(chain(null))
      .mockReturnValue(chain({ ...residentRow(), userId: null }));

    const result = await scanResidentForHostel(RESIDENT_ID, principal);

    expect(result.membership?.matchedBy).toBe("PHONE");
  });

  it("separates a refused ledger from a resident who owes nothing", async () => {
    const result = await scanResidentForHostel(RESIDENT_ID, principal, {
      canViewPayments: false,
    });

    expect(result.membership?.ledger).toBeNull();
    expect(result.membership?.ledgerDenied).toBe(true);
    expect(mocks.ledger).not.toHaveBeenCalled();
  });

  it("returns the dossier even for somebody who is not on the roll", async () => {
    mocks.residentFindOne.mockReturnValue(chain(null));

    const result = await scanResidentForHostel(RESIDENT_ID, principal);

    expect(result.membership).toBeNull();
    expect(result.membershipNotice).toMatch(/not on your roll/i);
    expect(result.profile?.primaryPhone).toBe("9800000000");
  });

  it("audits every read but only announces the first in a quiet window", async () => {
    // A warden who opens a complaint and comes back, or pulls to refresh, has
    // looked at one person once. Four notifications for that is how the one
    // that matters gets swiped away unread — but the audit row is the record
    // somebody may go looking for months later, so it is never suppressed.
    mocks.profileFindOne.mockReturnValue(
      chain({
        _id: new Types.ObjectId(),
        completedAt: new Date(),
        encryptedData: "{}",
        lastSharedAt: new Date(),
        lastSharedWithHostelId: hostelId,
        sharingEnabled: true,
        userId,
      }),
    );

    await scanResidentForHostel(RESIDENT_ID, principal);

    expect(mocks.auditCreate).toHaveBeenCalledTimes(1);
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });

  it("announces a read by a different hostel inside the same window", async () => {
    mocks.profileFindOne.mockReturnValue(
      chain({
        _id: new Types.ObjectId(),
        completedAt: new Date(),
        encryptedData: "{}",
        lastSharedAt: new Date(),
        lastSharedWithHostelId: new Types.ObjectId(),
        sharingEnabled: true,
        userId,
      }),
    );

    await scanResidentForHostel(RESIDENT_ID, principal);

    expect(mocks.notificationCreate).toHaveBeenCalledTimes(1);
  });

  it("rejects a string that is not a resident ID before touching the database", async () => {
    await expect(scanResidentForHostel("not-an-id", principal)).rejects.toThrow(
      /HH-4K7M-9XQ2/,
    );

    expect(mocks.userFindOne).not.toHaveBeenCalled();
  });
});
