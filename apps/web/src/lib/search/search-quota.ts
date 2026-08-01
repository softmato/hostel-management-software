import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Per-visitor quota for the LLM fallback on the public hero search.
 *
 * The counter lives in a signed cookie rather than a store: the endpoint is
 * anonymous, so there is no user to key on, and a database row per visitor for
 * a nice-to-have search upgrade is not worth the writes. Clearing cookies
 * resets the quota — accepted, because the downside is one extra free-tier call
 * and the upstream router has its own daily key exhaustion behind this.
 */
export const QUOTA_COOKIE = "hh_search_quota";
const WINDOW_MS = 5 * 60 * 60 * 1000; // 5 hours
export const QUOTA_LIMIT = 10;

export type QuotaState = {
  /** LLM calls already spent in the current window. */
  used: number;
  /** Epoch ms when the window resets. */
  windowEndsAt: number;
};

function secret(): string {
  // Falls back to the cron secret so a missing var cannot silently disable
  // signing; both are required in any real deployment.
  return process.env.SEARCH_QUOTA_SECRET || process.env.CRON_SECRET || "";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Serialize + sign. The signature stops a visitor editing `used` back to 0. */
export function encodeQuota(state: QuotaState): string {
  const payload = `${state.used}.${state.windowEndsAt}`;
  return `${payload}.${sign(payload)}`;
}

export function decodeQuota(raw: string | undefined): QuotaState | null {
  if (!raw) {
    return null;
  }

  const parts = raw.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [used, windowEndsAt, signature] = parts;
  const expected = sign(`${used}.${windowEndsAt}`);

  // Compare as buffers of equal length; a length mismatch is already a reject.
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return null;
  }

  const parsedUsed = Number(used);
  const parsedEnd = Number(windowEndsAt);
  if (!Number.isInteger(parsedUsed) || !Number.isFinite(parsedEnd)) {
    return null;
  }

  return { used: parsedUsed, windowEndsAt: parsedEnd };
}

/** Current window state, starting a fresh one when none is live. */
export function currentWindow(raw: string | undefined, now = Date.now()): QuotaState {
  const decoded = decodeQuota(raw);

  if (!decoded || decoded.windowEndsAt <= now) {
    return { used: 0, windowEndsAt: now + WINDOW_MS };
  }

  return decoded;
}

export function quotaRemaining(state: QuotaState): number {
  return Math.max(0, QUOTA_LIMIT - state.used);
}

/** Cookie lifetime in seconds, so the cookie dies with its window. */
export function quotaMaxAge(state: QuotaState, now = Date.now()): number {
  return Math.max(1, Math.ceil((state.windowEndsAt - now) / 1000));
}
