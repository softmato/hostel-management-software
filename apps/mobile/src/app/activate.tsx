import { AppBar } from "@/components/ui/app-bar";
import { EmptyState } from "@/components/ui/states";
import { Screen } from "@/components/ui/screen";

export default function ActivateScreen() {
  return (
    <Screen header={<AppBar title="Activate your account" />}>
      <EmptyState
        description="Scanning your hostel activation QR code, with manual code entry as a fallback, lands in M6."
        title="Scan your activation code"
      />
    </Screen>
  );
}
