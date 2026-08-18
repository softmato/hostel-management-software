import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/DeviceToken", () => ({
  DeviceTokenModel: { updateMany: mocks.updateMany },
}));

import { revokeDeviceToken } from "@/modules/notifications/notification.service";

const principal = { userId: "user-1" } as Parameters<typeof revokeDeviceToken>[1];

/**
 * Sign-out has to stop delivery to the device, and it has to stop delivery to
 * *only* the caller's own device.
 *
 * Before this existed, signing out forgot the push token on the phone and left
 * the `DeviceToken` row ACTIVE against the account that had just left — so that
 * person's invoices, complaint replies and SOS alerts kept arriving on a handset
 * they had signed out of. Nothing pruned it: Expo only reports
 * `DeviceNotRegistered` for a token the app no longer holds, and that token was
 * still perfectly valid.
 */
describe("revokeDeviceToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ modifiedCount: 1 });
  });

  it("revokes the token rather than deleting the row", async () => {
    // REVOKED, not deleted: the row is the record that this device existed, and
    // `account-purge` owns removal. Deleting also races a re-registration that
    // may already be in flight from the next account signing in.
    await revokeDeviceToken({ token: "ExponentPushToken[a]" }, principal);

    expect(mocks.updateMany).toHaveBeenCalledWith(
      { token: "ExponentPushToken[a]", userId: "user-1" },
      { $set: { status: "REVOKED" } },
    );
  });

  it("scopes the update to the caller", async () => {
    // The security half. Push tokens are posted by the client and are not
    // secret, so without `userId` in the filter this route would let anyone who
    // had observed a token silence that person's device — including their SOS
    // alerts.
    await revokeDeviceToken({ token: "ExponentPushToken[b]" }, principal);

    const [filter] = mocks.updateMany.mock.calls[0];

    expect(filter).toHaveProperty("userId", "user-1");
  });

  it("reports success when the token matched nothing", async () => {
    // The caller is signing out. A token that was never registered, or was
    // revoked already, means the desired state holds — failing here would only
    // give sign-out a way to break for a reason nobody can act on.
    mocks.updateMany.mockResolvedValue({ modifiedCount: 0 });

    await expect(
      revokeDeviceToken({ token: "ExponentPushToken[gone]" }, principal),
    ).resolves.toEqual({ revoked: 0 });
  });

  it("treats a driver that reports no count as zero", async () => {
    mocks.updateMany.mockResolvedValue({});

    await expect(
      revokeDeviceToken({ token: "ExponentPushToken[c]" }, principal),
    ).resolves.toEqual({ revoked: 0 });
  });
});
