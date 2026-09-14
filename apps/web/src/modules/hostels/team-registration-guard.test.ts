import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The duplicate guard on a field agent's registration.
 *
 * The team desk publishes on submit, so there is no reviewer between an agent
 * filing the same hostel twice and two live listings with two invoices. The
 * case that prompted this: one owner, three registrations in a day, two of
 * which had to be archived — and the leftovers broke that owner's app.
 */

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  hostelFind: vi.fn(),
  hostelFindOne: vi.fn(),
  userFindOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/Hostel", () => ({
  HostelModel: { find: mocks.hostelFind, findOne: mocks.hostelFindOne },
}));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: { findOne: mocks.userFindOne },
}));

import {
  assertTeamRegistrationIsNew,
  findHostelUsingEmail,
  hostelNameKey,
} from "@/modules/hostels/hostel.service";

function chain<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
    select: vi.fn().mockReturnThis(),
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    applicant: { email: "owner@example.com", name: "Owner", phone: "9800000000" },
    location: { area: "Narephat", city: "Kathmandu" },
    name: "Study Sanjal Hostel",
    ...overrides,
  } as Parameters<typeof assertTeamRegistrationIsNew>[0];
}

/** An owner who gave no email — the phone is the only way to match them. */
const PHONE_ONLY = { name: "Owner", phone: "9800000000" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hostelFind.mockReturnValue(chain([]));
  mocks.hostelFindOne.mockReturnValue(chain(null));
  mocks.userFindOne.mockReturnValue(chain(null));
});

describe("hostelNameKey", () => {
  it("reads the two names the real duplicate was filed under as one", () => {
    expect(hostelNameKey("Study Sanjal Hostel")).toBe(hostelNameKey("Study Sanjal"));
  });

  it("ignores case, punctuation and spacing", () => {
    expect(hostelNameKey("  study-sanjal  HOSTEL. ")).toBe("study sanjal");
  });

  it("keeps the words that actually name the place", () => {
    expect(hostelNameKey("Everest Boys Hostel")).not.toBe(hostelNameKey("Annapurna Boys Hostel"));
  });
});

describe("assertTeamRegistrationIsNew", () => {
  it("lets a new hostel for a new owner through", async () => {
    await expect(assertTeamRegistrationIsNew(input())).resolves.toBeUndefined();
  });

  it("refuses a building already listed in the same area", async () => {
    mocks.hostelFind.mockReturnValue(chain([{ name: "Study Sanjal", slug: "study-sanjal" }]));

    await expect(assertTeamRegistrationIsNew(input())).rejects.toMatchObject({
      errorCode: "HOSTEL_ALREADY_LISTED",
      status: 409,
    });
  });

  it("cannot be talked past a duplicate building by the second-hostel tick", async () => {
    mocks.hostelFind.mockReturnValue(chain([{ name: "Study Sanjal", slug: "study-sanjal" }]));

    await expect(
      assertTeamRegistrationIsNew(input({ confirmSecondHostel: true })),
    ).rejects.toMatchObject({ errorCode: "HOSTEL_ALREADY_LISTED" });
  });

  it("refuses a second hostel for the same owner, naming the first", async () => {
    mocks.userFindOne.mockReturnValue(chain({ _id: new Types.ObjectId() }));
    mocks.hostelFindOne.mockReturnValue(
      chain({ location: { area: "Baneshwor" }, name: "Everest Home" }),
    );

    const refused = assertTeamRegistrationIsNew(
      input({ applicant: PHONE_ONLY, name: "Annapurna Hostel" }),
    );

    await expect(refused).rejects.toMatchObject({
      errorCode: "OWNER_ALREADY_HAS_HOSTEL",
      status: 409,
    });
    await expect(refused).rejects.toThrow(/Everest Home/);
  });

  it("allows a genuine second building once the agent confirms it", async () => {
    mocks.userFindOne.mockReturnValue(chain({ _id: new Types.ObjectId() }));
    mocks.hostelFindOne.mockReturnValue(chain({ name: "Everest Home" }));

    await expect(
      assertTeamRegistrationIsNew(
        input({ applicant: PHONE_ONLY, confirmSecondHostel: true, name: "Annapurna Hostel" }),
      ),
    ).resolves.toBeUndefined();
  });

  it("matches the owner by phone and by email, the way registration resolves them", async () => {
    await assertTeamRegistrationIsNew(input());

    expect(mocks.userFindOne).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: [{ phone: "9800000000" }, { email: "owner@example.com" }],
      }),
    );
  });

  it("only counts hostels that are still live", async () => {
    await assertTeamRegistrationIsNew(input());

    expect(mocks.hostelFind).toHaveBeenCalledWith(
      expect.objectContaining({ isDeleted: { $ne: true } }),
    );
  });
});

describe("an owner email already tied to a hostel", () => {
  it("refuses it, naming the hostel", async () => {
    mocks.userFindOne.mockReturnValue(chain({ _id: new Types.ObjectId(), hostelIds: [] }));
    mocks.hostelFindOne.mockReturnValue(chain({ name: "Everest Home" }));

    const refused = assertTeamRegistrationIsNew(input({ name: "Annapurna Hostel" }));

    await expect(refused).rejects.toMatchObject({
      errorCode: "OWNER_EMAIL_IN_USE",
      status: 409,
    });
    await expect(refused).rejects.toThrow(/Everest Home/);
  });

  it("cannot be ticked past — the email itself is unusable", async () => {
    mocks.userFindOne.mockReturnValue(chain({ _id: new Types.ObjectId(), hostelIds: [] }));
    mocks.hostelFindOne.mockReturnValue(chain({ name: "Everest Home" }));

    await expect(
      assertTeamRegistrationIsNew(
        input({ confirmSecondHostel: true, name: "Annapurna Hostel" }),
      ),
    ).rejects.toMatchObject({ errorCode: "OWNER_EMAIL_IN_USE" });
  });

  it("is free when nothing live uses it", async () => {
    await expect(findHostelUsingEmail("new@example.com")).resolves.toBeNull();
  });

  it("counts a hostel whose own contact address it is", async () => {
    mocks.hostelFindOne.mockReturnValue(chain({ name: "Everest Home" }));

    await expect(findHostelUsingEmail("desk@everest.com")).resolves.toBe("Everest Home");
  });

  it("counts the hostels a warden or cook staffs", async () => {
    const hostelId = new Types.ObjectId();
    mocks.userFindOne.mockReturnValue(
      chain({ _id: new Types.ObjectId(), hostelIds: [hostelId], role: "WARDEN" }),
    );

    await findHostelUsingEmail("warden@example.com");

    expect(mocks.hostelFindOne.mock.calls[0][0].$or).toContainEqual({ _id: { $in: [hostelId] } });
  });

  it("does not name the hostel a resident lives in as the email's owner", async () => {
    const userId = new Types.ObjectId();
    mocks.userFindOne.mockReturnValue(
      chain({ _id: userId, hostelIds: [new Types.ObjectId()], role: "RESIDENT" }),
    );

    await findHostelUsingEmail("resident@example.com");

    const { $or } = mocks.hostelFindOne.mock.calls[0][0];
    expect($or).toHaveLength(2);
    expect($or).toContainEqual({ ownerId: userId });
  });

  it("looks the address up lower-cased", async () => {
    await findHostelUsingEmail("  Owner@Example.COM ");

    expect(mocks.userFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ email: "owner@example.com" }),
    );
  });

  it("only counts live hostels, so an archived one frees its address", async () => {
    await findHostelUsingEmail("owner@example.com");

    expect(mocks.hostelFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ isDeleted: { $ne: true } }),
    );
  });
});
