import { Types } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { assertHostelAccess } from "@/lib/tenant";
import { StoreCartModel } from "@hostel/db/models/StoreCart";
import { StoreProductModel } from "@hostel/db/models/StoreProduct";
import {
  StoreServiceError,
  serializeStoreProduct,
  storeObjectId,
  type StoreProductRecord,
} from "@/modules/store/catalog.service";
import { getStoreConfig } from "@/modules/store/store-config";
import { cartTotals, clampQuantity, lineTotal } from "@/modules/store/store-pricing";
import type {
  storeCartAddSchema,
  storeCartItemUpdateSchema,
} from "@/modules/store/store.validation";

/**
 * The hostel's basket.
 *
 * ## Prices are quoted, never stored
 *
 * Every read here joins the cart's product ids to the live catalogue and prices
 * from that. The cart document holds quantities and nothing else — see
 * `StoreCart`'s own note — so there is no path by which a basket can show a
 * price the checkout will not honour.
 *
 * ## A stale line is dropped, and the caller is told which
 *
 * Products get delisted while a basket sits open. Rather than 404 the whole
 * cart or silently show four items where there were five, the read prunes the
 * dead lines from the document and returns them in `removed`, so the screen can
 * say "Air Pro Sneakers is no longer available" instead of leaving somebody to
 * notice their total changed.
 */

type AddInput = z.infer<typeof storeCartAddSchema>;
type UpdateInput = z.infer<typeof storeCartItemUpdateSchema>;

type CartItemRecord = {
  addedAt?: Date;
  productId: Types.ObjectId;
  quantity: number;
};

type CartRecord = {
  _id: Types.ObjectId;
  hostelId: Types.ObjectId;
  items: CartItemRecord[];
  updatedAt?: Date;
};

/**
 * Which hostel is shopping.
 *
 * Same shape as `notice.service.ts`'s resolver, and for the same reason: an
 * owner with two hostels has two baskets, and guessing which one they meant
 * would put an order on the wrong address. One hostel, no argument needed; two,
 * and the caller has to say.
 */
export function resolveStoreHostelId(principal: ApiPrincipal, requestedHostelId?: string) {
  if (requestedHostelId) {
    assertHostelAccess(principal, requestedHostelId);

    return storeObjectId(requestedHostelId, "hostel id");
  }

  if (principal.hostelIds.length === 1) {
    return storeObjectId(principal.hostelIds[0], "hostel id");
  }

  throw new StoreServiceError(
    "Choose which hostel this order is for.",
    "HOSTEL_SCOPE_REQUIRED",
    422,
  );
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function getCart(principal: ApiPrincipal, requestedHostelId?: string) {
  await connectToDatabase();

  const hostelId = resolveStoreHostelId(principal, requestedHostelId);

  return readCart(hostelId);
}

/**
 * The badge on the Cart tab, on its own.
 *
 * A separate, deliberately tiny read: the tab bar wants one integer on every
 * screen in the store, and having it call the full cart would join the whole
 * catalogue to draw a number in a circle.
 */
export async function getCartCount(principal: ApiPrincipal, requestedHostelId?: string) {
  await connectToDatabase();

  const hostelId = resolveStoreHostelId(principal, requestedHostelId);
  const cart = await StoreCartModel.findOne({ hostelId }).lean<CartRecord | null>();
  const itemCount = (cart?.items ?? []).reduce((sum, item) => sum + item.quantity, 0);

  return { itemCount, lineCount: cart?.items.length ?? 0 };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export async function addToCart(
  input: AddInput,
  principal: ApiPrincipal,
  requestedHostelId?: string,
) {
  await connectToDatabase();

  const hostelId = resolveStoreHostelId(principal, requestedHostelId);
  const config = await getStoreConfig();

  if (!config.isOpen) {
    throw new StoreServiceError(config.closedMessage, "STORE_CLOSED", 409);
  }

  const product = await liveProduct(input.productId);
  /*
   * `new: true` with `upsert` always returns a document, but Mongoose types the
   * result as nullable regardless. The non-null assertion is the honest form
   * here - an `if (!cart) throw` would be dead code guarding a case the driver
   * cannot produce.
   */
  const cart = (await StoreCartModel.findOneAndUpdate(
    { hostelId },
    { $setOnInsert: { hostelId, items: [] } },
    { new: true, setDefaultsOnInsert: true, upsert: true },
  ).lean<CartRecord | null>())!;

  const existing = cart.items.find((item) => item.productId.equals(product._id));
  /*
   * Additive, not absolute — `storeCartAddSchema` explains why. The clamp runs
   * on the *sum*, so tapping "Add" five times on a product with three in stock
   * lands on three rather than on fifteen and a refusal at checkout.
   */
  const { quantity, reason } = clampQuantity((existing?.quantity ?? 0) + input.quantity, {
    maxOrderQuantity: product.maxOrderQuantity ?? 0,
    minOrderQuantity: product.minOrderQuantity ?? 1,
    stockQuantity: product.trackStock ? product.stockQuantity : null,
  });

  if (quantity === 0) {
    throw new StoreServiceError(
      `${product.name} is out of stock.`,
      "PRODUCT_OUT_OF_STOCK",
      409,
    );
  }

  if (existing) {
    await StoreCartModel.updateOne(
      { _id: cart._id, "items.productId": product._id },
      { $set: { "items.$.quantity": quantity, updatedBy: principal.userId } },
    );
  } else {
    await StoreCartModel.updateOne(
      { _id: cart._id },
      {
        $push: { items: { addedAt: new Date(), productId: product._id, quantity } },
        $set: { updatedBy: principal.userId },
      },
    );
  }

  return { ...(await readCart(hostelId)), clamped: reason === "none" ? null : reason };
}

/** Absolute quantity. `0` removes the line — see `storeCartItemUpdateSchema`. */
export async function updateCartItem(
  productId: string,
  input: UpdateInput,
  principal: ApiPrincipal,
  requestedHostelId?: string,
) {
  await connectToDatabase();

  const hostelId = resolveStoreHostelId(principal, requestedHostelId);

  if (input.quantity === 0) {
    return removeCartItem(productId, principal, requestedHostelId);
  }

  const product = await liveProduct(productId);
  const { quantity, reason } = clampQuantity(input.quantity, {
    maxOrderQuantity: product.maxOrderQuantity ?? 0,
    minOrderQuantity: product.minOrderQuantity ?? 1,
    stockQuantity: product.trackStock ? product.stockQuantity : null,
  });

  if (quantity === 0) {
    return removeCartItem(productId, principal, requestedHostelId);
  }

  const result = await StoreCartModel.updateOne(
    { hostelId, "items.productId": product._id },
    { $set: { "items.$.quantity": quantity, updatedBy: principal.userId } },
  );

  if (result.matchedCount === 0) {
    throw new StoreServiceError("That item is not in your cart.", "CART_ITEM_NOT_FOUND", 404);
  }

  return { ...(await readCart(hostelId)), clamped: reason === "none" ? null : reason };
}

export async function removeCartItem(
  productId: string,
  principal: ApiPrincipal,
  requestedHostelId?: string,
) {
  await connectToDatabase();

  const hostelId = resolveStoreHostelId(principal, requestedHostelId);

  await StoreCartModel.updateOne(
    { hostelId },
    {
      $pull: { items: { productId: storeObjectId(productId, "product id") } },
      $set: { updatedBy: principal.userId },
    },
  );

  return { ...(await readCart(hostelId)), clamped: null };
}

export async function clearCart(principal: ApiPrincipal, requestedHostelId?: string) {
  await connectToDatabase();

  const hostelId = resolveStoreHostelId(principal, requestedHostelId);

  await StoreCartModel.updateOne(
    { hostelId },
    { $set: { items: [], updatedBy: principal.userId } },
  );

  return { ...(await readCart(hostelId)), clamped: null };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The one read every cart operation returns, so a write and a refresh can never
 * describe the basket differently.
 *
 * Exported to the order service too — placing an order prices the basket
 * through exactly this, rather than through a second join that could disagree.
 */
export async function readCart(hostelId: Types.ObjectId) {
  const [config, cart] = await Promise.all([
    getStoreConfig(),
    StoreCartModel.findOne({ hostelId }).lean<CartRecord | null>(),
  ]);

  const rawItems = cart?.items ?? [];

  if (rawItems.length === 0) {
    return { cart: emptyCart(config), removed: [] as string[] };
  }

  const products = await StoreProductModel.find({
    _id: { $in: rawItems.map((item) => item.productId) },
    isActive: true,
  }).lean<StoreProductRecord[]>();

  const byId = new Map(products.map((product) => [product._id.toString(), product] as const));
  const live: { item: CartItemRecord; product: StoreProductRecord }[] = [];
  const removed: string[] = [];
  const deadIds: Types.ObjectId[] = [];

  for (const item of rawItems) {
    const product = byId.get(item.productId.toString());

    if (product) {
      live.push({ item, product });
    } else {
      removed.push(item.productId.toString());
      deadIds.push(item.productId);
    }
  }

  if (deadIds.length > 0) {
    /*
     * Pruned, but never awaited into the response path: the basket the caller
     * asked for is already correct in memory, and a slow write should not hold
     * up a screen. Worst case the prune runs again on the next read.
     */
    void StoreCartModel.updateOne(
      { hostelId },
      { $pull: { items: { productId: { $in: deadIds } } } },
    ).catch(() => {});
  }

  const lines = live.map(({ item, product }) => {
    /*
     * Re-clamped on read, not only on write. Stock falls while a basket sits
     * open, and a cart quoting ten of something with four left would take the
     * hostel all the way to a checkout that refuses them.
     */
    const { quantity, reason } = clampQuantity(item.quantity, {
      maxOrderQuantity: product.maxOrderQuantity ?? 0,
      minOrderQuantity: product.minOrderQuantity ?? 1,
      stockQuantity: product.trackStock ? product.stockQuantity : null,
    });

    return {
      addedAt: item.addedAt?.toISOString(),
      /** What the row asked for, when that is no longer possible. */
      availableQuantity: quantity,
      lineTotal: lineTotal({ quantity, unitPrice: product.price }),
      limitedBy: reason === "none" ? null : reason,
      product: serializeStoreProduct(product),
      quantity,
      requestedQuantity: item.quantity,
      unitPrice: product.price,
    };
  });

  const buyable = lines.filter((line) => line.quantity > 0);

  return {
    cart: {
      config: publicConfig(config),
      items: lines,
      totals: cartTotals(
        buyable.map((line) => ({ quantity: line.quantity, unitPrice: line.unitPrice })),
        config,
      ),
      updatedAt: cart?.updatedAt?.toISOString(),
    },
    removed,
  };
}

async function liveProduct(productId: string) {
  const product = await StoreProductModel.findOne({
    _id: storeObjectId(productId, "product id"),
    isActive: true,
  }).lean<StoreProductRecord | null>();

  if (!product) {
    throw new StoreServiceError(
      "That product is no longer available.",
      "PRODUCT_NOT_FOUND",
      404,
    );
  }

  return product;
}

type PublicStoreConfig = ReturnType<typeof publicConfig>;

/** The shopper's view of the store config — no `maxOrderTotal`, no internals. */
function publicConfig(config: Awaited<ReturnType<typeof getStoreConfig>>) {
  return {
    closedMessage: config.closedMessage,
    currency: config.currency,
    deliveryEstimate: config.deliveryEstimate,
    deliveryFee: config.deliveryFee,
    freeDeliveryThreshold: config.freeDeliveryThreshold,
    isOpen: config.isOpen,
  };
}

function emptyCart(config: Awaited<ReturnType<typeof getStoreConfig>>): {
  config: PublicStoreConfig;
  items: never[];
  totals: ReturnType<typeof cartTotals>;
  updatedAt?: string;
} {
  return {
    config: publicConfig(config),
    items: [],
    totals: cartTotals([], config),
  };
}
