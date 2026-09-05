import { useEffect } from "react";

import { RoleTabs, type TabDef } from "@/components/role-tabs";
import { SosFab } from "@/components/sos-fab";
import { runWhenIdle } from "@/lib/idle";
import { prefetchResidentPortal } from "@/lib/resident-queries";

const TABS: readonly TabDef[] = [
  { icon: "home", label: "Home", name: "index" },
  { icon: "card", label: "Payments", name: "payments" },
  { icon: "chatbubbles", label: "Community", name: "community" },
  { icon: "receipt", label: "Statement", name: "statement" },
  { icon: "ellipsis-horizontal", label: "More", name: "more" },
];

/**
 * Notices, then Food, gave up the slots Community and Statement needed.
 *
 * Both went for the same reason, and it is the reason a tab is worth having at
 * all: a notice worth reading arrives as a push and is listed on Home, and this
 * week's food is on Home too with `All meals` on it. Neither tab was a *way in*
 * to anything — each was a second way to reach something already in front of the
 * resident, holding a slot against something that had no first way.
 *
 * What took Food's is the statement of what they have actually paid. Payments
 * answers "what do I owe and how do I pay it"; a resident asked by a parent or a
 * landlord what they *have* paid was reading a list of debts to work it out.
 *
 * Both screens are unchanged and still reachable from Home and from More.
 */
const HIDDEN = ["food", "notices"] as const;

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
   * `runWhenIdle` puts these on the first idle frame, where the network is free
   * — issued in the same frame they would compete with Home's own three
   * requests on exactly the handsets this app is aimed at, making the screen
   * someone is looking at slower so that three they are not could be faster.
   * Nothing is awaited and nothing can throw.
   */
  useEffect(() => runWhenIdle(prefetchResidentPortal), []);

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
