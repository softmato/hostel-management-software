import { RoleTabs, type TabDef } from "@/components/role-tabs";

const TABS: readonly TabDef[] = [
  { icon: "home", label: "Home", name: "index" },
  { icon: "shield-checkmark", label: "Safety", name: "safety" },
  { icon: "card", label: "Payments", name: "payments" },
  { icon: "ellipsis-horizontal", label: "More", name: "more" },
];

export default function RoleLayout() {
  return <RoleTabs accent="GUARDIAN" tabs={TABS} />;
}
