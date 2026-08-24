"use client";

import { Boxes, PackageX, ShoppingBag, Tags } from "lucide-react";
import { memo, useCallback, useMemo, useState, type FormEvent } from "react";

import { BusyForm, SubmitButton } from "@/app/_components/busy-form";
import { useConfirm } from "@/app/_components/confirm-dialog";
import {
  MetricCard,
  PortalPageHeader,
  SoftBadge,
  TabBar,
  ToggleSwitch,
  ViewAllLink,
} from "@/app/_components/portal-dashboard-ui";
import {
  EmptyState,
  Input,
  LoadingRows,
  Panel,
  Select,
  TextArea,
} from "@/app/_components/shared-ui";
import { browserApi } from "@/lib/browser-api";
import { useInvalidateResources, usePortalResource } from "@/lib/portal-query";
import { Message } from "./core-portal-shared";

const PRODUCTS_ENDPOINT = "/api/v1/platform/store/products";
const CATEGORIES_ENDPOINT = "/api/v1/platform/store/categories";
const CONFIG_ENDPOINT = "/api/v1/platform/store/config";
const SUMMARY_ENDPOINT = "/api/v1/platform/store/summary";

/**
 * Prices cross the wire in **paisa** and are typed in **rupees**.
 *
 * The conversion lives in exactly these two functions and nowhere else, which is
 * the whole reason the API took an integer in the first place — see
 * `store.validation.ts`. A second `* 100` anywhere in this file is a bug waiting
 * for a rounding case.
 */
function toRupees(paisa: number) {
  return paisa / 100;
}

function toPaisa(rupees: number) {
  return Math.round(rupees * 100);
}

function formatPaisa(paisa: number) {
  return new Intl.NumberFormat("en-NP", {
    currency: "NPR",
    maximumFractionDigits: 2,
    style: "currency",
  }).format(toRupees(paisa));
}

type StoreCategory = {
  icon: string;
  id: string;
  imageUrl: string;
  isActive: boolean;
  name: string;
  priority: number;
  productCount: number;
  slug: string;
};

type StoreProduct = {
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  compareAtPrice: number | null;
  description: string;
  id: string;
  images: { assetId: string; url: string }[];
  inStock: boolean;
  isActive: boolean;
  isFeatured: boolean;
  maxOrderQuantity: number;
  minOrderQuantity: number;
  name: string;
  price: number;
  slug: string;
  stockOnHand: number;
  summary: string;
  tags: string[];
  trackStock: boolean;
  unit: string;
};

type StoreSettings = {
  closedMessage: string;
  currency: string;
  deliveryEstimate: string;
  deliveryFee: number;
  freeDeliveryThreshold: number;
  isOpen: boolean;
  maxOrderTotal: number;
  deliverySchedule: {
    cutoffCopy: string;
    eveningArrivalText: string;
    eveningCutoffHour: number;
    morningArrivalText: string;
    morningCutoffHour: number;
    timezone: string;
  };
};

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function number(form: FormData, key: string, fallback = 0) {
  const value = Number(text(form, key));

  return Number.isFinite(value) ? value : fallback;
}

/**
 * A name typed into the form becomes a URL handle when the slug field is blank.
 * Only ever a *default* — an existing product keeps whatever slug it shipped
 * with, because the phone and any shared link filter by it.
 */
function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

/**
 * The supply store's catalogue, as the platform owner sees it.
 *
 * Superadmin only: what the platform sells and for how much is a commercial
 * decision, the same reasoning that keeps a PLATFORM_MODERATOR off `/platform/
 * sponsors` (`route-access.ts`).
 *
 * Three tabs rather than three pages — products, the departments they sit in,
 * and the delivery rules — because editing a product almost always means
 * glancing at the category list, and a page load between the two would make
 * adding a shelf feel like a different job from stocking it. Orders **are** a
 * separate page: fulfilment is a different task done by a different person on a
 * different day.
 */
export const PlatformStorePageContent = memo(function PlatformStorePageContent() {
  const [tab, setTab] = useState<"products" | "categories" | "settings">("products");
  const [message, setMessage] = useState("");
  const [editingProduct, setEditingProduct] = useState<StoreProduct | null>(null);
  const [editingCategory, setEditingCategory] = useState<StoreCategory | null>(null);
  const invalidate = useInvalidateResources();
  const { confirm, confirmDialog } = useConfirm();

  const products = usePortalResource<{
    products: StoreProduct[];
    summary: { live: number; total: number };
  }>(PRODUCTS_ENDPOINT, { errorMessage: "Could not load the catalogue." });

  const categories = usePortalResource<{ categories: StoreCategory[] }>(CATEGORIES_ENDPOINT, {
    errorMessage: "Could not load the categories.",
  });

  const summary = usePortalResource<{
    summary: {
      categories: number;
      live: number;
      openOrders: number;
      outOfStock: number;
      products: number;
    };
  }>(SUMMARY_ENDPOINT, { errorMessage: "Could not load the store summary." });

  const settings = usePortalResource<{ config: StoreSettings }>(CONFIG_ENDPOINT, {
    errorMessage: "Could not load the store settings.",
  });

  const productRows = useMemo(() => products.data?.products ?? [], [products.data]);
  const categoryRows = useMemo(() => categories.data?.categories ?? [], [categories.data]);
  const config = settings.data?.config;

  const refresh = useCallback(() => {
    invalidate(PRODUCTS_ENDPOINT);
    invalidate(CATEGORIES_ENDPOINT);
    invalidate(SUMMARY_ENDPOINT);
  }, [invalidate]);

  /* ------------------------------------------------------------------ products */

  const saveProduct = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const formElement = event.currentTarget;
      const form = new FormData(formElement);
      const name = text(form, "name");
      const compareAtRupees = text(form, "compareAtPrice");

      const payload = {
        categoryId: text(form, "categoryId"),
        // `null` clears it; `undefined` on a create simply omits it.
        compareAtPrice: compareAtRupees
          ? toPaisa(Number(compareAtRupees))
          : editingProduct
            ? null
            : undefined,
        description: text(form, "description"),
        images: text(form, "imageUrl") ? [{ url: text(form, "imageUrl") }] : [],
        isFeatured: form.get("isFeatured") === "on",
        maxOrderQuantity: number(form, "maxOrderQuantity"),
        minOrderQuantity: Math.max(number(form, "minOrderQuantity", 1), 1),
        name,
        price: toPaisa(number(form, "price")),
        priority: number(form, "priority"),
        slug: text(form, "slug") || slugify(name),
        stockQuantity: number(form, "stockQuantity"),
        summary: text(form, "summary"),
        tags: text(form, "tags")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        trackStock: form.get("trackStock") === "on",
        unit: text(form, "unit") || "piece",
      };

      try {
        await browserApi(
          editingProduct ? `${PRODUCTS_ENDPOINT}/${editingProduct.id}` : PRODUCTS_ENDPOINT,
          { body: JSON.stringify(payload), method: editingProduct ? "PATCH" : "POST" },
        );
        formElement.reset();
        setEditingProduct(null);
        setMessage(editingProduct ? "Product updated." : "Product added.");
        refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not save the product.");
      }
    },
    [editingProduct, refresh],
  );

  const toggleProduct = useCallback(
    async (product: StoreProduct) => {
      try {
        await browserApi(`${PRODUCTS_ENDPOINT}/${product.id}`, {
          body: JSON.stringify({ isActive: !product.isActive }),
          method: "PATCH",
        });
        setMessage(product.isActive ? "Product hidden from the shop." : "Product is live.");
        refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not update.");
      }
    },
    [refresh],
  );

  const removeProduct = useCallback(
    async (product: StoreProduct) => {
      const confirmed = await confirm({
        actionLabel: "Delete product",
        description: `"${product.name}" leaves the shop and is pulled out of every hostel's open cart. Orders already placed keep their own copy and are unaffected.`,
        title: "Delete this product?",
        tone: "destructive",
      });

      if (!confirmed) {
        return;
      }

      try {
        await browserApi(`${PRODUCTS_ENDPOINT}/${product.id}`, { method: "DELETE" });
        setMessage("Product deleted.");
        refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not delete.");
      }
    },
    [confirm, refresh],
  );

  /* ---------------------------------------------------------------- categories */

  const saveCategory = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const formElement = event.currentTarget;
      const form = new FormData(formElement);
      const name = text(form, "name");
      const payload = {
        icon: text(form, "icon") || "cube-outline",
        imageUrl: text(form, "imageUrl"),
        name,
        priority: number(form, "priority"),
        slug: text(form, "slug") || slugify(name),
      };

      try {
        await browserApi(
          editingCategory
            ? `${CATEGORIES_ENDPOINT}/${editingCategory.id}`
            : CATEGORIES_ENDPOINT,
          { body: JSON.stringify(payload), method: editingCategory ? "PATCH" : "POST" },
        );
        formElement.reset();
        setEditingCategory(null);
        setMessage(editingCategory ? "Category updated." : "Category added.");
        refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not save the category.");
      }
    },
    [editingCategory, refresh],
  );

  const removeCategory = useCallback(
    async (category: StoreCategory) => {
      const confirmed = await confirm({
        actionLabel: "Delete category",
        description: `"${category.name}" is removed from the shop's grid. Categories that still hold products cannot be deleted — switch them off instead.`,
        title: "Delete this category?",
        tone: "destructive",
      });

      if (!confirmed) {
        return;
      }

      try {
        await browserApi(`${CATEGORIES_ENDPOINT}/${category.id}`, { method: "DELETE" });
        setMessage("Category deleted.");
        refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not delete.");
      }
    },
    [confirm, refresh],
  );

  /* ------------------------------------------------------------------ settings */

  const patchSettings = useCallback(
    async (patch: Partial<StoreSettings>) => {
      try {
        await browserApi(CONFIG_ENDPOINT, {
          body: JSON.stringify(patch),
          method: "PATCH",
        });
        setMessage("Store settings saved.");
        invalidate(CONFIG_ENDPOINT);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not save the settings.");
      }
    },
    [invalidate],
  );

  const saveSettings = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const form = new FormData(event.currentTarget);

      await patchSettings({
        closedMessage: text(form, "closedMessage"),
        deliveryEstimate: text(form, "deliveryEstimate"),
        deliveryFee: toPaisa(number(form, "deliveryFee")),
        freeDeliveryThreshold: toPaisa(number(form, "freeDeliveryThreshold")),
        maxOrderTotal: toPaisa(number(form, "maxOrderTotal")),
        deliverySchedule: {
          eveningArrivalText: text(form, "eveningArrivalText"),
          eveningCutoffHour: number(form, "eveningCutoffHour", 16),
          morningArrivalText: text(form, "morningArrivalText"),
          morningCutoffHour: number(form, "morningCutoffHour", 10),
          timezone: config?.deliverySchedule.timezone ?? "Asia/Kathmandu",
          cutoffCopy: config?.deliverySchedule.cutoffCopy ?? "",
        },
      });
    },
    [config, patchSettings],
  );

  const counts = summary.data?.summary;

  return (
    <div className="mx-auto max-w-[1448px] space-y-5">
      {confirmDialog}
      <PortalPageHeader
        description="The supply catalogue every hostel orders from — products, the departments they sit in, and what delivery costs."
        title="Supply Store"
      />
      <Message value={message || products.message} />

      {counts ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={ShoppingBag}
            label="Live products"
            tone="green"
            value={counts.live}
          />
          <MetricCard icon={Boxes} label="Total products" value={counts.products} />
          <MetricCard icon={Tags} label="Categories" value={counts.categories} />
          <MetricCard
            icon={PackageX}
            label="Out of stock"
            tone={counts.outOfStock > 0 ? "amber" : "slate"}
            value={counts.outOfStock}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabBar
          onChange={(key) => setTab(key as typeof tab)}
          tabs={[
            { key: "products", label: "Products" },
            { key: "categories", label: "Categories" },
            { key: "settings", label: "Delivery & fees" },
          ]}
          tone="platform"
          value={tab}
        />
        <ViewAllLink
          href="/platform/store/orders"
          label={
            counts?.openOrders
              ? `${counts.openOrders} order${counts.openOrders === 1 ? "" : "s"} to fulfil`
              : "Orders"
          }
        />
      </div>

      {tab === "products" ? (
        <div className="grid gap-5 xl:grid-cols-[1fr_400px]">
          <Panel title="Catalogue">
            {products.state === "loading" ? <LoadingRows /> : null}
            {products.state === "ready" && productRows.length === 0 ? (
              <EmptyState label="Nothing in the shop yet. Add a category first, then a product." />
            ) : null}

            <div className="space-y-3">
              {productRows.map((product) => (
                <div className="rounded-lg border border-border p-4" key={product.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 gap-3">
                      {product.images[0]?.url ? (
                        /* A catalogue thumbnail from whatever host the supplier
                           gave us. `next/image` would need every one of those
                           hosts added to `remotePatterns`, which turns adding a
                           product into a deploy. */
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          alt=""
                          className="size-12 shrink-0 rounded-lg object-cover"
                          src={product.images[0].url}
                        />
                      ) : (
                        <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                          <ShoppingBag className="size-5" />
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">
                          {product.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {product.categoryName || "No category"} · per {product.unit}
                          {product.summary ? ` · ${product.summary}` : ""}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {formatPaisa(product.price)}
                          {product.compareAtPrice
                            ? ` (was ${formatPaisa(product.compareAtPrice)})`
                            : ""}
                          {product.trackStock
                            ? ` · ${product.stockOnHand} in stock`
                            : " · stock not tracked"}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {product.images.length === 0 ? (
                        <SoftBadge tone="amber">No photo</SoftBadge>
                      ) : null}
                      {product.isFeatured ? (
                        <SoftBadge tone="amber">Featured</SoftBadge>
                      ) : null}
                      <SoftBadge tone={product.isActive ? "green" : "slate"}>
                        {product.isActive ? "Live" : "Hidden"}
                      </SoftBadge>
                      {product.trackStock && product.stockOnHand <= 0 ? (
                        <SoftBadge tone="rose">Out of stock</SoftBadge>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted"
                      onClick={() => setEditingProduct(product)}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted"
                      onClick={() => void toggleProduct(product)}
                      type="button"
                    >
                      {product.isActive ? "Hide" : "Make live"}
                    </button>
                    <button
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/10"
                      onClick={() => void removeProduct(product)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title={editingProduct ? `Edit ${editingProduct.name}` : "New product"}>
            {categoryRows.length === 0 ? (
              <EmptyState label="Add a category before adding products — every product needs one." />
            ) : (
              // Keyed on the product so switching which one is being edited
              // remounts the fields with that product's values.
              <BusyForm
                className="grid gap-3"
                key={editingProduct?.id ?? "new"}
                onSubmit={saveProduct}
              >
                <Input
                  defaultValue={editingProduct?.name}
                  label="Name"
                  name="name"
                  placeholder="Cotton mattress, 3 inch"
                  required
                />
                <Select
                  defaultValue={editingProduct?.categoryId ?? categoryRows[0]?.id}
                  label="Category"
                  name="categoryId"
                >
                  {categoryRows.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
                <Input
                  defaultValue={editingProduct?.summary}
                  hint="The one line under the name in a list. Keep it factual."
                  label="Summary"
                  name="summary"
                  placeholder="Single bed, cotton filled"
                />
                <TextArea
                  defaultValue={editingProduct?.description}
                  label="Description"
                  name="description"
                  placeholder="What it is, what it is made of, what it fits."
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    defaultValue={
                      editingProduct ? toRupees(editingProduct.price) : undefined
                    }
                    label="Price (NPR)"
                    min="0"
                    name="price"
                    required
                    step="0.01"
                    type="number"
                  />
                  <Input
                    defaultValue={
                      editingProduct?.compareAtPrice
                        ? toRupees(editingProduct.compareAtPrice)
                        : undefined
                    }
                    hint="Optional struck-through price. Must be above the price charged."
                    label="Was (NPR)"
                    min="0"
                    name="compareAtPrice"
                    step="0.01"
                    type="number"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    defaultValue={editingProduct?.unit ?? "piece"}
                    hint="What one unit is — piece, kg, dozen."
                    label="Unit"
                    name="unit"
                  />
                  <Input
                    defaultValue={editingProduct?.stockOnHand ?? 0}
                    label="Stock on hand"
                    min="0"
                    name="stockQuantity"
                    type="number"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    defaultValue={editingProduct?.minOrderQuantity ?? 1}
                    label="Minimum per order"
                    min="1"
                    name="minOrderQuantity"
                    type="number"
                  />
                  <Input
                    defaultValue={editingProduct?.maxOrderQuantity ?? 0}
                    hint="0 means no cap."
                    label="Maximum per order"
                    min="0"
                    name="maxOrderQuantity"
                    type="number"
                  />
                </div>
                <Input
                  defaultValue={editingProduct?.images[0]?.url}
                  hint="Shown as the thumbnail and on the product screen."
                  label="Image URL"
                  name="imageUrl"
                  placeholder="https://…"
                />
                <Input
                  defaultValue={editingProduct?.tags.join(", ")}
                  hint="Comma separated. These are what the shop's search box matches."
                  label="Search tags"
                  name="tags"
                  placeholder="mattress, gaddi, bed"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    defaultValue={editingProduct?.slug}
                    hint="Leave blank to build one from the name. Changing it breaks old links."
                    label="Handle"
                    name="slug"
                  />
                  <Input
                    defaultValue={0}
                    hint="Higher shows first."
                    label="Priority"
                    name="priority"
                    type="number"
                  />
                </div>

                <label className="flex items-center gap-2 text-[12.5px] font-semibold text-foreground">
                  <input
                    defaultChecked={editingProduct?.trackStock ?? true}
                    name="trackStock"
                    type="checkbox"
                  />
                  Track stock — refuse orders once it runs out
                </label>
                <label className="flex items-center gap-2 text-[12.5px] font-semibold text-foreground">
                  <input
                    defaultChecked={editingProduct?.isFeatured ?? false}
                    name="isFeatured"
                    type="checkbox"
                  />
                  Feature on the shop&apos;s front screen
                </label>

                <div className="flex gap-2">
                  <SubmitButton className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-role-platform text-sm font-semibold text-white">
                    {editingProduct ? "Save changes" : "Add product"}
                  </SubmitButton>
                  {editingProduct ? (
                    <button
                      className="h-11 rounded-md border border-border px-4 text-sm font-semibold text-foreground"
                      onClick={() => setEditingProduct(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </BusyForm>
            )}
          </Panel>
        </div>
      ) : null}

      {tab === "categories" ? (
        <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
          <Panel title="Departments">
            {categories.state === "loading" ? <LoadingRows /> : null}
            {categories.state === "ready" && categoryRows.length === 0 ? (
              <EmptyState label="No categories yet. Create one on the right." />
            ) : null}

            <div className="space-y-3">
              {categoryRows.map((category) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4"
                  key={category.id}
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">{category.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {category.slug} · {category.productCount}{" "}
                      {category.productCount === 1 ? "product" : "products"} · glyph{" "}
                      {category.icon}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <SoftBadge tone={category.isActive ? "green" : "slate"}>
                      {category.isActive ? "Live" : "Hidden"}
                    </SoftBadge>
                    <button
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted"
                      onClick={() => setEditingCategory(category)}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/10"
                      onClick={() => void removeCategory(category)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title={editingCategory ? `Edit ${editingCategory.name}` : "New category"}>
            <BusyForm
              className="grid gap-3"
              key={editingCategory?.id ?? "new"}
              onSubmit={saveCategory}
            >
              <Input
                defaultValue={editingCategory?.name}
                label="Name"
                name="name"
                placeholder="Bedding"
                required
              />
              <Input
                defaultValue={editingCategory?.slug}
                hint="Leave blank to build one from the name. The app filters by this."
                label="Handle"
                name="slug"
              />
              <Input
                defaultValue={editingCategory?.icon ?? "bed-outline"}
                hint="An Ionicons name — bed-outline, water-outline, restaurant-outline."
                label="Icon"
                name="icon"
              />
              <Input
                defaultValue={editingCategory?.imageUrl}
                hint="Optional photograph for the tile. The icon is used when blank."
                label="Image URL"
                name="imageUrl"
                placeholder="https://…"
              />
              <Input
                defaultValue={editingCategory?.priority ?? 0}
                hint="Higher shows first in the shop's grid."
                label="Priority"
                name="priority"
                type="number"
              />

              <div className="flex gap-2">
                <SubmitButton className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-role-platform text-sm font-semibold text-white">
                  {editingCategory ? "Save changes" : "Add category"}
                </SubmitButton>
                {editingCategory ? (
                  <button
                    className="h-11 rounded-md border border-border px-4 text-sm font-semibold text-foreground"
                    onClick={() => setEditingCategory(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </BusyForm>
          </Panel>
        </div>
      ) : null}

      {tab === "settings" ? (
        <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
          <Panel title="Delivery and fees">
            {settings.state === "loading" || !config ? (
              <LoadingRows />
            ) : (
              <BusyForm className="grid max-w-xl gap-3" onSubmit={saveSettings}>
                <Input
                  defaultValue={toRupees(config.deliveryFee)}
                  hint="Charged on every order that misses the free-delivery threshold."
                  label="Delivery fee (NPR)"
                  min="0"
                  name="deliveryFee"
                  step="0.01"
                  type="number"
                />
                <Input
                  defaultValue={toRupees(config.freeDeliveryThreshold)}
                  hint="Spend this much and delivery is free. Set 0 to turn the rule off entirely — it does not make delivery free."
                  label="Free delivery over (NPR)"
                  min="0"
                  name="freeDeliveryThreshold"
                  step="0.01"
                  type="number"
                />
                <Input
                  defaultValue={config.deliveryEstimate}
                  hint="Printed under the total at checkout."
                  label="Delivery estimate"
                  name="deliveryEstimate"
                />
                <DeliveryWindowFields schedule={config.deliverySchedule} />
                <Input
                  defaultValue={toRupees(config.maxOrderTotal)}
                  hint="A guard against a mistyped quantity. Orders above this are refused."
                  label="Single-order limit (NPR)"
                  min="0"
                  name="maxOrderTotal"
                  step="0.01"
                  type="number"
                />
                <Input
                  defaultValue={config.closedMessage}
                  hint="Shown in the app when the store is closed."
                  label="Closed message"
                  name="closedMessage"
                />

                <SubmitButton className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-role-platform text-sm font-semibold text-white">
                  Save settings
                </SubmitButton>
              </BusyForm>
            )}
          </Panel>

          <Panel title="Shop status">
            {config ? (
              <ToggleSwitch
                checked={config.isOpen}
                description="Closing keeps the catalogue intact and stops new orders. The app shows the closed message rather than hiding the Store button — a button that vanishes reads as a bug."
                label="Store is open"
                onChange={(next) => void patchSettings({ isOpen: next })}
              />
            ) : (
              <LoadingRows />
            )}
          </Panel>
        </div>
      ) : null}
    </div>
  );
});

function DeliveryWindowFields({
  schedule,
}: {
  schedule: StoreSettings["deliverySchedule"];
}) {
  const [morningCutoffHour, setMorningCutoffHour] = useState(
    String(schedule.morningCutoffHour),
  );
  const [eveningCutoffHour, setEveningCutoffHour] = useState(
    String(schedule.eveningCutoffHour),
  );
  const [morningArrivalText, setMorningArrivalText] = useState(
    schedule.morningArrivalText,
  );
  const [eveningArrivalText, setEveningArrivalText] = useState(
    schedule.eveningArrivalText,
  );

  const [currentNepalHour] = useState(
    () => new Date(Date.now() + (5 * 60 + 45) * 60 * 1000).getUTCHours(),
  );
  const arrivesText =
    currentNepalHour < Number(eveningCutoffHour) ? morningArrivalText : eveningArrivalText;

  return (
    <fieldset className="grid gap-3 rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-semibold text-foreground">Delivery windows</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Morning cutoff (Nepal time)"
          max="23"
          min="0"
          name="morningCutoffHour"
          onChange={(event) => setMorningCutoffHour(event.target.value)}
          type="number"
          value={morningCutoffHour}
        />
        <Input
          label="Evening cutoff (Nepal time)"
          max="23"
          min="0"
          name="eveningCutoffHour"
          onChange={(event) => setEveningCutoffHour(event.target.value)}
          type="number"
          value={eveningCutoffHour}
        />
      </div>
      <Input
        label="Before evening cutoff, arrives"
        name="morningArrivalText"
        onChange={(event) => setMorningArrivalText(event.target.value)}
        value={morningArrivalText}
      />
      <Input
        label="After evening cutoff, arrives"
        name="eveningArrivalText"
        onChange={(event) => setEveningArrivalText(event.target.value)}
        value={eveningArrivalText}
      />
      <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        An order placed now arrives {arrivesText}.
      </p>
    </fieldset>
  );
}
