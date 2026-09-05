/**
 * Shapes and constants shared with `apps/web`'s REST layer.
 *
 * Every route handler wraps its payload in `successResponse`, so responses are
 * `{ success: true, message, data }` and failures are
 * `{ success: false, message, errorCode }`. `unwrap` exists so no caller has to
 * remember the envelope.
 */

import type { AxiosError, AxiosResponse } from "axios";

/** Mirrors apps/web/src/lib/mobile-auth.ts. */
export const AUTH_CLIENT_HEADER = "x-hostelhub-client";
export const MOBILE_AUTH_CLIENT = "mobile";

export type ApiEnvelope<T> = {
  data: T;
  message: string;
  success: true;
};

export type ApiFailure = {
  /**
   * What the thrower attached, when it attached anything.
   *
   * `handleRouteError` forwards it from any error carrying a `details` property,
   * so the shape is per-`errorCode` and never guaranteed — a refused payment
   * claim names the month and date it collided with, and most failures carry
   * nothing at all. Read it through {@link readApiErrorDetails}, which types the
   * hole rather than pretending it is filled.
   */
  details?: unknown;
  errorCode: string;
  message: string;
  success: false;
};

export function unwrap<T>(response: AxiosResponse<ApiEnvelope<T>>): T {
  return response.data.data;
}

/**
 * Turns any thrown value into something worth showing a user.
 *
 * The server's own `message` is written for humans, so prefer it. Only fall
 * back to a generic line when there isn't one — "Request failed with status
 * code 500" helps nobody.
 */
export function readApiError(error: unknown, fallback = "Something went wrong."): string {
  const axiosError = error as AxiosError<ApiFailure>;

  if (axiosError?.response?.data?.message) {
    return axiosError.response.data.message;
  }

  if (axiosError?.code === "ECONNABORTED") {
    return "The server took too long to respond. Check your connection and try again.";
  }

  if (axiosError?.request && !axiosError.response) {
    return "Can't reach the server. Check your internet connection.";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

/**
 * The two messages `readApiError` produces when the request never reached a
 * server, held as constants so the predicate below cannot drift from them.
 */
const OFFLINE_MESSAGES = [
  "The server took too long to respond. Check your connection and try again.",
  "Can’t reach the server. Check your internet connection.",
  "Can't reach the server. Check your internet connection.",
] as const;

/**
 * Whether a rendered error message means *no network* rather than *bad answer*.
 *
 * Screens hold `error` as a string — `useResource` throws the raw axios error
 * away — so this reads the message rather than the cause. That is a deliberate
 * trade and not a lossy one: the two strings above are only ever produced by the
 * two branches of `readApiError` that fire when there is no response to read,
 * and a server that genuinely returned one of them as its `message` would be
 * saying the same thing anyway.
 *
 * The alternative is a connectivity listener, which means a native module and a
 * new dev build for a signal that is strictly weaker: a phone can hold four bars
 * of a captive-portal Wi-Fi and reach nothing.
 */
export function isOfflineError(message: string | null | undefined): boolean {
  if (!message) {
    return false;
  }

  return OFFLINE_MESSAGES.some((candidate) => message === candidate);
}

export function readApiErrorCode(error: unknown): string | null {
  return (error as AxiosError<ApiFailure>)?.response?.data?.errorCode ?? null;
}

/**
 * The `details` object a failure carried, or null.
 *
 * Typed by the caller, because the shape belongs to the `errorCode` rather than
 * to the envelope — a refused payment claim carries the month and date it
 * collided with, a validation failure carries Zod issues, and most failures
 * carry nothing. Anything non-object (a string, a number, an array the caller
 * did not expect) reads as null: a caller reaching for `details.priorPeriod` on
 * one should render the generic failure, not `undefined` dressed as a fact.
 */
export function readApiErrorDetails<T>(error: unknown): T | null {
  const details = (error as AxiosError<ApiFailure>)?.response?.data?.details;

  return details && typeof details === "object" && !Array.isArray(details)
    ? (details as T)
    : null;
}
