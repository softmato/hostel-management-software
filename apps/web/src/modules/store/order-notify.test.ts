import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assetFindById: vi.fn(),
  createInAppNotification: vi.fn(),
  hostelFindById: vi.fn(),
  sendEmail: vi.fn(),
  sendPushToUsers: vi.fn(),
  userFind: vi.fn(),
  userFindById: vi.fn(),
}));

vi.mock("@hostel/db/models/FileAsset", () => ({
  FileAssetModel: { findById: mocks.assetFindById },
}));
vi.mock("@hostel/db/models/User", () => ({
  UserModel: { find: mocks.userFind, findById: mocks.userFindById },
}));
vi.mock("@hostel/db/models/Hostel", () => ({
  HostelModel: { findById: mocks.hostelFindById },
}));
vi.mock("@hostel/shared/email/sender", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/modules/notifications/notification.service", () => ({
  createInAppNotification: mocks.createInAppNotification,
}));
vi.mock("@/modules/notifications/push.service", () => ({
  sendPushToUsers: mocks.sendPushToUsers,
}));

import {
  notifyOrderPlaced,
  notifyOrderStatusEmail,
  type StoreOrderNotificationRecord,
} from "@/modules/store/order.service";

function queryResult<T>(value: T) {
  const query = {
    lean: vi.fn().mockResolvedValue(value),
    select: vi.fn(),
  };
  query.select.mockReturnValue(query);
  return query;
}

const order = {
  _id: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f1"),
  createdAt: new Date("2030-04-10T09:00:00.000Z"),
  delivery: {
    addressLine: "Gate 2",
    contactName: "Asha",
    note: "Call on arrival",
    phone: "9800000000",
  },
  deliveryFee: 0,
  deliveryPromise: "today between 4 PM and 7 PM",
  hostelId: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f2"),
  items: [
    {
      imageAssetId: "",
      imageUrl: "https://cdn.example.com/mattress.jpg",
      lineTotal: 125000,
      name: "Mattress",
      productId: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f3"),
      quantity: 2,
      stockAfterOrder: 4,
      unit: "piece",
      unitPrice: 62500,
    },
  ],
  orderNumber: "SO-2604-0001-00F2",
  paymentMethod: "COD",
  paymentStatus: "PENDING",
  placedBy: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f4"),
  status: "PLACED" as const,
  subtotal: 125000,
  timeline: [],
  total: 125000,
} satisfies StoreOrderNotificationRecord;

describe("store order notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindById.mockReturnValue(
      queryResult({ email: "buyer@example.com", name: "Asha" }),
    );
    mocks.userFind.mockReturnValue(
      queryResult([
        {
          _id: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f5"),
          email: "admin@example.com",
        },
      ]),
    );
    mocks.hostelFindById.mockReturnValue(
      queryResult({ contact: { email: "hostel@example.com" }, name: "Sunrise Hostel" }),
    );
    mocks.createInAppNotification.mockResolvedValue({});
    mocks.sendEmail.mockResolvedValue({ sent: true });
    mocks.sendPushToUsers.mockResolvedValue({ revoked: 0, sent: 0, skipped: true });
  });

  it("addresses buyer and platform with the same stamped promise", async () => {
    await notifyOrderPlaced(order);

    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    expect(mocks.sendEmail.mock.calls.map(([input]) => input.to)).toEqual([
      "buyer@example.com",
      ["admin@example.com"],
    ]);
    for (const [input] of mocks.sendEmail.mock.calls) {
      expect(input.html).toContain("today between 4 PM and 7 PM");
    }

    expect(mocks.sendPushToUsers).toHaveBeenCalledTimes(2);
    expect(mocks.createInAppNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("deliver by today between 4 PM and 7 PM"),
        userId: expect.any(String),
      }),
    );
  });

  it("does not let a throwing mailer fail notification delivery", async () => {
    mocks.sendEmail.mockRejectedValue(new Error("Resend unavailable"));

    await expect(notifyOrderPlaced(order)).resolves.toBeUndefined();
  });

  it("does not email the buyer for PACKED", async () => {
    await notifyOrderStatusEmail({ ...order, status: "PACKED" });

    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("emails the buyer for a status change with the order promise", async () => {
    await notifyOrderStatusEmail({ ...order, status: "CONFIRMED" });

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail.mock.calls[0][0].html).toContain(
      "today between 4 PM and 7 PM",
    );
  });
});
