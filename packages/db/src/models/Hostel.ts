import { Schema, model, models } from "mongoose";

const hostelSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, unique: true },
    /**
     * Three uppercase letters, unique platform-wide, opening every reference
     * code this hostel issues — `RUP` in `RUP-4821-K` (target §5.1).
     *
     * Nullable only so existing hostels can be backfilled; every hostel must
     * have one before it can issue an invoice, because the code is what lets a
     * payment identify itself (P2). Derived from the name, then disambiguated
     * numerically — see `finance/reference-code.ts`.
     */
    referencePrefix: {
      type: String,
      trim: true,
      uppercase: true,
      match: /^[A-Z]{3}$/,
    },
    description: String,
    ownerId: { ref: "User", required: true, type: Schema.Types.ObjectId },
    location: {
      area: { type: String, required: true, trim: true },
      city: { type: String, default: "Kathmandu", trim: true },
      province: { type: String, trim: true },
      address: { type: String, trim: true },
      lat: Number,
      lng: Number,
      // MANUAL means an admin dropped the pin on the map themselves — the
      // geocoder must never overwrite those coordinates. GEOCODED means lat/lng
      // were derived from the address text and may be refreshed freely.
      locationSource: {
        type: String,
        enum: ["MANUAL", "GEOCODED"],
        default: "GEOCODED",
      },
    },
    contact: {
      phone: String,
      email: String,
    },
    hostelType: {
      type: String,
      enum: ["BOYS", "GIRLS", "CO_LIVING"],
      default: "CO_LIVING",
    },
    pricing: {
      currency: { type: String, default: "NPR", trim: true },
      monthlyRentMin: { min: 0, type: Number },
      monthlyRentMax: { min: 0, type: Number },
      admissionFee: { min: 0, type: Number },
    },
    facilities: [{ type: String, trim: true }],
    roomTypes: [{ type: String, trim: true }],
    // Per-room-type pricing and vacancy as the owner submitted it. `roomTypes`
    // above stays the flat, indexable list used by listing filters; this is the
    // authoritative source for what each room type actually costs. Without it
    // the public detail page has to guess rents from pricing.monthlyRentMin/Max.
    roomConfigurations: [
      {
        roomType: { type: String, required: true, trim: true },
        monthlyRent: { min: 0, type: Number },
        bedsPerRoom: { min: 0, type: Number },
        rooms: { min: 0, type: Number },
        vacantBeds: { min: 0, type: Number, default: 0 },
        mealInclusion: {
          type: String,
          enum: ["Included", "Not Included", "Optional"],
          default: "Included",
        },
      },
    ],
    food: {
      mealsPerDay: { min: 0, type: Number },
      hasVeg: { default: true, type: Boolean },
      hasNonVeg: { default: true, type: Boolean },
      notes: { type: String, trim: true },
    },
    rules: [{ type: String, trim: true }],
    photos: [
      {
        alt: { type: String, trim: true },
        fileAssetId: { ref: "FileAsset", type: Schema.Types.ObjectId },
        url: { type: String, trim: true },
        // EXTERIOR (max 3) leads the public listing; INTERIOR (max 20) fills
        // the gallery; ROOM (max 10 per room type) illustrates one entry of
        // roomConfigurations. Limits enforced in the profile service.
        kind: {
          type: String,
          enum: ["EXTERIOR", "INTERIOR", "ROOM"],
          default: "INTERIOR",
        },
        // Set only on ROOM photos — matches roomConfigurations[].roomType.
        roomType: { type: String, trim: true },
      },
    ],
    // Post-approval renames are limited to 2; further changes go through the
    // superadmin change-request flow.
    nameChangeCount: { type: Number, default: 0, min: 0 },
    // Running total of de-duplicated visits to /hostels/{slug}, kept here so the
    // admin dashboard reads one number instead of aggregating HostelPageView.
    // The event rows stay the source of truth for unique/recent breakdowns.
    publicViewCount: { type: Number, default: 0, min: 0 },
    // How many floors the building has. Purely descriptive — rooms are stored
    // as one flat list per hostel and are not grouped by floor.
    totalFloors: { min: 0, type: Number },
    capacitySummary: {
      totalRooms: { min: 0, type: Number },
      totalBeds: { min: 0, type: Number },
      vacantBeds: { min: 0, type: Number },
    },
    nearbyPlaces: [
      {
        name: { type: String, trim: true },
        type: {
          type: String,
          enum: [
            "college",
            "hospital",
            "bus_stop",
            "park",
            "gym",
            "restaurant",
            "pharmacy",
            "other",
          ],
          default: "other",
        },
        distance: Number,
        coordinates: {
          lat: Number,
          lng: Number,
        },
      },
    ],
    nearbyPlacesLastUpdated: Date,
    status: {
      type: String,
      enum: [
        "DRAFT",
        "PENDING_APPROVAL",
        "APPROVED",
        "PUBLISHED",
        "REJECTED",
        "SUSPENDED",
      ],
      default: "DRAFT",
    },
    verificationStatus: {
      type: String,
      enum: ["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"],
      default: "UNVERIFIED",
    },
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
    updatedBy: { ref: "User", type: Schema.Types.ObjectId },
    isDemoData: { type: Boolean, default: false },
    demoDataLabel: { type: String, trim: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
    deletedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

hostelSchema.index({ slug: 1 }, { unique: true });
// Partial, because the prefix is nullable until every hostel is backfilled —
// a plain unique index would collide on the nulls.
hostelSchema.index(
  { referencePrefix: 1 },
  {
    partialFilterExpression: { referencePrefix: { $type: "string" } },
    unique: true,
  },
);
hostelSchema.index({ status: 1, "location.area": 1, hostelType: 1 });
hostelSchema.index({ verificationStatus: 1, status: 1 });
hostelSchema.index({ ownerId: 1, status: 1 });
hostelSchema.index({
  "pricing.monthlyRentMin": 1,
  "pricing.monthlyRentMax": 1,
});

export const HostelModel = models.Hostel || model("Hostel", hostelSchema);
