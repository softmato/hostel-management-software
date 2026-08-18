import { RoleTabs, type TabDef } from "@/components/role-tabs";
import { SosFab } from "@/components/sos-fab";

const TABS: readonly TabDef[] = [
  { icon: "home", label: "Home", name: "index" },
  { icon: "card", label: "Payments", name: "payments" },
  { icon: "restaurant", label: "Food", name: "food" },
  { icon: "megaphone", label: "Notices", name: "notices" },
  { icon: "ellipsis-horizontal", label: "More", name: "more" },
];

export default function RoleLayout() {
  return (
    <>
      <RoleTabs accent="RESIDENT" tabs={TABS} />

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
