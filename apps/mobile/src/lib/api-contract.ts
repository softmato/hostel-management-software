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

export function readApiErrorCode(error: unknown): string | null {
  return (error as AxiosError<ApiFailure>)?.response?.data?.errorCode ?? null;
}
