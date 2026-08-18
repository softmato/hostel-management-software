/**
 * Google sign-in: get an ID token from the phone, hand it to our server.
 *
 * ## The client id here is the **web** one, deliberately
 *
 * `configure({ webClientId })` is what makes Google mint an ID token whose
 * `aud` is that client. Our server verifies with
 * `jwtVerify(idToken, GOOGLE_JWKS, { audience: GOOGLE_CLIENT_ID })`
 * (`apps/web/src/modules/auth/auth.service.ts`), and `GOOGLE_CLIENT_ID` is the
 * web client — the same value the website's `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
 * uses. So one audience satisfies both clients and the server needed no change.
 *
 * The **Android** OAuth client is never named in this file and that is correct:
 * it is what authorises *this APK* to talk to Google at all, matched on package
 * name plus signing SHA-1, so it has to exist in the same Google Cloud project
 * but it is not what the token is addressed to. Naming it here — the obvious
 * thing to do, since it is the Android one — would produce a token the server
 * rejects with `GOOGLE_TOKEN_INVALID` and nothing in the message would say why.
 *
 * ## Not in Expo Go
 *
 * This is a native module, so it needs a dev or preview build
 * (`npx expo run:android`). Nothing on the boot path imports this file — only
 * the sign-in button does — so the rest of the app still runs under Expo Go;
 * only the Google button is dead there.
 *
 * No Expo config plugin is registered. The plugin's bare form is its *Firebase*
 * mode and requires a `google-services.json` we do not have; its other form
 * exists only to add an iOS URL scheme. Android needs neither — the native
 * module is autolinked and takes everything from `configure()` at runtime. Add
 * `["@react-native-google-signin/google-signin", { iosUrlScheme: "…" }]` when
 * an iOS client is created.
 */

import {
  GoogleSignin,
  isSuccessResponse,
  statusCodes,
} from "@react-native-google-signin/google-signin";

import {
  GOOGLE_NOT_CONFIGURED_MESSAGE,
  GOOGLE_NO_TOKEN_MESSAGE,
  googleFailureMessage,
} from "@/lib/google-error";

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "";

/**
 * Whether this build can offer Google at all. False in any checkout without
 * `apps/mobile/.env` — which is gitignored, so that is every fresh clone.
 * The button hides rather than failing on tap.
 */
export const isGoogleSignInAvailable = WEB_CLIENT_ID.length > 0;

let configured = false;

/**
 * Lazy, not at module load. `configure` crosses into native, and the only
 * screens that reach this file already have the user waiting on a tap — doing
 * it during the splash hold would put native work on the one path §0 says must
 * stay clear.
 */
function ensureConfigured() {
  if (configured) {
    return;
  }

  GoogleSignin.configure({
    // Omitted rather than empty: the library treats "" as a configured value
    // and iOS fails later, further from the cause.
    ...(IOS_CLIENT_ID ? { iosClientId: IOS_CLIENT_ID } : {}),
    /*
     * No `offlineAccess`. That asks Google for a `serverAuthCode` so a backend
     * can hold a refresh token and act for the user later; ours never does —
     * `authenticateWithGoogle` verifies the ID token, links the OAuth account
     * and issues *our* session. Requesting it would collect a credential with
     * no use and a real cost if it leaked.
     */
    webClientId: WEB_CLIENT_ID,
  });

  configured = true;
}

export type GoogleIdTokenResult =
  /** Got a token. Post it to `/auth/google`. */
  | { idToken: string; ok: true }
  /**
   * No token. `message` is `null` when the user simply backed out — the caller
   * must not render an error for that.
   */
  | { message: string | null; ok: false };

/**
 * Opens the Google account sheet and returns the ID token.
 *
 * **Signs out of the Google client first, every time.** Google otherwise
 * reuses the last account silently, so on a shared phone — which is the normal
 * case in a hostel — the second person taps the button and lands in the first
 * person's account with no picker and no clue it happened. Same reasoning as
 * `RESET_STORE` wiping every slice on logout. The sign-out is local to the
 * Google client and touches nothing of ours.
 */
export async function requestGoogleIdToken(): Promise<GoogleIdTokenResult> {
  if (!isGoogleSignInAvailable) {
    return { message: GOOGLE_NOT_CONFIGURED_MESSAGE, ok: false };
  }

  try {
    ensureConfigured();

    // Throws when nobody is signed in, which is the common case and not a
    // problem — the point is only to guarantee the picker.
    await GoogleSignin.signOut().catch(() => undefined);

    // Surfaces the "update Play services" dialogue itself where it can, which
    // is a fix the user can act on rather than a message they have to decode.
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

    const response = await GoogleSignin.signIn();

    if (!isSuccessResponse(response)) {
      return { message: null, ok: false };
    }

    const idToken = response.data.idToken;

    if (!idToken) {
      return { message: GOOGLE_NO_TOKEN_MESSAGE, ok: false };
    }

    return { idToken, ok: true };
  } catch (caught) {
    const code =
      typeof caught === "object" && caught !== null && "code" in caught
        ? String((caught as { code: unknown }).code)
        : null;

    return { message: googleFailureMessage(code, statusCodes), ok: false };
  }
}
