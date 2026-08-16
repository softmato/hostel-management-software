/**
 * The single HTTP client.
 *
 * Three responsibilities, in order:
 *  1. Resolve the API base URL, including the dev-machine LAN address so a
 *     physical phone can reach `npm run web:dev`.
 *  2. Attach the access token to every request, plus the mobile client header
 *     that makes `/auth/login` return `refreshToken` in the JSON body instead of
 *     a cookie (apps/web/src/lib/mobile-auth.ts).
 *  3. On 401: refresh once, replay the queued requests, and if the refresh
 *     itself fails, end the session properly — wipe every slice, purge what is
 *     on disk, and send the user to login.
 */

import {
  create,
  type AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from "axios";
import Constants from "expo-constants";
import { Platform } from "react-native";

import { AUTH_CLIENT_HEADER, MOBILE_AUTH_CLIENT } from "@/lib/api-contract";
import { clearTokens, readTokens, writeAccessToken } from "@/lib/session";

const FALLBACK_API_URL = "http://localhost:3000";
const DEV_WEB_PORT = process.env.EXPO_PUBLIC_WEB_DEV_PORT?.trim() || "3000";

function trimTrailingSlash(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : "";
}

/** The host Metro is being served from — i.e. the dev machine's LAN address. */
function expoHostUri() {
  const constants = Constants as unknown as {
    expoConfig?: { hostUri?: string };
    manifest?: { debuggerHost?: string; hostUri?: string };
    manifest2?: { extra?: { expoClient?: { hostUri?: string } } };
  };

  return (
    constants.expoConfig?.hostUri ||
    constants.manifest2?.extra?.expoClient?.hostUri ||
    constants.manifest?.hostUri ||
    constants.manifest?.debuggerHost ||
    ""
  );
}

function hostOf(hostUri: string) {
  const withPort = hostUri.replace(/^[a-z][a-z\d+.-]*:\/\//i, "").split("/")[0];
  return withPort?.split(":")[0]?.trim() ?? "";
}

function isPrivateHost(host: string) {
  if (!host) return false;
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (host.startsWith("192.168.") || host.startsWith("10.")) return true;

  const match = /^172\.(\d{1,3})\./.exec(host);
  if (!match) return false;

  const secondOctet = Number(match[1]);
  return secondOctet >= 16 && secondOctet <= 31;
}

/** The Android emulator reaches the host machine at 10.0.2.2, not localhost. */
function forEmulator(host: string) {
  return Platform.OS === "android" && (host === "localhost" || host === "127.0.0.1")
    ? "10.0.2.2"
    : host;
}

export function resolveApiBaseUrl() {
  const configured = trimTrailingSlash(process.env.EXPO_PUBLIC_API_URL);

  if (__DEV__) {
    // In dev, prefer the machine serving Metro: it is almost always also
    // running `npm run web:dev`, and hardcoding a LAN IP goes stale every time
    // the router hands out a new lease.
    const host = hostOf(expoHostUri());
    if (host && isPrivateHost(host) && (!configured || isPrivateHost(hostOf(configured)))) {
      return `http://${forEmulator(host)}:${DEV_WEB_PORT}`;
    }
  }

  return configured || FALLBACK_API_URL;
}

export const API_BASE_URL = resolveApiBaseUrl();

function createClient(): AxiosInstance {
  return create({
    baseURL: `${API_BASE_URL}/api/v1`,
    headers: {
      "Content-Type": "application/json",
      [AUTH_CLIENT_HEADER]: MOBILE_AUTH_CLIENT,
    },
    timeout: 20000,
  });
}

/** Authenticated client. Use for everything except login/refresh. */
export const api = createClient();

/**
 * Unauthenticated client, and deliberately a *separate instance*: it has no
 * interceptors, so a 401 from `/auth/login` surfaces as "wrong password"
 * instead of triggering a refresh-and-logout cycle.
 */
export const publicApi = createClient();

/** Set by the store module on boot to avoid a require cycle (store → api → store). */
type SessionHandlers = {
  getAccessToken: () => string | null;
  onAccessToken: (token: string) => void;
  onSessionEnded: (reason: "EXPIRED" | "SUSPENDED") => Promise<void> | void;
};

let handlers: SessionHandlers | null = null;

export function bindSessionHandlers(next: SessionHandlers) {
  handlers = next;
}

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = handlers?.getAccessToken() ?? (await readTokens())?.accessToken;

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

let refreshing = false;
let waiters: ((token: string | null) => void)[] = [];

function releaseWaiters(token: string | null) {
  const pending = waiters;
  waiters = [];
  pending.forEach((resolve) => resolve(token));
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const request = error.config as
      | (InternalAxiosRequestConfig & { _retried?: boolean })
      | undefined;

    if (!request || error.response?.status !== 401 || request._retried) {
      return Promise.reject(error);
    }

    // A refresh is already in flight — park this request rather than starting a
    // second one. Two parallel refreshes race, and the loser's rotated token is
    // already invalid by the time it is written.
    if (refreshing) {
      return new Promise((resolve, reject) => {
        waiters.push((token) => {
          if (!token) {
            reject(error);
            return;
          }

          request._retried = true;
          request.headers.Authorization = `Bearer ${token}`;
          resolve(api(request));
        });
      });
    }

    request._retried = true;
    refreshing = true;

    try {
      const tokens = await readTokens();

      if (!tokens?.refreshToken) {
        throw error;
      }

      const response = await publicApi.post<{
        data: { accessToken: string };
      }>("/auth/refresh", { refreshToken: tokens.refreshToken });

      const accessToken = response.data?.data?.accessToken;

      if (!accessToken) {
        throw error;
      }

      await writeAccessToken(accessToken);
      handlers?.onAccessToken(accessToken);
      releaseWaiters(accessToken);

      request.headers.Authorization = `Bearer ${accessToken}`;
      return await api(request);
    } catch (refreshError) {
      releaseWaiters(null);
      await clearTokens();

      const status = (refreshError as AxiosError)?.response?.status;
      await handlers?.onSessionEnded(status === 403 ? "SUSPENDED" : "EXPIRED");

      return Promise.reject(error);
    } finally {
      refreshing = false;
    }
  },
);
