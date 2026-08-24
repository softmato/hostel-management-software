import nextEnv from "@next/env";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A starter catalogue for the supply store.
 *
 * Same contract as `seed-community-posts.mjs`: every product carries
 * `isDemoData: true`, and `--clean` deletes exactly and only documents carrying
 * it. Categories do **not** carry the flag and are upserted by slug instead —
 * deleting a category that products still point at is refused by the service on
 * purpose, and a seed that had to work around its own product's foreign key
 * would be teaching the wrong lesson.
 *
 *   npm run seed:store          # write the sample catalogue
 *   npm run seed:store:clean    # remove every seeded product
 *
 * Re-running cleans first, so it is idempotent rather than additive.
 *
 * ## Prices are paisa
 *
 * Every `price` below is hundredths of a rupee, matching `StoreProduct.price`.
 * `NPR 4,500` is written `450_000`. Getting this wrong by a factor of a hundred
 * is the single easiest mistake to make against this collection, which is why
 * the helper is named `npr()` and nothing here writes a bare number.
 *
 * ## No images
 *
 * Same reasoning as the community seed: an asset id that is not in R2 renders as
 * a broken thumbnail, and `ProductArtwork` already draws a tinted glyph when
 * there is no photograph. Add real pictures from `/platform/store`.
 */

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

nextEnv.loadEnvConfig(repoRoot);

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required to seed the store catalogue.");
}

const shouldCleanOnly = process.argv.includes("--clean");

const looseSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
const model = (name) => mongoose.models[name] ?? mongoose.model(name, looseSchema);

const StoreCategory = model("StoreCategory");
const StoreProduct = model("StoreProduct");

const DEMO = { isDemoData: true };

/** Rupees to paisa. Nothing below writes a bare number — see the note above. */
function npr(rupees) {
  return Math.round(rupees * 100);
}

const CATEGORIES = [
  { icon: "bed-outline", name: "Bedding", priority: 100, slug: "bedding" },
  { icon: "water-outline", name: "Cleaning", priority: 90, slug: "cleaning" },
  { icon: "restaurant-outline", name: "Kitchen", priority: 80, slug: "kitchen" },
  { icon: "cube-outline", name: "Furniture", priority: 70, slug: "furniture" },
  { icon: "bulb-outline", name: "Electrical", priority: 60, slug: "electrical" },
  { icon: "medkit-outline", name: "Safety", priority: 50, slug: "safety" },
];

const PRODUCTS = [
  {
    category: "bedding",
    isFeatured: true,
    name: "Cotton mattress, 3 inch",
    price: npr(4_500),
    compareAtPrice: npr(5_200),
    stockQuantity: 40,
    summary: "Single bed, cotton filled",
    tags: ["mattress", "gaddi", "bed"],
    unit: "piece",
    description:
      "A 72 x 36 inch cotton-filled mattress, three inches thick, with a cotton drill cover. Sized for a standard hostel single bed frame.",
  },
  {
    category: "bedding",
    name: "Bedsheet set, single",
    price: npr(850),
    stockQuantity: 120,
    summary: "Flat sheet and one pillow cover",
    tags: ["bedsheet", "linen"],
    unit: "set",
  },
  {
    category: "bedding",
    name: "Fibre pillow",
    price: npr(420),
    stockQuantity: 200,
    summary: "17 x 27 inch, washable cover",
    tags: ["pillow", "sirani"],
    unit: "piece",
  },
  {
    category: "bedding",
    isFeatured: true,
    name: "Fleece blanket",
    price: npr(1_250),
    stockQuantity: 60,
    summary: "Single, 200 gsm",
    tags: ["blanket", "kambal", "winter"],
    unit: "piece",
  },
  {
    category: "cleaning",
    name: "Floor cleaner, 5 litre",
    price: npr(720),
    stockQuantity: 80,
    summary: "Concentrated, dilutes 1:20",
    tags: ["phenyl", "floor", "cleaner"],
    unit: "can",
  },
  {
    category: "cleaning",
    isFeatured: true,
    name: "Toilet cleaner, 1 litre",
    price: npr(260),
    stockQuantity: 150,
    summary: "Acid based, 12 per carton",
    tags: ["toilet", "harpic", "bathroom"],
    unit: "bottle",
  },
  {
    category: "cleaning",
    name: "Plastic bucket, 20 litre",
    price: npr(480),
    stockQuantity: 90,
    summary: "Food grade, with handle",
    tags: ["bucket", "balti"],
    unit: "piece",
    maxOrderQuantity: 50,
  },
  {
    category: "cleaning",
    name: "Floor wiper with handle",
    price: npr(390),
    stockQuantity: 70,
    tags: ["wiper", "mop"],
    unit: "piece",
  },
  {
    category: "kitchen",
    name: "Stainless steel plate",
    price: npr(280),
    stockQuantity: 300,
    summary: "11 inch, compartment thali",
    tags: ["plate", "thali", "steel"],
    unit: "piece",
    minOrderQuantity: 10,
  },
  {
    category: "kitchen",
    name: "Steel tumbler, 300 ml",
    price: npr(120),
    stockQuantity: 400,
    tags: ["glass", "tumbler", "steel"],
    unit: "piece",
    minOrderQuantity: 10,
  },
  {
    category: "kitchen",
    isFeatured: true,
    name: "Pressure cooker, 10 litre",
    price: npr(6_900),
    compareAtPrice: npr(7_800),
    stockQuantity: 12,
    summary: "Aluminium, ISI marked",
    tags: ["cooker", "kitchen"],
    unit: "piece",
    maxOrderQuantity: 4,
  },
  {
    category: "furniture",
    name: "Study table",
    price: npr(5_400),
    stockQuantity: 0,
    summary: "Engineered wood, one drawer",
    tags: ["table", "desk", "study"],
    unit: "piece",
  },
  {
    category: "furniture",
    name: "Steel almirah, 2 door",
    price: npr(18_500),
    // Made to order: no shelf to run empty, so stock is not tracked at all.
    trackStock: false,
    summary: "Six foot, powder coated, with lock",
    tags: ["almirah", "wardrobe", "locker"],
    unit: "piece",
  },
  {
    category: "electrical",
    name: "LED tube light, 20W",
    price: npr(340),
    stockQuantity: 180,
    summary: "4 foot, cool white",
    tags: ["light", "led", "tube"],
    unit: "piece",
  },
  {
    category: "electrical",
    name: "Ceiling fan, 48 inch",
    price: npr(3_200),
    stockQuantity: 25,
    tags: ["fan", "ceiling"],
    unit: "piece",
  },
  {
    category: "electrical",
    name: "Extension board, 4 socket",
    price: npr(560),
    stockQuantity: 60,
    summary: "With surge protection",
    tags: ["extension", "socket", "power"],
    unit: "piece",
  },
  {
    category: "safety",
    isFeatured: true,
    name: "Fire extinguisher, 4 kg ABC",
    price: npr(4_100),
    stockQuantity: 18,
    summary: "Dry powder, with wall bracket",
    tags: ["fire", "extinguisher", "safety"],
    unit: "piece",
  },
  {
    category: "safety",
    name: "First aid box, wall mounted",
    price: npr(1_450),
    stockQuantity: 30,
    summary: "Stocked, metal case",
    tags: ["first aid", "medical", "safety"],
    unit: "piece",
  },
];

async function clean() {
  const products = await StoreProduct.deleteMany(DEMO);

  return { products: products.deletedCount };
}

async function seed() {
  const categoryIds = new Map();

  for (const category of CATEGORIES) {
    // Upserted by slug rather than deleted and recreated: products point at
    // these by `_id`, and a fresh id every run would orphan anything a person
    // added by hand from the portal.
    const record = await StoreCategory.findOneAndUpdate(
      { slug: category.slug },
      { $set: { ...category, isActive: true } },
      { new: true, upsert: true },
    ).lean();

    categoryIds.set(category.slug, record._id);
  }

  const documents = PRODUCTS.map((product) => {
    const { category, ...rest } = product;

    return {
      ...rest,
      categoryId: categoryIds.get(category),
      images: [],
      isActive: true,
      isDemoData: true,
      isFeatured: rest.isFeatured ?? false,
      maxOrderQuantity: rest.maxOrderQuantity ?? 0,
      minOrderQuantity: rest.minOrderQuantity ?? 1,
      priority: rest.isFeatured ? 10 : 0,
      slug: rest.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
      stockQuantity: rest.stockQuantity ?? 0,
      tags: rest.tags ?? [],
      trackStock: rest.trackStock ?? true,
    };
  });

  await StoreProduct.insertMany(documents);

  return { categories: CATEGORIES.length, products: documents.length };
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const removed = await clean();

  if (shouldCleanOnly) {
    console.log(`Removed ${removed.products} seeded products.`);
    await mongoose.disconnect();
    return;
  }

  const written = await seed();

  console.log(
    `Seeded ${written.products} products across ${written.categories} categories (removed ${removed.products} from a previous run).`,
  );

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
