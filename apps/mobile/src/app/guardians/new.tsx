import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Chip } from "@/components/ui/layout";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { Toggle } from "@/components/ui/toggle";
import { useResource } from "@/hooks/use-resource";
import { readApiError } from "@/lib/api-contract";
import {
  describeGuardianOnRecord,
  EMPTY_INVITE_DRAFT,
  type GuardianInviteDraft,
  type GuardianLink,
  type GuardianOnRecord,
  GUARDIAN_PERMISSIONS,
  type GuardianPermissions,
  grantedLabels,
  invalidInviteReason,
  invitableGuardians,
  inviteDraftFrom,
  NO_GUARDIAN_PERMISSIONS,
} from "@/lib/guardian-access";
import { inviteGuardian } from "@/lib/guardian-access-api";
import { type ResidentProfile } from "@/lib/resident-api";
import { residentQuery } from "@/lib/resident-queries";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * Inviting a parent or guardian.
 *
 * ## The details are already ours — the resident should not retype them
 *
 * The office wrote this person down at intake: `GET /resident/profile` returns
 * their name, relation, phone and email under `guardians`, and until this screen
 * read it a resident was made to type all five fields for somebody the hostel
 * had on file. So the form opens **already filled** from that record — first
 * impression, not a button they have to find — and every field stays editable,
 * because the record can be out of date and the resident is the one who knows.
 *
 * What is sent is always what is in the inputs. Nothing here is locked to the
 * record, and picking a different person overwrites the five fields rather than
 * merging into them.
 *
 * ## Only the ones with no sign-in yet
 *
 * `invitableGuardians` drops anybody already linked. A record and a link are the
 * same `Guardian` document seen from two ends, and offering to invite someone who
 * already has access would send a resident to replace a working invitation.
 *
 * ## Every switch starts off, and that is not a default worth "improving"
 *
 * `guardianPermissionsSchema` defaults all six to `false` and says why in its
 * own comment: "sharing is opt-in, one field at a time". The identity fields are
 * facts the hostel already holds; permissions are a decision only the resident
 * can make, so they are the one thing on this screen that is never pre-filled.
 * The screen compensates by *naming* what is shared as they go, so an empty set
 * is visible rather than silent.
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
  /*
    Both through the registry, so this screen almost never waits: `/profile` is
    warmed when the resident enters the portal and the guardians list is warmed
    on the way into `/guardians`, which is the only route that reaches here.
  */
  const profileQuery = residentQuery.profile();
  const profile = useResource<ResidentProfile>(profileQuery.load, {
    cacheKey: profileQuery.key,
    topics: profileQuery.topics,
  });

  const linksQuery = residentQuery.guardians();
  const links = useResource<GuardianLink[]>(linksQuery.load, {
    cacheKey: linksQuery.key,
    topics: linksQuery.topics,
  });

  const [form, setForm] = useState<GuardianInviteDraft>(EMPTY_INVITE_DRAFT);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<GuardianPermissions>(
    NO_GUARDIAN_PERMISSIONS,
  );
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(
    () => invitableGuardians(profile.data?.guardians ?? [], links.data ?? []),
    [links.data, profile.data],
  );

  /*
    Filled once, and never again.

    Both queries re-fetch on focus and on a `residents` broadcast, so `candidates`
    can arrive a second time while the resident is halfway through correcting a
    phone number. A prefill that ran on every change would wipe what they typed;
    the ref makes the fill a first-impression event rather than a subscription.
  */
  const filled = useRef(false);

  useEffect(() => {
    if (filled.current || candidates.length === 0) {
      return;
    }

    filled.current = true;
    setSourceId(candidates[0].id);
    setForm(inviteDraftFrom(candidates[0]));
  }, [candidates]);

  function choose(guardian: GuardianOnRecord) {
    // Overwrite, not merge. Half of one person's details beside half of
    // another's is the one outcome a chooser must never produce.
    filled.current = true;
    setSourceId(guardian.id);
    setForm(inviteDraftFrom(guardian));
  }

  function set(field: keyof GuardianInviteDraft, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

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
    const problem = invalidInviteReason(form);

    if (problem) {
      toastError("Check the form", problem);
      return;
    }

    setBusy(true);

    try {
      const guardian = await inviteGuardian({
        email: form.email.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        permissions,
        phone: form.phone.trim(),
        relation: form.relation.trim(),
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

  const header = <AppBar showBack title="Invite a guardian" />;

  /*
    Skeletons until the record is in, because the whole point is that the fields
    are already filled when the resident first looks at them — an empty form that
    fills itself a frame later reads as the app overwriting their typing.

    A *failed* read is not worth blocking on: the invitation works perfectly well
    typed by hand, so an error here just means no prefill.
  */
  if (profile.loading || links.loading) {
    return (
      <Screen header={header}>
        <SkeletonRows rows={5} />
      </Screen>
    );
  }

  const source = candidates.find((guardian) => guardian.id === sourceId) ?? null;

  return (
    <Screen header={header} scroll>
      <View className="gap-5 pt-1">
        <View>
          <SectionHeader
            subtitle="They get their own sign-in, in their own name"
            title="Who they are"
          />
          <Card className="gap-3">
            {source ? (
              <View className="gap-2">
                <Text variant="label">From your hostel record</Text>
                <Text variant="caption">
                  Edit anything that is out of date — what you send is what is used.
                </Text>
                {candidates.length > 1 ? (
                  <View className="flex-row flex-wrap gap-2">
                    {candidates.map((guardian) => (
                      <Chip
                        key={guardian.id}
                        icon={guardian.id === source.id ? "checkmark" : undefined}
                        label={describeGuardianOnRecord(guardian)}
                        onPress={() => choose(guardian)}
                        tone={guardian.id === source.id ? "brand" : "neutral"}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            <Input
              autoCapitalize="words"
              label="First name"
              onChangeText={(value) => set("firstName", value)}
              placeholder="Sita"
              value={form.firstName}
            />
            <Input
              autoCapitalize="words"
              label="Last name"
              onChangeText={(value) => set("lastName", value)}
              placeholder="Sharma"
              value={form.lastName}
            />
            <Input
              autoCapitalize="none"
              autoCorrect={false}
              hint="The invitation goes here. Inviting the same address again replaces the old link — that is how you resend one."
              keyboardType="email-address"
              label="Email"
              onChangeText={(value) => set("email", value)}
              placeholder="name@example.com"
              value={form.email}
            />
            <Input
              hint="How they are identified when they sign in."
              keyboardType="phone-pad"
              label="Phone"
              onChangeText={(value) => set("phone", value)}
              placeholder="98########"
              value={form.phone}
            />
            <Input
              autoCapitalize="words"
              label="Relation"
              onChangeText={(value) => set("relation", value)}
              placeholder="Mother"
              value={form.relation}
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

        <Button label="Send invitation" loading={busy} onPress={() => void submit()} />
      </View>
    </Screen>
  );
}
