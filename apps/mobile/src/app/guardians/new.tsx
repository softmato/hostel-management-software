import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { Toggle } from "@/components/ui/toggle";
import { readApiError } from "@/lib/api-contract";
import {
  GUARDIAN_PERMISSIONS,
  type GuardianPermissions,
  grantedLabels,
  invalidInviteReason,
  NO_GUARDIAN_PERMISSIONS,
} from "@/lib/guardian-access";
import { inviteGuardian } from "@/lib/guardian-access-api";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * Inviting a parent or guardian.
 *
 * ## Every switch starts off, and that is not a default worth "improving"
 *
 * `guardianPermissionsSchema` defaults all six to `false` and says why in its
 * own comment: "sharing is opt-in, one field at a time". Pre-ticking even the
 * harmless-looking ones — the food menu, say — would mean a resident who taps
 * through this form has shared something they never chose to. The screen
 * compensates by *naming* what is shared as they go, so an empty set is
 * visible rather than silent.
 *
 * ## The form is validated here and validated again there
 *
 * `invalidInviteReason` mirrors `guardianInviteSchema`'s bounds so the resident
 * is told before the request rather than by a 400 with a Zod message in it. It
 * is not a substitute for the server, and where the two ever disagree the
 * server is right — the email check here is deliberately looser than
 * `z.string().email()` for exactly that reason.
 *
 * ## Inviting the same address twice is how you resend
 *
 * `inviteGuardian` revokes every `ACTIVE` access for that guardian before
 * minting a new one — "one live invitation per guardian" — and reuses the
 * guardian record when `{ email, hostelId, residentId }` already matches. So
 * there is no separate Resend button to build, and the note under the email
 * field says as much rather than leaving a resident to discover it.
 */
export default function InviteGuardianScreen() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [relation, setRelation] = useState("");
  const [permissions, setPermissions] = useState<GuardianPermissions>(
    NO_GUARDIAN_PERMISSIONS,
  );
  const [busy, setBusy] = useState(false);

  const granted = grantedLabels(permissions);

  /*
   * Not wrapped in `useCallback`, deliberately.
   *
   * It is called from one inline arrow on one button, so a stable identity buys
   * nothing — and the React Compiler says so: memoising it here means "memoized
   * in source but not in compilation output", which fails
   * `react-hooks/preserve-manual-memoization` and makes the compiler skip
   * optimising the whole component. The rule to take from that is that
   * `useCallback` is for a value something else depends on being stable
   * (`useResource`'s loader is the case that genuinely needs it), not a reflex.
   */
  async function submit() {
    const problem = invalidInviteReason({
      email,
      firstName,
      lastName,
      phone,
      relation,
    });

    if (problem) {
      toastError("Check the form", problem);
      return;
    }

    setBusy(true);

    try {
      const guardian = await inviteGuardian({
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        permissions,
        phone: phone.trim(),
        relation: relation.trim(),
      });

      toastSuccess(
        `Invitation sent to ${guardian.name}`,
        "They have seven days to open the link in their email.",
      );
      router.back();
    } catch (caught) {
      toastError("Could not send that invitation", readApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen header={<AppBar showBack title="Invite a guardian" />} scroll>
      <View className="gap-5 pt-1">
        <View>
          <SectionHeader
            subtitle="They get their own sign-in, in their own name"
            title="Who they are"
          />
          <Card className="gap-3">
            <Input
              autoCapitalize="words"
              label="First name"
              onChangeText={setFirstName}
              placeholder="Sita"
              value={firstName}
            />
            <Input
              autoCapitalize="words"
              label="Last name"
              onChangeText={setLastName}
              placeholder="Sharma"
              value={lastName}
            />
            <Input
              autoCapitalize="none"
              autoCorrect={false}
              hint="The invitation goes here. Inviting the same address again replaces the old link — that is how you resend one."
              keyboardType="email-address"
              label="Email"
              onChangeText={setEmail}
              placeholder="name@example.com"
              value={email}
            />
            <Input
              hint="How they are identified when they sign in."
              keyboardType="phone-pad"
              label="Phone"
              onChangeText={setPhone}
              placeholder="98########"
              value={phone}
            />
            <Input
              autoCapitalize="words"
              label="Relation"
              onChangeText={setRelation}
              placeholder="Mother"
              value={relation}
            />
          </Card>
        </View>

        <View>
          <SectionHeader
            subtitle="All off to begin with — switch on only what you want them to see"
            title="What they can see"
          />
          <Card>
            {GUARDIAN_PERMISSIONS.map((field, index) => (
              <View key={field.key}>
                {index > 0 ? <RowDivider /> : null}
                <ListRow
                  right={
                    <Toggle
                      accessibilityLabel={field.label}
                      onChange={(next) =>
                        setPermissions((current) => ({ ...current, [field.key]: next }))
                      }
                      value={permissions[field.key]}
                    />
                  }
                  title={field.label}
                />
              </View>
            ))}
          </Card>
        </View>

        {/*
          Said back to them before they send it.

          The switches above are six rows of grey; this is the one line that
          answers "so what did I just agree to". It also makes the all-off case
          visible — an invitation that shares nothing is allowed, and is
          sometimes what somebody wants, but it should not be an accident.
        */}
        <Card className="gap-1">
          <Text variant="label">
            {granted.length === 0
              ? "They will see nothing yet"
              : `They will see ${granted.length === 1 ? "one thing" : `${granted.length} things`}`}
          </Text>
          <Text variant="muted">
            {granted.length === 0
              ? "You can send the invitation anyway and turn things on later — they will get their sign-in, and an empty account until you do."
              : `${granted.join(", ")}. Nothing else, and you can change this at any time.`}
          </Text>
        </Card>

        <Button
          label="Send invitation"
          loading={busy}
          onPress={() => void submit()}
        />
      </View>
    </Screen>
  );
}
