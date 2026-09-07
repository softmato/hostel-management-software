import { useEffect, useMemo } from "react";

import { RoleTabs, type TabDef } from "@/components/role-tabs";
import { useMinuteTick } from "@/hooks/use-minute-tick";
import { useQueryValue } from "@/hooks/use-query-value";
import type { CookToday } from "@/lib/cook-api";
import { mealButtons, mealsToCall } from "@/lib/cook";
import { cookQuery, prefetchCookPortal } from "@/lib/cook-queries";
import { runWhenIdle } from "@/lib/idle";

export default function RoleLayout() {
  /*
   * The portal's warm-up, and the one place it belongs.
   *
   * This layout mounts once when a cook enters the group and stays mounted
   * until they leave, so the reads fire once per visit rather than once per tab
   * — and the tab they land on is Today, which is deliberately *not* in the list
   * (it is already asking; warming it would be a duplicate racing the screen).
   *
   * `runWhenIdle` puts them on the first idle frame, where the network is free.
   * Issued in the same frame they would compete with Today's own request on
   * exactly the handsets a hostel kitchen runs, making the screen somebody is
   * looking at slower so that three they are not could be faster. Nothing is
   * awaited and nothing can throw.
   */
  useEffect(() => runWhenIdle(prefetchCookPortal), []);

  /*
   * The badge, and why it costs nothing.
   *
   * `useQueryValue` watches `cook:today` — it never asks for it. The Today tab
   * is the tab this group lands on and it loads that key for its own four
   * buttons, so by the time a cook has wandered to Photos the payload is in the
   * cache and the count is free. Before that it is `null`, the badge is absent,
   * and no request was made to find that out. A `useResource` here would have
   * been a second `GET /cook/today` on every entry into the portal, for a number
   * that is decoration beside the screen it came from.
   *
   * ## Why this count and no other
   *
   * A kitchen leaves the Today tab constantly — to photograph the meal, to check
   * the week, to look somebody up — and the shift is not a list of things read
   * but four things *done*. "2" on Today is the only thing in this portal that
   * says the shift is unfinished from a tab that is not Today.
   *
   * It disappears at zero rather than showing `0`: `RoleTabs` draws nothing for
   * a falsy badge, and a zero in a red dot reads as a fault rather than as a
   * finished day. It also disappears while the payload is still loading, which
   * is right — an unknown count is not "nothing left to do", and a badge that
   * flickered 4 → 2 on every entry would be noise on a bar somebody glances at.
   */
  const today = useQueryValue<CookToday>(cookQuery.today());
  /*
   * `mealsToCall` counts only the meals that are due, so the badge is a
   * function of the clock as well as of the payload. Without a tick it would be
   * frozen at whatever the count was when the cook entered the portal —
   * silently, since nothing else on this layout re-renders for hours.
   */
  const now = useMinuteTick();

  const tabs = useMemo<readonly TabDef[]>(
    () => [
      {
        badge: today ? mealsToCall(mealButtons(today.meals, today.announced, now)) : 0,
        icon: "today",
        label: "Today",
        name: "index",
      },
      { icon: "restaurant", label: "Menu", name: "menu" },
      { icon: "chatbubbles", label: "Community", name: "community" },
      { icon: "camera", label: "Photos", name: "photos" },
      { icon: "ellipsis-horizontal", label: "More", name: "more" },
    ],
    [now, today],
  );

  return <RoleTabs accent="COOK" tabs={tabs} />;
}
