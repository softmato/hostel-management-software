import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  find: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/DeviceToken", () => ({
  DeviceTokenModel: {
    find: mocks.find,
    updateMany: mocks.updateMany,
  },
}));

import { sendPushToUsers } from "@/modules/notifications/push.service";
import { deepLinkForNotification } from "@/modules/notifications/push-routing";

/** `find().select().lean()` — the chain the service actually calls. */
function tokensResolveTo(tokens: string[]) {
  mocks.find.mockReturnValue({
    select: () => ({ lean: () => Promise.resolve(tokens.map((token) => ({ token }))) }),
  });
}

function expoRespondsWith(tickets: unknown[]) {
  return vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ data: tickets }),
    ok: true,
  });
}

const payload = {
  body: "Your rent for Bhadra is due in 3 days.",
  category: "PAYMENT",
  data: { invoiceId: "inv-1" },
  title: "Payment due",
};

describe("sendPushToUsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ modifiedCount: 1 });
  });

  it("does nothing when the user has no registered device", async () => {
    tokensResolveTo([]);
    const fetchMock = expoRespondsWith([]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendPushToUsers(["user-1"], payload);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ revoked: 0, sent: 0, skipped: true });
  });

  it("sends one message per device and carries a server-decided deep link", async () => {
    tokensResolveTo(["ExponentPushToken[a]", "ExponentPushToken[b]"]);
    const fetchMock = expoRespondsWith([{ status: "ok" }, { status: "ok" }]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendPushToUsers(["user-1"], payload);

    expect(result.sent).toBe(2);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);

    expect(body).toHaveLength(2);
    expect(body[0].to).toBe("ExponentPushToken[a]");
    // The tap target is resolved here, not guessed by the app, so an older
    // build still lands on the right screen.
    expect(body[0].data.path).toBe("/(resident)/payments/inv-1");
    expect(body[0].data.category).toBe("PAYMENT");
  });

  it("de-duplicates a token registered twice so one phone buzzes once", async () => {
    tokensResolveTo(["ExponentPushToken[a]", "ExponentPushToken[a]"]);
    const fetchMock = expoRespondsWith([{ status: "ok" }]);
    vi.stubGlobal("fetch", fetchMock);

    await sendPushToUsers(["user-1", "user-1"], payload);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toHaveLength(1);
  });

  it("splits into batches of 100, which is Expo's per-request cap", async () => {
    tokensResolveTo(Array.from({ length: 250 }, (_, index) => `token-${index}`));
    const fetchMock = expoRespondsWith(
      Array.from({ length: 100 }, () => ({ status: "ok" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendPushToUsers(["user-1"], payload);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toHaveLength(100);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toHaveLength(50);
  });

  it("revokes a token Expo reports as unregistered, and only that one", async () => {
    tokensResolveTo(["good-token", "dead-token"]);
    vi.stubGlobal(
      "fetch",
      expoRespondsWith([
        { status: "ok" },
        { details: { error: "DeviceNotRegistered" }, status: "error" },
      ]),
    );

    const result = await sendPushToUsers(["user-1"], payload);

    expect(result.sent).toBe(1);

    const [filter, update] = mocks.updateMany.mock.calls[0];

    expect(filter.token).toEqual({ $in: ["dead-token"] });
    // REVOKED, not deleted — account-purge owns removal, and deleting here
    // would race a re-registration already in flight.
    expect(update.$set.status).toBe("REVOKED");
  });

  it("leaves a token alone when the failure is not DeviceNotRegistered", async () => {
    tokensResolveTo(["token"]);
    vi.stubGlobal(
      "fetch",
      expoRespondsWith([{ details: { error: "MessageRateExceeded" }, status: "error" }]),
    );

    await sendPushToUsers(["user-1"], payload);

    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("swallows an Expo outage rather than failing the request that wrote the row", async () => {
    tokensResolveTo(["token"]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    await expect(sendPushToUsers(["user-1"], payload)).resolves.toEqual({
      revoked: 0,
      sent: 0,
      skipped: false,
    });
  });

  it("routes an SOS to the urgent channel at high priority", async () => {
    tokensResolveTo(["token"]);
    const fetchMock = expoRespondsWith([{ status: "ok" }]);
    vi.stubGlobal("fetch", fetchMock);

    await sendPushToUsers(["user-1"], {
      body: "Anita triggered an SOS alert.",
      category: "SOS",
      title: "SOS alert",
    });

    const [message] = JSON.parse(fetchMock.mock.calls[0][1].body);

    expect(message.channelId).toBe("urgent");
    expect(message.priority).toBe("high");
  });

  it("carries the product picture on an order push", async () => {
    tokensResolveTo(["token"]);
    const fetchMock = expoRespondsWith([{ status: "ok" }]);
    vi.stubGlobal("fetch", fetchMock);

    await sendPushToUsers(["user-1"], {
      body: "3 items · NPR 4,500.00 · arriving today between 4 PM and 7 PM",
      category: "STORE_ORDER",
      data: { orderId: "order-1" },
      imageUrl: "https://cdn.example.com/mattress.jpg",
      title: "Order placed",
    });

    const [message] = JSON.parse(fetchMock.mock.calls[0][1].body);

    expect(message.channelId).toBe("default_v2");
    expect(message.richContent).toEqual({ image: "https://cdn.example.com/mattress.jpg" });
    expect(message.data.path).toBe("/store/order/order-1");
  });
});

describe("deepLinkForNotification", () => {
  it("prefers an explicit actionUrl over the category default", () => {
    expect(
      deepLinkForNotification({ actionUrl: "/(admin)/inquiries/9", category: "PAYMENT" }),
    ).toBe("/(admin)/inquiries/9");
  });

  it("ignores an actionUrl that is not an in-app path", () => {
    // An absolute URL here would be an open redirect handed straight to the
    // router; fall back to the category route instead.
    expect(
      deepLinkForNotification({ actionUrl: "https://evil.example", category: "FOOD" }),
    ).toBe("/(resident)/food");
    // Protocol-relative — looks local, resolves off-origin.
    expect(
      deepLinkForNotification({ actionUrl: "//evil.example", category: "FOOD" }),
    ).toBe("/(resident)/food");
  });

  it("opens the specific record when the payload identifies one", () => {
    expect(
      deepLinkForNotification({ category: "COMPLAINT", data: { complaintId: "c-1" } }),
    ).toBe("/(resident)/more/complaints/c-1");
    expect(deepLinkForNotification({ category: "COMPLAINT" })).toBe(
      "/(resident)/more/complaints",
    );
  });

  it("routes store pushes to mobile store paths", () => {
    expect(
      deepLinkForNotification({
        actionUrl: "/platform/store/orders",
        category: "STORE_ORDER",
        data: { orderId: "order-1" },
      }),
    ).toBe("/store/order/order-1");
  });

  it("falls back to the notification list for an unknown category", () => {
    expect(deepLinkForNotification({ category: "SOMETHING_NEW" })).toBe("/notifications");
  });
});
