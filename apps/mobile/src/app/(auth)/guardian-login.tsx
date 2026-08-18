import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { resolveHome } from "@/constants/roles";
import { useAppTheme } from "@/hooks/use-app-theme";
import { readApiError, readApiErrorCode } from "@/lib/api-contract";
import { startSession } from "@/lib/auth-session";
import { loginWithGuardianAccessCode } from "@/lib/guardian-api";
import {
  type GuardianLoginErrors,
  guardianLoginPayload,
  hasGuardianLoginErrors,
  validateGuardianLogin,
} from "@/lib/guardian-login";

/**
 * Signing in with the access code a hostel printed out.
 *
 * ## Why this is a separate screen and not a mode on the login form
 *
 * It is a different credential against a different endpoint for a different
 * person. The guardian this exists for has **no email account** — that is the
 * whole reason the hostel handed them a code instead of sending an invitation —
 * so the main form's "Email or phone" and "Password" have nothing they can
 * type, and folding a third pair of fields into it would make the common case
 * worse to serve the uncommon one. It is reached from a line at the bottom of
 * login, which is where somebody who has already failed to sign in will look.
 *
 * ## It is a real sign-in, unlike the invitation
 *
 * `POST /guardian/login` returns a full session — `issueSessionForUser`, the
 * same shape `/auth/login` gives — so this hands straight to `startSession` and
 * routes through `resolveHome`. The invitation flow
 * (`app/guardian-invite.tsx`) does the opposite: it accepts the invite, issues
 * **no** session, and hands off to login. Two doors, two behaviours; do not
 * copy one into the other.
 *
 * ## The server's messages are shown verbatim
 *
 * Each of the three failures is written for the person reading it and says
 * something the client could not work out on its own — an expired code, a phone
 * number that already belongs to a resident account. The one place the copy is
 * extended is `INVALID_GUARDIAN_LOGIN`, which is deliberately vague on the
 * server (naming which half was wrong turns a phone number into an oracle for
 * enumerating codes) and therefore unhelpful on a phone: the hint under it says
 * what to check without saying which one failed.
 */
export default function GuardianLoginScreen() {
  const { colors } = useAppTheme();

  const [draft, setDraft] = useState({ accessCode: "", phone: "" });
  const [errors, setErrors] = useState<GuardianLoginErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const patch = useCallback((next: Partial<typeof draft>) => {
    setDraft((current) => ({ ...current, ...next }));
  }, []);

  const submit = useCallback(async () => {
    const found = validateGuardianLogin(draft);

    setErrors(found);
    setMessage(null);
    setHint(null);

    if (hasGuardianLoginErrors(found)) {
      return;
    }

    setSubmitting(true);

    try {
      const result = await loginWithGuardianAccessCode(guardianLoginPayload(draft));
      const auth = await startSession(result);

      router.replace(
        resolveHome({
          isApprovedProvider: result.user.isServiceProvider,
          isResidentActivated: auth.isResidentActivated ?? true,
          mustChangePassword: result.user.mustChangePassword,
          role: result.user.role,
        }),
      );
    } catch (caught) {
      setMessage(readApiError(caught, "Could not sign you in."));

      /*
       * Only for the vague one. The expiry and phone-conflict messages already
       * say what to do; adding a hint under them would be the app talking over
       * the server.
       */
      if (readApiErrorCode(caught) === "INVALID_GUARDIAN_LOGIN") {
        setHint(
          "Check both: the code is the one printed on your hostel's slip, and the number must be the one they registered for you — not a different phone in the family.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  }, [draft]);

  return (
    <Screen header={<AppBar showBack title="Guardian sign-in" />} scroll>
      <View className="gap-6 pt-2">
        <Card className="gap-3">
          <View className="flex-row items-center gap-2">
            <Ionicons color={colors.primary} name="shield-checkmark-outline" size={20} />
            <Text variant="subtitle">Use your access code</Text>
          </View>
          <Text variant="muted">
            If your hostel gave you a code on paper instead of emailing you an
            invitation, sign in with it here. You do not need an email address.
          </Text>
        </Card>

        <View className="gap-4">
          <Input
            autoCapitalize="characters"
            autoCorrect={false}
            error={errors.accessCode}
            hint="Six characters, printed on the slip from your hostel."
            label="Access code"
            onChangeText={(accessCode) => patch({ accessCode })}
            placeholder="AB12CD"
            returnKeyType="next"
            value={draft.accessCode}
          />

          <Input
            autoCapitalize="none"
            autoComplete="tel"
            error={errors.phone}
            hint="The number your hostel registered for you."
            keyboardType="phone-pad"
            label="Phone number"
            onChangeText={(phone) => patch({ phone })}
            onSubmitEditing={() => void submit()}
            placeholder="9800000000"
            returnKeyType="go"
            value={draft.phone}
          />

          {message ? (
            <View className="gap-1">
              <Text className="text-destructive" variant="caption">
                {message}
              </Text>
              {hint ? <Text variant="caption">{hint}</Text> : null}
            </View>
          ) : null}

          <Button
            label="Sign in"
            loading={submitting}
            onPress={() => void submit()}
            size="lg"
          />
        </View>

        <Card className="gap-2">
          <Text variant="label">Don&apos;t have a code?</Text>
          <Text variant="muted">
            Ask your hostel office for one, or ask the resident to invite you — an
            invitation arrives by email and signs you in with a password instead.
          </Text>
        </Card>

        {/*
          Codes are time-boxed by the hostel, and the expiry is the single most
          common reason a correct code stops working. Saying so up front costs a
          line and saves a call to the office.
        */}
        <Text className="px-1 text-center" variant="caption">
          Access codes expire. If yours has, your hostel can issue a new one.
        </Text>
      </View>
    </Screen>
  );
}
