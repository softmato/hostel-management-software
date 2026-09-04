import { useEffect } from "react";
import { InteractionManager } from "react-native";

import { RoleTabs, type TabDef } from "@/components/role-tabs";
import { SosFab } from "@/components/sos-fab";
import { prefetchResidentPortal } from "@/lib/resident-queries";

const TABS: readonly TabDef[] = [
  { icon: "home", label: "Home", name: "index" },
  { icon: "card", label: "Payments", name: "payments" },
  { icon: "chatbubbles", label: "Community", name: "community" },
  { icon: "restaurant", label: "Food", name: "food" },
  { icon: "ellipsis-horizontal", label: "More", name: "more" },
];

/**
 * Notices gave up the slot Community needed.
 *
 * It is the tab a resident opens least — a notice worth reading arrives as a
 * push and is listed on Home, so the tab was mostly a second way to reach
 * something already in front of them. The screen is unchanged and still
 * reachable from Home and from More.
 */
const HIDDEN = ["notices"] as const;

export default function RoleLayout() {
  /*
   * The portal's warm-up, and the one place it belongs.
   *
   * This layout mounts once when a resident enters the group and stays mounted
   * until they leave, so the reads fire once per visit rather than once per tab
   * — and the tab they land on is Home, which is deliberately *not* in the list
   * (it is already asking; warming it would be a duplicate racing the screen).
   *
   * One wave, not the admin portal's three. A warden has seven reads at the door
   * and a dozen behind it; a resident has five tabs with one payload each, four
   * of them small, so a second wave would be scheduling machinery around
   * nothing.
   *
   * `runAfterInteractions` puts these after the navigation settles, where the
   * network is idle — issued in the same frame they would compete with Home's
   * own three requests on exactly the handsets this app is aimed at, making the
   * screen someone is looking at slower so that three they are not could be
   * faster. Nothing is awaited and nothing can throw.
   */
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(prefetchResidentPortal);

    return () => task.cancel();
  }, []);

  return (
    <>
      <RoleTabs accent="RESIDENT" hidden={HIDDEN} tabs={TABS} />

      {/*
        Outside the navigator, so it is mounted once and survives every tab
        change — §M5 wants SOS reachable from every resident screen, and a copy
        per screen is five chances to forget one. It also means the countdown
        keeps running if the resident switches tabs mid-arm.
      */}
      <SosFab />
    </>
  );
}
