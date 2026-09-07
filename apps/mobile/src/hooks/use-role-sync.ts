import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { useAppSelector } from "@/hooks/redux";
import { adoptRoleChange } from "@/lib/auth-session";

/**
 * Re-read the account whenever the app comes back to the front.
 *
 * ## The gap this closes
 *
 * Two things already adopt a changed account: the boot effect in `_layout.tsx`,
 * which runs on a **cold** start, and `usePush`, which runs when a role-change
 * notification is delivered. Between them sits the case that actually happens
 * most: an app that was never killed and a notification that never arrived.
 *
 * Android keeps a process alive for days, so "opened the app again" is usually a
 * resume rather than a launch — and push is not guaranteed. Permission can be
 * refused at the prompt or revoked in system settings, an OEM battery saver can
 * hold notifications for a backgrounded app, and a phone that was offline when
 * the platform approved somebody may never receive the message at all. In every
 * one of those, a provider approved on Tuesday would still be looking at the
 * hostel-shopping shell on Friday, having been told by email that they are
 * verified.
 *
 * So the resume itself is the signal. `revalidateSession` — which
 * `adoptRoleChange` runs — returns an account **only when something actually
 * moved**, so an ordinary return to the app routes nothing and costs one
 * request. When it did move, the shell is replaced with the one the account now
 * implies: the provider's tabs, or the resident's.
 *
 * ## Why it is throttled, and why silence on failure
 *
 * Switching between the app and a camera, a gallery picker or a bank's OTP
 * screen fires `active` every time. `MIN_GAP_MS` keeps that to one lookup a
 * minute rather than one per app switch. A failure is swallowed for the same
 * reason `adoptRoleChange` swallows one: an offline phone keeps the app it has,
 * and the next resume or the next launch corrects it.
 */

/** The shortest gap between two `/auth/me` lookups, in milliseconds. */
const MIN_GAP_MS = 60_000;

export function useRoleSync() {
  const userId = useAppSelector((state) => state.auth.account?.id ?? null);
  const isReady = useAppSelector((state) => state.auth.isReady);
  const checkedAt = useRef(0);

  useEffect(() => {
    /*
     * Signed out there is no account to re-read, and before the boot gate has
     * chosen a route a `replace` from here would race the gate's own — the
     * ordering trap that left the splash stuck over referral deep links.
     */
    if (!userId || !isReady) {
      return;
    }

    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        return;
      }

      const now = Date.now();

      if (now - checkedAt.current < MIN_GAP_MS) {
        return;
      }

      checkedAt.current = now;

      void adoptRoleChange().catch(() => null);
    });

    return () => subscription.remove();
  }, [isReady, userId]);
}
