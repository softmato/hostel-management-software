/**
 * Everything that starts, refreshes or ends a session.
 *
 * The boot contract (docs/MOBILE_APP_PHASES.md §0):
 *
 *   1. Splash stays up while we read SecureStore.
 *   2. If a token is there, route from the *cached* account immediately — no
 *      await on the network. This is the whole point: a warm start must never
 *      flash the login screen on its way to the dashboard.
 *   3. Only then does `revalidate()` run, confirming the token and the role are
 *      still what we cached. If they changed, we re-route; if the token is
 *      dead, the axios interceptor ends the session.
 *   4. With no token, we route to login before the splash hides.
 *
 * Step 2 and step 3 are deliberately not awaited together. Awaiting `/auth/me`
 * before the first navigation is the bug this whole file exists to avoid — it
 * turns every cold start into a second of blank screen on a slow connection.
 */

import { router } from "expo-router";

import { bindSessionHandlers, rotateAccessToken } from "@/lib/api";
import {
  type ApiUser,
  fetchActivationStatus,
  fetchMe,
  logout as revokeSession,
} from "@/lib/auth-api";
import { revokePushToken } from "@/lib/push-notifications";
import { clearQueryCache } from "@/lib/query-cache";
import { resetUploadNotifications } from "@/lib/upload-notifier";
import { clearTokens, readTokens, writeTokens } from "@/lib/session";
import { persistor, resetStore, store } from "@/store";
import {
  clearAuth,
  setAccessToken,
  setAccount,
  setReady,
  setResidentActivated,
  setSession,
  setSessionEndReason,
} from "@/store/slices/authSlice";
import { ROLE } from "@/constants/roles";

/** Wire the HTTP layer to the store once, at module load. */
bindSessionHandlers({
  getAccessToken: () => store.getState().auth.accessToken,
  onAccessToken: (token) => store.dispatch(setAccessToken(token)),
  onSessionEnded: async (reason) => {
    await endSession({ reason, revoke: false });

    /*
     * A suspended account needs to be told why, so it lands on the login screen
     * where that message is shown. An expired session is ordinary — drop back
     * to the public app the same way the website does, rather than confronting
     * someone with a login form they did not ask for. The reason is still on
     * the store, so the login screen explains itself if they go there.
     */
    router.replace(reason === "SUSPENDED" ? "/(auth)/login" : "/(browse)");
  },
});

export type BootResult = {
  account: ApiUser | null;
  isResidentActivated: boolean | null;
};

/**
 * Reads persisted credentials and puts the token back in memory.
 *
 * Returns the *cached* account — deliberately. Nothing here touches the
 * network.
 */
export async function bootstrapSession(): Promise<BootResult> {
  const tokens = await readTokens();
  const cached = store.getState().auth;

  if (!tokens) {
    // Tokens gone but an account still cached (app data cleared, keychain reset
    // on restore-from-backup) — drop the stale account so the gate sends the
    // user to login rather than to a dashboard that will 401 on first paint.
    if (cached.account) {
      store.dispatch(clearAuth());
    }

    return { account: null, isResidentActivated: null };
  }

  store.dispatch(setAccessToken(tokens.accessToken));

  return {
    account: cached.account,
    isResidentActivated: cached.isResidentActivated,
  };
}

/**
 * Confirms the cached account against the server. Runs *after* the first
 * navigation, so a slow or failed call costs nothing visible.
 *
 * Returns the fresh account when something changed and the caller should
 * re-route, or `null` when the cache was already correct.
 */
export async function revalidateSession(): Promise<ApiUser | null> {
  const before = store.getState().auth;

  if (!before.accessToken) {
    return null;
  }

  let account: ApiUser;

  try {
    account = await fetchMe();
  } catch {
    // A 401 has already been handled by the interceptor (refresh, or session
    // end). Anything else is a network blip — keep showing cached data rather
    // than logging someone out because their train went into a tunnel.
    return null;
  }

  store.dispatch(setAccount(account));

  const roleChanged = before.account?.role !== account.role;

  /*
   * A changed role has to reach the *token* before it reaches the router.
   *
   * `/auth/me` reads the user record, but every request is authorised from the
   * claims baked into the access token, so an account promoted elsewhere — a
   * hostel scanning somebody's ID card at the desk and registering them, which
   * turns a PUBLIC account into a RESIDENT one server-side — is still a public
   * user to this phone until its token expires. Re-routing on `/auth/me` alone
   * put them on a resident dashboard where every call came back refused, and
   * the 403s are not 401s, so nothing below would have refreshed either.
   *
   * Rotating first also makes the activation lookup underneath truthful: it is
   * a resident-only endpoint, and asking it with a public token answers
   * "not activated" for somebody who is.
   */
  if (roleChanged) {
    await rotateAccessToken();
  }

  let activated = before.isResidentActivated;

  if (account.role === ROLE.RESIDENT) {
    activated = await fetchActivationStatus().catch(() => activated);

    if (typeof activated === "boolean") {
      store.dispatch(setResidentActivated(activated));
    }
  }

  const providerChanged = before.account?.isServiceProvider !== account.isServiceProvider;
  const activationChanged = before.isResidentActivated !== activated;

  /*
   * `mustChangePassword` is deliberately not in this list. It no longer decides
   * where anyone lands — see `resolveHome` — so a change to it is not a reason
   * to pull the screen out from under someone mid-launch.
   */
  return roleChanged || providerChanged || activationChanged ? account : null;
}

/** Called on every successful login, signup, Google exchange and QR activation. */
export async function startSession(result: {
  accessToken: string;
  refreshToken: string;
  user: ApiUser;
}) {
  await writeTokens({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
  });

  store.dispatch(setSession({ accessToken: result.accessToken, account: result.user }));

  if (result.user.role === ROLE.RESIDENT) {
    // Decides between the dashboard and the activation screen, so it is worth
    // one blocking call here — unlike on boot, the user is already waiting on a
    // button press and expects a moment of work.
    const activated = await fetchActivationStatus().catch(() => null);

    if (typeof activated === "boolean") {
      store.dispatch(setResidentActivated(activated));
    }
  }

  return store.getState().auth;
}

/**
 * Ends a session and leaves nothing behind.
 *
 * `revoke: false` is for the case where the refresh token is already dead —
 * calling `/auth/logout` with it would just 401.
 */
export async function endSession(options?: {
  reason?: "EXPIRED" | "SUSPENDED" | null;
  revoke?: boolean;
}) {
  const { reason = null, revoke = true } = options ?? {};

  /*
   * Before `clearTokens`, because this call is authenticated.
   *
   * Unconditional, unlike the session revoke below: `revoke: false` means the
   * *refresh* token is already dead, not that this device should carry on
   * receiving the departing account's notifications. The push row is keyed to a
   * user id and survives sign-out, so without this the previous account's
   * invoices, complaint replies and SOS alerts keep arriving on a handset it has
   * signed out of. Never throws — see `revokePushToken`.
   */
  await revokePushToken();

  /*
   * Clears the upload shade for the departing account. The tally is per-batch
   * and holds a label like "Payment proof"; leaving it posted would show the
   * next person to sign in on this handset what the last one was uploading.
   */
  resetUploadNotifications();

  /*
   * The in-memory half of `persistor.purge()` below.
   *
   * `lib/query-cache.ts` holds whole rosters, invoice matrices and claim
   * evidence for the account that is leaving. Hostel phones get handed around —
   * an owner signs out, a warden signs in — and a cache that survived that would
   * hand the next person the last one's resident list on their first tab switch.
   */
  clearQueryCache();

  if (revoke) {
    const tokens = await readTokens();

    if (tokens?.refreshToken) {
      await revokeSession(tokens.refreshToken);
    }
  }

  await clearTokens();

  store.dispatch(resetStore());
  await persistor.purge();

  // `resetStore` cleared it, so re-flag the two things the login screen needs:
  // that boot is done (otherwise the gate re-runs and hangs on the splash) and
  // why the user is here.
  store.dispatch(setReady(true));

  if (reason) {
    store.dispatch(setSessionEndReason(reason));
  }
}
