import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import nextEnv from "@next/env";
import mongoose from "mongoose";
import { createHash } from "node:crypto";
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
 * Re-running upserts by slug, so it is idempotent rather than additive.
 *
 * ## Prices are paisa
 *
 * Every `price` below is hundredths of a rupee, matching `StoreProduct.price`.
 * `NPR 4,500` is written `450_000`. Getting this wrong by a factor of a hundred
 * is the single easiest mistake to make against this collection, which is why
 * the helper is named `npr()` and nothing here writes a bare number.
 *
 * ## Images
 *
 * The URLs below are hand-curated Unsplash images. Unsplash's licence permits
 * use in this product, and the remote form is intentionally useful for local
 * development. `--upload` copies them to the public R2 bucket when a deployment
 * needs assets it controls.
 */

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

nextEnv.loadEnvConfig(repoRoot);

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required to seed the store catalogue.");
}

const shouldCleanOnly = process.argv.includes("--clean");
const shouldFillMissing = process.argv.includes("--fill-missing");
const shouldUpload = process.argv.includes("--upload");

const looseSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
const model = (name) => mongoose.models[name] ?? mongoose.model(name, looseSchema);

const StoreCategory = model("StoreCategory");
const StoreProduct = model("StoreProduct");
const FileAsset = model("FileAsset");

const DEMO = { isDemoData: true };

/** Rupees to paisa. Nothing below writes a bare number — see the note above. */
function npr(rupees) {
  return Math.round(rupees * 100);
}

const downloadedImages = new Map();
let uploadClient;

function uploadSettings() {
  const required = [
    "R2_ENDPOINT",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_PUBLIC",
    "R2_PUBLIC_URL",
  ];

  const missing = required.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new Error(`--upload requires public R2 settings: ${missing.join(", ")}`);
  }

  return {
    bucket: process.env.R2_BUCKET_PUBLIC,
    endpoint: process.env.R2_ENDPOINT,
    publicUrl: process.env.R2_PUBLIC_URL.replace(/\/+$/, ""),
    prefix: (process.env.R2_KEY_PREFIX ?? "").replace(/^\/+|\/+$/g, ""),
  };
}

function getUploadClient(settings) {
  if (!uploadClient) {
    uploadClient = new S3Client({
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      endpoint: settings.endpoint,
      region: "auto",
    });
  }

  return uploadClient;
}

async function downloadImage(url) {
  if (!downloadedImages.has(url)) {
    downloadedImages.set(
      url,
      (async () => {
        const response = await fetch(url, {
          headers: { "user-agent": "HostelHub store catalogue seed" },
        });

        if (!response.ok) {
          throw new Error(`Could not download ${url}: HTTP ${response.status}`);
        }

        const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0];

        if (!contentType.startsWith("image/")) {
          throw new Error(`Catalogue URL did not return an image: ${url}`);
        }

        const body = Buffer.from(await response.arrayBuffer());

        if (body.length > 10 * 1024 * 1024) {
          throw new Error(`Catalogue image is larger than 10 MB: ${url}`);
        }

        return { body, contentType };
      })(),
    );
  }

  return downloadedImages.get(url);
}

async function uploadImage(url, keyName) {
  const settings = uploadSettings();
  const key = `${settings.prefix ? `${settings.prefix}/` : ""}store-catalogue/${keyName}.jpg`;
  const existing = await FileAsset.findOne({
    key,
    accessLevel: "PUBLIC",
    status: "ACTIVE",
  }).lean();

  if (existing) {
    return { assetId: existing._id.toString() };
  }

  const { body, contentType } = await downloadImage(url);

  await getUploadClient(settings).send(
    new PutObjectCommand({
      Body: body,
      Bucket: settings.bucket,
      ContentType: contentType,
      Key: key,
    }),
  );

  const record = await FileAsset.findOneAndUpdate(
    { key },
    {
      $setOnInsert: {
        accessLevel: "PUBLIC",
        bucket: settings.bucket,
        contentHash: createHash("sha256").update(body).digest("hex"),
        fileName: `${keyName}.jpg`,
        key,
        mimeType: contentType,
        publicUrl: `${settings.publicUrl}/${key}`,
        sizeBytes: body.length,
        status: "ACTIVE",
        storageProvider: "CLOUDFLARE_R2",
        uploadCompletedAt: new Date(),
      },
    },
    { new: true, upsert: true },
  ).lean();

  return { assetId: record._id.toString() };
}

const CATEGORIES = [
  {
    icon: "bed-outline",
    imageUrl:
      "https://images.unsplash.com/photo-1584100936595-c0654b55a0e2?auto=format&fit=crop&w=900&q=85",
    name: "Bedding",
    priority: 160,
    slug: "bedding",
  },
  {
    icon: "cube-outline",
    imageUrl:
      "https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?auto=format&fit=crop&w=900&q=85",
    name: "Furniture",
    priority: 150,
    slug: "furniture",
  },
  {
    icon: "restaurant-outline",
    imageUrl:
      "https://images.unsplash.com/photo-1556910103-1c02745aae4d?auto=format&fit=crop&w=900&q=85",
    name: "Kitchen & Cookware",
    priority: 140,
    slug: "kitchen-cookware",
  },
  {
    icon: "water-outline",
    imageUrl:
      "https://images.unsplash.com/photo-1563453392212-326f5e854473?auto=format&fit=crop&w=900&q=85",
    name: "Cleaning & Hygiene",
    priority: 130,
    slug: "cleaning-hygiene",
  },
  {
    icon: "water-outline",
    imageUrl:
      "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&w=900&q=85",
    name: "Bathroom",
    priority: 120,
    slug: "bathroom",
  },
  {
    icon: "bulb-outline",
    imageUrl:
      "https://images.unsplash.com/photo-1509391366360-2e959784a276?auto=format&fit=crop&w=900&q=85",
    name: "Electrical & Lighting",
    priority: 110,
    slug: "electrical-lighting",
  },
  {
    icon: "beaker-outline",
    imageUrl:
      "https://images.unsplash.com/photo-1603038385298-bdbbdbb7c5f6?auto=format&fit=crop&w=900&q=85",
    name: "Water & Storage",
    priority: 100,
    slug: "water-storage",
  },
  {
    icon: "shirt-outline",
    imageUrl:
      "https://images.unsplash.com/photo-1517677208171-0bc6725a3e60?auto=format&fit=crop&w=900&q=85",
    name: "Laundry",
    priority: 90,
    slug: "laundry",
  },
  {
    icon: "medkit-outline",
    imageUrl:
      "https://images.unsplash.com/photo-1584483766114-2cea6e7de4f6?auto=format&fit=crop&w=900&q=85",
    name: "Safety & Fire",
    priority: 80,
    slug: "safety-fire",
  },
  {
    icon: "document-text-outline",
    imageUrl:
      "https://images.unsplash.com/photo-1456735190827-d1262f71b8a3?auto=format&fit=crop&w=900&q=85",
    name: "Stationery & Office",
    priority: 70,
    slug: "stationery-office",
  },
  {
    icon: "school-outline",
    imageUrl:
      "https://images.unsplash.com/photo-1499750310107-5fef28a66643?auto=format&fit=crop&w=900&q=85",
    name: "Study & Desk",
    priority: 60,
    slug: "study-desk",
  },
  {
    icon: "lock-closed-outline",
    imageUrl:
      "https://images.unsplash.com/photo-1558008258-3256797b43f3?auto=format&fit=crop&w=900&q=85",
    name: "Doors & Locks",
    priority: 50,
    slug: "doors-locks",
  },
  {
    icon: "wifi-outline",
    imageUrl:
      "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=900&q=85",
    name: "Networking",
    priority: 40,
    slug: "networking",
  },
  {
    icon: "construct-outline",
    imageUrl:
      "https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=900&q=85",
    name: "Maintenance & Tools",
    priority: 30,
    slug: "maintenance-tools",
  },
  {
    icon: "leaf-outline",
    imageUrl:
      "https://images.unsplash.com/photo-1558904541-efa843a96f01?auto=format&fit=crop&w=900&q=85",
    name: "Outdoor & Garden",
    priority: 20,
    slug: "outdoor-garden",
  },
  {
    icon: "trash-outline",
    imageUrl:
      "https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?auto=format&fit=crop&w=900&q=85",
    name: "Waste Management",
    priority: 10,
    slug: "waste-management",
  },
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
    category: "cleaning-hygiene",
    name: "Floor cleaner, 5 litre",
    price: npr(720),
    stockQuantity: 80,
    summary: "Concentrated, dilutes 1:20",
    tags: ["phenyl", "floor", "cleaner"],
    unit: "can",
  },
  {
    category: "cleaning-hygiene",
    isFeatured: true,
    name: "Toilet cleaner, 1 litre",
    price: npr(260),
    stockQuantity: 150,
    summary: "Acid based, 12 per carton",
    tags: ["toilet", "harpic", "bathroom"],
    unit: "bottle",
  },
  {
    category: "cleaning-hygiene",
    name: "Plastic bucket, 20 litre",
    price: npr(480),
    stockQuantity: 90,
    summary: "Food grade, with handle",
    tags: ["bucket", "balti"],
    unit: "piece",
    maxOrderQuantity: 50,
  },
  {
    category: "cleaning-hygiene",
    name: "Floor wiper with handle",
    price: npr(390),
    stockQuantity: 70,
    tags: ["wiper", "mop"],
    unit: "piece",
  },
  {
    category: "kitchen-cookware",
    name: "Stainless steel plate",
    price: npr(280),
    stockQuantity: 300,
    summary: "11 inch, compartment thali",
    tags: ["plate", "thali", "steel"],
    unit: "piece",
    minOrderQuantity: 10,
  },
  {
    category: "kitchen-cookware",
    name: "Steel tumbler, 300 ml",
    price: npr(120),
    stockQuantity: 400,
    tags: ["glass", "tumbler", "steel"],
    unit: "piece",
    minOrderQuantity: 10,
  },
  {
    category: "kitchen-cookware",
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
    category: "electrical-lighting",
    name: "LED tube light, 20W",
    price: npr(340),
    stockQuantity: 180,
    summary: "4 foot, cool white",
    tags: ["light", "led", "tube"],
    unit: "piece",
  },
  {
    category: "electrical-lighting",
    name: "Ceiling fan, 48 inch",
    price: npr(3_200),
    stockQuantity: 25,
    tags: ["fan", "ceiling"],
    unit: "piece",
  },
  {
    category: "electrical-lighting",
    name: "Extension board, 4 socket",
    price: npr(560),
    stockQuantity: 60,
    summary: "With surge protection",
    tags: ["extension", "socket", "power"],
    unit: "piece",
  },
  {
    category: "safety-fire",
    isFeatured: true,
    name: "Fire extinguisher, 4 kg ABC",
    price: npr(4_100),
    stockQuantity: 18,
    summary: "Dry powder, with wall bracket",
    tags: ["fire", "extinguisher", "safety"],
    unit: "piece",
  },
  {
    category: "safety-fire",
    name: "First aid box, wall mounted",
    price: npr(1_450),
    stockQuantity: 30,
    summary: "Stocked, metal case",
    tags: ["first aid", "medical", "safety"],
    unit: "piece",
  },
];

const PRODUCT_IMAGE_SETS = [
  {
    keywords: [
      "mattress",
      "gaddi",
      "bed",
      "bedsheet",
      "linen",
      "pillow",
      "sirani",
      "blanket",
      "kambal",
      "winter",
    ],
    urls: [
      "https://images.unsplash.com/photo-1584100936595-c0654b55a0e2?auto=format&fit=crop&w=900&q=85",
      "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=900&q=85",
      "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=900&q=85",
    ],
  },
  {
    keywords: [
      "phenyl",
      "floor",
      "cleaner",
      "toilet",
      "harpic",
      "bathroom",
      "bucket",
      "balti",
      "wiper",
      "mop",
    ],
    urls: [
      "https://images.unsplash.com/photo-1563453392212-326f5e854473?auto=format&fit=crop&w=900&q=85",
      "https://images.unsplash.com/photo-1583947215259-38e31be8751f?auto=format&fit=crop&w=900&q=85",
      "https://images.unsplash.com/photo-1527515637462-cff94eecc1ac?auto=format&fit=crop&w=900&q=85",
    ],
  },
  {
    keywords: ["plate", "thali", "tumbler", "glass", "steel", "cooker", "kitchen"],
    urls: [
      "https://images.unsplash.com/photo-1556910103-1c02745aae4d?auto=format&fit=crop&w=900&q=85",
      "https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=900&q=85",
      "https://images.unsplash.com/photo-1598514982901-ae627d8f4a89?auto=format&fit=crop&w=900&q=85",
    ],
  },
  {
    keywords: ["table", "desk", "study", "almirah", "wardrobe", "locker"],
    urls: [
      "https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?auto=format&fit=crop&w=900&q=85",
      "https://images.unsplash.com/photo-1538688525198-9b88f6f53126?auto=format&fit=crop&w=900&q=85",
      "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=900&q=85",
    ],
  },
  {
    keywords: ["light", "led", "tube", "fan", "ceiling", "extension", "socket", "power"],
    urls: [
      "https://images.unsplash.com/photo-1509391366360-2e959784a276?auto=format&fit=crop&w=900&q=85",
      "https://images.unsplash.com/photo-1558008258-3256797b43f3?auto=format&fit=crop&w=900&q=85",
      "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=900&q=85",
    ],
  },
  {
    keywords: ["fire", "extinguisher", "first aid", "medical", "safety"],
    urls: [
      "https://images.unsplash.com/photo-1584483766114-2cea6e7de4f6?auto=format&fit=crop&w=900&q=85",
      "https://images.unsplash.com/photo-1585435557343-3b092031a831?auto=format&fit=crop&w=900&q=85",
      "https://images.unsplash.com/photo-1541888946425-d81bb19240f5?auto=format&fit=crop&w=900&q=85",
    ],
  },
];

function imageSetFor(product) {
  const haystack = `${product.name} ${(product.tags ?? []).join(" ")}`.toLowerCase();

  return PRODUCT_IMAGE_SETS.find((set) =>
    set.keywords.some((keyword) => haystack.includes(keyword)),
  );
}

async function clean() {
  const products = await StoreProduct.deleteMany(DEMO);

  return { products: products.deletedCount };
}

function productSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function remoteImagesFor(product, slug) {
  const imageSet = imageSetFor(product);

  if (!imageSet) {
    throw new Error(`No image set matches seeded product: ${product.name}`);
  }

  if (!shouldUpload) {
    return imageSet.urls.map((url) => ({ url }));
  }

  return Promise.all(
    imageSet.urls.map((url, index) => uploadImage(url, `${slug}-${index + 1}`)),
  );
}

async function fillMissing() {
  const products = await StoreProduct.find({ images: { $size: 0 } }).lean();
  let filled = 0;

  for (const product of products) {
    const images = await remoteImagesFor(product, productSlug(product.name));

    await StoreProduct.updateOne({ _id: product._id }, { $set: { images } });
    filled += 1;
  }

  return { filled, inspected: products.length };
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

  let written = 0;

  for (const product of PRODUCTS) {
    const { category, ...rest } = product;
    const slug = productSlug(rest.name);
    const document = {
      ...rest,
      categoryId: categoryIds.get(category),
      images: await remoteImagesFor(product, slug),
      isActive: true,
      isDemoData: true,
      isFeatured: rest.isFeatured ?? false,
      maxOrderQuantity: rest.maxOrderQuantity ?? 0,
      minOrderQuantity: rest.minOrderQuantity ?? 1,
      priority: rest.isFeatured ? 10 : 0,
      slug,
      stockQuantity: rest.stockQuantity ?? 0,
      tags: rest.tags ?? [],
      trackStock: rest.trackStock ?? true,
    };

    await StoreProduct.findOneAndUpdate(
      { slug },
      { $set: document },
      { new: true, upsert: true },
    );
    written += 1;
  }

  return { categories: CATEGORIES.length, products: written };
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  if (shouldCleanOnly) {
    const removed = await clean();
    console.log(`Removed ${removed.products} seeded products.`);
    await mongoose.disconnect();
    return;
  }

  if (shouldFillMissing) {
    const result = await fillMissing();
    console.log(
      `Filled ${result.filled} of ${result.inspected} products with missing photos.`,
    );
    await mongoose.disconnect();
    return;
  }

  const written = await seed();

  console.log(
    `Seeded ${written.products} products across ${written.categories} categories.`,
  );

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
