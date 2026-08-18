import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { resolveHome } from "@/constants/roles";
import { useAppSelector } from "@/hooks/redux";
import { readApiError } from "@/lib/api-contract";
import { changePassword } from "@/lib/auth-api";
import { endSession, startSession } from "@/lib/auth-session";
import { validatePassword } from "@/lib/auth-form";
import { toastSuccess } from "@/lib/toast";

/**
 * Where a provisioned account — a cook, a warden — lands until it owns its
 * password.
 *
 * ## Why this is a gate, not a prompt
 *
 * These accounts are created by a hostel admin with a temporary password that
 * the admin typed, read out, or wrote down. Until it is changed, the person who
 * issued it can sign in as this account, and every message and food-ready log
 * it produces is deniable. `resolveHome` therefore routes here **before** the
 * role's own group and keeps doing so on every launch, so there is no way to
 * carry on using the app around it.
 *
 * ## No current password
 *
 * `changePassword` requires `currentPassword` only when `mustChangePassword` is
 * false — the whole point is that the owner of this account does not have a
 * password of their own yet. Asking for one here would demand the temporary
 * password back, which is exactly the thing they have just used and the thing
 * we are trying to retire.
 *
 * ## The response is a new session
 *
 * The server revokes every session and issues a fresh pair, so the token in
 * memory is dead the moment this returns. It goes through `startSession` for
 * the same reason QR activation does; re-fetching `/auth/me` with the old token
 * would 401.
 */
export default function SetPasswordScreen() {
  const account = useAppSelector((state) => state.auth.account);

  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(async () => {
    const invalid = validatePassword(password);
    /*
     * The confirmation field exists here and not on the login screen because
     * this password is being *invented*, and it is masked. A typo in one that
     * nobody notices locks the account out of the app until an admin issues
     * another temporary password.
     */
    const mismatched = password !== confirmation ? "These don't match." : null;

    setPasswordError(invalid);
    setConfirmationError(mismatched);

    if (invalid || mismatched) {
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const result = await changePassword({ newPassword: password });
      const auth = await startSession(result);

      toastSuccess("Password set", "This account is yours now.");

      router.replace(
        resolveHome({
          isApprovedProvider: result.user.isServiceProvider,
          isResidentActivated: auth.isResidentActivated ?? true,
          mustChangePassword: result.user.mustChangePassword,
          role: result.user.role,
        }),
      );
    } catch (caught) {
      setError(readApiError(caught, "Could not set your password."));
    } finally {
      setSubmitting(false);
    }
  }, [confirmation, password]);

  function signOut() {
    Alert.alert(
      "Sign out?",
      "You'll need the temporary password from your hostel admin to get back in.",
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () => {
            void endSession().finally(() => router.replace("/(public)"));
          },
          style: "destructive",
          text: "Sign out",
        },
      ],
    );
  }

  // Reachable directly, and `/auth/change-password` needs a principal. Saying
  // so beats a 401 with no explanation.
  if (!account) {
    return (
      <Screen header={<AppBar title="Set your password" />}>
        <Card className="gap-3">
          <Text variant="muted">
            Sign in with the temporary password your hostel admin gave you, and
            you&apos;ll be brought straight back here.
          </Text>
          <Button label="Sign in" onPress={() => router.replace("/(auth)/login")} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <Button
          label="Set password"
          loading={submitting}
          onPress={() => void submit()}
          size="lg"
        />
      }
      header={
        <AppBar
          actions={
            <Pressable
              accessibilityLabel="Sign out"
              accessibilityRole="button"
              hitSlop={10}
              onPress={signOut}
            >
              <Text className="text-primary" variant="label">
                Sign out
              </Text>
            </Pressable>
          }
          subtitle={account.name}
          title="Set your password"
        />
      }
      scroll
    >
      <View className="gap-6 pt-2">
        <Text variant="muted">
          Your account was created with a temporary password. Choose your own before
          you carry on — whoever set up your account can sign in with the old one until
          you do.
        </Text>

        <View className="gap-4">
          <Input
            autoCapitalize="none"
            autoComplete="new-password"
            error={passwordError}
            hint="At least 8 characters."
            label="New password"
            onChangeText={setPassword}
            placeholder="Choose a password"
            returnKeyType="next"
            secure
            value={password}
          />

          <Input
            autoCapitalize="none"
            autoComplete="new-password"
            error={confirmationError}
            label="Confirm password"
            onChangeText={setConfirmation}
            onSubmitEditing={() => void submit()}
            placeholder="Type it again"
            returnKeyType="go"
            secure
            value={confirmation}
          />
        </View>

        {error ? (
          <Text className="text-destructive" variant="caption">
            {error}
          </Text>
        ) : null}

        <Text variant="caption">
          Setting a password signs this account out of every other device.
        </Text>
      </View>
    </Screen>
  );
}
