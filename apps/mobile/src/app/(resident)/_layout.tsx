import { RoleTabs, type TabDef } from "@/components/role-tabs";

const TABS: readonly TabDef[] = [
  { icon: "home", label: "Home", name: "index" },
  { icon: "card", label: "Payments", name: "payments" },
  { icon: "restaurant", label: "Food", name: "food" },
  { icon: "megaphone", label: "Notices", name: "notices" },
  { icon: "ellipsis-horizontal", label: "More", name: "more" },
];

export default function RoleLayout() {
  return <RoleTabs accent="RESIDENT" tabs={TABS} />;
}
