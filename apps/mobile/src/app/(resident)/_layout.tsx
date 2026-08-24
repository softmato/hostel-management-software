import { RoleTabs, type TabDef } from "@/components/role-tabs";
import { SosFab } from "@/components/sos-fab";

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
