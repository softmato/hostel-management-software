/**
 * The ID card as data, and the rules behind its form.
 *
 * Its own module so it can be tested — Vitest here is node-side with no React
 * Native shim.
 *
 * ## The palette is fixed, and that is not an oversight
 *
 * Every other surface in this app takes its colours from the theme. This one does
 * not, because the card is a **document**: the web renders the same values onto a
 * canvas for the on-screen preview, the PNG the holder downloads and the image
 * attached to their approval email, so all three are identical. Quoting the
 * reason from `apps/web/src/lib/platform-id-card.ts`: an ID card that turns dark
 * because the viewer had dark mode on is not an ID card. These are that file's
 * exact hexes — if they change there, change them here.
 */

import type {
  BloodGroup,
  DietaryPreference,
  Gender,
  GovernmentIdType,
  IdCardType,
  Identity,
  IdentityProfile,
  IdentityProfileInput,
  Occupation,
} from "@/lib/identity-api";

/** `platform-id-card.ts`'s palette, verbatim. */
export const CARD_COLORS = {
  accent: "#48c98a",
  brand: "#0a8a4b",
  hairline: "#d9e5dd",
  ink: "#04301c",
  muted: "#5d6f66",
  paper: "#ffffff",
} as const;

/** `CARD_WIDTH / CARD_HEIGHT` — roughly ID-1 portrait (54 × 86 mm). */
export const CARD_ASPECT = 640 / 1000;

/* -------------------------------------------------------------------------- */
/* The variants                                                               */
/* -------------------------------------------------------------------------- */

type CardVariant = {
  accent: string;
  backBullets: string[];
  idLabel: string;
  title: string;
};

/**
 * The per-variant copy, matching `VARIANTS` in `platform-id-card.ts`. A resident
 * approved as an owner or provider keeps their id and is simply re-issued in the
 * matching variant, so the client must render whichever `cardType` says — never
 * assume `RESIDENT`.
 */
const CARD_VARIANTS: Record<IdCardType, CardVariant> = {
  HOSTEL_OWNER: {
    accent: "#2fae72",
    backBullets: [
      "Show this card to confirm you are the registered owner of your hostel on the platform.",
      "No hostel or resident detail is stored in the code itself — it only carries your platform ID.",
      "Report a lost card from your account menu and the ID stops resolving straight away.",
    ],
    idLabel: "OWNER ID",
    title: "HOSTEL OWNER IDENTITY CARD",
  },
  RESIDENT: {
    accent: CARD_COLORS.accent,
    backBullets: [
      "Show the QR code to a hostel and they can fill your registration without asking you to write anything down.",
      "No personal detail is stored in the code itself — it only carries your resident ID.",
      "Turn sharing off from your account menu and the ID stops opening your details straight away.",
    ],
    idLabel: "RESIDENT ID",
    title: "RESIDENT IDENTITY CARD",
  },
  SERVICE_PROVIDER: {
    accent: "#6fdda6",
    backBullets: [
      "Show this card when you arrive for a job so the hostel can confirm you are a verified provider.",
      "No job or resident detail is stored in the code itself — it only carries your platform ID.",
      "Jobs are broadcast to the provider mobile app you signed in to with this ID.",
    ],
    idLabel: "PROVIDER ID",
    title: "SERVICE PROVIDER IDENTITY CARD",
  },
};

const CARD_NOUNS: Record<IdCardType, string> = {
  HOSTEL_OWNER: "hostel owner",
  RESIDENT: "resident",
  SERVICE_PROVIDER: "service provider",
};

export function idCardNoun(cardType: IdCardType = "RESIDENT"): string {
  return CARD_NOUNS[cardType];
}

/**
 * Which variant an account will be issued, decided from `/auth/me` alone.
 *
 * The server is still the authority — `resolvePlatformIdCard` does exactly this
 * against the database, and `GET /users/resident-identity` returns its answer.
 * This mirror exists for the one place that has to name the card **before**
 * fetching anything: the home header's button, which offers to create a card for
 * an account that has none. Calling the endpoint just to word a label would put
 * a network round trip in front of a tap.
 *
 * Keep it in step with `resolvePlatformIdCard`: `HOSTEL_ADMIN` outranks the
 * provider record, an approved provider outranks the default, and everyone else
 * is a resident.
 */
export function idCardTypeForAccount(account: {
  isServiceProvider?: boolean;
  role: string;
}): IdCardType {
  if (account.role === "HOSTEL_ADMIN") {
    return "HOSTEL_OWNER";
  }

  return account.isServiceProvider ? "SERVICE_PROVIDER" : "RESIDENT";
}

export const OCCUPATION_LABELS: Record<Occupation, string> = {
  OTHER: "Resident",
  STUDENT: "Student",
  WORKING_PROFESSIONAL: "Working Professional",
};

/* -------------------------------------------------------------------------- */
/* The card                                                                   */
/* -------------------------------------------------------------------------- */

export type IdCard = {
  accent: string;
  backBullets: string[];
  fullName: string;
  idLabel: string;
  /** Preformatted — the renderer does no date maths, matching the web. */
  issuedOn: string;
  residentId: string;
  /** `[label, value]`, in the web's order. Blanks are already `—`. */
  rows: [string, string][];
  /** What is printed under the name, uppercased and letterspaced by the view. */
  role: string;
  title: string;
};

/** `16 Aug 2026` from a `YYYY-MM-DD` or ISO string. `null` stays null. */
function cardDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  /*
   * UTC getters, not local ones, and no Nepal shift: a date of birth is a plain
   * calendar date the server stored as `YYYY-MM-DD`, so `new Date("2004-03-02")`
   * is midnight UTC and reading it with the *local* getters prints 1 March on
   * every phone west of Greenwich. This is not the same problem
   * `lib/format.ts` solves — that one is about instants.
   */
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * Mirrors `buildIdCardData` in `apps/web/src/components/resident-identity.tsx`,
 * including the two pieces of judgement embedded in it:
 *
 * 1. **`UNKNOWN` is never printed as a blood group.** It is the schema's
 *    placeholder default, and a paramedic reading "UNKNOWN" off a card cannot
 *    tell it from a real answer. It becomes a dash like any other blank.
 * 2. **An approved owner's or provider's `cardRole` outranks the profile's
 *    course or occupation** — it is what the card is now *for*.
 */
export function buildIdCard(
  identity: Identity,
  profile: IdentityProfile | null,
  now: Date = new Date(),
): IdCard {
  const variant = CARD_VARIANTS[identity.cardType] ?? CARD_VARIANTS.RESIDENT;
  const bloodGroup =
    profile?.bloodGroup && profile.bloodGroup !== "UNKNOWN" ? profile.bloodGroup : null;

  return {
    accent: variant.accent,
    backBullets: variant.backBullets,
    fullName: profile?.fullName ?? identity.accountName,
    idLabel: variant.idLabel,
    issuedOn: cardDate(identity.updatedAt ?? now.toISOString()) ?? "—",
    residentId: identity.residentId ?? "—",
    role:
      identity.cardRole ||
      profile?.courseOrDesignation ||
      profile?.institution ||
      OCCUPATION_LABELS[profile?.occupation ?? "OTHER"] ||
      "Resident",
    rows: [
      ["ID NO", identity.residentId ?? "—"],
      ["DOB", cardDate(profile?.dateOfBirth) ?? "—"],
      ["BLOOD", bloodGroup ?? "—"],
      ["PHONE", profile?.primaryPhone ?? "—"],
      ["E-MAIL", profile?.primaryEmail ?? identity.accountEmail ?? "—"],
    ],
    title: variant.title,
  };
}

/** There is no card at all until a profile has been saved and an id minted. */
export function hasIdCard(identity: Identity): boolean {
  return identity.hasProfile && Boolean(identity.residentId);
}

/* -------------------------------------------------------------------------- */
/* The profile form                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The form's own shape: every field a string, because that is what a `TextInput`
 * holds. `toProfileInput` converts it to the payload, and the empty-string →
 * omitted step is the important half — see its comment.
 */
export type IdentityDraft = Record<IdentityTextField, string> & {
  bloodGroup: BloodGroup;
  dietaryPreference: DietaryPreference;
  gender: Gender | "";
  governmentIdType: GovernmentIdType | "";
  interests: string[];
  occupation: Occupation;
};

export type IdentityTextField =
  | "alternatePhone"
  | "backupEmail"
  | "budgetRange"
  | "city"
  | "courseOrDesignation"
  | "dateOfBirth"
  | "emergencyContactName"
  | "emergencyContactPhone"
  | "emergencyContactRelation"
  | "fullName"
  | "governmentIdNumber"
  | "guardianEmail"
  | "guardianName"
  | "guardianPhone"
  | "guardianRelation"
  | "institution"
  | "medicalNotes"
  | "permanentAddress"
  | "primaryEmail"
  | "primaryPhone"
  | "province"
  | "secondGuardianEmail"
  | "secondGuardianName"
  | "secondGuardianPhone"
  | "secondGuardianRelation";

export type IdentityErrors = Partial<Record<keyof IdentityDraft, string>>;

export function emptyIdentityDraft(): IdentityDraft {
  return {
    alternatePhone: "",
    backupEmail: "",
    bloodGroup: "UNKNOWN",
    budgetRange: "",
    city: "",
    courseOrDesignation: "",
    dateOfBirth: "",
    dietaryPreference: "NO_PREFERENCE",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelation: "",
    fullName: "",
    gender: "",
    governmentIdNumber: "",
    governmentIdType: "",
    guardianEmail: "",
    guardianName: "",
    guardianPhone: "",
    guardianRelation: "",
    institution: "",
    interests: [],
    medicalNotes: "",
    occupation: "STUDENT",
    permanentAddress: "",
    primaryEmail: "",
    primaryPhone: "",
    province: "",
    secondGuardianEmail: "",
    secondGuardianName: "",
    secondGuardianPhone: "",
    secondGuardianRelation: "",
  };
}

/** Prefills the form from a saved profile so an edit is an edit, not a retype. */
export function draftFromProfile(profile: IdentityProfile | null): IdentityDraft {
  const draft = emptyIdentityDraft();

  if (!profile) {
    return draft;
  }

  const text = (value: string | undefined) => value ?? "";

  return {
    ...draft,
    alternatePhone: text(profile.alternatePhone),
    backupEmail: text(profile.backupEmail),
    bloodGroup: profile.bloodGroup,
    budgetRange: text(profile.budgetRange),
    city: text(profile.city),
    courseOrDesignation: text(profile.courseOrDesignation),
    dateOfBirth: text(profile.dateOfBirth),
    dietaryPreference: profile.dietaryPreference,
    emergencyContactName: text(profile.emergencyContactName),
    emergencyContactPhone: text(profile.emergencyContactPhone),
    emergencyContactRelation: text(profile.emergencyContactRelation),
    fullName: profile.fullName,
    gender: profile.gender,
    governmentIdNumber: text(profile.governmentIdNumber),
    governmentIdType: profile.governmentIdType ?? "",
    guardianEmail: text(profile.guardianEmail),
    guardianName: profile.guardianName,
    guardianPhone: profile.guardianPhone,
    guardianRelation: profile.guardianRelation,
    institution: text(profile.institution),
    interests: profile.interests ?? [],
    medicalNotes: text(profile.medicalNotes),
    occupation: profile.occupation,
    permanentAddress: text(profile.permanentAddress),
    primaryEmail: profile.primaryEmail,
    primaryPhone: profile.primaryPhone,
    province: text(profile.province),
    secondGuardianEmail: text(profile.secondGuardianEmail),
    secondGuardianName: text(profile.secondGuardianName),
    secondGuardianPhone: text(profile.secondGuardianPhone),
    secondGuardianRelation: text(profile.secondGuardianRelation),
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `phone` on the server: trimmed, 7–24 characters. No pattern beyond length. */
function phoneError(value: string, label: string): string | null {
  const trimmed = value.trim();

  if (trimmed.length < 7) {
    return `${label} needs at least 7 characters.`;
  }

  return trimmed.length > 24 ? `${label} is too long.` : null;
}

/**
 * Mirrors `residentProfileDataSchema`. Seven fields are required and the rest are
 * validated only when filled, which is exactly what the server's
 * `blankToUndefined` preprocessing does — a blank optional field must never fail
 * the submission.
 */
export function validateIdentity(draft: IdentityDraft): IdentityErrors {
  const errors: IdentityErrors = {};
  const text = (field: IdentityTextField) => draft[field].trim();

  if (text("fullName").length < 2) {
    errors.fullName = "Enter your full name.";
  } else if (text("fullName").length > 120) {
    errors.fullName = "That name is too long.";
  }

  if (!draft.gender) {
    errors.gender = "Pick one.";
  }

  const primaryPhone = phoneError(draft.primaryPhone, "Your phone number");

  if (primaryPhone) {
    errors.primaryPhone = primaryPhone;
  }

  if (!EMAIL.test(text("primaryEmail"))) {
    errors.primaryEmail = "Enter a valid email address.";
  }

  if (text("guardianName").length < 2) {
    errors.guardianName = "The hostel needs one reachable adult.";
  }

  if (text("guardianRelation").length < 2) {
    errors.guardianRelation = "How are they related to you?";
  }

  const guardianPhone = phoneError(draft.guardianPhone, "Their phone number");

  if (guardianPhone) {
    errors.guardianPhone = guardianPhone;
  }

  /* Optional-when-filled from here down. */

  if (text("dateOfBirth") && !ISO_DATE.test(text("dateOfBirth"))) {
    errors.dateOfBirth = "Use YYYY-MM-DD.";
  }

  if (text("backupEmail")) {
    if (!EMAIL.test(text("backupEmail"))) {
      errors.backupEmail = "Enter a valid email address.";
    } else if (
      text("backupEmail").toLowerCase() === text("primaryEmail").toLowerCase()
    ) {
      // The server's own `.refine`, which fails the whole save rather than one
      // field — worth catching here so the message lands next to the input.
      errors.backupEmail = "Use a different address from your main one.";
    }
  }

  if (text("guardianEmail") && !EMAIL.test(text("guardianEmail"))) {
    errors.guardianEmail = "Enter a valid email address.";
  }

  if (text("secondGuardianEmail") && !EMAIL.test(text("secondGuardianEmail"))) {
    errors.secondGuardianEmail = "Enter a valid email address.";
  }

  for (const field of [
    "alternatePhone",
    "emergencyContactPhone",
    "secondGuardianPhone",
  ] as const) {
    if (draft[field].trim()) {
      const problem = phoneError(draft[field], "That number");

      if (problem) {
        errors[field] = problem;
      }
    }
  }

  if (text("medicalNotes").length > 500) {
    errors.medicalNotes = "Keep this under 500 characters.";
  }

  if (text("permanentAddress").length > 240) {
    errors.permanentAddress = "That address is too long.";
  }

  if (draft.interests.length > 12) {
    errors.interests = "Up to 12.";
  }

  return errors;
}

export function hasIdentityErrors(errors: IdentityErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * The draft as the save payload.
 *
 * **A blank optional field is omitted, not sent as `""`.** The server's
 * preprocessing does convert `""` to `undefined` — it was written for an HTML
 * form, where an untouched input arrives as an empty string — but relying on that
 * would put `primaryEmail: ""` through `z.string().email()` for a *required*
 * field and, worse, make the `optionalEnum` fields depend on a coercion the
 * client can see and should not need. Sending only what was filled in is the
 * payload the schema describes.
 */
export function toProfileInput(draft: IdentityDraft): IdentityProfileInput {
  const text = (field: IdentityTextField) => draft[field].trim() || undefined;

  return {
    ...(text("alternatePhone") ? { alternatePhone: text("alternatePhone") } : {}),
    ...(text("backupEmail") ? { backupEmail: text("backupEmail") } : {}),
    ...(text("budgetRange") ? { budgetRange: text("budgetRange") } : {}),
    ...(text("city") ? { city: text("city") } : {}),
    ...(text("courseOrDesignation")
      ? { courseOrDesignation: text("courseOrDesignation") }
      : {}),
    ...(text("dateOfBirth") ? { dateOfBirth: text("dateOfBirth") } : {}),
    ...(text("emergencyContactName")
      ? { emergencyContactName: text("emergencyContactName") }
      : {}),
    ...(text("emergencyContactPhone")
      ? { emergencyContactPhone: text("emergencyContactPhone") }
      : {}),
    ...(text("emergencyContactRelation")
      ? { emergencyContactRelation: text("emergencyContactRelation") }
      : {}),
    ...(text("governmentIdNumber")
      ? { governmentIdNumber: text("governmentIdNumber") }
      : {}),
    ...(draft.governmentIdType ? { governmentIdType: draft.governmentIdType } : {}),
    ...(text("guardianEmail") ? { guardianEmail: text("guardianEmail") } : {}),
    ...(text("institution") ? { institution: text("institution") } : {}),
    ...(text("medicalNotes") ? { medicalNotes: text("medicalNotes") } : {}),
    ...(text("permanentAddress")
      ? { permanentAddress: text("permanentAddress") }
      : {}),
    ...(text("province") ? { province: text("province") } : {}),
    ...(text("secondGuardianEmail")
      ? { secondGuardianEmail: text("secondGuardianEmail") }
      : {}),
    ...(text("secondGuardianName")
      ? { secondGuardianName: text("secondGuardianName") }
      : {}),
    ...(text("secondGuardianPhone")
      ? { secondGuardianPhone: text("secondGuardianPhone") }
      : {}),
    ...(text("secondGuardianRelation")
      ? { secondGuardianRelation: text("secondGuardianRelation") }
      : {}),
    bloodGroup: draft.bloodGroup,
    dietaryPreference: draft.dietaryPreference,
    fullName: draft.fullName.trim(),
    // Validated before this runs; the cast is the one place the form's "nothing
    // picked yet" empty string is discharged.
    gender: draft.gender as Exclude<IdentityDraft["gender"], "">,
    guardianName: draft.guardianName.trim(),
    guardianPhone: draft.guardianPhone.trim(),
    guardianRelation: draft.guardianRelation.trim(),
    // De-duplicated and blank-stripped here as well as on the server, so the
    // chip list a user sees is the list that gets stored.
    interests: Array.from(new Set(draft.interests.map((i) => i.trim()).filter(Boolean))),
    occupation: draft.occupation,
    primaryEmail: draft.primaryEmail.trim().toLowerCase(),
    primaryPhone: draft.primaryPhone.trim(),
  };
}
