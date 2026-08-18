/**
 * What to tell someone whose Google sign-in did not hand back a token.
 *
 * Split out from `google-auth.ts` because that module imports
 * `@react-native-google-signin/google-signin`, which reaches `react-native` —
 * and Vitest here is node-side with no RN shim, so anything on that path cannot
 * be loaded by a test file at all. Same split as `lib/status.ts`: the branching
 * lives in the module that can be tested, the native call in the one that
 * cannot.
 *
 * **The status codes are passed in, never hardcoded.** `statusCodes` is
 * resolved by the native module per platform — `SIGN_IN_CANCELLED` is `"12501"`
 * on Android and `"-5"` on iOS — so a literal here would match on one platform
 * and silently fall through to "something went wrong" on the other. The caller
 * is the only place that can read the real values.
 */

/** The subset of the library's `statusCodes` this module branches on. */
export type GoogleStatusCodes = {
  IN_PROGRESS: string;
  PLAY_SERVICES_NOT_AVAILABLE: string;
  SIGN_IN_CANCELLED: string;
};

export const GOOGLE_NOT_CONFIGURED_MESSAGE =
  "Google sign-in is not set up in this build. Use your email and password.";

/**
 * Android's `DEVELOPER_ERROR`, as a literal — the one code here that is not
 * injected, because the library's `statusCodes` has no entry for it and so
 * there is nothing for the caller to pass in.
 *
 * Safe as a literal in a way the others are not: `ErrorDto.kt` stringifies
 * `ApiException.getStatusCode()`, and Android's status codes are positive
 * integers while iOS's `GIDSignInError` values are negative, so `"10"` cannot
 * collide with an iOS code.
 */
const ANDROID_DEVELOPER_ERROR = "10";

/**
 * `DEVELOPER_ERROR`. Google could not match this *installed build* to an OAuth
 * client: package name plus the SHA-1 of the certificate that signed the APK
 * must be registered on an Android client in the same Google Cloud project as
 * `webClientId`. The account sheet still opens — it is only on picking an
 * account that Play services looks the app up and fails.
 *
 * Worth its own message because the generic one tells the user to try again,
 * and no number of retries can fix a build that Google does not recognise.
 * Nothing on the phone is wrong, so it says so and names the one action that
 * helps.
 */
export const GOOGLE_BUILD_NOT_REGISTERED_MESSAGE =
  "This app build is not registered with Google, so Google sign-in cannot work here. Nothing is wrong with your phone or your Google account. Sign in with your email and password, and tell the hostel this build needs its Google setup fixed.";

/**
 * Shown when Google returns a signed-in user whose `idToken` is null. On
 * Android that means `webClientId` was missing or wrong at `configure()` time —
 * the token is minted for the *server's* client, and without one there is
 * nothing to send.
 */
export const GOOGLE_NO_TOKEN_MESSAGE =
  "Google did not return a sign-in token. Use your email and password, and tell the hostel this happened.";

/**
 * Maps a thrown Google error code to a message, or `null` when there is
 * nothing to say.
 *
 * Two outcomes are deliberately silent:
 *
 * - **Cancelled.** Dismissing the account sheet is a decision, not a failure.
 *   An error under the button after backing out of it reads as the app having
 *   broken, and the next thing people do is stop trusting the button.
 * - **In progress.** Fired by a second tap while the first sheet is still
 *   opening. Reporting it makes an impatient double-tap look like a rejection.
 */
export function googleFailureMessage(
  code: string | null | undefined,
  codes: GoogleStatusCodes,
): string | null {
  if (code === codes.SIGN_IN_CANCELLED || code === codes.IN_PROGRESS) {
    return null;
  }

  if (code === codes.PLAY_SERVICES_NOT_AVAILABLE) {
    /*
     * Common on the cheap and grey-import handsets this product targets, where
     * Play Services is old, disabled or absent entirely. It is also the one
     * failure the user can actually fix, so it says how — and names the way
     * round it, because a resident standing at a hostel desk needs to get in
     * now rather than after a 200MB update.
     */
    return "Google Play services is missing or out of date on this phone. Update it, or sign in with your email and password.";
  }

  if (code === ANDROID_DEVELOPER_ERROR) {
    return GOOGLE_BUILD_NOT_REGISTERED_MESSAGE;
  }

  /*
   * Everything else. The code is appended rather than swallowed: this branch
   * exists precisely for failures nobody anticipated, and without it a report
   * reads "it said try again" — which narrows nothing. `10` reaching a user
   * once already cost a debugging session that a visible code would have ended
   * in a minute.
   */
  return code
    ? `Could not sign in with Google (${code}). Try again, or use your email and password.`
    : "Could not sign in with Google. Try again, or use your email and password.";
}
