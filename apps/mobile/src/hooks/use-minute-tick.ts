import { useEffect, useState } from "react";
import { AppState } from "react-native";

/**
 * A `Date` that moves on its own, for the screens whose content is decided by
 * the clock rather than by a fetch.
 *
 * ## Why any screen needs this
 *
 * The cook portal's four announce buttons unlock at their meal's serving time.
 * Computed once at render, that is a button which is still dead at 6:31 for a
 * kitchen that opened the app at 6:29 — and the cook's reasonable conclusion is
 * that the app is broken, not that it wants pulling down to refresh. A gate the
 * user cannot see the far side of has to open by itself.
 *
 * ## Half a minute, not a second
 *
 * The thresholds this drives are whole minutes, so a second-by-second tick would
 * be sixty re-renders to change nothing. Thirty seconds bounds the staleness at
 * half a minute — under the resolution of "is it 6:30 yet" — for two wake-ups a
 * minute on a phone that is usually plugged in on a worktop.
 *
 * ## And on the way back from the background
 *
 * Android throttles and eventually suspends timers behind a locked screen, so a
 * handset put down before breakfast and picked up at lunch cannot be assumed to
 * have ticked in between. The `AppState` listener re-reads the clock the moment
 * the app is foregrounded, which is the case that actually happens in a
 * kitchen: the phone sits face-down until there is food to call.
 */
export function useMinuteTick(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        setNow(new Date());
      }
    });

    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [intervalMs]);

  return now;
}
