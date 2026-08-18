/**
 * The access-code sign-in form: what to type, and what the server will accept.
 *
 * Mirrors `guardianLoginSchema` in `apps/web` — `accessCode` 4–24 characters,
 * `phone` 6–32, both trimmed. Kept in `lib/` so it is testable node-side, and
 * kept **at most as strict as the server**: a client that rejects something the
 * server would have taken leaves the person on the phone with no way to find
 * out why.
 *
 * ## The code is normalised, not validated by shape
 *
 * `loginGuardian` uppercases before it looks up, so this does too — otherwise a
 * lower-case code typed exactly right fails with "invalid". Whitespace goes as
 * well, because a code read off a printout is often typed with a space in the
 * middle, and hyphens because people insert them into anything that looks like
 * a code.
 *
 * What this deliberately does **not** do is check the alphabet. The generator
 * now emits 32 unambiguous symbols, but codes issued before 2026-08-17 came
 * from `Math.random().toString(36)` and can contain `0`, `1`, `i` and `o` — a
 * client-side character check would lock out every guardian holding one of
 * those, which is all of them today.
 *
 * ## Why the two failures share a message
 *
 * The server answers `INVALID_GUARDIAN_LOGIN` when *either* half is wrong, and
 * that is right: telling someone which half matched turns a phone number into
 * an oracle for enumerating valid codes. So the client never guesses at a
 * friendlier split either.
 */

/** `guardianLoginSchema`: `z.string().trim().min(4).max(24)`. */
export const ACCESS_CODE_MIN = 4;
export const ACCESS_CODE_MAX = 24;

/** `guardianLoginSchema`: `z.string().trim().min(6).max(32)`. */
export const GUARDIAN_PHONE_MIN = 6;
export const GUARDIAN_PHONE_MAX = 32;

/** Uppercased and stripped of the separators people add when copying a code. */
export function normalizeAccessCode(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

/** Same rule as `lib/inquiry-form.ts` — a pasted number keeps its `+`. */
export function normalizeGuardianPhone(raw: string): string {
  return raw.replace(/[\s()-]/g, "");
}

export type GuardianLoginDraft = { accessCode: string; phone: string };
export type GuardianLoginErrors = Partial<Record<keyof GuardianLoginDraft, string>>;

export function validateGuardianLogin(draft: GuardianLoginDraft): GuardianLoginErrors {
  const errors: GuardianLoginErrors = {};
  const accessCode = normalizeAccessCode(draft.accessCode);
  const phone = normalizeGuardianPhone(draft.phone);

  if (!accessCode) {
    errors.accessCode = "Enter the code your hostel gave you.";
  } else if (accessCode.length < ACCESS_CODE_MIN) {
    errors.accessCode = "That code looks too short.";
  } else if (accessCode.length > ACCESS_CODE_MAX) {
    errors.accessCode = "That code looks too long.";
  }

  if (!phone) {
    errors.phone = "Use the number the hostel registered for you.";
  } else if (phone.length < GUARDIAN_PHONE_MIN) {
    errors.phone = "That doesn't look like a phone number.";
  } else if (phone.length > GUARDIAN_PHONE_MAX) {
    errors.phone = "That doesn't look like a phone number.";
  }

  return errors;
}

export function hasGuardianLoginErrors(errors: GuardianLoginErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Exactly what goes on the wire, once the draft is known to be valid. */
export function guardianLoginPayload(draft: GuardianLoginDraft) {
  return {
    accessCode: normalizeAccessCode(draft.accessCode),
    phone: normalizeGuardianPhone(draft.phone),
  };
}
