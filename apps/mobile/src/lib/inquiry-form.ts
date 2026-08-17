/**
 * What has to be true before an inquiry is worth sending.
 *
 * Mirrors `publicInquiryCreateSchema` rather than inventing softer rules, and
 * lives in `lib/` so it is testable — Vitest here is node-side with no React
 * Native shim.
 *
 * The bar is deliberately low: a name and a phone number. This is the form a
 * hostel-hunting student fills in on a bus, and every extra required field is
 * a reason to close the app. The optional ones exist because a hostel that has
 * to ring back to ask "how many sharing?" takes a day longer to answer.
 */

export type InquiryDraft = {
  email: string;
  message: string;
  name: string;
  phone: string;
};

export type InquiryErrors = Partial<Record<keyof InquiryDraft, string>>;

/**
 * Nepali mobile numbers are 10 digits and start `98`/`97`; landlines and the
 * `+977` prefix are also legitimate. So this checks the *digit count* after
 * stripping formatting rather than pattern-matching a carrier — the server
 * accepts 7–24 characters, and a client stricter than the server rejects real
 * customers.
 */
export function normalizePhone(raw: string): string {
  return raw.replace(/[\s()-]/g, "");
}

export function validateInquiry(draft: InquiryDraft): InquiryErrors {
  const errors: InquiryErrors = {};
  const name = draft.name.trim();
  const phone = normalizePhone(draft.phone);

  if (name.length < 2) {
    errors.name = "Tell them who is asking.";
  } else if (name.length > 120) {
    errors.name = "That name is too long.";
  }

  if (!phone) {
    errors.phone = "A phone number is how the hostel replies.";
  } else if (!/^\+?\d{7,23}$/.test(phone)) {
    errors.phone = "That doesn't look like a phone number.";
  }

  // Optional, but a typo here means the reply goes nowhere and the student
  // concludes the hostel ignored them.
  if (draft.email.trim() && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(draft.email.trim())) {
    errors.email = "Check that email address.";
  }

  if (draft.message.trim().length > 1200) {
    errors.message = "That message is too long.";
  }

  return errors;
}

export function hasInquiryErrors(errors: InquiryErrors): boolean {
  return Object.keys(errors).length > 0;
}
