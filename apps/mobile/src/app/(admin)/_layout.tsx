import { RoleTabs, type TabDef } from "@/components/role-tabs";

const TABS: readonly TabDef[] = [
  { icon: "stats-chart", label: "Overview", name: "index" },
  { icon: "notifications", label: "Alerts", name: "alerts" },
  { icon: "people", label: "Residents", name: "residents" },
  { icon: "ellipsis-horizontal", label: "More", name: "more" },
];

export default function RoleLayout() {
  return <RoleTabs accent="ADMIN" tabs={TABS} />;
}
