import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { Children, useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  FadeInLeft,
  FadeInRight,
  ReduceMotion,
} from "react-native-reanimated";

import { GuidedCapture, type GuideShape } from "@/components/guided-capture";
import { SignaturePad } from "@/components/signature-pad";
import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader, SectionLink } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FactRow } from "@/components/ui/layout";
import { Meter } from "@/components/ui/meter";
import { Screen } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
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
  firstIncompleteIdentityStep,
  hasIdentityErrors,
  idCardNoun,
  idCardTypeForAccount,
  IDENTITY_STEPS,
  identityStepComplete,
  type IdentityDraft,
  type IdentityErrors,
  type IdentityStep,
  type IdentityTextField,
  toProfileInput,
  validateIdentity,
  validateIdentityStep,
} from "@/lib/id-card";
import {
  type BloodGroup,
  checkIdentityEmail,
  type DietaryPreference,
  type EmailCheckStatus,
  type Gender,
  getIdentity,
  type GovernmentIdType,
  type IdentityResponse,
  identityPhotoSource,
  identitySignatureSource,
  type Occupation,
  saveIdentity,
} from "@/lib/identity-api";
import { toastError, toastSuccess } from "@/lib/toast";
import { uploadAsset } from "@/lib/uploads";

/**
 * The one-time profile behind the ID card, collected one question-group at a
 * time.
 *
 * ## Why this is a sequence and not a form
 *
 * What is being collected is a KYC pack — name, address, guardian, government
 * ID, a face and a signature. As a single page it was a wall of seven cards and
 * thirty-odd fields, and the problem with a wall is not its length but that you
 * cannot see the end of it: somebody opening it has no idea whether this is a
 * two-minute job or a twenty-minute one, and that judgement is made before the
 * first field is touched. A counter and a bar answer it up front. The banking
 * apps in `ui_inspiration_folder` all collect exactly this sort of pack exactly
 * this way, and the residents using this app have already been through that
 * flow at eSewa and their bank.
 *
 * The steps themselves live in `lib/id-card.ts` — order, titles, which fields
 * each one owns, and what "done" means for each. This file is how they look.
 *
 * ## Editing opens on Review
 *
 * A first-time holder walks the steps. Somebody coming back to fix their phone
 * number lands on Review and taps Edit beside Contact — nobody should page
 * through eight screens to change one line. Same rule the finance screens
 * already follow: facts, with a per-section Edit.
 *
 * ## Photo and signature are steps, not attachments
 *
 * Both print on the card, so both are asked for in the run rather than left to
 * be discovered afterwards. Each uploads the moment it is captured and rides
 * along with the save as a handle, so the server attaches them in the same
 * write — a first save without a photo is refused outright, and the signature
 * can be either drawn on the glass or photographed off paper.
 *
 * ## The email is the sign-in email
 *
 * Filled in from the account and locked whenever the account has one; the
 * server overwrites it anyway, so a client cannot put someone else's address on
 * a card. Only an account with no email types one, and that is checked live
 * against every other account once typing pauses.
 *
 * ## Saving mints the ID
 *
 * The first save allocates the resident id and emails the card once, then lands
 * on the card rather than going back — the form was never the destination. A
 * later edit goes back, because the card is where they were.
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

const GENDER_LABELS = new Map(GENDER_OPTIONS.map((o) => [o.value, o.label]));
const OCCUPATION_LABELS = new Map(OCCUPATION_OPTIONS.map((o) => [o.value, o.label]));
const DIET_LABELS = new Map(DIET_OPTIONS.map((o) => [o.value, o.label]));
const ID_TYPE_LABELS = new Map(ID_TYPE_OPTIONS.map((o) => [o.value, o.label]));

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type EmailCheck = "idle" | "checking" | EmailCheckStatus;

/**
 * Asks the server whether an address is free once typing pauses. A new
 * keystroke cancels the pending ask, so a slow answer for an older address can
 * never overwrite a newer one. The save re-checks; this makes the refusal early.
 */
function useEmailCheck(email: string, enabled: boolean): EmailCheck {
  const [state, setState] = useState<EmailCheck>("idle");

  useEffect(() => {
    const value = email.trim().toLowerCase();

    if (!enabled || !EMAIL_PATTERN.test(value)) {
      setState("idle");

      return;
    }

    let current = true;

    setState("checking");

    const timer = setTimeout(() => {
      checkIdentityEmail(value)
        .then((result) => {
          if (current) {
            setState(result.status);
          }
        })
        // Rate limited or offline: say nothing rather than guess.
        .catch(() => {
          if (current) {
            setState("idle");
          }
        });
    }, 600);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [email, enabled]);

  return state;
}

export default function EditIdentityScreen() {
  const identity = useResource<IdentityResponse>(useCallback(() => getIdentity(), []));
  const account = useAppSelector((state) => state.auth.account);

  // Named from the cached account, so the title is right from the first frame
  // — the loading and error states render this same bar.
  const cardNoun = idCardNoun(
    idCardTypeForAccount({
      isServiceProvider: account?.isServiceProvider,
      role: account?.role ?? "PUBLIC",
    }),
  );

  if (identity.loading) {
    return (
      <Screen
        header={<AppBar showBack subtitle="Loading your details" title="Your ID" />}
      >
        <LoadingState />
      </Screen>
    );
  }

  if (identity.error || !identity.data) {
    return (
      <Screen header={<AppBar showBack subtitle="Your details" title="Your ID" />}>
        <ErrorState
          message={identity.error ?? "Your details could not be loaded."}
          onRetry={identity.reload}
        />
      </Screen>
    );
  }

  return <IdentityWizard cardNoun={cardNoun} response={identity.data} />;
}

/** What each step screen is handed. Keeps the field helpers out of nine props. */
type FormControl = {
  draft: IdentityDraft;
  errors: IdentityErrors;
  set: <K extends keyof IdentityDraft>(field: K, value: IdentityDraft[K]) => void;
};

const REVIEW_INDEX = IDENTITY_STEPS.length - 1;

function IdentityWizard({
  cardNoun,
  response,
}: {
  cardNoun: string;
  response: IdentityResponse;
}) {
  const token = useAppSelector((state) => state.auth.accessToken);
  const { identity, profile } = response;

  const [draft, setDraft] = useState<IdentityDraft>(() => {
    const loaded = draftFromProfile(profile);

    return {
      ...loaded,
      fullName: loaded.fullName || identity.accountName,
      // The sign-in email outranks whatever an older save stored.
      primaryEmail: identity.accountEmail || loaded.primaryEmail || "",
    };
  });
  // Raw comma-separated text: a chip editor cannot express "still typing".
  const [interestsText, setInterestsText] = useState(
    (profile?.interests ?? []).join(", "),
  );
  const [sharingEnabled, setSharingEnabled] = useState(identity.sharingEnabled);
  const [errors, setErrors] = useState<IdentityErrors>({});
  const [saving, setSaving] = useState(false);
  const [signing, setSigning] = useState(false);

  const isFirstSave = !identity.hasProfile;

  /*
   * An edit opens on Review. Somebody who already has a card came back to
   * change one thing, and nine screens between them and it is nine screens of
   * other people's decisions.
   */
  const [index, setIndex] = useState(isFirstSave ? 0 : REVIEW_INDEX);
  /** Which way the next screen slides in from. */
  const [forward, setForward] = useState(true);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoAssetId, setPhotoAssetId] = useState<string | null>(null);
  const [signatureUri, setSignatureUri] = useState<string | null>(null);
  const [signatureAssetId, setSignatureAssetId] = useState<string | null>(null);
  const [uploading, setUploading] = useState<null | GuideShape>(null);
  const [camera, setCamera] = useState<null | GuideShape>(null);

  const photoSource = photoUri ? { uri: photoUri } : identityPhotoSource(identity, token);
  const signatureSource = signatureUri
    ? { uri: signatureUri }
    : identitySignatureSource(identity, token);

  const hasPhoto = Boolean(photoAssetId || identity.hasPhoto);
  const hasSignatureImage = Boolean(signatureAssetId || identity.hasSignatureImage);

  const emailLocked = Boolean(identity.accountEmail);
  const emailCheck = useEmailCheck(draft.primaryEmail, !emailLocked);

  const set = useCallback(
    <K extends keyof IdentityDraft>(field: K, value: IdentityDraft[K]) => {
      setDraft((current) => ({ ...current, [field]: value }));
      // The error under a field is about what *was* there. Clearing it as soon
      // as the field is touched is the difference between a form that corrects
      // you and one that nags.
      setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
    },
    [],
  );

  /** The draft with the comma-separated interests box folded back in. */
  const full = useMemo<IdentityDraft>(
    () => ({ ...draft, interests: interestsText.split(",") }),
    [draft, interestsText],
  );

  const step = IDENTITY_STEPS[index]!;
  const assets = { hasPhoto, hasSignatureImage };

  const goTo = useCallback((next: number, direction: boolean) => {
    setForward(direction);
    setIndex(next);
  }, []);

  const back = useCallback(() => {
    if (index === 0) {
      router.back();

      return;
    }

    goTo(index - 1, false);
  }, [goTo, index]);

  const advance = useCallback(() => {
    const found = validateIdentityStep(step.key, full);

    if (!emailLocked && step.key === "contact" && emailCheck === "TAKEN") {
      found.primaryEmail = "Already used by another account. Use a different one.";
    }

    if (step.key === "photo" && !hasPhoto) {
      toastError("Your photo is missing", "It goes on the front of your card.");

      return;
    }

    setErrors(found);

    if (hasIdentityErrors(found)) {
      return;
    }

    goTo(Math.min(REVIEW_INDEX, index + 1), true);
  }, [emailCheck, emailLocked, full, goTo, hasPhoto, index, step.key]);

  /** Uploads a captured file and remembers its handle for the save. */
  const attach = useCallback(
    async (shape: GuideShape, uri: string) => {
      const label = shape === "face" ? "ID card photo" : "Signature";

      if (shape === "face") {
        setPhotoUri(uri);
      } else {
        setSignatureUri(uri);
        // The two signatures are exclusive, and the draft is what the payload
        // is built from — leaving strokes behind would send both.
        set("signature", "");
        set("signatureImageUri", uri);
      }

      setUploading(shape);

      try {
        const assetId = await uploadAsset({ uri }, { kind: "GENERIC", label });

        if (shape === "face") {
          setPhotoAssetId(assetId);
        } else {
          setSignatureAssetId(assetId);
        }
      } catch (caught) {
        if (shape === "face") {
          setPhotoUri(null);
        } else {
          setSignatureUri(null);
          set("signatureImageUri", "");
        }

        toastError(`Could not upload that ${label.toLowerCase()}`, readApiError(caught));
      } finally {
        setUploading(null);
      }
    },
    [set],
  );

  /** The gallery, for a photo somebody already has. Square crop, as the card is. */
  const pickPhotoFromLibrary = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      toastError("Permission needed", "Allow photo access to pick your photo.");

      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      mediaTypes: ["images"],
      quality: 0.85,
    });
    const picked = result.canceled ? null : result.assets[0];

    if (picked) {
      await attach("face", picked.uri);
    }
  }, [attach]);

  const submit = useCallback(async () => {
    const found = validateIdentity(full);

    if (!emailLocked && emailCheck === "TAKEN") {
      found.primaryEmail = "Already used by another account. Use a different one.";
    }

    setErrors(found);

    if (uploading) {
      toastError("Something is still uploading", "Try again in a moment.");

      return;
    }

    const incomplete = firstIncompleteIdentityStep(full, assets);

    if (incomplete || hasIdentityErrors(found)) {
      const target = IDENTITY_STEPS.findIndex((entry) => entry.key === incomplete);

      toastError("Some details need fixing", "The ones in red.");

      if (target >= 0) {
        goTo(target, false);
      }

      return;
    }

    setSaving(true);

    try {
      await saveIdentity({
        ...(photoAssetId ? { photoAssetId } : {}),
        profile: toProfileInput(full),
        ...(signatureAssetId ? { signatureAssetId } : {}),
        sharingEnabled,
      });

      toastSuccess(
        isFirstSave ? "Your ID is ready" : "Details saved",
        isFirstSave
          ? "Any hostel can now register you from your QR code or your ID."
          : undefined,
      );

      if (isFirstSave) {
        // The save minted the id; `/auth/me`'s `userResidentId` is now stale.
        // Not awaited — the card below does not depend on it.
        void revalidateSession();
        // `replace`: backing out of the card should leave, not reopen the form.
        router.replace("/id-card");

        return;
      }

      router.back();
    } catch (caught) {
      toastError("Could not save your details", readApiError(caught));
    } finally {
      setSaving(false);
    }
  }, [
    assets,
    emailCheck,
    emailLocked,
    full,
    goTo,
    isFirstSave,
    photoAssetId,
    sharingEnabled,
    signatureAssetId,
    uploading,
    full,
  ]);

  const control: FormControl = { draft, errors, set };
  const onReview = step.key === "review";

  return (
    <>
      <Screen
        footer={
          onReview ? (
            <Button
              label={isFirstSave ? "Create my ID" : "Save changes"}
              loading={saving}
              onPress={() => void submit()}
            />
          ) : (
            <View className="flex-row gap-3">
              <View className="w-28">
                <Button label="Back" onPress={back} variant="outline" />
              </View>
              <View className="flex-1">
                <Button
                  label={continueLabel(step.key, full, assets)}
                  onPress={advance}
                />
              </View>
            </View>
          )
        }
        header={
          <>
            <AppBar
              onBack={back}
              showBack
              subtitle={`Step ${index + 1} of ${IDENTITY_STEPS.length}`}
              title={step.title}
            />
            <View className="px-4 pb-3">
              <Meter
                animated
                height={4}
                label={null}
                percent={((index + 1) / IDENTITY_STEPS.length) * 100}
                reading="elapsed"
              />
            </View>
          </>
        }
        scroll
        scrollEnabled={!signing}
      >
        {/*
          Keyed on the step so each screen mounts fresh and plays its entrance.
          Only `entering` is animated: a simultaneous exit would need both
          screens laid out at once, and two stacked forms inside a scroll view
          is a jump rather than a transition.
        */}
        <Animated.View
          className="gap-6 pt-1"
          entering={(forward ? FadeInRight : FadeInLeft)
            .duration(220)
            .reduceMotion(ReduceMotion.System)}
          key={step.key}
        >
          <Text variant="muted">{step.subtitle}</Text>

          {step.key === "about" ? <AboutStep control={control} /> : null}
          {step.key === "contact" ? (
            <ContactStep
              check={emailCheck}
              control={control}
              locked={emailLocked}
            />
          ) : null}
          {step.key === "address" ? <AddressStep control={control} /> : null}
          {step.key === "work" ? <WorkStep control={control} /> : null}
          {step.key === "guardian" ? <GuardianStep control={control} /> : null}
          {step.key === "preferences" ? (
            <PreferencesStep
              control={control}
              interestsText={interestsText}
              onInterestsChange={setInterestsText}
            />
          ) : null}
          {step.key === "photo" ? (
            <PhotoStep
              busy={uploading === "face"}
              onOpenCamera={() => setCamera("face")}
              onPickFromLibrary={() => void pickPhotoFromLibrary()}
              source={photoSource}
            />
          ) : null}
          {step.key === "signature" ? (
            <SignatureStep
              busy={uploading === "signature"}
              control={control}
              hasImage={hasSignatureImage}
              onOpenCamera={() => setCamera("signature")}
              onSigningChange={setSigning}
              source={signatureSource}
            />
          ) : null}
          {step.key === "review" ? (
            <ReviewStep
              assets={assets}
              cardNoun={cardNoun}
              draft={full}
              interestsText={interestsText}
              onEdit={(key) =>
                goTo(
                  IDENTITY_STEPS.findIndex((entry) => entry.key === key),
                  false,
                )
              }
              onSharingChange={setSharingEnabled}
              sharingEnabled={sharingEnabled}
            />
          ) : null}
        </Animated.View>
      </Screen>

      <GuidedCapture
        onCancel={() => setCamera(null)}
        onConfirm={(uri) => {
          const shape = camera;

          setCamera(null);

          if (shape) {
            void attach(shape, uri);
          }
        }}
        shape={camera ?? "face"}
        visible={camera !== null}
      />
    </>
  );
}

/**
 * "Skip" rather than "Continue" on a step where nothing has been filled in and
 * nothing is required — so the way past it is stated rather than guessed at.
 */
function continueLabel(
  step: IdentityStep,
  draft: IdentityDraft,
  assets: { hasPhoto: boolean; hasSignatureImage: boolean },
): string {
  const optional = step === "work" || step === "address" || step === "preferences";
  const untouched =
    optional && !hasIdentityErrors(validateIdentityStep(step, draft)) && isBlank(step, draft);

  if (untouched) {
    return "Skip";
  }

  return step === "signature" && identityStepComplete(step, draft, assets)
    ? "Review"
    : "Continue";
}

/** Whether an optional step has been left entirely alone. */
function isBlank(step: IdentityStep, draft: IdentityDraft): boolean {
  if (step === "address") {
    return !draft.permanentAddress.trim() && !draft.city.trim() && !draft.province.trim();
  }

  if (step === "work") {
    return !draft.institution.trim() && !draft.courseOrDesignation.trim();
  }

  return (
    !draft.budgetRange.trim() &&
    !draft.medicalNotes.trim() &&
    !draft.governmentIdNumber.trim() &&
    draft.interests.length === 0
  );
}

/* ── steps ── */

function AboutStep({ control }: { control: FormControl }) {
  return (
    <Group title="About you">
      <TextField
        control={control}
        label="Full name"
        name="fullName"
        placeholder="As written on your ID"
        required
      />
      <TextField
        control={control}
        label="Date of birth"
        name="dateOfBirth"
        placeholder="YYYY-MM-DD"
      />
      <Row>
        <Select
          error={control.errors.gender}
          label="Gender *"
          onChange={(value) => control.set("gender", value)}
          options={GENDER_OPTIONS}
          placeholder="Select"
          value={control.draft.gender || null}
        />
        <Select
          label="Blood group"
          onChange={(value) => control.set("bloodGroup", value)}
          options={BLOOD_OPTIONS}
          value={control.draft.bloodGroup}
        />
      </Row>
    </Group>
  );
}

function ContactStep({
  check,
  control,
  locked,
}: {
  check: EmailCheck;
  control: FormControl;
  locked: boolean;
}) {
  const status: { hint?: string; tone?: "success" } = locked
    ? { hint: "Your sign-in email — filled in for you." }
    : check === "checking"
      ? { hint: "Checking…" }
      : check === "AVAILABLE"
        ? { hint: "✓ Available", tone: "success" }
        : check === "YOURS"
          ? { hint: "✓ Your account's email", tone: "success" }
          : {};

  return (
    <Group title="Contact">
      <TextField
        control={control}
        keyboardType="phone-pad"
        label="Phone"
        name="primaryPhone"
        placeholder="98XXXXXXXX"
        required
      />
      <TextField
        control={control}
        keyboardType="phone-pad"
        label="Alternate phone"
        name="alternatePhone"
      />
      <Input
        autoCapitalize="none"
        autoComplete="email"
        editable={!locked}
        error={control.errors.primaryEmail}
        hint={status.hint}
        keyboardType="email-address"
        label="Email *"
        onChangeText={(value) => control.set("primaryEmail", value)}
        tone={status.tone}
        value={control.draft.primaryEmail}
      />
      <TextField
        control={control}
        keyboardType="email-address"
        label="Backup email"
        name="backupEmail"
      />
    </Group>
  );
}

function AddressStep({ control }: { control: FormControl }) {
  return (
    <Group title="Address">
      <TextField control={control} label="Permanent address" multiline name="permanentAddress" />
      <Row>
        <TextField control={control} label="City" name="city" />
        <TextField control={control} label="Province" name="province" />
      </Row>
    </Group>
  );
}

function WorkStep({ control }: { control: FormControl }) {
  return (
    <Group subtitle="Nothing here is required" title="Study or work">
      <Select
        label="I am a"
        onChange={(value) => control.set("occupation", value)}
        options={OCCUPATION_OPTIONS}
        value={control.draft.occupation}
      />
      <TextField control={control} label="College / company" name="institution" />
      <TextField control={control} label="Course / job title" name="courseOrDesignation" />
    </Group>
  );
}

function GuardianStep({ control }: { control: FormControl }) {
  const { colors } = useAppTheme();
  const [showSecond, setShowSecond] = useState(
    Boolean(control.draft.secondGuardianName || control.draft.secondGuardianPhone),
  );

  return (
    <>
      <Group title="Guardian">
        <TextField control={control} label="Name" name="guardianName" required />
        <Row>
          <TextField
            control={control}
            label="Relation"
            name="guardianRelation"
            placeholder="Father, mother…"
            required
          />
          <TextField
            control={control}
            keyboardType="phone-pad"
            label="Phone"
            name="guardianPhone"
            required
          />
        </Row>
        <TextField
          control={control}
          keyboardType="email-address"
          label="Email"
          name="guardianEmail"
        />

        {showSecond ? (
          <View className="gap-3 border-t border-border pt-3">
            <Text variant="label">Second guardian</Text>
            <TextField control={control} label="Name" name="secondGuardianName" />
            <Row>
              <TextField control={control} label="Relation" name="secondGuardianRelation" />
              <TextField
                control={control}
                keyboardType="phone-pad"
                label="Phone"
                name="secondGuardianPhone"
              />
            </Row>
            <TextField
              control={control}
              keyboardType="email-address"
              label="Email"
              name="secondGuardianEmail"
            />
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            className="flex-row items-center gap-1.5 self-start py-1 active:opacity-70"
            onPress={() => setShowSecond(true)}
          >
            <Ionicons color={colors.primary} name="add" size={16} />
            <Text className="text-primary" variant="label">
              Add a second guardian
            </Text>
          </Pressable>
        )}
      </Group>

      <Group subtitle="Blank = your guardian" title="Emergency contact">
        <TextField control={control} label="Name" name="emergencyContactName" />
        <Row>
          <TextField control={control} label="Relation" name="emergencyContactRelation" />
          <TextField
            control={control}
            keyboardType="phone-pad"
            label="Phone"
            name="emergencyContactPhone"
          />
        </Row>
      </Group>
    </>
  );
}

function PreferencesStep({
  control,
  interestsText,
  onInterestsChange,
}: {
  control: FormControl;
  interestsText: string;
  onInterestsChange: (value: string) => void;
}) {
  return (
    <>
      <Group title="Preferences and safety">
        <Row>
          <Select
            label="Food"
            onChange={(value) => control.set("dietaryPreference", value)}
            options={DIET_OPTIONS}
            value={control.draft.dietaryPreference}
          />
          <TextField
            control={control}
            label="Monthly budget"
            name="budgetRange"
            placeholder="8000-12000"
          />
        </Row>
        <Input
          error={control.errors.interests}
          label="Interests"
          onChangeText={onInterestsChange}
          placeholder="Football, music, coding"
          value={interestsText}
        />
        <TextField
          control={control}
          label="Allergies or medical notes"
          multiline
          name="medicalNotes"
        />
      </Group>

      <Group subtitle="Saves reading it out at the desk" title="Government ID">
        <Row>
          <Select
            label="Type"
            onChange={(value) => control.set("governmentIdType", value)}
            options={ID_TYPE_OPTIONS}
            placeholder="Not now"
            value={control.draft.governmentIdType || null}
          />
          <TextField control={control} label="Number" name="governmentIdNumber" />
        </Row>
      </Group>
    </>
  );
}

function PhotoStep({
  busy,
  onOpenCamera,
  onPickFromLibrary,
  source,
}: {
  busy: boolean;
  onOpenCamera: () => void;
  onPickFromLibrary: () => void;
  source: { uri: string } | null;
}) {
  const { colors } = useAppTheme();

  return (
    <View className="items-center gap-5 pt-2">
      <View className="size-40 items-center justify-center overflow-hidden rounded-full border-2 border-border bg-muted">
        {source ? (
          <Image
            contentFit="cover"
            source={source}
            style={{ height: "100%", width: "100%" }}
          />
        ) : (
          <Ionicons color={colors.mutedForeground} name="person" size={64} />
        )}
      </View>

      <Text className="px-6 text-center" variant="muted">
        Face the camera in good light, with nothing covering your face. This is the
        picture a warden checks you against.
      </Text>

      <View className="w-full gap-3">
        <Button
          disabled={busy}
          label={source ? "Take it again" : "Take my photo"}
          loading={busy}
          onPress={onOpenCamera}
        />
        {/* The second answer to the question, not a peer of it. */}
        <Button
          disabled={busy}
          label="Choose from gallery"
          onPress={onPickFromLibrary}
          variant="outline"
        />
      </View>
    </View>
  );
}

function SignatureStep({
  busy,
  control,
  hasImage,
  onOpenCamera,
  onSigningChange,
  source,
}: {
  busy: boolean;
  control: FormControl;
  hasImage: boolean;
  onOpenCamera: () => void;
  onSigningChange: (active: boolean) => void;
  source: { uri: string } | null;
}) {
  /*
   * Opens on whichever one they already have. A holder who photographed their
   * signature last time and came back to change something else should not find
   * an empty drawing pad where their signature was.
   */
  const [mode, setMode] = useState<"draw" | "photo">(hasImage ? "photo" : "draw");

  return (
    <View className="gap-4">
      <Segmented
        onChange={(value) => {
          setMode(value);
          onSigningChange(false);
        }}
        options={[
          { label: "Draw it", value: "draw" as const },
          { label: "Photograph it", value: "photo" as const },
        ]}
        value={mode}
      />

      {mode === "draw" ? (
        <SignaturePad
          error={control.errors.signature}
          onActiveChange={onSigningChange}
          onChange={(value) => {
            control.set("signature", value);
            // Drawing replaces a photographed signature; the card holds one.
            control.set("signatureImageUri", "");
          }}
          value={control.draft.signature}
        />
      ) : (
        <View className="gap-4">
          <View className="h-32 items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted">
            {source ? (
              <Image
                contentFit="contain"
                source={source}
                style={{ height: "100%", width: "100%" }}
              />
            ) : (
              <Text variant="caption">Nothing photographed yet</Text>
            )}
          </View>

          <Text variant="muted">
            Sign on a clean white sheet, lay it flat and fill the frame. The picture
            is cropped to the frame and printed on the back of your card.
          </Text>

          <Button
            disabled={busy}
            label={source ? "Photograph it again" : "Open the camera"}
            loading={busy}
            onPress={onOpenCamera}
          />

          {control.errors.signature ? (
            <Text className="text-destructive" variant="caption">
              {control.errors.signature}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

/**
 * Everything that was entered, as facts with a per-section Edit.
 *
 * Read-only on purpose. A review screen that is also editable is the same wall
 * of fields the steps just took apart, and it removes the one thing a review is
 * for: seeing what you are about to submit at a glance.
 */
function ReviewStep({
  assets,
  cardNoun,
  draft,
  interestsText,
  onEdit,
  onSharingChange,
  sharingEnabled,
}: {
  assets: { hasPhoto: boolean; hasSignatureImage: boolean };
  cardNoun: string;
  draft: IdentityDraft;
  interestsText: string;
  onEdit: (step: IdentityStep) => void;
  onSharingChange: (value: boolean) => void;
  sharingEnabled: boolean;
}) {
  const { colors } = useAppTheme();
  const dash = (value: string) => value.trim() || "—";

  return (
    <View className="gap-6">
      <Section
        complete={identityStepComplete("about", draft, assets)}
        onEdit={() => onEdit("about")}
        title="About you"
      >
        <FactRow label="Full name" value={dash(draft.fullName)} />
        <FactRow label="Date of birth" value={dash(draft.dateOfBirth)} />
        <FactRow
          label="Gender"
          value={GENDER_LABELS.get(draft.gender as Gender) ?? "—"}
        />
        <FactRow
          label="Blood group"
          value={draft.bloodGroup === "UNKNOWN" ? "—" : draft.bloodGroup}
        />
      </Section>

      <Section
        complete={identityStepComplete("contact", draft, assets)}
        onEdit={() => onEdit("contact")}
        title="Contact"
      >
        <FactRow label="Phone" value={dash(draft.primaryPhone)} />
        <FactRow label="Alternate phone" value={dash(draft.alternatePhone)} />
        <FactRow label="Email" value={dash(draft.primaryEmail)} />
        <FactRow label="Backup email" value={dash(draft.backupEmail)} />
      </Section>

      <Section
        complete={identityStepComplete("address", draft, assets)}
        onEdit={() => onEdit("address")}
        title="Address"
      >
        <FactRow label="Permanent address" value={dash(draft.permanentAddress)} />
        <FactRow label="City" value={dash(draft.city)} />
        <FactRow label="Province" value={dash(draft.province)} />
      </Section>

      <Section
        complete={identityStepComplete("work", draft, assets)}
        onEdit={() => onEdit("work")}
        title="Study or work"
      >
        <FactRow
          label="I am a"
          value={OCCUPATION_LABELS.get(draft.occupation) ?? "—"}
        />
        <FactRow label="College / company" value={dash(draft.institution)} />
        <FactRow label="Course / job title" value={dash(draft.courseOrDesignation)} />
      </Section>

      <Section
        complete={identityStepComplete("guardian", draft, assets)}
        onEdit={() => onEdit("guardian")}
        title="Guardian and emergency"
      >
        <FactRow label="Guardian" value={dash(draft.guardianName)} />
        <FactRow label="Relation" value={dash(draft.guardianRelation)} />
        <FactRow label="Phone" value={dash(draft.guardianPhone)} />
        {draft.secondGuardianName.trim() ? (
          <FactRow label="Second guardian" value={draft.secondGuardianName} />
        ) : null}
        <FactRow
          label="Emergency contact"
          value={dash(draft.emergencyContactName) === "—"
            ? "Your guardian"
            : draft.emergencyContactName}
        />
      </Section>

      <Section
        complete={identityStepComplete("preferences", draft, assets)}
        onEdit={() => onEdit("preferences")}
        title="Preferences and ID"
      >
        <FactRow
          label="Food"
          value={DIET_LABELS.get(draft.dietaryPreference) ?? "—"}
        />
        <FactRow label="Monthly budget" value={dash(draft.budgetRange)} />
        <FactRow label="Interests" value={dash(interestsText)} />
        <FactRow label="Medical notes" value={dash(draft.medicalNotes)} />
        <FactRow
          label="Government ID"
          value={
            draft.governmentIdType
              ? `${ID_TYPE_LABELS.get(draft.governmentIdType) ?? draft.governmentIdType} ${dash(draft.governmentIdNumber)}`
              : "—"
          }
        />
      </Section>

      <Section
        complete={assets.hasPhoto}
        onEdit={() => onEdit("photo")}
        title="Your photo"
      >
        <FactRow label="Photo" value={assets.hasPhoto ? "Added" : "Not added yet"} />
      </Section>

      <Section
        complete={identityStepComplete("signature", draft, assets)}
        onEdit={() => onEdit("signature")}
        title="Your signature"
      >
        <FactRow
          label="Signature"
          value={
            assets.hasSignatureImage || draft.signatureImageUri
              ? "Photographed"
              : draft.signature
                ? "Drawn"
                : "Not signed yet"
          }
        />
      </Section>

      <Card>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: sharingEnabled }}
          className="flex-row items-center gap-3 active:opacity-70"
          onPress={() => onSharingChange(!sharingEnabled)}
        >
          <Ionicons
            color={sharingEnabled ? colors.primary : colors.mutedForeground}
            name={sharingEnabled ? "checkbox" : "square-outline"}
            size={22}
          />
          <Text className="flex-1" variant="muted">
            Let a hostel load these details from my QR code or {cardNoun} ID. I can
            turn this off later.
          </Text>
        </Pressable>
      </Card>
    </View>
  );
}

/** One reviewed section: heading, a tick when it is done, and an Edit. */
function Section({
  children,
  complete,
  onEdit,
  title,
}: {
  children: React.ReactNode;
  complete: boolean;
  onEdit: () => void;
  title: string;
}) {
  const { colors } = useAppTheme();

  return (
    <View>
      <SectionHeader
        action={<SectionLink label="Edit" onPress={onEdit} />}
        title={title}
      />
      <Card>
        {children}
        {complete ? null : (
          <View className="flex-row items-center gap-2 pt-2">
            <Ionicons color={colors.warning} name="alert-circle" size={16} />
            <Text className="flex-1 text-warning" variant="caption">
              Something here still needs filling in.
            </Text>
          </View>
        )}
      </Card>
    </View>
  );
}

/* ── field helpers ── */

function TextField({
  control,
  keyboardType,
  label,
  multiline,
  name,
  placeholder,
  required,
}: {
  control: FormControl;
  keyboardType?: "email-address" | "phone-pad";
  label: string;
  multiline?: boolean;
  name: IdentityTextField;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <Input
      autoCapitalize={keyboardType === "email-address" ? "none" : "sentences"}
      error={control.errors[name]}
      keyboardType={keyboardType}
      label={required ? `${label} *` : label}
      multiline={multiline}
      onChangeText={(value) => control.set(name, value)}
      placeholder={placeholder}
      style={multiline ? { height: 88 } : undefined}
      value={control.draft[name]}
    />
  );
}

/** One section: heading outside, fields inside one card. */
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
      <Card className="gap-3">{children}</Card>
    </View>
  );
}

/** Two short fields side by side, each taking half the row. */
function Row({ children }: { children: React.ReactNode }) {
  return (
    <View className="flex-row gap-3">
      {Children.map(children, (child) => (
        <View className="flex-1">{child}</View>
      ))}
    </View>
  );
}
