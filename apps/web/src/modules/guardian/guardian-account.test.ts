import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const mocks = vi.hoisted(() => ({
  accessExists: vi.fn(),
  userUpdateOne: vi.fn(),
}));

vi.mock("@hostel/db/models/GuardianAccess", () => ({
  GuardianAccessModel: { exists: mocks.accessExists },
}));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: { updateOne: mocks.userUpdateOne },
}));

import { releaseGuardianAccounts } from "@/modules/guardian/guardian-account";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");
const userId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a2");

// `exists` is asked twice per account: once scoped to this hostel, once not.
function linked({ anywhere, here }: { anywhere: boolean; here: boolean }) {
  mocks.accessExists.mockImplementation((filter: { hostelId?: unknown }) =>
    Promise.resolve((filter.hostelId ? here : anywhere) ? { _id: new Types.ObjectId() } : null),
  );
}

describe("releasing guardian accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hands a guardian with no ward left back a public account", async () => {
    linked({ anywhere: false, here: false });

    await releaseGuardianAccounts([userId], hostelId);

    expect(mocks.userUpdateOne).toHaveBeenCalledWith(
      { _id: userId, isDeleted: { $ne: true }, role: Role.GUARDIAN },
      { $pull: { hostelIds: hostelId }, $set: { role: Role.PUBLIC } },
    );
  });

  it("drops only this hostel for a guardian still linked elsewhere", async () => {
    linked({ anywhere: true, here: false });

    await releaseGuardianAccounts([userId], hostelId);

    expect(mocks.userUpdateOne).toHaveBeenCalledWith(expect.anything(), {
      $pull: { hostelIds: hostelId },
    });
  });

  it("leaves a guardian with another ward in this hostel alone", async () => {
    linked({ anywhere: true, here: true });

    await releaseGuardianAccounts([userId], hostelId);

    expect(mocks.userUpdateOne).not.toHaveBeenCalled();
  });

  it("skips unclaimed invitations, which have no account behind them", async () => {
    await releaseGuardianAccounts([null, undefined], hostelId);

    expect(mocks.accessExists).not.toHaveBeenCalled();
    expect(mocks.userUpdateOne).not.toHaveBeenCalled();
  });
});
