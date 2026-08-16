import { AppBar } from "@/components/ui/app-bar";
import { EmptyState } from "@/components/ui/states";
import { Screen } from "@/components/ui/screen";

export default function PublicHostelsScreen() {
  return (
    <Screen header={<AppBar showBack title="Hostels" />}>
      <EmptyState
        description="Search, filters, the map/list toggle and hostel detail pages land in M6."
        title="Hostel discovery"
      />
    </Screen>
  );
}
