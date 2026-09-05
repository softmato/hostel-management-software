import { useEffect } from "react";

import { RoleTabs, type TabDef } from "@/components/role-tabs";
import { prefetchCookPortal } from "@/lib/cook-queries";
import { runWhenIdle } from "@/lib/idle";

const TABS: readonly TabDef[] = [
  { icon: "today", label: "Today", name: "index" },
  { icon: "restaurant", label: "Menu", name: "menu" },
  { icon: "chatbubbles", label: "Community", name: "community" },
  { icon: "camera", label: "Photos", name: "photos" },
  { icon: "ellipsis-horizontal", label: "More", name: "more" },
];

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

  return <RoleTabs accent="COOK" tabs={TABS} />;
}
