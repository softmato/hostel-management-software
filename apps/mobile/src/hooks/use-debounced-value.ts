import { useEffect, useState } from "react";

/**
 * A value, once it has stopped changing.
 *
 * ## What this is for, and what it is not for
 *
 * Not for making typing feel fast — a `TextInput` bound to debounced state drops
 * characters and moves the caret, and is the classic way to make a field feel
 * broken. The field keeps its own state and stays instant. This is for the
 * *work* the typing causes: the map's search re-filters sixty hostels, rebuilds
 * a marker array and injects it into a WebView, and doing that per keystroke
 * meant "Kritika" cost seven passes to answer one question.
 *
 * So the pattern at the call site is two values, not one: `query` drives the
 * field, and the value returned here drives everything expensive.
 *
 * ## Clearing is not a change to wait out
 *
 * The delay is deliberately **not** applied when the reader empties the box —
 * that is handled by the caller choosing the raw value when it is empty, rather
 * than by a rule in here. Emptying a search field is a request to see everything
 * again, and a quarter-second of the previous, narrower result set after it is a
 * screen that looks stuck. Keeping that decision at the call site is what lets
 * this hook stay one generic thing rather than a string helper with an opinion.
 *
 * ## The timer is per change, and it is always cleaned up
 *
 * Each new value replaces the pending timer rather than queueing behind it, so
 * the settled value lands `delayMs` after the **last** change, not `delayMs`
 * after the first. Unmounting mid-type clears it too: a `setState` landing on a
 * screen that has gone is a warning at best and a leak at worst.
 *
 * `setState` inside the timeout is asynchronous — it runs long after the effect
 * body has returned — so this does not trip `react-hooks/set-state-in-effect`,
 * which is about the synchronous case that costs every mount an extra render.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);

    return () => clearTimeout(timer);
  }, [delayMs, value]);

  return settled;
}
