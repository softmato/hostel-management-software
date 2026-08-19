/**
 * The service-provider application, as a value.
 *
 * ## Why this is a module and not state inside the screen
 *
 * The screen is a five-step wizard, and the two things a wizard gets wrong are
 * *which step a missing field belongs to* and *what it finally submits*. Both are
 * pure functions of the form, both are worth tests, and neither can be tested
 * inside a component that imports `expo-camera`. So the screen owns one state
 * object and asks this module every question about it.
 *
 * ## The field list is the server's, not the website's
 *
 * Typed from `serviceProviderRegisterSchema` in
 * `apps/web/src/modules/service-providers/service-provider.validation.ts`. That
 * matters in one place: `categories` is an **array** with the first entry
 * treated as the headline trade (`normalizeProviderCategories`), so the order the
 * chips are tapped in is meaningful and the form has to preserve it rather than
 * storing a set.
 */

export const PROVIDER_CATEGORIES = [
  "PLUMBER",
  "ELECTRICIAN",
  "DOCTOR_CLINIC",
  "INTERNET_TECHNICIAN",
  "CLEANER",
  "CARPENTER",
  "PAINTER",
  "WATER_SUPPLIER",
  "APPLIANCE_REPAIR",
  "ROOM_REPAIR",
  "OTHER",
] as const;

export type ProviderCategory = (typeof PROVIDER_CATEGORIES)[number];

/** `INTERNET_TECHNICIAN` → `Internet Technician`. The website's own transform. */
export function providerCategoryLabel(category: string): string {
  return category
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

/** An uploaded file, reduced to what the payload and the chip both need. */
export type ProviderAttachment = {
  fileName: string;
  url: string;
};

export type ProviderForm = {
  area: string;
  availability: string;
  categories: ProviderCategory[];
  city: string;
  description: string;
  documents: ProviderAttachment[];
  experience: string;
  fullName: string;
  phone: string;
  /**
   * The live portrait, taken on step 4. Held apart from `documents` because it
   * is required, because it is captured rather than picked, and because it is
   * submitted under a different `documentType`.
   */
  selfie: ProviderAttachment | null;
};

export const EMPTY_PROVIDER_FORM: ProviderForm = {
  area: "",
  availability: "",
  categories: [],
  city: "Kathmandu",
  description: "",
  documents: [],
  experience: "",
  fullName: "",
  phone: "",
  selfie: null,
};

/**
 * The steps, in order.
 *
 * Five short ones rather than the website's two long ones. A desktop form can
 * put nine fields on a page because they are all visible at once; on a phone
 * "step 2 of 2" means an unbroken column of eleven inputs and a submit button
 * somewhere past the bottom of the screen, which is the shape people abandon.
 */
export const PROVIDER_STEPS = [
  { key: "you", label: "About you" },
  { key: "trades", label: "Your trades" },
  { key: "area", label: "Where you work" },
  { key: "selfie", label: "Your photo" },
  { key: "review", label: "Review" },
] as const;

export type ProviderStepKey = (typeof PROVIDER_STEPS)[number]["key"];

export type ProviderErrors = Partial<Record<keyof ProviderForm, string>>;

/**
 * What is wrong with one step, keyed by field so the message renders under the
 * input it is about.
 *
 * The bounds are the schema's, to the digit — `fullName` 2–160, `phone` 7–24,
 * `area` 2–120. A form that accepts a one-character name and hands the applicant
 * a 422 afterwards has done nothing except waste the round trip.
 */
export function providerStepErrors(
  step: ProviderStepKey,
  form: ProviderForm,
): ProviderErrors {
  const errors: ProviderErrors = {};

  if (step === "you") {
    const name = form.fullName.trim();

    if (name.length < 2) {
      errors.fullName = "Tell us the name hostels should ask for.";
    } else if (name.length > 160) {
      errors.fullName = "That name is too long.";
    }

    const phone = form.phone.trim();

    if (phone.length < 7) {
      errors.phone = "A working phone number — this is how a hostel reaches you.";
    } else if (phone.length > 24) {
      errors.phone = "That number is too long.";
    }
  }

  if (step === "trades" && form.categories.length === 0) {
    errors.categories = "Pick at least one trade.";
  }

  if (step === "area") {
    const area = form.area.trim();

    if (area.length < 2) {
      errors.area = "Which neighbourhood do you cover?";
    } else if (area.length > 120) {
      errors.area = "That is too long for one area.";
    }

    if (form.city.trim().length < 2) {
      errors.city = "Which city?";
    }
  }

  /*
   * The selfie is required, and it is the one requirement this app adds to the
   * website's form.
   *
   * It is not decoration: approval turns the application into a directory
   * listing and an ID card that a resident is shown at their door before letting
   * a stranger into the building, and `PROFILE_PHOTO` is the portrait on it. A
   * gallery pick can be anyone; a photo taken through this screen was taken by
   * the person holding the phone that filed the application. The reviewer gets a
   * face they can compare against the ID document, which is what makes the
   * approval mean anything.
   */
  if (step === "selfie" && !form.selfie) {
    errors.selfie = "Take a photo of yourself to finish — it goes on your ID card.";
  }

  return errors;
}

export function hasProviderErrors(errors: ProviderErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** A step is done when it has nothing wrong with it — drives the tracker's ticks. */
export function isProviderStepComplete(
  step: ProviderStepKey,
  form: ProviderForm,
): boolean {
  return !hasProviderErrors(providerStepErrors(step, form));
}

/**
 * The first step that still has something missing, or `null` when the form is
 * submittable.
 *
 * Used by the review step's submit: jumping to the offending step is the only
 * useful thing to do about a wizard that cannot submit, and reporting "phone is
 * required" on a screen with no phone field on it is the classic failure.
 */
export function firstIncompleteProviderStep(form: ProviderForm): ProviderStepKey | null {
  return (
    PROVIDER_STEPS.find((step) => !isProviderStepComplete(step.key, form))?.key ?? null
  );
}

/**
 * Adds or removes a trade, preserving tap order.
 *
 * Order is the point — see the module note. `[...current, category]` rather than
 * a `Set`, because the first entry becomes `ServiceProvider.category`, the trade
 * the listing and every email calls them.
 */
export function toggleProviderCategory(
  categories: ProviderCategory[],
  category: ProviderCategory,
): ProviderCategory[] {
  return categories.includes(category)
    ? categories.filter((item) => item !== category)
    : [...categories, category];
}

export type ProviderRegisterPayload = {
  area: string;
  availability?: string;
  categories: ProviderCategory[];
  city: string;
  description?: string;
  documents: { documentType: string; fileUrl: string }[];
  email?: string;
  experience: string | undefined;
  fullName: string;
  phone: string;
};

/**
 * The request body for `POST /public/service-providers/register`.
 *
 * ## Two decisions worth naming
 *
 * **The selfie is submitted as `PROFILE_PHOTO`.** Not as `SELFIE`: the platform's
 * review page looks up exactly that string to find the portrait it draws
 * (`PHOTO_DOCUMENT_TYPE` in `platform-service-provider-review-page.tsx`), so a
 * more descriptive type would file the photo where the reviewer's screen cannot
 * see it, and the application would look like it arrived with no face on it.
 *
 * **Empty optionals are dropped, not sent as `""`.** The schema's `.max()` rules
 * pass an empty string happily, so this is not about validation — it is that a
 * stored `availability: ""` renders as an empty row on the review screen where an
 * absent one renders as nothing.
 *
 * `email` comes from the session rather than the form. The account is what the
 * approval upgrades, so the address on the application has to be the account's.
 */
export function buildProviderPayload(
  form: ProviderForm,
  email: string | null,
): ProviderRegisterPayload {
  const documents = [
    ...(form.selfie
      ? [{ documentType: "PROFILE_PHOTO", fileUrl: form.selfie.url }]
      : []),
    ...form.documents.map((document) => ({
      documentType: "PROFILE_DOCUMENT",
      fileUrl: document.url,
    })),
    // The schema caps documents at 8 and the server 422s on the ninth. The
    // selfie is first, so a truncation drops a supporting file and never the
    // portrait the reviewer needs.
  ].slice(0, 8);

  return {
    area: form.area.trim(),
    availability: form.availability.trim() || undefined,
    categories: form.categories,
    city: form.city.trim() || "Kathmandu",
    description: form.description.trim() || undefined,
    documents,
    email: email?.trim() || undefined,
    experience: form.experience.trim() || undefined,
    fullName: form.fullName.trim(),
    phone: form.phone.trim(),
  };
}
