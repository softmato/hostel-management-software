import { Types } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { paginationMeta, paginationRange } from "@/lib/pagination";
import { REALTIME_TOPIC } from "@/lib/realtime/channels";
import { publishResourceChange } from "@/lib/realtime/server";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { StoreCartModel } from "@hostel/db/models/StoreCart";
import { StoreCategoryModel } from "@hostel/db/models/StoreCategory";
import { StoreOrderModel } from "@hostel/db/models/StoreOrder";
import { StoreProductModel } from "@hostel/db/models/StoreProduct";
import {
  serializeStoreCategory,
  serializeStoreProduct,
  StoreServiceError,
  storeObjectId,
  type StoreCategoryRecord,
  type StoreProductRecord,
} from "@/modules/store/catalog.service";
import type {
  storeCategoryCreateSchema,
  storeCategoryUpdateSchema,
  storeProductCreateSchema,
  storeProductListQuerySchema,
  storeProductUpdateSchema,
} from "@/modules/store/store.validation";

/**
 * The shopkeeper's side: creating and editing the catalogue.
 *
 * Separate from `catalog.service.ts` because the reads there are hard-wired to
 * `isActive: true` and must stay that way. A platform owner needs to see
 * everything, drafts included, and the fastest way to leak a half-written
 * product into a hostel's shop is to add an "include inactive" flag to a
 * function the shop also calls.
 */

type CategoryCreateInput = z.infer<typeof storeCategoryCreateSchema>;
type CategoryUpdateInput = z.infer<typeof storeCategoryUpdateSchema>;
type ProductCreateInput = z.infer<typeof storeProductCreateSchema>;
type ProductUpdateInput = z.infer<typeof storeProductUpdateSchema>;
type ProductListQuery = z.infer<typeof storeProductListQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

export async function listCategoriesForAdmin() {
  await connectToDatabase();

  const categories = await StoreCategoryModel.find({})
    .sort({ priority: -1, name: 1 })
    .lean<StoreCategoryRecord[]>();

  const counts = await StoreProductModel.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $group: { _id: "$categoryId", count: { $sum: 1 } } },
  ]);

  const countByCategory = new Map(
    counts.map((row) => [row._id.toString(), row.count] as const),
  );

  return {
    categories: categories.map((category) => ({
      ...serializeStoreCategory(category),
      productCount: countByCategory.get(category._id.toString()) ?? 0,
    })),
  };
}

export async function createCategory(input: CategoryCreateInput, principal: ApiPrincipal) {
  await connectToDatabase();

  await assertSlugFree(StoreCategoryModel, input.slug, "category");

  const category = (await StoreCategoryModel.create({
    ...input,
    createdBy: principal.userId,
    updatedBy: principal.userId,
  })) as unknown as StoreCategoryRecord;

  await writeAudit("STORE_CATEGORY_CREATED", "StoreCategory", category._id, principal, {
    name: category.name,
  });
  await publishStoreChange();

  return { category: serializeStoreCategory(category) };
}

export async function updateCategory(
  categoryId: string,
  input: CategoryUpdateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const id = storeObjectId(categoryId, "category id");

  if (input.slug) {
    await assertSlugFree(StoreCategoryModel, input.slug, "category", id);
  }

  const category = await StoreCategoryModel.findOneAndUpdate(
    { _id: id },
    { $set: { ...input, updatedBy: principal.userId } },
    { new: true },
  ).lean<StoreCategoryRecord | null>();

  if (!category) {
    throw new StoreServiceError("That category was not found.", "CATEGORY_NOT_FOUND", 404);
  }

  await writeAudit("STORE_CATEGORY_UPDATED", "StoreCategory", category._id, principal, {
    name: category.name,
  });
  await publishStoreChange();

  return { category: serializeStoreCategory(category) };
}

/**
 * Deleting a category is refused while products point at it.
 *
 * The alternative — cascading, or orphaning the products — both end with a shop
 * that cannot render: `serializeStoreProduct` prints an empty category name and
 * the filter grid loses a whole shelf's worth of stock with no way to reach it.
 * Deactivating is the operation somebody actually wants here, and the error says
 * so.
 */
export async function deleteCategory(categoryId: string, principal: ApiPrincipal) {
  await connectToDatabase();

  const id = storeObjectId(categoryId, "category id");
  const inUse = await StoreProductModel.countDocuments({ categoryId: id });

  if (inUse > 0) {
    throw new StoreServiceError(
      `${inUse} ${inUse === 1 ? "product is" : "products are"} still in this category. Move or delete them first, or switch the category off instead.`,
      "CATEGORY_IN_USE",
      409,
    );
  }

  const category = await StoreCategoryModel.findOneAndDelete({
    _id: id,
  }).lean<StoreCategoryRecord | null>();

  if (!category) {
    throw new StoreServiceError("That category was not found.", "CATEGORY_NOT_FOUND", 404);
  }

  await writeAudit("STORE_CATEGORY_DELETED", "StoreCategory", category._id, principal, {
    name: category.name,
  });
  await publishStoreChange();

  return { categoryId };
}

/* -------------------------------------------------------------------------- */
/* Products                                                                   */
/* -------------------------------------------------------------------------- */

export async function listProductsForAdmin(query: ProductListQuery) {
  await connectToDatabase();

  const filter: Record<string, unknown> = {};

  if (query.category) {
    const category = await StoreCategoryModel.findOne({
      slug: query.category.toLowerCase(),
    }).lean<StoreCategoryRecord | null>();

    filter.categoryId = category?._id ?? new Types.ObjectId();
  }

  if (query.search) {
    const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

    filter.$or = [{ name: pattern }, { slug: pattern }, { tags: pattern }];
  }

  const { limit, skip } = paginationRange(query);

  const [products, total, live, categories] = await Promise.all([
    StoreProductModel.find(filter)
      .sort({ priority: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<StoreProductRecord[]>(),
    StoreProductModel.countDocuments(filter),
    StoreProductModel.countDocuments({ isActive: true }),
    StoreCategoryModel.find({}).lean<StoreCategoryRecord[]>(),
  ]);

  const byId = new Map(
    categories.map((category) => [category._id.toString(), category] as const),
  );

  return {
    pagination: paginationMeta(query, total),
    products: products.map((product) => ({
      ...serializeStoreProduct(product, byId.get(product.categoryId.toString())),
      // The shop's serializer hides both, deliberately — an inactive product is
      // simply absent there. The owner's table is the one place they belong.
      isActive: product.isActive,
      stockOnHand: product.stockQuantity,
    })),
    summary: { live, total },
  };
}

export async function createProduct(input: ProductCreateInput, principal: ApiPrincipal) {
  await connectToDatabase();

  await assertSlugFree(StoreProductModel, input.slug, "product");

  const categoryId = storeObjectId(input.categoryId, "category id");
  const category = await StoreCategoryModel.findById(
    categoryId,
  ).lean<StoreCategoryRecord | null>();

  if (!category) {
    throw new StoreServiceError("Choose a category that exists.", "CATEGORY_NOT_FOUND", 422);
  }

  const product = (await StoreProductModel.create({
    ...input,
    categoryId,
    createdBy: principal.userId,
    updatedBy: principal.userId,
  })) as unknown as StoreProductRecord;

  await writeAudit("STORE_PRODUCT_CREATED", "StoreProduct", product._id, principal, {
    name: product.name,
    price: product.price,
  });
  await publishStoreChange();

  return { product: serializeStoreProduct(product, category) };
}

export async function updateProduct(
  productId: string,
  input: ProductUpdateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const id = storeObjectId(productId, "product id");
  const existing = await StoreProductModel.findById(id).lean<StoreProductRecord | null>();

  if (!existing) {
    throw new StoreServiceError("That product was not found.", "PRODUCT_NOT_FOUND", 404);
  }

  if (input.slug) {
    await assertSlugFree(StoreProductModel, input.slug, "product", id);
  }

  /*
   * The cross-field rules the create schema enforces, re-run against the
   * *merged* record — `storeProductUpdateSchema` explains why they cannot live
   * in the schema. A PATCH that only lowers `maxOrderQuantity` still has to be
   * checked against the stored minimum.
   */
  const merged = { ...existing, ...input };

  if (merged.maxOrderQuantity > 0 && merged.maxOrderQuantity < merged.minOrderQuantity) {
    throw new StoreServiceError(
      "The maximum per order cannot be below the minimum.",
      "INVALID_ORDER_LIMITS",
      422,
    );
  }

  if (
    merged.compareAtPrice !== undefined &&
    merged.compareAtPrice !== null &&
    merged.compareAtPrice <= merged.price
  ) {
    throw new StoreServiceError(
      "The struck-through price has to be above the price being charged.",
      "INVALID_COMPARE_PRICE",
      422,
    );
  }

  let categoryId = existing.categoryId;

  if (input.categoryId) {
    categoryId = storeObjectId(input.categoryId, "category id");

    const exists = await StoreCategoryModel.countDocuments({ _id: categoryId });

    if (exists === 0) {
      throw new StoreServiceError("Choose a category that exists.", "CATEGORY_NOT_FOUND", 422);
    }
  }

  /*
   * `null` is how the form clears the struck-through price, and it has to leave
   * `$set` entirely rather than be written as a null.
   *
   * Not tidiness: MongoDB refuses an update that touches one path from both
   * `$set` and `$unset` — "Updating the path 'compareAtPrice' would create a
   * conflict" — so spreading `input` and then adding `$unset` would fail every
   * edit that clears the field.
   */
  const { compareAtPrice, ...rest } = input;
  const clearsComparePrice = compareAtPrice === null;

  const product = (await StoreProductModel.findOneAndUpdate(
    { _id: id },
    {
      $set: {
        ...rest,
        ...(clearsComparePrice ? {} : { compareAtPrice }),
        categoryId,
        updatedBy: principal.userId,
      },
      ...(clearsComparePrice ? { $unset: { compareAtPrice: "" } } : {}),
    },
    { new: true },
  ).lean<StoreProductRecord | null>())!;

  const category = await StoreCategoryModel.findById(
    product.categoryId,
  ).lean<StoreCategoryRecord | null>();

  await writeAudit("STORE_PRODUCT_UPDATED", "StoreProduct", product._id, principal, {
    name: product.name,
    price: product.price,
  });
  await publishStoreChange();

  return { product: serializeStoreProduct(product, category ?? undefined) };
}

/**
 * Deletes the product and pulls it out of every open basket.
 *
 * The cart read already survives a missing product — it prunes and reports —
 * but leaving the rows there means every hostel with one in their basket gets a
 * "no longer available" line for something they never see again. Removing it
 * here means the basket is simply shorter, which is the truth.
 *
 * Placed orders are untouched. They hold a snapshot precisely so that deleting
 * the catalogue entry cannot rewrite what somebody bought.
 */
export async function deleteProduct(productId: string, principal: ApiPrincipal) {
  await connectToDatabase();

  const id = storeObjectId(productId, "product id");
  const product = await StoreProductModel.findOneAndDelete({
    _id: id,
  }).lean<StoreProductRecord | null>();

  if (!product) {
    throw new StoreServiceError("That product was not found.", "PRODUCT_NOT_FOUND", 404);
  }

  await StoreCartModel.updateMany({}, { $pull: { items: { productId: id } } });

  await writeAudit("STORE_PRODUCT_DELETED", "StoreProduct", product._id, principal, {
    name: product.name,
  });
  await publishStoreChange();

  return { productId };
}

/** The shop's headline figures for the platform dashboard card. */
export async function getStoreAdminSummary() {
  await connectToDatabase();

  const [products, live, categories, openOrders, outOfStock] = await Promise.all([
    StoreProductModel.countDocuments({}),
    StoreProductModel.countDocuments({ isActive: true }),
    StoreCategoryModel.countDocuments({}),
    StoreOrderModel.countDocuments({
      status: { $in: ["PLACED", "CONFIRMED", "PACKED", "SHIPPED"] },
    }),
    StoreProductModel.countDocuments({
      isActive: true,
      stockQuantity: { $lte: 0 },
      trackStock: true,
    }),
  ]);

  return { summary: { categories, live, openOrders, outOfStock, products } };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Checked here as well as by the unique index, so the owner gets "that slug is
 * taken" instead of a raw E11000 through `handleRouteError`. The index is still
 * what makes it true under a race; this is only the readable path.
 */
async function assertSlugFree(
  model: { countDocuments: (filter: Record<string, unknown>) => Promise<number> },
  slug: string,
  label: string,
  exceptId?: Types.ObjectId,
) {
  const clash = await model.countDocuments({
    slug,
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  });

  if (clash > 0) {
    throw new StoreServiceError(
      `Another ${label} already uses the handle "${slug}".`,
      "SLUG_TAKEN",
      409,
    );
  }
}

/**
 * A catalogue edit reaches every hostel at once, so this is `global`, not a
 * per-hostel fan-out. There is no list of "hostels currently in the shop" to
 * address, and there should not be one.
 */
async function publishStoreChange() {
  await publishResourceChange({
    global: true,
    platform: true,
    topics: [REALTIME_TOPIC.STORE],
  });
}

async function writeAudit(
  action: string,
  entityType: string,
  entityId: Types.ObjectId,
  principal: ApiPrincipal,
  metadata: Record<string, unknown>,
) {
  try {
    await AuditLogModel.create({
      action,
      actorId: principal.userId,
      entityId: entityId.toString(),
      entityType,
      metadata,
    });
  } catch {
    // The catalogue change is what had to succeed.
  }
}
