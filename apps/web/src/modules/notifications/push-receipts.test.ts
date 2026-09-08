import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  deleteMany: vi.fn(),
  find: vi.fn(),
  revokeMany: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/DeviceToken", () => ({
  DeviceTokenModel: { updateMany: mocks.revokeMany },
}));

vi.mock("@hostel/db/models/PushTicket", () => ({
  PushTicketModel: {
    deleteMany: mocks.deleteMany,
    find: mocks.find,
    updateMany: mocks.updateMany,
  },
}));

import { sweepPushReceipts } from "@/modules/notifications/push-receipts.service";

/** `find().select().limit().lean()` — the chain the service actually calls. */
function pendingTickets(rows: { ticketId: string; token: string }[]) {
  mocks.find.mockReturnValue({
    select: () => ({
      limit: () => ({ lean: () => Promise.resolve(rows) }),
    }),
  });
}

function expoRespondsWith(data: Record<string, unknown>) {
  return vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ data }),
    ok: true,
  });
}

/** The exact shape Expo returns when the FCM service account lacks permission. */
const permissionDenied = {
  details: {
    error: "DeveloperError",
    fcm: {
      httpStatus: 403,
      response:
        '{"error":{"code":403,"message":"Permission \'cloudmessaging.messages.create\' denied on resource \'projects/softmato-e65a6\'","status":"PERMISSION_DENIED"}}',
    },
  },
  message: "The request sent to the server was malformed.",
  status: "error",
};

describe("sweepPushReceipts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteMany.mockResolvedValue({ deletedCount: 0 });
    mocks.updateMany.mockResolvedValue({ modifiedCount: 1 });
    mocks.revokeMany.mockResolvedValue({ modifiedCount: 1 });
  });

  it("asks Expo for nothing when no ticket is waiting", async () => {
    pendingTickets([]);
    const fetchMock = expoRespondsWith({});
    vi.stubGlobal("fetch", fetchMock);

    const result = await sweepPushReceipts();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.checked).toBe(0);
  });

  it("counts a delivered receipt and retires its ticket", async () => {
    pendingTickets([{ ticketId: "t-1", token: "ExponentPushToken[a]" }]);
    vi.stubGlobal("fetch", expoRespondsWith({ "t-1": { status: "ok" } }));

    const result = await sweepPushReceipts();

    expect(result).toMatchObject({ checked: 1, delivered: 1, failed: 0, revoked: 0 });
    expect(mocks.updateMany).toHaveBeenCalledWith(
      { ticketId: { $in: ["t-1"] } },
      { $set: { status: "CHECKED" } },
    );
  });

  it("revokes the token behind a DeviceNotRegistered receipt", async () => {
    pendingTickets([{ ticketId: "t-1", token: "ExponentPushToken[dead]" }]);
    vi.stubGlobal(
      "fetch",
      expoRespondsWith({
        "t-1": { details: { error: "DeviceNotRegistered" }, status: "error" },
      }),
    );

    const result = await sweepPushReceipts();

    expect(result).toMatchObject({ failed: 1, revoked: 1 });
    expect(mocks.revokeMany).toHaveBeenCalledWith(
      { token: { $in: ["ExponentPushToken[dead]"] } },
      { $set: { status: "REVOKED" } },
    );
  });

  /**
   * The regression this whole module exists for. Expo accepted the message,
   * FCM refused it, and every previous version of the pipeline reported it as
   * sent. It must be reported loudly — and it must **not** cost the recipient
   * their device token, because nothing is wrong with their phone.
   */
  it("reports an FCM permission failure without revoking a healthy token", async () => {
    pendingTickets([{ ticketId: "t-1", token: "ExponentPushToken[good]" }]);
    vi.stubGlobal("fetch", expoRespondsWith({ "t-1": permissionDenied }));

    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      errors.push(String(line));
    });

    const result = await sweepPushReceipts();

    expect(result).toMatchObject({ checked: 1, delivered: 0, failed: 1, revoked: 0 });
    expect(mocks.revokeMany).not.toHaveBeenCalled();

    const report = errors.find((line) => line.includes("push_transport_misconfigured"));

    expect(report).toBeDefined();
    expect(report).toContain("PERMISSION_DENIED");
    expect(report).toContain("eas credentials");
  });

  it("leaves a ticket Expo stayed silent about pending for the next run", async () => {
    pendingTickets([
      { ticketId: "t-1", token: "ExponentPushToken[a]" },
      { ticketId: "t-2", token: "ExponentPushToken[b]" },
    ]);
    vi.stubGlobal("fetch", expoRespondsWith({ "t-1": { status: "ok" } }));

    await sweepPushReceipts();

    // Only the id Expo answered for is retired; `t-2` is asked again later.
    expect(mocks.updateMany).toHaveBeenCalledWith(
      { ticketId: { $in: ["t-1"] } },
      { $set: { status: "CHECKED" } },
    );
  });
});
