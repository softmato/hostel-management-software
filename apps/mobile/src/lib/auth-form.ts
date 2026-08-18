/**
 * Client-side mirrors of the auth schemas in `apps/web`.
 *
 * Two sources: `modules/auth/auth.validation.ts` (register, OTP) and
 * `packages/shared/src/schemas/auth.schema.ts` (password rules). Kept in `lib/`
 * so it is testable — Vitest here is node-side with no React Native shim.
 *
 * These exist to stop avoidable round trips, not to be the authority. Every
 * rule here is *at most* as strict as the server's: a client stricter than the
 * server rejects accounts the server would have accepted, and the person on the
 * phone has no way to find out why. `/auth/otp/request` in particular sends an
 * email per call and is rate limited to five in fifteen minutes — a typo that
 * reaches it costs the user one of five.
 */

/** `passwordSchema`: 8–128. Not a complexity rule — the server has none. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/**
 * Deliberately looser than a full RFC 5322 matcher.
 *
 * The server runs Zod's `.email()`, which this cannot reproduce exactly; the
 * job here is to catch "sita@gmail" and a missing `@`, which are the two typos
 * that actually happen, and to let everything else through to be judged by the
 * server.
 */
export function isProbablyEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(value.trim());
}

export type RegisterDraft = {
  email: string;
  name: string;
  password: string;
};

export type RegisterErrors = Partial<Record<keyof RegisterDraft, string>>;

export function validateRegister(draft: RegisterDraft): RegisterErrors {
  const errors: RegisterErrors = {};
  const name = draft.name.trim();

  if (name.length < 2) {
    errors.name = "Tell us what to call you.";
  } else if (name.length > 120) {
    errors.name = "That name is too long.";
  }

  if (!draft.email.trim()) {
    errors.email = "We send your verification code here.";
  } else if (!isProbablyEmail(draft.email)) {
    errors.email = "Check that email address.";
  }

  const passwordError = validatePassword(draft.password);

  if (passwordError) {
    errors.password = passwordError;
  }

  return errors;
}

/**
 * One message for both new-password fields there are.
 *
 * Returns `null` when the password is fine, so a caller can drop it straight
 * into an errors object.
 */
export function validatePassword(password: string): string | null {
  if (!password) {
    return "Choose a password.";
  }

  if (password.length < PASSWORD_MIN) {
    return `At least ${PASSWORD_MIN} characters.`;
  }

  if (password.length > PASSWORD_MAX) {
    return `At most ${PASSWORD_MAX} characters.`;
  }

  return null;
}

/**
 * `otpVerifySchema` is exactly six digits.
 *
 * Spaces are stripped rather than rejected: people paste "123 456" out of the
 * email, and refusing that is a self-inflicted failure on a code that was
 * correct.
 */
export function normalizeOtpCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

export function isCompleteOtpCode(raw: string): boolean {
  return /^\d{6}$/.test(normalizeOtpCode(raw));
}

/**
 * Pulls the reset token out of whatever the user pasted.
 *
 * The emailed link is `{appUrl}/reset-password?token=…`, and on a phone the
 * whole URL is what gets copied — the token alone requires editing a query
 * string by hand in a text field. `resetPasswordSchema` wants a bare token of
 * at least 20 characters, so both forms are accepted and the URL is unwrapped
 * here.
 */
export function extractResetToken(raw: string): string | null {
  const trimmed = raw.trim();

  if (!trimmed) {
    return null;
  }

  const fromQuery = /[?&]token=([^&\s]+)/.exec(trimmed);
  // `decodeURIComponent` because the link percent-encodes the JWT's separators
  // in some mail clients; a `%2E` left in place is a token that never verifies.
  const candidate = fromQuery ? safeDecode(fromQuery[1]) : trimmed;

  // A pasted URL with no `token=` is not a token, however long it is — posting
  // it burns one of the reset endpoint's attempts for nothing.
  if (!fromQuery && /^https?:\/\//i.test(candidate)) {
    return null;
  }

  return candidate.length >= 20 ? candidate : null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A stray `%` in a pasted string throws; the raw value is still the best
    // guess we have.
    return value;
  }
}
