import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Screen } from "@/components/ui/screen";
import { Select } from "@/components/ui/select";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import { readApiError } from "@/lib/api-contract";
import { revalidateSession } from "@/lib/auth-session";
import {
  draftFromProfile,
  hasIdentityErrors,
  idCardNoun,
  idCardTypeForAccount,
  type IdentityDraft,
  type IdentityErrors,
  type IdentityTextField,
  toProfileInput,
  validateIdentity,
} from "@/lib/id-card";
import {
  type BloodGroup,
  type DietaryPreference,
  type Gender,
  getIdentity,
  type GovernmentIdType,
  type IdentityResponse,
  type Occupation,
  saveIdentity,
} from "@/lib/identity-api";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * The one-time profile behind the ID card.
 *
 * ## Structure copied from the web, not reinvented
 *
 * The eight sections, their order, their labels and their hint copy are
 * `apps/web/src/components/resident-identity.tsx`'s — "About you", "How to reach
 * you", "Where you are from", "Study or work", "Guardian", "Emergency contact",
 * "Stay preferences and safety", "Government ID". A resident who filled this in
 * on the website and later edits it on the phone should recognise the same form,
 * so only the controls are native: the web's three-column grid becomes one
 * column, its `<select>`s become sheets, its textareas become multiline inputs.
 *
 * ## The account email is not editable here
 *
 * Same rule as the web, which marks it `readOnly` whenever `accountEmail` exists:
 * `primaryEmail` is the sign-in address, and changing it from a profile form
 * would silently diverge from the credential. It is shown, because it is what
 * goes on the card.
 *
 * ## Saving mints the ID
 *
 * `saveResidentIdentity` allocates the resident id on the first completed save and
 * emails the card once — later saves are edits and send nothing. So the first
 * submit is the moment the card comes into existence, and the toast says so.
 *
 * That first save also **lands on the card**, rather than going back where it
 * came from. The web does the same thing in its modal — a "your resident ID is
 * ready" panel with the id and an Open my ID card button — and the reason holds
 * here: the form was never the destination. A later edit does go back, because
 * then the card is where the person already was.
 */

const GENDER_OPTIONS: { label: string; value: Gender }[] = [
  { label: "Male", value: "MALE" },
  { label: "Female", value: "FEMALE" },
  { label: "Other", value: "OTHER" },
  { label: "Prefer not to say", value: "PREFER_NOT_TO_SAY" },
];

/** `UNKNOWN` last and worded as a choice, as on the web. */
const BLOOD_OPTIONS: { label: string; value: BloodGroup }[] = [
  { label: "A+", value: "A+" },
  { label: "A-", value: "A-" },
  { label: "B+", value: "B+" },
  { label: "B-", value: "B-" },
  { label: "AB+", value: "AB+" },
  { label: "AB-", value: "AB-" },
  { label: "O+", value: "O+" },
  { label: "O-", value: "O-" },
  { label: "I do not know", value: "UNKNOWN" },
];

const OCCUPATION_OPTIONS: { label: string; value: Occupation }[] = [
  { label: "Student", value: "STUDENT" },
  { label: "Working professional", value: "WORKING_PROFESSIONAL" },
  { label: "Neither", value: "OTHER" },
];

const DIET_OPTIONS: { label: string; value: DietaryPreference }[] = [
  { label: "No preference", value: "NO_PREFERENCE" },
  { label: "Vegetarian", value: "VEG" },
  { label: "Non-vegetarian", value: "NON_VEG" },
  { label: "Eggetarian", value: "EGGETARIAN" },
  { label: "Vegan", value: "VEGAN" },
];

const ID_TYPE_OPTIONS: { label: string; value: GovernmentIdType }[] = [
  { label: "Citizenship", value: "CITIZENSHIP" },
  { label: "National ID", value: "NATIONAL_ID" },
  { label: "Passport", value: "PASSPORT" },
  { label: "Driving license", value: "DRIVING_LICENSE" },
  { label: "Student ID", value: "STUDENT_ID" },
  { label: "Other", value: "OTHER" },
];

export default function EditIdentityScreen() {
  const identity = useResource<IdentityResponse>(useCallback(() => getIdentity(), []));
  const account = useAppSelector((state) => state.auth.account);

  /*
   * "Your details" was the whole title, and on the screen it sat above thirty
   * fields that begin with a *second* heading reading "About you". Nothing at
   * the top said which document this fills in — someone arriving from the ID
   * card prompt could not tell whether they were editing their profile, their
   * account or their card.
   *
   * Named from the cached account rather than `identity.data`, because this bar
   * is also what the loading and error states render, and a title that appears
   * one beat after the screen does is worse than one that is simply right from
   * the first frame. `idCardTypeForAccount` is the same mirror the home header
   * uses, and the server stays the authority on what is actually issued.
   */
  const cardNoun = idCardNoun(
    idCardTypeForAccount({
      isServiceProvider: account?.isServiceProvider,
      role: account?.role ?? "PUBLIC",
    }),
  );

  const header = (
    <AppBar
      showBack
      subtitle="Your details, filled in once"
      title={`${cardNoun.charAt(0).toUpperCase()}${cardNoun.slice(1)} ID form`}
    />
  );

  if (identity.loading) {
    return (
      <Screen header={header}>
        <LoadingState />
      </Screen>
    );
  }

  if (identity.error || !identity.data) {
    return (
      <Screen header={header}>
        <ErrorState
          message={identity.error ?? "Your details could not be loaded."}
          onRetry={identity.reload}
        />
      </Screen>
    );
  }

  return <IdentityForm header={header} response={identity.data} />;
}

function IdentityForm({
  header,
  response,
}: {
  header: React.ReactNode;
  response: IdentityResponse;
}) {
  const { colors } = useAppTheme();
  const { identity, profile } = response;

  const [draft, setDraft] = useState<IdentityDraft>(() => {
    const loaded = draftFromProfile(profile);

    return {
      ...loaded,
      // Prefilled from the account when the profile has nothing yet, exactly as
      // the web's `defaultValue={profile?.fullName ?? identity.accountName}` does.
      fullName: loaded.fullName || identity.accountName,
      primaryEmail: loaded.primaryEmail || identity.accountEmail || "",
    };
  });
  /*
   * The interests input holds raw comma-separated text, as on the web, because a
   * chip editor cannot express "still typing the second one". `draft.interests`
   * is only the loaded value; the split at save is what counts.
   */
  const [interestsText, setInterestsText] = useState(
    (profile?.interests ?? []).join(", "),
  );
  const [sharingEnabled, setSharingEnabled] = useState(identity.sharingEnabled);
  const [showSecondGuardian, setShowSecondGuardian] = useState(
    Boolean(profile?.secondGuardianName || profile?.secondGuardianPhone),
  );
  const [errors, setErrors] = useState<IdentityErrors>({});
  const [saving, setSaving] = useState(false);

  const set = useCallback(
    <K extends keyof IdentityDraft>(field: K, value: IdentityDraft[K]) => {
      setDraft((current) => ({ ...current, [field]: value }));
    },
    [],
  );

  const emailLocked = Boolean(identity.accountEmail);
  const isFirstSave = !identity.hasProfile;

  const submit = useCallback(async () => {
    const full: IdentityDraft = { ...draft, interests: interestsText.split(",") };
    const found = validateIdentity(full);

    setErrors(found);

    if (hasIdentityErrors(found)) {
      toastError("Some details need fixing", "The fields in red are the ones.");
      return;
    }

    setSaving(true);

    try {
      await saveIdentity({ profile: toProfileInput(full), sharingEnabled });

      toastSuccess(
        isFirstSave ? "Your ID is ready" : "Details saved",
        isFirstSave
          ? "Any hostel can now register you from your QR code or your ID."
          : undefined,
      );

      if (isFirstSave) {
        /*
         * The save minted the id, so the cached `/auth/me` copy is now stale in
         * the one field the home header reads to decide whether there is a card
         * — `userResidentId`. Not awaited: the card below does not depend on it,
         * and a slow refresh must not hold the screen on a form that has already
         * been saved.
         */
        void revalidateSession();

        // `replace`, not `push`: the form is finished, and its whole point was
        // the card. Backing out of the card should leave, not re-open thirty
        // fields that are already saved.
        router.replace("/id-card");
        return;
      }

      router.back();
    } catch (caught) {
      toastError("Could not save your details", readApiError(caught));
    } finally {
      setSaving(false);
    }
  }, [draft, interestsText, isFirstSave, sharingEnabled]);

  const field = useCallback(
    (
      name: IdentityTextField,
      props: {
        hint?: string;
        keyboardType?: "email-address" | "phone-pad";
        label: string;
        multiline?: boolean;
        placeholder?: string;
        readOnly?: boolean;
        required?: boolean;
      },
    ) => (
      <Input
        autoCapitalize={props.keyboardType === "email-address" ? "none" : "sentences"}
        editable={!props.readOnly}
        error={errors[name]}
        hint={props.hint}
        keyboardType={props.keyboardType}
        label={props.required ? `${props.label} *` : props.label}
        multiline={props.multiline}
        onChangeText={(value) => set(name, value)}
        placeholder={props.placeholder}
        // The height only. `Input` supplies the top alignment and the inner
        // padding a multiline box needs, and sizes its own border around it.
        style={props.multiline ? { height: 88 } : undefined}
        value={draft[name]}
      />
    ),
    [draft, errors, set],
  );

  return (
    <Screen
      footer={
        <Button
          label={isFirstSave ? "Save my details" : "Save changes"}
          loading={saving}
          onPress={() => void submit()}
        />
      }
      header={header}
      scroll
    >
      <View className="gap-6 pt-1">
        <Card className="gap-1">
          <Text variant="label">Fill this in once</Text>
          <Text variant="muted">
            Your details are stored encrypted against your account, so no hostel
            ever asks you to fill this form again.
          </Text>
        </Card>

        <Group title="About you">
          {field("fullName", {
            label: "Full name",
            placeholder: "As written on your ID",
            required: true,
          })}
          {field("dateOfBirth", {
            hint: "Used to show your age to the hostel.",
            label: "Date of birth",
            placeholder: "YYYY-MM-DD",
          })}
          <Select
            error={errors.gender}
            label="Gender *"
            onChange={(value) => set("gender", value)}
            options={GENDER_OPTIONS}
            placeholder="Select gender"
            value={draft.gender || null}
          />
          <Select
            label="Blood group"
            onChange={(value) => set("bloodGroup", value)}
            options={BLOOD_OPTIONS}
            value={draft.bloodGroup}
          />
        </Group>

        <Group title="How to reach you">
          {field("primaryPhone", {
            keyboardType: "phone-pad",
            label: "Phone",
            placeholder: "98XXXXXXXX",
            required: true,
          })}
          {field("alternatePhone", {
            keyboardType: "phone-pad",
            label: "Alternate phone",
            placeholder: "Optional",
          })}
          {field("primaryEmail", {
            hint: emailLocked
              ? "This is your sign-in email and cannot be changed here."
              : undefined,
            keyboardType: "email-address",
            label: "Account email",
            readOnly: emailLocked,
            required: true,
          })}
          {field("backupEmail", {
            hint: "A second email in case we cannot reach the first.",
            keyboardType: "email-address",
            label: "Backup email",
          })}
        </Group>

        <Group title="Where you are from">
          {field("permanentAddress", { label: "Permanent address", multiline: true })}
          {field("city", { label: "City" })}
          {field("province", { label: "Province / state" })}
        </Group>

        <Group subtitle="Optional — skip it if neither applies" title="Study or work">
          <Select
            label="I am a"
            onChange={(value) => set("occupation", value)}
            options={OCCUPATION_OPTIONS}
            value={draft.occupation}
          />
          {field("institution", { label: "College / company" })}
          {field("courseOrDesignation", { label: "Course / job title" })}
        </Group>

        <Group title="Guardian">
          {field("guardianName", { label: "Guardian name", required: true })}
          {field("guardianRelation", {
            label: "Relation",
            placeholder: "Father, mother, uncle…",
            required: true,
          })}
          {field("guardianPhone", {
            keyboardType: "phone-pad",
            label: "Guardian phone",
            required: true,
          })}
          {field("guardianEmail", {
            hint: "How their guardian-portal invite is sent.",
            keyboardType: "email-address",
            label: "Guardian email",
          })}

          {showSecondGuardian ? (
            <Card className="gap-3 bg-muted/30">
              {field("secondGuardianName", { label: "Second guardian name" })}
              {field("secondGuardianRelation", { label: "Relation" })}
              {field("secondGuardianPhone", {
                keyboardType: "phone-pad",
                label: "Second guardian phone",
              })}
              {field("secondGuardianEmail", {
                keyboardType: "email-address",
                label: "Second guardian email",
              })}
            </Card>
          ) : (
            <Pressable
              accessibilityRole="button"
              className="flex-row items-center gap-1.5 self-start py-1 active:opacity-70"
              onPress={() => setShowSecondGuardian(true)}
            >
              <Ionicons color={colors.primary} name="add" size={16} />
              <Text className="text-primary" variant="label">
                Add a second guardian
              </Text>
            </Pressable>
          )}
        </Group>

        <Group
          subtitle="Leave blank to use your guardian as the emergency contact"
          title="Emergency contact"
        >
          {field("emergencyContactName", { label: "Name" })}
          {field("emergencyContactRelation", { label: "Relation" })}
          {field("emergencyContactPhone", {
            keyboardType: "phone-pad",
            label: "Phone",
          })}
        </Group>

        <Group title="Stay preferences and safety">
          <Select
            label="Food preference"
            onChange={(value) => set("dietaryPreference", value)}
            options={DIET_OPTIONS}
            value={draft.dietaryPreference}
          />
          {field("budgetRange", {
            hint: "Prefills your future inquiries.",
            label: "Monthly budget",
            placeholder: "8000-12000",
          })}
          <Input
            error={errors.interests}
            hint="Comma separated. Used for roommate and hostel suggestions."
            label="Interests"
            onChangeText={setInterestsText}
            placeholder="Football, music, coding"
            value={interestsText}
          />
          {field("medicalNotes", {
            label: "Allergies or medical notes",
            multiline: true,
            placeholder: "Anything the hostel should know in an emergency.",
          })}
        </Group>

        <Group
          subtitle="Hostels are required to record one. Filling it here means you do not have to read it out at the desk"
          title="Government ID"
        >
          <Select
            label="ID type"
            onChange={(value) => set("governmentIdType", value)}
            options={ID_TYPE_OPTIONS}
            placeholder="Not now"
            value={draft.governmentIdType || null}
          />
          {field("governmentIdNumber", { label: "ID number" })}
        </Group>

        <Card>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: sharingEnabled }}
            className="flex-row items-start gap-3 active:opacity-70"
            onPress={() => setSharingEnabled((value) => !value)}
          >
            <Ionicons
              color={sharingEnabled ? colors.primary : colors.mutedForeground}
              name={sharingEnabled ? "checkbox" : "square-outline"}
              size={22}
            />
            <Text className="flex-1" variant="muted">
              Let a hostel load these details when I show them my QR code or give
              them my resident ID. You can turn this off later and your data stays
              saved.
            </Text>
          </Pressable>
        </Card>
      </View>
    </Screen>
  );
}

/** One section of the form. `SectionHeader` + a gap, so the eight look alike. */
function Group({
  children,
  subtitle,
  title,
}: {
  children: React.ReactNode;
  subtitle?: string;
  title: string;
}) {
  return (
    <View>
      <SectionHeader subtitle={subtitle} title={title} />
      <View className="gap-3">{children}</View>
    </View>
  );
}
