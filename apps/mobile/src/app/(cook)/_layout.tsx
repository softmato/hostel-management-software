import { RoleTabs, type TabDef } from "@/components/role-tabs";

const TABS: readonly TabDef[] = [
  { icon: "today", label: "Today", name: "index" },
  { icon: "restaurant", label: "Menu", name: "menu" },
  { icon: "chatbubbles", label: "Community", name: "community" },
  { icon: "camera", label: "Photos", name: "photos" },
  { icon: "ellipsis-horizontal", label: "More", name: "more" },
];

export default function RoleLayout() {
  return <RoleTabs accent="COOK" tabs={TABS} />;
}
