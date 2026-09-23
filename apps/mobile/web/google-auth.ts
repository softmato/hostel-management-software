import { GOOGLE_NOT_CONFIGURED_MESSAGE, GOOGLE_NO_TOKEN_MESSAGE } from "@/lib/google-error";

import type { GoogleIdTokenResult } from "@/lib/google-auth";

export type { GoogleIdTokenResult };

/**
 * `lib/google-auth.ts` for the installable web app, where the native Google
 * SDK does not exist.
 *
 * Google Identity Services with the same web client id the phone asks for its
 * id token with, and the website already signs in with, so `/auth/google`
 * verifies it unchanged. `prompt()` over FedCM is the browser's own account
 * chooser, which keeps the app's own button rather than Google's.
 */
const CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";

export const isGoogleSignInAvailable = CLIENT_ID.length > 0;

type Moment = {
  getDismissedReason?(): string;
  isDismissedMoment?(): boolean;
  isNotDisplayed?(): boolean;
  isSkippedMoment?(): boolean;
};

type GoogleIdentity = {
  accounts: {
    id: {
      initialize(options: Record<string, unknown>): void;
      prompt(listener: (moment: Moment) => void): void;
    };
  };
};

let loading: Promise<GoogleIdentity> | null = null;

function loadGoogle() {
  loading ??= new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement("script");

    script.async = true;
    script.src = "https://accounts.google.com/gsi/client";
    script.onload = () => resolve((window as unknown as { google: GoogleIdentity }).google);
    script.onerror = () => {
      loading = null;
      reject(new Error("Google sign-in did not load."));
    };
    document.head.appendChild(script);
  });

  return loading;
}

export async function requestGoogleIdToken(): Promise<GoogleIdTokenResult> {
  if (!isGoogleSignInAvailable) {
    return { message: GOOGLE_NOT_CONFIGURED_MESSAGE, ok: false };
  }

  let google: GoogleIdentity;

  try {
    google = await loadGoogle();
  } catch {
    return {
      message: "Google sign-in could not load. Check your connection and try again.",
      ok: false,
    };
  }

  return new Promise((resolve) => {
    google.accounts.id.initialize({
      callback: ({ credential }: { credential?: string }) =>
        resolve(
          credential ? { idToken: credential, ok: true } : { message: GOOGLE_NO_TOKEN_MESSAGE, ok: false },
        ),
      cancel_on_tap_outside: true,
      client_id: CLIENT_ID,
      use_fedcm_for_prompt: true,
    });

    // A closed chooser, or one the browser is holding back after earlier
    // dismissals, ends here as a quiet cancel — the same as backing out of the
    // phone's account sheet.
    google.accounts.id.prompt((moment) => {
      if (
        moment.isSkippedMoment?.() ||
        moment.isNotDisplayed?.() ||
        (moment.isDismissedMoment?.() && moment.getDismissedReason?.() !== "credential_returned")
      ) {
        resolve({ message: null, ok: false });
      }
    });
  });
}
