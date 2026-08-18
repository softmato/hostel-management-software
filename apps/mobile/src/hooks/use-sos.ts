import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";

import { readApiError } from "@/lib/api-contract";
import { triggerSos } from "@/lib/safety-api";
import { describeFanout, SOS_COUNTDOWN_SECONDS, type SosOutcome } from "@/lib/sos";

/**
 * The one path an SOS alert takes: arm → count down → send → report.
 *
 * There are two entry points — the floating button's long press and the SOS
 * screen's send button — and exactly one of these. The countdown, the
 * double-send guard and the honest reading of `notified` are the three things
 * in this milestone most costly to get subtly different in two places, and a
 * hostel-wide alert fired twice is not a cosmetic bug.
 *
 * ## The countdown runs before the request
 *
 * `POST /resident/sos` has no resident-facing undo: only staff can move an
 * alert to `FALSE_ALARM`, from the admin panel. So the cancellable window has
 * to be on this side of the network call, and once `send` starts there is
 * genuinely no taking it back — which is why nothing here offers to.
 */

export type SosPhase = "armed" | "done" | "idle" | "sending";

export type SosInput = {
  guardianAlertEnabled: boolean;
  message?: string;
};

export function useSos() {
  const [phase, setPhase] = useState<SosPhase>("idle");
  const [remaining, setRemaining] = useState(SOS_COUNTDOWN_SECONDS);
  const [outcome, setOutcome] = useState<SosOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * Captured when the countdown is armed, not read at send time.
   *
   * The note and the guardian toggle are live form state on the SOS screen. If
   * the request read them three seconds later it would send whatever the field
   * held then — including whatever a keyboard autocorrect did to it after the
   * user stopped looking. What was on screen when they committed is what goes.
   */
  const input = useRef<SosInput>({ guardianAlertEnabled: false });

  // One alert per arming. The send is kicked off from an effect, and an effect
  // that re-runs would otherwise fire a second alert nobody can retract.
  const inFlight = useRef(false);

  const arm = useCallback((next: SosInput) => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    input.current = next;
    inFlight.current = false;
    setError(null);
    setOutcome(null);
    setRemaining(SOS_COUNTDOWN_SECONDS);
    setPhase("armed");
  }, []);

  const cancel = useCallback(() => {
    void Haptics.selectionAsync();
    inFlight.current = false;
    setPhase("idle");
  }, []);

  const close = useCallback(() => {
    inFlight.current = false;
    setPhase("idle");
  }, []);

  /*
   * `ticks` is a closure local rather than the `remaining` state: an interval
   * that depended on a value it also sets would be torn down and rebuilt on
   * every tick, stretching three seconds into however long the renders take.
   * State is written from the timer for display only.
   */
  useEffect(() => {
    if (phase !== "armed") {
      return;
    }

    let ticks = SOS_COUNTDOWN_SECONDS;

    const id = setInterval(() => {
      ticks -= 1;

      if (ticks <= 0) {
        clearInterval(id);
        setPhase("sending");
        return;
      }

      // Escalating, so the countdown is felt as well as seen. This gets pressed
      // in the dark, and by someone not looking at the screen.
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      setRemaining(ticks);
    }, 1000);

    return () => clearInterval(id);
  }, [phase]);

  /*
   * Split from the countdown effect so nothing touches state synchronously in
   * an effect body — `react-hooks/set-state-in-effect` traces into the callee,
   * and `send` only writes after its first `await`.
   */
  useEffect(() => {
    if (phase !== "sending" || inFlight.current) {
      return;
    }

    inFlight.current = true;
    const sent = input.current;
    let cancelled = false;

    async function send() {
      try {
        const result = await triggerSos(sent);

        if (cancelled) return;

        const described = describeFanout({
          guardianAlertEnabled: sent.guardianAlertEnabled,
          notified: result.notified,
        });

        void Haptics.notificationAsync(
          described.tone === "reached"
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Warning,
        );
        setOutcome(described);
        setPhase("done");
      } catch (caught) {
        if (cancelled) return;

        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setError(readApiError(caught, "The alert could not be sent."));
        setPhase("done");
      }
    }

    void send();

    return () => {
      cancelled = true;
    };
  }, [phase]);

  return { arm, cancel, close, error, outcome, phase, remaining };
}
