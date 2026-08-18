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

import { bindSessionHandlers } from "@/lib/api";
import {
  type ApiUser,
  fetchActivationStatus,
  fetchMe,
  logout as revokeSession,
} from "@/lib/auth-api";
import { revokePushToken } from "@/lib/push-notifications";
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
    router.replace(reason === "SUSPENDED" ? "/(auth)/login" : "/(public)");
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

  let activated = before.isResidentActivated;

  if (account.role === ROLE.RESIDENT) {
    activated = await fetchActivationStatus().catch(() => activated);

    if (typeof activated === "boolean") {
      store.dispatch(setResidentActivated(activated));
    }
  }

  const roleChanged = before.account?.role !== account.role;
  const providerChanged = before.account?.isServiceProvider !== account.isServiceProvider;
  const activationChanged = before.isResidentActivated !== activated;
  /*
   * An admin can re-issue a temporary password for an account that is already
   * signed in on a phone. The boot gate routed from the cached flag, so without
   * this the app carries on as normal until the next login — which is the whole
   * window the set-password gate exists to close.
   */
  const passwordGateChanged =
    Boolean(before.account?.mustChangePassword) !== Boolean(account.mustChangePassword);

  return roleChanged || providerChanged || activationChanged || passwordGateChanged
    ? account
    : null;
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
