import { RoleTabs, type TabDef } from "@/components/role-tabs";

const TABS: readonly TabDef[] = [
  { icon: "briefcase", label: "Jobs", name: "index" },
  { icon: "id-card", label: "My card", name: "card" },
  { icon: "chatbubbles", label: "Community", name: "community" },
  { icon: "ellipsis-horizontal", label: "More", name: "more" },
];

export default function RoleLayout() {
  return <RoleTabs accent="PROVIDER" tabs={TABS} />;
}
