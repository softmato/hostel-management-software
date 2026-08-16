import { AppBar } from "@/components/ui/app-bar";
import { EmptyState } from "@/components/ui/states";
import { Screen } from "@/components/ui/screen";

export default function ForgotPasswordScreen() {
  return (
    <Screen header={<AppBar showBack title="Reset password" />}>
      <EmptyState
        description="Requesting a reset link and setting a new password lands in M2."
        title="Reset your password"
      />
    </Screen>
  );
}
