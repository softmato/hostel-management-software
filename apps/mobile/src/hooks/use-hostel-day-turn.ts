import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { hostelCalendarDay } from "@hostel/calendar/bs";

/**
 * Calls `onTurn` when the day turns in Nepal — at midnight in Kathmandu while
 * the screen is open, or on the way back from the background if it turned
 * while the phone was down.
 *
 * ## For counts of days the server worked out
 *
 * Plan billing prints "31 days left", counted on the server in Nepal days. That
 * figure is right all day and wrong from midnight, so the screen showing it has
 * to re-ask when the day turns — not on a timer of its own, and not by
 * recounting on the phone, which is how two clients end up a day apart.
 *
 * ## A check a minute, not a timer set for midnight
 *
 * One timeout for the next midnight is the obvious shape and the wrong one on
 * Android: timers behind a locked screen are throttled and then suspended, and a
 * twelve-hour timeout is exactly the kind that never fires. So the day is
 * re-read once a minute — a comparison, no render — and on every return to the
 * foreground, which is when a phone put down last night is looked at again.
 * `useMinuteTick` is the same idea at minute resolution; this one renders
 * nothing and only calls back.
 */
export function useHostelDayTurn(onTurn: () => void, intervalMs = 60_000) {
  const callback = useRef(onTurn);

  useEffect(() => {
    callback.current = onTurn;
  });

  useEffect(() => {
    let day = hostelCalendarDay(new Date()).getTime();

    const check = () => {
      const today = hostelCalendarDay(new Date()).getTime();

      if (today !== day) {
        day = today;
        callback.current();
      }
    };

    const timer = setInterval(check, intervalMs);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        check();
      }
    });

    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [intervalMs]);
}
