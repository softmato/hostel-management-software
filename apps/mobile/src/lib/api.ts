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
 *
 * The refresh **rotates**: the server invalidates the token it was given and
 * returns a new one, so both tokens are written back. `lib/refresh-tokens.ts`
 * has the reasoning and the failure mode that follows from getting it wrong.
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
import {
  readRefreshOutcome,
  type RefreshResponseBody,
} from "@/lib/refresh-tokens";
import { clearTokens, readTokens, writeAccessToken, writeTokens } from "@/lib/session";

/**
 * The deployed web app. It serves the API under `/api/v1`, so this is the origin
 * every build that is not talking to a dev machine should use.
 */
const PRODUCTION_API_URL = "https://hostel-management-software-web.vercel.app";

/**
 * Where to go when `EXPO_PUBLIC_API_URL` is unset.
 *
 * Split by build type, because "unset" means opposite things in each. In a dev
 * build it means "you are running the web app yourself" and localhost is right.
 * In a release build it means the build was configured wrong — and answering
 * `localhost` there is the worst possible failure: every request dies at the
 * loopback with nothing on screen to explain why, and the app looks broken
 * rather than misconfigured. The deployed origin is the only sane answer, so a
 * missing variable costs nothing instead of costing the build.
 *
 * `eas.json` still sets it explicitly on `preview` and `production`. This is the
 * floor, not the mechanism.
 */
const FALLBACK_API_URL = __DEV__ ? "http://localhost:3000" : PRODUCTION_API_URL;
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

/**
 * Where `EXPO_PUBLIC_API_URL` comes from, per build:
 *
 * - **Expo Go / `expo start`** — `apps/mobile/.env`, which does not set it. The
 *   Metro-host branch below takes over.
 * - **`development` EAS profile** — deliberately *not* set in `eas.json`. A dev
 *   client is meant to talk to the dev machine, and a configured public origin
 *   would switch the branch below off (a non-private configured host wins).
 * - **`preview` / `production` EAS profiles** — set in `eas.json` to the
 *   deployed origin. `.env` is gitignored and never reaches an EAS build, which
 *   is exactly how a release APK ended up pointed at its own loopback.
 */
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

/**
 * Rotate the session because the **account** changed, not because a request
 * failed.
 *
 * Every API call is authorised from the claims inside the access token
 * (`payload.role` in `lib/api-auth.ts`), not from the user record. So a public
 * account that a hostel has just registered as a resident — scanned at the desk,
 * promoted by `promoteAccountToResident` — is a RESIDENT in the database and a
 * PUBLIC one to every request this phone makes, for as long as the token in hand
 * lives (`ACCESS_TOKEN_TTL`, 15 minutes by default). `/auth/me` reads the
 * database and so notices immediately; routing to the resident portal on the
 * strength of that alone lands them on a dashboard whose every call is refused.
 * `/auth/refresh` re-reads the user, so one rotation closes that window.
 *
 * Shares the interceptor's `refreshing` flag and its waiter queue, deliberately:
 * a second, independent refresh path racing the first is how the loser writes an
 * already-invalid rotated token and the session dies for good.
 *
 * **Never ends the session.** A failure here means the caller keeps the token it
 * already had, which still works — unlike the interceptor, this is not running
 * over a request that has already been refused.
 */
export async function rotateAccessToken(): Promise<string | null> {
  if (refreshing) {
    return new Promise((resolve) => {
      waiters.push(resolve);
    });
  }

  refreshing = true;

  try {
    const tokens = await readTokens();

    if (!tokens?.refreshToken) {
      releaseWaiters(null);
      return null;
    }

    const response = await publicApi.post<RefreshResponseBody>("/auth/refresh", {
      refreshToken: tokens.refreshToken,
    });

    const outcome = readRefreshOutcome(response.data);

    if (!outcome.ok) {
      releaseWaiters(null);
      return null;
    }

    const { accessToken, refreshToken } = outcome;

    // Both tokens, for the reason the interceptor spells out below: the server
    // invalidates the refresh token it was handed.
    if (refreshToken) {
      await writeTokens({ accessToken, refreshToken });
    } else {
      await writeAccessToken(accessToken);
    }

    handlers?.onAccessToken(accessToken);
    releaseWaiters(accessToken);

    return accessToken;
  } catch {
    releaseWaiters(null);

    return null;
  } finally {
    refreshing = false;
  }
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

      const response = await publicApi.post<RefreshResponseBody>("/auth/refresh", {
        refreshToken: tokens.refreshToken,
      });

      const outcome = readRefreshOutcome(response.data);

      if (!outcome.ok) {
        throw error;
      }

      const { accessToken, refreshToken } = outcome;

      /*
       * Both tokens, not just the access one.
       *
       * The server rotates on every refresh and invalidates the token it was
       * handed (`refreshAccessToken` overwrites `session.refreshTokenHash`), so
       * keeping the old one on disk buys exactly one more refresh before the
       * session dies for good. See `lib/refresh-tokens.ts` — a missing
       * `refreshToken` in the response means "unchanged", not "cleared".
       */
      if (refreshToken) {
        await writeTokens({ accessToken, refreshToken });
      } else {
        await writeAccessToken(accessToken);
      }

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
