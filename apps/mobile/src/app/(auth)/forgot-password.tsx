import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { readApiError } from "@/lib/api-contract";
import { forgotPassword, resetPassword } from "@/lib/auth-api";
import { extractResetToken, isProbablyEmail, validatePassword } from "@/lib/auth-form";
import { toastSuccess } from "@/lib/toast";

/**
 * Forgotten password: request the link, then redeem it.
 *
 * ## Why the token is pasted rather than deep-linked
 *
 * `requestPasswordReset` builds `{appUrl}/reset-password?token=…` — a **web**
 * URL, because the same email goes to people who signed up on the website and
 * the server has no way to know which client asked. Tapping it on a phone opens
 * the browser and resets the password there, which works and is fine. What is
 * not fine is a dead end for someone who is already standing in the app: so the
 * link can also be long-pressed, copied, and pasted here. `extractResetToken`
 * pulls the token out of the whole URL, because the whole URL is what a phone
 * copies.
 *
 * A `hostelhub://` link would remove the paste, and it is the right fix — but it
 * belongs in the email builder on the server, and the emailed link has to keep
 * working in a browser for every web user. Tracked in §1.
 *
 * ## The request step never says whether the address exists
 *
 * `requestPasswordReset` returns `{ requested: true }` either way and only
 * sends mail when it finds an active account — deliberately, because an
 * endpoint that distinguishes the two lets anyone test whether a person has an
 * account here. So the confirmation is phrased as a conditional, matching the
 * server's own message.
 *
 * ## After a successful reset, they land on login
 *
 * `resetPasswordWithToken` bumps `tokenVersion` and revokes every session —
 * which is the point of a reset — so there is no session to hand back and
 * pretending otherwise would produce an app that 401s on its first request.
 */
export default function ForgotPasswordScreen() {
  // The web reset link can also open here through the app scheme once one
  // exists; accepting the param now costs nothing and means the screen is
  // ready for it.
  const params = useLocalSearchParams<{ token?: string }>();

  const [step, setStep] = useState<"request" | "reset">(
    params.token ? "reset" : "request",
  );

  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);

  const [tokenInput, setTokenInput] = useState(params.token ?? "");
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /*
   * The token param is read once, in the two `useState` initialisers above,
   * rather than copied in by an effect. A deep link mounts this route fresh, so
   * the initial value is the one that matters — and an effect that assigns it
   * would overwrite whatever the user had typed on every re-render the router
   * causes.
   */

  const sendLink = useCallback(async () => {
    if (!isProbablyEmail(email)) {
      setEmailError("Enter the email address on your account.");
      return;
    }

    setEmailError(null);
    setError(null);
    setSubmitting(true);

    try {
      await forgotPassword(email.trim());
      setStep("reset");
    } catch (caught) {
      // The endpoint allows five requests in fifteen minutes, so this is
      // usually the rate limiter — worth showing rather than swallowing.
      setError(readApiError(caught, "Could not send the reset link."));
    } finally {
      setSubmitting(false);
    }
  }, [email]);

  const pasteLink = useCallback(async () => {
    const clipboard = await Clipboard.getStringAsync();

    if (!clipboard.trim()) {
      setTokenError("Your clipboard is empty. Copy the link from the email first.");
      return;
    }

    setTokenInput(clipboard.trim());
    setTokenError(null);
  }, []);

  const submitReset = useCallback(async () => {
    const token = extractResetToken(tokenInput);
    const invalidPassword = validatePassword(password);

    setTokenError(
      token ? null : "Paste the whole link from the email, or the code inside it.",
    );
    setPasswordError(invalidPassword);

    if (!token || invalidPassword) {
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      await resetPassword({ newPassword: password, token });

      toastSuccess("Password reset", "Sign in with your new password.");
      router.replace("/(auth)/login");
    } catch (caught) {
      setError(readApiError(caught, "That link could not be used."));
    } finally {
      setSubmitting(false);
    }
  }, [password, tokenInput]);

  if (step === "request") {
    return (
      <Screen
        footer={
          <Button
            label="Email me a reset link"
            loading={submitting}
            onPress={() => void sendLink()}
            size="lg"
          />
        }
        header={<AppBar showBack title="Reset password" />}
        scroll
      >
        <View className="gap-6 pt-2">
          <Text variant="muted">
            We&apos;ll send a link to your email. It works for one hour.
          </Text>

          <Input
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            error={emailError}
            keyboardType="email-address"
            label="Email"
            onChangeText={setEmail}
            onSubmitEditing={() => void sendLink()}
            placeholder="you@example.com"
            returnKeyType="go"
            value={email}
          />

          {error ? (
            <Text className="text-destructive" variant="caption">
              {error}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            className="self-start py-2"
            onPress={() => setStep("reset")}
          >
            <Text className="text-primary" variant="label">
              I already have a reset link
            </Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <Button
          label="Set new password"
          loading={submitting}
          onPress={() => void submitReset()}
          size="lg"
        />
      }
      header={
        <AppBar onBack={() => setStep("request")} showBack title="Set a new password" />
      }
      scroll
    >
      <View className="gap-6 pt-2">
        <Text variant="muted">
          If an account exists for that address, a reset link is on its way. Open the
          email, copy the link, and paste it below — or just tap it to finish in your
          browser.
        </Text>

        <View className="gap-4">
          <View className="gap-2">
            <Input
              autoCapitalize="none"
              autoCorrect={false}
              error={tokenError}
              hint="The whole link is fine — we'll take the code out of it."
              label="Reset link"
              multiline
              onChangeText={setTokenInput}
              placeholder="https://…/reset-password?token=…"
              value={tokenInput}
            />

            <Pressable
              accessibilityRole="button"
              className="self-start py-1"
              onPress={() => void pasteLink()}
            >
              <Text className="text-primary" variant="label">
                Paste from clipboard
              </Text>
            </Pressable>
          </View>

          <Input
            autoCapitalize="none"
            autoComplete="new-password"
            error={passwordError}
            hint="At least 8 characters."
            label="New password"
            onChangeText={setPassword}
            onSubmitEditing={() => void submitReset()}
            placeholder="Choose a password"
            returnKeyType="go"
            secure
            value={password}
          />
        </View>

        {error ? (
          <Text className="text-destructive" variant="caption">
            {error}
          </Text>
        ) : null}

        {/* Every other device is signed out by a reset, which is the point —
            saying so here stops it reading as a bug on the tablet at home. */}
        <Text variant="caption">
          Resetting your password signs you out everywhere else.
        </Text>
      </View>
    </Screen>
  );
}
