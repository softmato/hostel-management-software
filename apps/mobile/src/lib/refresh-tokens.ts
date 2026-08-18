/**
 * What to persist after a `/auth/refresh` round trip.
 *
 * ## The server rotates, and the old token dies immediately
 *
 * `refreshAccessToken` in `apps/web/src/modules/auth/auth.service.ts` signs a
 * **new** refresh token on every call and overwrites `session.refreshTokenHash`
 * with its hash before returning. The token that was just spent is dead the
 * moment it is spent — that is the whole point of rotation, and nothing about
 * it is wrong.
 *
 * A browser never notices, because `applySessionCookies` writes the rotated
 * pair straight back into the cookie jar. A phone has no cookie jar, which is
 * why `/auth/refresh` returns `refreshToken` in the JSON body for callers that
 * send `x-hostelhub-client: mobile` (`shouldExposeRefreshToken`).
 *
 * ## Why this is its own function
 *
 * The interceptor that calls it lives in `lib/api.ts`, which imports
 * `expo-constants` and `react-native` and therefore cannot be loaded by the
 * node-only test runner. The *decision* — which of the two tokens to write, and
 * what to do when the response is missing one — is the part worth pinning down,
 * so it is kept here where a test can reach it.
 *
 * The failure this exists to prevent is silent and delayed: persisting only the
 * access token leaves a refresh token the server has already invalidated on
 * disk. The first refresh succeeds and everything looks correct. One
 * access-token TTL later (15 minutes by default) the next refresh 401s, the
 * interceptor ends the session, and the user is dropped on the public stack
 * with no explanation. It reads as "the app logs me out at random" rather than
 * as a token bug.
 */

export type RefreshResponseBody = {
  data?: {
    accessToken?: unknown;
    refreshToken?: unknown;
  } | null;
} | null;

export type RefreshOutcome =
  | {
      accessToken: string;
      /**
       * The rotated refresh token, or `null` when the response did not carry
       * one. `null` means "leave what is on disk alone" — see below.
       */
      refreshToken: string | null;
      ok: true;
    }
  | { ok: false };

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Reads a refresh response into the tokens to persist.
 *
 * An absent `accessToken` is a failure: there is nothing to retry the original
 * request with, and treating a malformed body as success would replay the
 * request with the same dead token and loop.
 *
 * An absent `refreshToken` is **not** a failure, and deliberately does not clear
 * the stored one. A deployment older than the mobile-client header, or a server
 * that answered from the cookie branch, returns only the access token — and in
 * that case the refresh token on disk is still the live one. Wiping it there
 * would turn a harmless version skew into a forced logout.
 */
export function readRefreshOutcome(body: RefreshResponseBody): RefreshOutcome {
  const accessToken = readString(body?.data?.accessToken);

  if (!accessToken) {
    return { ok: false };
  }

  return {
    accessToken,
    ok: true,
    refreshToken: readString(body?.data?.refreshToken),
  };
}
