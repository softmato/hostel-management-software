import { Types } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { paginationMeta, paginationRange } from "@/lib/pagination";
import { REALTIME_TOPIC } from "@/lib/realtime/channels";
import { publishResourceChange } from "@/lib/realtime/server";
import { Role } from "@/lib/roles";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { HostelModel } from "@hostel/db/models/Hostel";
import { ReceiptCounterModel } from "@hostel/db/models/ReceiptCounter";
import { StoreCartModel } from "@hostel/db/models/StoreCart";
import { StoreOrderModel } from "@hostel/db/models/StoreOrder";
import { StoreProductModel } from "@hostel/db/models/StoreProduct";
import { UserModel } from "@hostel/db/models/User";
import { createInAppNotification } from "@/modules/notifications/notification.service";
import { readCart, resolveStoreHostelId } from "@/modules/store/cart.service";
import { StoreServiceError, storeObjectId } from "@/modules/store/catalog.service";
import { getStoreConfig } from "@/modules/store/store-config";
import {
  canBuyerCancelStoreOrder,
  canTransitionStoreOrder,
  OPEN_STORE_ORDER_STATUSES,
  STORE_ORDER_STATUS_LABEL,
  type StoreOrderStatus,
} from "@/modules/store/store-status";
import type {
  platformStoreOrderListQuerySchema,
  storeOrderCancelSchema,
  storeOrderCreateSchema,
  storeOrderListQuerySchema,
  storeOrderStatusSchema,
} from "@/modules/store/store.validation";

/**
 * Placing, reading and moving supply orders.
 *
 * ## Stock is reserved before the order is written, and released if it fails
 *
 * MongoDB gives no multi-document transaction on a standalone server, and this
 * deployment does not guarantee a replica set, so `placeOrder` reserves each
 * product with a **conditional** decrement — `stockQuantity >= quantity` in the
 * filter — and rolls the successful ones back by hand if a later line has run
 * out. That is not as strong as a transaction and it does not need to be: the
 * only failure it has to rule out is two hostels being sold the same last unit,
 * and a conditional `$inc` rules that out on its own.
 *
 * The compensating release is in a `finally`-shaped path rather than a `catch`,
 * because an order that throws *after* reserving would otherwise strand stock
 * that nobody bought.
 */

type CreateInput = z.infer<typeof storeOrderCreateSchema>;
type CancelInput = z.infer<typeof storeOrderCancelSchema>;
type ListQuery = z.infer<typeof storeOrderListQuerySchema>;
type PlatformListQuery = z.infer<typeof platformStoreOrderListQuerySchema>;
type StatusInput = z.infer<typeof storeOrderStatusSchema>;

type OrderItemRecord = {
  imageAssetId?: string;
  imageUrl?: string;
  lineTotal: number;
  name: string;
  productId: Types.ObjectId;
  quantity: number;
  unit?: string;
  unitPrice: number;
};

type OrderRecord = {
  _id: Types.ObjectId;
  cancelledAt?: Date;
  cancelledReason?: string;
  createdAt?: Date;
  delivery: {
    addressLine: string;
    city?: string;
    contactName: string;
    note?: string;
    phone: string;
  };
  deliveredAt?: Date;
  deliveryFee: number;
  hostelId: Types.ObjectId;
  items: OrderItemRecord[];
  orderNumber: string;
  paymentMethod: string;
  paymentStatus: string;
  placedBy: Types.ObjectId;
  status: StoreOrderStatus;
  subtotal: number;
  timeline: { at?: Date; byUserId?: Types.ObjectId; note?: string; status: string }[];
  total: number;
  updatedAt?: Date;
};

/* -------------------------------------------------------------------------- */
/* Placing                                                                    */
/* -------------------------------------------------------------------------- */

export async function placeOrder(
  input: CreateInput,
  principal: ApiPrincipal,
  requestedHostelId?: string,
) {
  await connectToDatabase();

  const hostelId = resolveStoreHostelId(principal, requestedHostelId);
  const config = await getStoreConfig();

  if (!config.isOpen) {
    throw new StoreServiceError(config.closedMessage, "STORE_CLOSED", 409);
  }

  const { cart } = await readCart(hostelId);
  const lines = cart.items.filter((item) => item.quantity > 0);

  if (lines.length === 0) {
    throw new StoreServiceError("Your cart is empty.", "CART_EMPTY", 422);
  }

  /*
   * A line the cart already had to clamp is a line the shopper has not seen the
   * new number for. Refusing here rather than quietly ordering the smaller
   * amount is the difference between "we sent you four" and "you agreed to
   * four" — they have to go back and look.
   */
  const shortfall = cart.items.find((item) => item.quantity < item.requestedQuantity);

  if (shortfall) {
    throw new StoreServiceError(
      `Only ${shortfall.quantity} × ${shortfall.product.name} ${
        shortfall.quantity === 1 ? "is" : "are"
      } available. Update your cart and try again.`,
      "CART_QUANTITY_UNAVAILABLE",
      409,
    );
  }

  if (cart.totals.total > config.maxOrderTotal) {
    throw new StoreServiceError(
      "This order is above the store's single-order limit. Please split it or get in touch.",
      "ORDER_TOTAL_TOO_LARGE",
      422,
    );
  }

  const reserved: { productId: Types.ObjectId; quantity: number }[] = [];
  let placed: OrderRecord | null = null;

  try {
    for (const line of lines) {
      if (!line.product.trackStock) {
        continue;
      }

      const result = await StoreProductModel.updateOne(
        {
          _id: storeObjectId(line.product.id, "product id"),
          stockQuantity: { $gte: line.quantity },
        },
        { $inc: { stockQuantity: -line.quantity } },
      );

      if (result.modifiedCount === 0) {
        throw new StoreServiceError(
          `${line.product.name} sold out while you were checking out.`,
          "PRODUCT_OUT_OF_STOCK",
          409,
        );
      }

      reserved.push({
        productId: storeObjectId(line.product.id, "product id"),
        quantity: line.quantity,
      });
    }

    const orderNumber = await allocateOrderNumber(hostelId);

    placed = (await StoreOrderModel.create({
      delivery: input.delivery,
      deliveryFee: cart.totals.deliveryFee,
      hostelId,
      items: lines.map((line) => ({
        imageAssetId: line.product.images[0]?.assetId ?? "",
        imageUrl: line.product.images[0]?.url ?? "",
        lineTotal: line.lineTotal,
        name: line.product.name,
        productId: storeObjectId(line.product.id, "product id"),
        quantity: line.quantity,
        unit: line.product.unit,
        unitPrice: line.unitPrice,
      })),
      orderNumber,
      paymentMethod: input.paymentMethod,
      paymentStatus: "PENDING",
      placedBy: principal.userId,
      status: "PLACED",
      subtotal: cart.totals.subtotal,
      timeline: [
        { at: new Date(), byUserId: principal.userId, note: "", status: "PLACED" },
      ],
      total: cart.totals.total,
    })) as unknown as OrderRecord;
  } catch (error) {
    await releaseReservations(reserved);

    throw error;
  }

  /*
   * The basket empties only after the order exists. A `clearCart` before the
   * write would lose somebody's whole basket to a failed insert, and there is
   * nothing to reconstruct it from.
   */
  await StoreCartModel.updateOne({ hostelId }, { $set: { items: [] } });

  await Promise.all([
    notifyPlatformOfOrder(placed),
    writeAudit("STORE_ORDER_PLACED", placed, principal),
  ]);

  await publishResourceChange({
    hostelIds: [hostelId.toString()],
    platform: true,
    topics: [REALTIME_TOPIC.STORE],
  });

  return { order: serializeOrder(placed) };
}

/* -------------------------------------------------------------------------- */
/* Reading — the buying hostel                                                */
/* -------------------------------------------------------------------------- */

export async function listOrders(
  query: ListQuery,
  principal: ApiPrincipal,
  requestedHostelId?: string,
) {
  await connectToDatabase();

  const hostelIds = requestedHostelId
    ? [resolveStoreHostelId(principal, requestedHostelId)]
    : principal.hostelIds.map((id) => storeObjectId(id, "hostel id"));

  const filter = { hostelId: { $in: hostelIds }, ...statusFilter(query.status) };
  const { limit, skip } = paginationRange(query);

  const [orders, total, open] = await Promise.all([
    StoreOrderModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<OrderRecord[]>(),
    StoreOrderModel.countDocuments(filter),
    StoreOrderModel.countDocuments({
      hostelId: { $in: hostelIds },
      status: { $in: OPEN_STORE_ORDER_STATUSES },
    }),
  ]);

  return {
    orders: orders.map(serializeOrder),
    pagination: paginationMeta(query, total),
    summary: { open, total },
  };
}

export async function getOrder(orderId: string, principal: ApiPrincipal) {
  await connectToDatabase();

  const order = await StoreOrderModel.findOne({
    _id: storeObjectId(orderId, "order id"),
    /*
     * Scoped in the query, not checked after the read. A `findById` followed by
     * an ownership `if` is one early return away from leaking another hostel's
     * delivery address and phone number, and this collection holds both.
     */
    hostelId: { $in: principal.hostelIds.map((id) => storeObjectId(id, "hostel id")) },
  }).lean<OrderRecord | null>();

  if (!order) {
    throw new StoreServiceError("That order was not found.", "ORDER_NOT_FOUND", 404);
  }

  return { order: serializeOrder(order) };
}

export async function cancelOrder(
  orderId: string,
  input: CancelInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const order = await StoreOrderModel.findOne({
    _id: storeObjectId(orderId, "order id"),
    hostelId: { $in: principal.hostelIds.map((id) => storeObjectId(id, "hostel id")) },
  }).lean<OrderRecord | null>();

  if (!order) {
    throw new StoreServiceError("That order was not found.", "ORDER_NOT_FOUND", 404);
  }

  if (!canBuyerCancelStoreOrder(order.status)) {
    throw new StoreServiceError(
      order.status === "CANCELLED"
        ? "That order is already cancelled."
        : `This order is ${STORE_ORDER_STATUS_LABEL[
            order.status
          ].toLowerCase()} — call us and we will sort it out.`,
      "ORDER_NOT_CANCELLABLE",
      409,
    );
  }

  const updated = await applyStatus(order, "CANCELLED", {
    actorId: principal.userId,
    note: input.reason ?? "Cancelled by the hostel",
  });

  await writeAudit("STORE_ORDER_CANCELLED", updated, principal);
  await publishResourceChange({
    hostelIds: [order.hostelId.toString()],
    platform: true,
    topics: [REALTIME_TOPIC.STORE],
  });

  return { order: serializeOrder(updated) };
}

/* -------------------------------------------------------------------------- */
/* Fulfilment — the platform                                                  */
/* -------------------------------------------------------------------------- */

export async function listAllOrders(query: PlatformListQuery) {
  await connectToDatabase();

  const filter: Record<string, unknown> = { ...statusFilter(query.status) };

  if (query.hostelId) {
    filter.hostelId = storeObjectId(query.hostelId, "hostel id");
  }

  const { limit, skip } = paginationRange(query);

  const [orders, total, open, revenue] = await Promise.all([
    StoreOrderModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<OrderRecord[]>(),
    StoreOrderModel.countDocuments(filter),
    StoreOrderModel.countDocuments({ status: { $in: OPEN_STORE_ORDER_STATUSES } }),
    /*
     * Delivered only. Counting placed-but-undelivered orders as revenue would
     * make the number swing every time something is cancelled, and on cash on
     * delivery the money genuinely does not exist until the courier is handed it.
     */
    StoreOrderModel.aggregate<{ total: number }>([
      { $match: { status: "DELIVERED" } },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]),
  ]);

  const hostels = await hostelNames(orders);

  return {
    orders: orders.map((order) => ({
      ...serializeOrder(order),
      hostelName: hostels.get(order.hostelId.toString()) ?? "",
    })),
    pagination: paginationMeta(query, total),
    summary: { deliveredRevenue: revenue[0]?.total ?? 0, open, total },
  };
}

export async function updateOrderStatus(
  orderId: string,
  input: StatusInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const order = await StoreOrderModel.findById(
    storeObjectId(orderId, "order id"),
  ).lean<OrderRecord | null>();

  if (!order) {
    throw new StoreServiceError("That order was not found.", "ORDER_NOT_FOUND", 404);
  }

  if (!canTransitionStoreOrder(order.status, input.status)) {
    throw new StoreServiceError(
      `An order that is ${STORE_ORDER_STATUS_LABEL[
        order.status
      ].toLowerCase()} cannot move to ${STORE_ORDER_STATUS_LABEL[input.status].toLowerCase()}.`,
      "INVALID_ORDER_TRANSITION",
      409,
    );
  }

  const updated = await applyStatus(order, input.status, {
    actorId: principal.userId,
    note: input.note ?? "",
  });

  await Promise.all([
    notifyHostelOfOrderStatus(updated),
    writeAudit("STORE_ORDER_STATUS_CHANGED", updated, principal),
  ]);

  await publishResourceChange({
    hostelIds: [order.hostelId.toString()],
    platform: true,
    topics: [REALTIME_TOPIC.STORE],
  });

  return { order: serializeOrder(updated) };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The one place a status is written, so the timeline, the terminal timestamps
 * and the payment flag can never be updated by one caller and forgotten by
 * another.
 *
 * Cash on delivery means `DELIVERED` **is** the payment event — there is no
 * separate confirmation, and a `paymentStatus` left `PENDING` on a delivered
 * order would be a permanently wrong figure in the revenue sum.
 */
async function applyStatus(
  order: OrderRecord,
  status: StoreOrderStatus,
  { actorId, note }: { actorId: string; note: string },
) {
  const now = new Date();
  const set: Record<string, unknown> = { status };

  if (status === "DELIVERED") {
    set.deliveredAt = now;
    set.paymentStatus = "PAID";
  }

  if (status === "CANCELLED") {
    set.cancelledAt = now;
    set.cancelledReason = note;
  }

  const updated = (await StoreOrderModel.findOneAndUpdate(
    { _id: order._id },
    {
      $push: { timeline: { at: now, byUserId: actorId, note, status } },
      $set: set,
    },
    { new: true },
  ).lean<OrderRecord | null>())!;

  if (status === "CANCELLED") {
    // Everything that was reserved goes back on the shelf. Products that had
    // `trackStock` off were never decremented, so the guard has to match the
    // one in `placeOrder` rather than blindly incrementing every line.
    await releaseReservations(
      order.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    );
  }

  return updated;
}

/**
 * Puts reserved stock back.
 *
 * `trackStock` is re-read rather than remembered, because a product may have had
 * tracking switched on between the reservation and the release — incrementing a
 * counter that was never decremented would invent stock out of a cancellation.
 */
async function releaseReservations(
  reserved: readonly { productId: Types.ObjectId; quantity: number }[],
) {
  await Promise.all(
    reserved.map(async (row) => {
      try {
        await StoreProductModel.updateOne(
          { _id: row.productId, trackStock: true },
          { $inc: { stockQuantity: row.quantity } },
        );
      } catch {
        // A failed release leaves stock understated, which sells less than it
        // could. Throwing here would instead fail the cancellation the user
        // asked for, which is the worse of the two.
      }
    }),
  );
}

/**
 * `SO-2608-0001-4F2A` — sequence per hostel per month, hostel suffix for global
 * uniqueness.
 *
 * Per hostel rather than one platform-wide run, for the reason `ReceiptCounter`
 * already documents: a global sequence tells every hostel that reads its own
 * order numbers how much the platform sells in a month.
 */
async function allocateOrderNumber(hostelId: Types.ObjectId) {
  const now = new Date();
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const counter = await ReceiptCounterModel.findOneAndUpdate(
    { hostelId, kind: "STORE_ORDER", period },
    { $inc: { sequence: 1 } },
    { new: true, setDefaultsOnInsert: true, upsert: true },
  ).lean<{ sequence: number } | null>();

  const sequence = String(counter?.sequence ?? 1).padStart(4, "0");
  const stamp = `${String(now.getUTCFullYear()).slice(2)}${String(
    now.getUTCMonth() + 1,
  ).padStart(2, "0")}`;

  return `SO-${stamp}-${sequence}-${hostelId.toString().slice(-4).toUpperCase()}`;
}

function statusFilter(status: ListQuery["status"]) {
  if (status === "all") {
    return {};
  }

  if (status === "open") {
    return { status: { $in: OPEN_STORE_ORDER_STATUSES } };
  }

  return { status };
}

function serializeOrder(order: OrderRecord) {
  return {
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
    cancelledReason: order.cancelledReason ?? "",
    canCancel: canBuyerCancelStoreOrder(order.status),
    createdAt: order.createdAt?.toISOString(),
    deliveredAt: order.deliveredAt?.toISOString() ?? null,
    delivery: {
      addressLine: order.delivery.addressLine,
      city: order.delivery.city ?? "",
      contactName: order.delivery.contactName,
      note: order.delivery.note ?? "",
      phone: order.delivery.phone,
    },
    deliveryFee: order.deliveryFee,
    hostelId: order.hostelId.toString(),
    id: order._id.toString(),
    itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
    items: order.items.map((item) => ({
      imageAssetId: item.imageAssetId ?? "",
      imageUrl: item.imageUrl ?? "",
      lineTotal: item.lineTotal,
      name: item.name,
      productId: item.productId.toString(),
      quantity: item.quantity,
      unit: item.unit ?? "piece",
      unitPrice: item.unitPrice,
    })),
    orderNumber: order.orderNumber,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    status: order.status,
    statusLabel: STORE_ORDER_STATUS_LABEL[order.status],
    subtotal: order.subtotal,
    timeline: order.timeline.map((entry) => ({
      at: entry.at?.toISOString(),
      note: entry.note ?? "",
      status: entry.status,
      statusLabel:
        STORE_ORDER_STATUS_LABEL[entry.status as StoreOrderStatus] ?? entry.status,
    })),
    total: order.total,
    updatedAt: order.updatedAt?.toISOString(),
  };
}

export type StoreOrderView = ReturnType<typeof serializeOrder>;

async function hostelNames(orders: readonly OrderRecord[]) {
  const ids = [...new Set(orders.map((order) => order.hostelId.toString()))];

  if (ids.length === 0) {
    return new Map<string, string>();
  }

  const hostels = await HostelModel.find({
    _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
  })
    .select("_id name")
    .lean<{ _id: Types.ObjectId; name: string }[]>();

  return new Map(hostels.map((hostel) => [hostel._id.toString(), hostel.name] as const));
}

/**
 * Somebody has to pack this. Targets SUPERADMIN only — fulfilling a paid order
 * is a commercial job, the same reasoning that keeps a PLATFORM_MODERATOR off
 * the sponsors screen.
 */
async function notifyPlatformOfOrder(order: OrderRecord) {
  try {
    const [staff, hostel] = await Promise.all([
      UserModel.find({ isDeleted: { $ne: true }, role: Role.SUPERADMIN, status: "ACTIVE" })
        .select("_id")
        .lean<{ _id: Types.ObjectId }[]>(),
      HostelModel.findById(order.hostelId).select("name").lean<{ name: string } | null>(),
    ]);

    await Promise.all(
      staff.map((member) =>
        createInAppNotification({
          actionUrl: "/platform/store/orders",
          body: `${hostel?.name ?? "A hostel"} ordered ${order.items.length} ${
            order.items.length === 1 ? "item" : "items"
          } — ${order.orderNumber}.`,
          category: "STORE_ORDER",
          data: { orderId: order._id.toString(), orderNumber: order.orderNumber },
          kind: "ACTION",
          priority: "NORMAL",
          title: "New supply order",
          userId: member._id.toString(),
        }),
      ),
    );
  } catch {
    // An order that was placed successfully must not fail because the bell did.
  }
}

/** Tells the person who placed it that it moved. */
async function notifyHostelOfOrderStatus(order: OrderRecord) {
  try {
    await createInAppNotification({
      actionUrl: `/store/order/${order._id.toString()}`,
      body: `${order.orderNumber} is now ${STORE_ORDER_STATUS_LABEL[
        order.status
      ].toLowerCase()}.`,
      category: "STORE_ORDER",
      data: { orderId: order._id.toString(), status: order.status },
      hostelId: order.hostelId.toString(),
      kind: "NORMAL",
      title: "Supply order update",
      userId: order.placedBy.toString(),
    });
  } catch {
    // Same rule as above: the status change is the thing that had to succeed.
  }
}

async function writeAudit(action: string, order: OrderRecord, principal: ApiPrincipal) {
  try {
    await AuditLogModel.create({
      action,
      actorId: principal.userId,
      entityId: order._id.toString(),
      entityType: "StoreOrder",
      hostelId: order.hostelId,
      metadata: {
        orderNumber: order.orderNumber,
        status: order.status,
        total: order.total,
      },
    });
  } catch {
    // Money changing hands is worth logging and never worth failing the order.
  }
}

/* -------------------------------------------------------------------------- */
/* Checkout                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Everything the checkout screen needs, in one request: the priced basket and a
 * delivery address already filled in.
 *
 * The suggestion comes from the **last order** first and the hostel record
 * second. A hostel's registered address is where the business is licensed; the
 * gate a delivery should arrive at is whatever worked last time, and asking
 * somebody to retype it every month is how a form gets abandoned.
 */
export async function getCheckout(principal: ApiPrincipal, requestedHostelId?: string) {
  await connectToDatabase();

  const hostelId = resolveStoreHostelId(principal, requestedHostelId);

  const [{ cart }, config, previous, hostel, user] = await Promise.all([
    readCart(hostelId),
    getStoreConfig(),
    StoreOrderModel.findOne({ hostelId })
      .sort({ createdAt: -1 })
      .select("delivery")
      .lean<{ delivery: OrderRecord["delivery"] } | null>(),
    HostelModel.findById(hostelId)
      .select("name location contact")
      .lean<{
        contact?: { phone?: string };
        location?: { address?: string; area?: string; city?: string };
        name: string;
      } | null>(),
    UserModel.findById(principal.userId)
      .select("name phone")
      .lean<{ name?: string; phone?: string } | null>(),
  ]);

  return {
    cart,
    delivery: {
      addressLine:
        previous?.delivery.addressLine ??
        [hostel?.location?.address, hostel?.location?.area].filter(Boolean).join(", "),
      city: previous?.delivery.city ?? hostel?.location?.city ?? "",
      contactName: previous?.delivery.contactName ?? user?.name ?? hostel?.name ?? "",
      note: "",
      phone: previous?.delivery.phone ?? hostel?.contact?.phone ?? user?.phone ?? "",
    },
    deliveryEstimate: config.deliveryEstimate,
    /** One member today, sent as a list so the phone renders a picker, not an `if`. */
    paymentMethods: [
      {
        available: true,
        description: "Pay the courier when the order arrives.",
        id: "COD" as const,
        label: "Cash on delivery",
      },
    ],
  };
}
