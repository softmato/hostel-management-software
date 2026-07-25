import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id.");

const textArraySchema = z.array(z.string().trim().min(1).max(80)).max(40).default([]);
const optionalTextArraySchema = z.array(z.string().trim().min(1).max(80)).max(40);

const optionalHostelScopeSchema = {
  hostelId: objectIdSchema.optional(),
};

export const hostelTypeSchema = z.enum(["BOYS", "GIRLS", "CO_LIVING"]);

const roomConfigurationSchema = z.object({
  bedsPerRoom: z.coerce.number().int().nonnegative(),
  mealInclusion: z.enum(["Included", "Not Included", "Optional"]),
  monthlyRent: z.coerce.number().nonnegative().optional(),
  rooms: z.coerce.number().int().nonnegative(),
  roomType: z.string().trim().min(1).max(80),
  vacantBeds: z.coerce.number().int().nonnegative().default(0),
});

const roomConfigurationsSchema = z.array(roomConfigurationSchema).max(30).default([]);

export const platformHostelCreateSchema = z.object({
  capacitySummary: z
    .object({
      totalBeds: z.coerce.number().int().nonnegative().optional(),
      totalRooms: z.coerce.number().int().nonnegative().optional(),
      vacantBeds: z.coerce.number().int().nonnegative().optional(),
    })
    .optional(),
  contact: z
    .object({
      email: z.string().trim().email().optional(),
      phone: z.string().trim().min(7).max(24).optional(),
    })
    .optional(),
  description: z.string().trim().max(2000).optional(),
  documents: z
    .array(
      z.object({
        documentType: z.string().trim().min(2).max(80),
        fileAssetId: objectIdSchema.optional(),
        fileUrl: z.string().trim().url().optional(),
      }),
    )
    .max(12)
    .default([]),
  facilities: textArraySchema,
  food: z
    .object({
      hasNonVeg: z.boolean().default(true),
      hasVeg: z.boolean().default(true),
      mealsPerDay: z.coerce.number().int().nonnegative().max(6).optional(),
      notes: z.string().trim().max(500).optional(),
    })
    .optional(),
  hostelType: hostelTypeSchema.default("CO_LIVING"),
  location: z.object({
    address: z.string().trim().max(240).optional(),
    area: z.string().trim().min(2).max(120),
    city: z.string().trim().min(2).max(120).default("Kathmandu"),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    province: z.string().trim().max(120).optional(),
  }),
  name: z.string().trim().min(2).max(160),
  notes: z.string().trim().max(1000).optional(),
  ownerId: objectIdSchema,
  photos: z
    .array(
      z.object({
        alt: z.string().trim().max(120).optional(),
        fileAssetId: objectIdSchema.optional(),
        url: z.string().trim().url(),
      }),
    )
    .max(20)
    .default([]),
  pricing: z
    .object({
      admissionFee: z.coerce.number().nonnegative().optional(),
      currency: z.string().trim().min(2).max(8).default("NPR"),
      monthlyRentMax: z.coerce.number().nonnegative().optional(),
      monthlyRentMin: z.coerce.number().nonnegative().optional(),
    })
    .optional(),
  roomConfigurations: roomConfigurationsSchema,
  roomTypes: textArraySchema,
  rules: textArraySchema,
});

export const publicHostelApplicationCreateSchema = platformHostelCreateSchema
  .omit({ ownerId: true })
  .extend({
    applicant: z.object({
      email: z.string().trim().email().optional(),
      name: z.string().trim().min(2).max(120),
      phone: z.string().trim().min(7).max(24),
    }),
    selectedPlan: z.string().trim().min(2).max(80),
  });

export const platformHostelListQuerySchema = z.object({
  status: z
    .enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "PUBLISHED", "REJECTED", "SUSPENDED"])
    .optional(),
  verificationStatus: z
    .enum(["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"])
    .optional(),
});

export const hostelRejectSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
});

// Unpublishing pulls a live listing out of public search, so the owner is owed
// an explanation — the reason is required and goes straight into their email.
export const hostelUnpublishSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
});

export const hostelRequestDocumentsSchema = z.object({
  documents: z
    .array(
      z.object({
        documentType: z.string().trim().min(2).max(120),
        note: z.string().trim().max(400).optional(),
      }),
    )
    .min(1, "Request at least one document.")
    .max(12),
  note: z.string().trim().max(1000).optional(),
});

export const hostelResubmitDocumentsSchema = z.object({
  documents: z
    .array(
      z.object({
        documentType: z.string().trim().min(2).max(120),
        fileAssetId: objectIdSchema.optional(),
        fileUrl: z.string().trim().url(),
      }),
    )
    .min(1, "Upload at least one document.")
    .max(12),
});

export const publicHostelListQuerySchema = z.object({
  area: z.string().trim().min(1).max(120).optional(),
  facility: z.string().trim().min(1).max(80).optional(),
  food: z.enum(["veg", "non-veg"]).optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  q: z.string().trim().min(1).max(160).optional(),
  roomType: z.string().trim().min(1).max(80).optional(),
  type: hostelTypeSchema.optional(),
});

export const publicHostelCompareQuerySchema = z.object({
  ids: z
    .string()
    .trim()
    .min(1)
    .transform((value) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    )
    .pipe(
      z
        .array(objectIdSchema)
        .min(2, "Select at least 2 hostels to compare.")
        .max(3, "Compare up to 3 hostels at a time."),
    ),
});

export const inquiryStatusSchema = z.enum([
  "NEW",
  "CONTACTED",
  "VISIT_SCHEDULED",
  "CONVERTED",
  "CLOSED",
]);

export const publicInquiryCreateSchema = z.object({
  budgetRange: z.string().trim().max(80).optional(),
  email: z.string().trim().email().optional(),
  gender: z.string().trim().max(40).optional(),
  message: z.string().trim().max(1200).optional(),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(24),
  preferredRoomType: z.string().trim().max(80).optional(),
  preferredVisitDate: z.coerce.date().optional(),
});

export const hostelAdminInquiryListQuerySchema = z.object({
  ...optionalHostelScopeSchema,
  status: inquiryStatusSchema.optional(),
});

export const hostelAdminInquiryStatusSchema = z.object({
  ...optionalHostelScopeSchema,
  status: inquiryStatusSchema,
});

export const inquiryNoteCreateSchema = z.object({
  ...optionalHostelScopeSchema,
  nextFollowUpAt: z.coerce.date().optional(),
  note: z.string().trim().min(2).max(1200),
});

export const hostelAdminProfileQuerySchema = z.object(optionalHostelScopeSchema);

export const hostelAdminProfileUpdateSchema = z.object({
  ...optionalHostelScopeSchema,
  capacitySummary: z
    .object({
      totalBeds: z.coerce.number().int().nonnegative().optional(),
      totalRooms: z.coerce.number().int().nonnegative().optional(),
      vacantBeds: z.coerce.number().int().nonnegative().optional(),
    })
    .optional(),
  contact: z
    .object({
      email: z.string().trim().email().optional(),
      phone: z.string().trim().min(7).max(24).optional(),
    })
    .optional(),
  description: z.string().trim().max(2000).optional(),
  facilities: optionalTextArraySchema.optional(),
  food: z
    .object({
      hasNonVeg: z.boolean().optional(),
      hasVeg: z.boolean().optional(),
      mealsPerDay: z.coerce.number().int().nonnegative().max(6).optional(),
      notes: z.string().trim().max(500).optional(),
    })
    .optional(),
  hostelType: hostelTypeSchema.optional(),
  location: z
    .object({
      address: z.string().trim().max(240).optional(),
      area: z.string().trim().min(2).max(120).optional(),
      city: z.string().trim().min(2).max(120).optional(),
      lat: z.coerce.number().min(-90).max(90).optional(),
      lng: z.coerce.number().min(-180).max(180).optional(),
      province: z.string().trim().max(120).optional(),
    })
    .optional(),
  name: z.string().trim().min(2).max(160).optional(),
  pricing: z
    .object({
      admissionFee: z.coerce.number().nonnegative().optional(),
      currency: z.string().trim().min(2).max(8).optional(),
      monthlyRentMax: z.coerce.number().nonnegative().optional(),
      monthlyRentMin: z.coerce.number().nonnegative().optional(),
    })
    .optional(),
  roomConfigurations: z.array(roomConfigurationSchema).max(30).optional(),
  roomTypes: optionalTextArraySchema.optional(),
  rules: optionalTextArraySchema.optional(),
});

export const hostelPhotoCreateSchema = z.object({
  ...optionalHostelScopeSchema,
  alt: z.string().trim().max(120).optional(),
  fileAssetId: objectIdSchema.optional(),
  url: z.string().trim().url(),
});

export const hostelPhotoDeleteQuerySchema = z.object(optionalHostelScopeSchema);

export const floorCreateSchema = z.object({
  ...optionalHostelScopeSchema,
  description: z.string().trim().max(500).optional(),
  level: z.coerce.number().int().min(-5).max(100),
  name: z.string().trim().min(1).max(80),
  sortOrder: z.coerce.number().int().min(-100).max(1000).default(0),
});

export const hostelScopedListQuerySchema = z.object(optionalHostelScopeSchema);

export const roomCreateSchema = z.object({
  ...optionalHostelScopeSchema,
  capacity: z.coerce.number().int().min(1).max(40),
  facilities: textArraySchema,
  floorId: objectIdSchema,
  notes: z.string().trim().max(800).optional(),
  repairStatus: z.enum(["OK", "NEEDS_REPAIR", "UNDER_REPAIR"]).default("OK"),
  roomNumber: z.string().trim().min(1).max(40),
  roomType: z.string().trim().min(1).max(80),
  vacancyStatus: z.enum(["VACANT", "PARTIAL", "FULL"]).default("VACANT"),
});

export const roomUpdateSchema = z.object({
  ...optionalHostelScopeSchema,
  capacity: z.coerce.number().int().min(1).max(40).optional(),
  facilities: optionalTextArraySchema.optional(),
  floorId: objectIdSchema.optional(),
  notes: z.string().trim().max(800).optional(),
  repairStatus: z.enum(["OK", "NEEDS_REPAIR", "UNDER_REPAIR"]).optional(),
  roomNumber: z.string().trim().min(1).max(40).optional(),
  roomType: z.string().trim().min(1).max(80).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  vacancyStatus: z.enum(["VACANT", "PARTIAL", "FULL"]).optional(),
});

export const bedCreateSchema = z.object({
  ...optionalHostelScopeSchema,
  assignedResidentId: objectIdSchema.optional(),
  bedNumber: z.string().trim().min(1).max(40),
  notes: z.string().trim().max(800).optional(),
  repairStatus: z.enum(["OK", "NEEDS_REPAIR", "UNDER_REPAIR"]).default("OK"),
  roomId: objectIdSchema,
  status: z
    .enum(["AVAILABLE", "OCCUPIED", "RESERVED", "MAINTENANCE"])
    .default("AVAILABLE"),
});

export const bedUpdateSchema = z.object({
  ...optionalHostelScopeSchema,
  assignedResidentId: objectIdSchema.nullish(),
  bedNumber: z.string().trim().min(1).max(40).optional(),
  notes: z.string().trim().max(800).optional(),
  repairStatus: z.enum(["OK", "NEEDS_REPAIR", "UNDER_REPAIR"]).optional(),
  roomId: objectIdSchema.optional(),
  status: z.enum(["AVAILABLE", "OCCUPIED", "RESERVED", "MAINTENANCE"]).optional(),
});
