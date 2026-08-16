import { Image } from "expo-image";
import { Link, router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { APP_NAME, POWERED_BY, logo } from "@/constants/branding";
import { resolveHome } from "@/constants/roles";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { readApiError } from "@/lib/api-contract";
import { login } from "@/lib/auth-api";
import { startSession } from "@/lib/auth-session";
import { setSessionEndReason } from "@/store/slices/authSlice";

export default function LoginScreen() {
  const dispatch = useAppDispatch();
  const sessionEndReason = useAppSelector((state) => state.auth.sessionEndReason);

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /*
   * Why the user is looking at this screen, when they did not ask to be. Derived
   * rather than copied into state by an effect: an effect would race the first
   * paint, so the reason would appear a frame late — and it would need clearing
   * on submit, which is a second place to forget.
   */
  const endedMessage =
    sessionEndReason === "SUSPENDED"
      ? "This account has been suspended. Contact your hostel admin."
      : sessionEndReason === "EXPIRED"
        ? "Your session expired. Please sign in again."
        : null;

  const message = error ?? endedMessage;

  async function onSubmit() {
    if (!identifier.trim() || !password) {
      setError("Enter your email or phone and your password.");
      return;
    }

    setError(null);
    setSubmitting(true);
    dispatch(setSessionEndReason(null));

    try {
      const result = await login(identifier.trim(), password);
      const auth = await startSession(result);

      router.replace(
        resolveHome({
          isApprovedProvider: result.user.isServiceProvider,
          isResidentActivated: auth.isResidentActivated ?? true,
          role: result.user.role,
        }),
      );
    } catch (caught) {
      setError(readApiError(caught, "Could not sign you in."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen
      // Back goes to the public app, not out of the stack: someone who opened
      // login from the home CTA must be able to change their mind and carry on
      // browsing without an account.
      header={<AppBar onBack={() => router.replace("/(public)")} showBack title="" />}
      scroll
    >
      <View className="flex-1 justify-between">
        <View className="gap-8">
          <View className="items-center gap-3">
            <Image
              contentFit="contain"
              source={logo.mark}
              style={{ height: 64, width: 64 }}
            />
            <Text variant="display">{APP_NAME}</Text>
            <Text className="text-center" variant="muted">
              Sign in to your hostel account.
            </Text>
          </View>

          <View className="gap-4">
            <Input
              autoCapitalize="none"
              autoComplete="username"
              autoCorrect={false}
              keyboardType="email-address"
              label="Email or phone"
              onChangeText={setIdentifier}
              placeholder="you@example.com"
              returnKeyType="next"
              value={identifier}
            />

            <Input
              autoCapitalize="none"
              autoComplete="current-password"
              label="Password"
              onChangeText={setPassword}
              onSubmitEditing={onSubmit}
              placeholder="Your password"
              returnKeyType="go"
              secure
              value={password}
            />

            {message ? (
              <Text className="text-destructive" variant="caption">
                {message}
              </Text>
            ) : null}

            <Button label="Sign in" loading={submitting} onPress={onSubmit} size="lg" />

            <Link asChild href="/(auth)/forgot-password">
              <Pressable className="self-center py-2">
                <Text className="text-primary" variant="label">
                  Forgot your password?
                </Text>
              </Pressable>
            </Link>
          </View>
        </View>

        <View className="items-center gap-4 pt-10">
          <View className="flex-row items-center gap-1">
            <Text variant="muted">New here?</Text>
            <Link asChild href="/(auth)/register">
              <Pressable>
                <Text className="text-primary" variant="label">
                  Create an account
                </Text>
              </Pressable>
            </Link>
          </View>

          <Text className="uppercase tracking-[2px]" variant="caption">
            {POWERED_BY}
          </Text>
        </View>
      </View>
    </Screen>
  );
}
