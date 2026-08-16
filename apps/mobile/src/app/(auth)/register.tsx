import { AppBar } from "@/components/ui/app-bar";
import { EmptyState } from "@/components/ui/states";
import { Screen } from "@/components/ui/screen";

export default function RegisterScreen() {
  return (
    <Screen header={<AppBar showBack title="Create an account" />}>
      <EmptyState
        description="Signup with email or phone OTP verification, plus Google sign-in, lands in M2."
        title="Create an account"
      />
    </Screen>
  );
}
