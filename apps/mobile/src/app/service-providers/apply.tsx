import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import {
  ChipGroup,
  FormSection,
  ReviewRow,
  StepTracker,
  WizardFooter,
} from "@/components/registration-form";
import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { EmptyState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { API_BASE_URL } from "@/lib/api";
import { readApiError } from "@/lib/api-contract";
import { absoluteMediaUrl } from "@/lib/media";
import {
  buildProviderPayload,
  EMPTY_PROVIDER_FORM,
  firstIncompleteProviderStep,
  hasProviderErrors,
  isProviderStepComplete,
  PROVIDER_CATEGORIES,
  PROVIDER_STEPS,
  providerCategoryLabel,
  providerStepErrors,
  toggleProviderCategory,
  type ProviderCategory,
  type ProviderErrors,
  type ProviderForm,
  type ProviderStepKey,
} from "@/lib/provider-registration";
import { uploadPublicFile } from "@/lib/public-uploads";
import { registerServiceProvider } from "@/lib/registration-api";
import { toastError } from "@/lib/toast";

/**
 * "Become a service provider", filled in on the phone.
 *
 * ## This used to open a browser
 *
 * `WEB_PUBLIC_PATHS.becomeProvider` sent a tradesperson to `/service-providers`
 * on the website, and the reason given was the Google gate: the web form signs
 * you in with Google *before* the form so that the email on the application is
 * one Google has verified, and approval upgrades that account to
 * `SERVICE_PROVIDER`.
 *
 * That reason does not survive being on the phone. The gate exists to attach an
 * application to a real, verified account — and this app **already has one**. The
 * session was established at launch, `account.email` is the address the platform
 * knows this person by, and `registerServiceProvider` posts through the
 * authenticated client, so `requireApiPrincipal` gets the same `userId` the web
 * flow was working to produce. Nothing about the upgrade path changes; the app
 * simply arrives at the gate already through it.
 *
 * So the whole application is here, and the one thing it asks for that the
 * website does not is the thing only a phone can collect.
 *
 * ## The selfie
 *
 * Step 4 opens the front camera and will not accept a photo from the gallery.
 * That is not friction for its own sake: approval publishes this person in a
 * directory and issues them an ID card, and a resident is shown that card at
 * their door before letting a stranger into the building. `PROFILE_PHOTO` is the
 * portrait on it. A gallery pick can be any image on the internet; a photo taken
 * through this screen was taken by whoever was holding the phone that filed the
 * application, which is what gives the reviewer something to compare against the
 * ID document.
 */
export default function ServiceProviderApplyScreen() {
  const account = useAppSelector((state) => state.auth.account);
  const { colors } = useAppTheme();

  const [form, setForm] = useState<ProviderForm>(() => ({
    ...EMPTY_PROVIDER_FORM,
    // Prefilled, not locked. The platform knows this person's name and number;
    // asking for them again is asking someone to retype what the app is already
    // showing them two screens away. They stay editable because a trading name
    // is routinely not the name on the account.
    fullName: account?.name ?? "",
    phone: account?.phone ?? "",
  }));
  const [step, setStep] = useState<ProviderStepKey>("you");
  const [errors, setErrors] = useState<ProviderErrors>({});
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const patch = useCallback((next: Partial<ProviderForm>) => {
    setForm((current) => ({ ...current, ...next }));
    // Clearing on edit rather than re-validating on every keystroke: a message
    // that appears under a field while it is half-typed tells someone their name
    // is too short when they have got as far as "R".
    setErrors({});
  }, []);

  const index = PROVIDER_STEPS.findIndex((item) => item.key === step);

  const goNext = useCallback(() => {
    const stepErrors = providerStepErrors(step, form);

    if (hasProviderErrors(stepErrors)) {
      setErrors(stepErrors);
      return;
    }

    setErrors({});
    const next = PROVIDER_STEPS[index + 1];

    if (next) {
      setStep(next.key);
    }
  }, [form, index, step]);

  const goBack = useCallback(() => {
    const previous = PROVIDER_STEPS[index - 1];

    setErrors({});

    if (previous) {
      setStep(previous.key);
    }
  }, [index]);

  /**
   * The camera, front-facing, square, cropped by the applicant.
   *
   * `allowsEditing` with a 1:1 aspect because the portrait is drawn in a circle
   * on the ID card and in a small square in the directory: an uncropped 4:3 photo
   * of someone standing in a doorway becomes a circle of doorway.
   *
   * `quality: 0.6` keeps a phone camera's output under the public upload route's
   * 5 MB cap without a resize step. A modern sensor at full quality clears that
   * on its own.
   */
  const takeSelfie = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();

    if (!permission.granted) {
      toastError(
        "Camera access needed",
        "Your application needs a photo of you, taken now.",
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      cameraType: ImagePicker.CameraType.front,
      quality: 0.6,
    });

    const asset = result.canceled ? null : result.assets[0];

    if (!asset) {
      return;
    }

    setBusy(true);

    try {
      const uploaded = await uploadPublicFile(asset, { label: "Your photo" });

      patch({ selfie: { fileName: "Your photo", url: uploaded.url } });
    } catch (caught) {
      toastError("That photo didn't upload", readApiError(caught));
    } finally {
      setBusy(false);
    }
  }, [patch]);

  const pickDocument = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      toastError("Photo access needed", "Allow access to attach your documents.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
    });

    const asset = result.canceled ? null : result.assets[0];

    if (!asset) {
      return;
    }

    setBusy(true);

    try {
      const uploaded = await uploadPublicFile(asset, { label: "Supporting document" });

      setForm((current) => ({
        ...current,
        // Eight is the schema's cap for the whole `documents` array and the
        // selfie takes one of them, so seven is what is left here. Capping in the
        // UI rather than truncating at submit, because a document silently
        // dropped from an application is worse than one that was never accepted.
        documents: [
          ...current.documents,
          { fileName: uploaded.fileName, url: uploaded.url },
        ].slice(0, 7),
      }));
    } catch (caught) {
      toastError("That file didn't upload", readApiError(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  const submit = useCallback(async () => {
    const incomplete = firstIncompleteProviderStep(form);

    if (incomplete) {
      setStep(incomplete);
      setErrors(providerStepErrors(incomplete, form));
      return;
    }

    setSubmitting(true);
    setFailure(null);

    try {
      await registerServiceProvider(buildProviderPayload(form, account?.email ?? null));
      setSubmitted(true);
    } catch (caught) {
      setFailure(readApiError(caught, "Your application could not be submitted."));
    } finally {
      setSubmitting(false);
    }
    // `account`, not `account?.email` — the React compiler infers the whole
    // object as the dependency and refuses to preserve a narrower manual list.
  }, [account, form]);

  /*
   * No session, no application. `requireApiPrincipal` on the register route would
   * 401 anyway, but the point of checking here is that it is checkable *before*
   * someone fills in five steps — the account is what an approval upgrades, so
   * there is nothing to file the work against.
   */
  if (!account) {
    return (
      <Screen header={<AppBar showBack title="Become a service provider" />} scroll>
        <EmptyState
          action={
            <Button label="Sign in" onPress={() => router.push("/(auth)/login")} />
          }
          description="Your application is attached to your account — approval turns that same account into your provider login, and jobs are sent to it."
          title="Sign in to apply"
        />
      </Screen>
    );
  }

  if (submitted) {
    return <SubmittedView email={account.email} />;
  }

  return (
    <Screen
      footer={
        <WizardFooter
          loading={submitting}
          nextLabel={step === "review" ? "Submit application" : "Continue"}
          onBack={index > 0 ? goBack : undefined}
          onNext={step === "review" ? () => void submit() : goNext}
        />
      }
      header={<AppBar showBack title="Become a service provider" />}
      scroll
    >
      <View className="gap-6 pt-1">
        <StepTracker
          current={step}
          isComplete={(key) => isProviderStepComplete(key as ProviderStepKey, form)}
          onSelect={(key) => {
            setErrors({});
            setStep(key as ProviderStepKey);
          }}
          steps={PROVIDER_STEPS}
        />

        {failure ? (
          <View className="rounded-xl border border-destructive/30 bg-destructive/10 p-3">
            <Text className="text-destructive" variant="label">
              {failure}
            </Text>
          </View>
        ) : null}

        {step === "you" ? (
          <FormSection
            subtitle={`Filed against ${account.email || account.name || "your account"} — approval turns it into your provider login.`}
            title="About you"
          >
            <Input
              autoCapitalize="words"
              error={errors.fullName}
              label="Full name"
              onChangeText={(value) => patch({ fullName: value })}
              placeholder="The name hostels should ask for"
              value={form.fullName}
            />
            <Input
              error={errors.phone}
              keyboardType="phone-pad"
              label="Phone"
              onChangeText={(value) => patch({ phone: value })}
              placeholder="98…"
              value={form.phone}
            />
          </FormSection>
        ) : null}

        {step === "trades" ? (
          <FormSection
            subtitle="Pick every trade you work in — you are matched to jobs in all of them."
            title="Your work"
          >
            <ChipGroup<ProviderCategory>
              error={errors.categories}
              hint="The first one you tap is shown as your main trade."
              onToggle={(category) =>
                patch({ categories: toggleProviderCategory(form.categories, category) })
              }
              optionLabel={providerCategoryLabel}
              options={PROVIDER_CATEGORIES}
              ordered
              selected={form.categories}
            />

            <Input
              label="Experience (optional)"
              multiline
              onChangeText={(value) => patch({ experience: value })}
              placeholder="e.g. 5 years fixing residential plumbing"
              style={{ height: 76 }}
              value={form.experience}
            />

            <Input
              label="About your service (optional)"
              multiline
              onChangeText={(value) => patch({ description: value })}
              placeholder="Coverage, tools, how quickly you can get there."
              style={{ height: 108 }}
              value={form.description}
            />
          </FormSection>
        ) : null}

        {step === "area" ? (
          <FormSection
            subtitle="Jobs are broadcast to providers in the area they are raised in."
            title="Where you work"
          >
            <Input
              autoCapitalize="words"
              error={errors.area}
              label="Area"
              onChangeText={(value) => patch({ area: value })}
              placeholder="Neighbourhood or tole"
              value={form.area}
            />
            <Input
              autoCapitalize="words"
              error={errors.city}
              label="City"
              onChangeText={(value) => patch({ city: value })}
              value={form.city}
            />
            <Input
              label="Availability (optional)"
              onChangeText={(value) => patch({ availability: value })}
              placeholder="Weekdays, emergency, on-call"
              value={form.availability}
            />
          </FormSection>
        ) : null}

        {step === "selfie" ? (
          <FormSection
            subtitle="Taken now, on this phone. It becomes the portrait on your provider ID card, which residents are shown before they let you in."
            title="Your photo"
          >
            <View className="items-center gap-4 py-2">
              <View
                className="h-40 w-40 items-center justify-center overflow-hidden rounded-full bg-muted"
                // A circle, because that is how the ID card and the directory
                // draw it — showing a square here and a circle there is how
                // someone ends up with the top of their head cropped off.
              >
                {form.selfie ? (
                  /*
                    Resolved, never raw. `POST /public/files/upload` answers with
                    a relative `/uploads/…` path whenever R2 is not configured,
                    and a phone has no page origin to resolve it against — the
                    preview would be an empty circle after a photo that uploaded
                    fine. See `lib/media.ts`.
                  */
                  <Image
                    accessibilityLabel="Your photo"
                    contentFit="cover"
                    source={{
                      uri:
                        absoluteMediaUrl(form.selfie.url, API_BASE_URL) ??
                        form.selfie.url,
                    }}
                    style={{ height: 160, width: 160 }}
                    transition={150}
                  />
                ) : (
                  <Ionicons
                    color={colors.mutedForeground}
                    name="person-outline"
                    size={48}
                  />
                )}
              </View>

              <Button
                disabled={busy}
                label={
                  busy ? "Uploading…" : form.selfie ? "Take it again" : "Take your photo"
                }
                onPress={() => void takeSelfie()}
                variant={form.selfie ? "outline" : "primary"}
              />

              {errors.selfie ? (
                <Text className="text-center text-destructive" variant="caption">
                  {errors.selfie}
                </Text>
              ) : null}
            </View>

            <RowDivider />

            <View className="gap-2">
              <Text variant="label">Supporting documents (optional)</Text>
              <Text variant="caption">
                Citizenship, a trade licence, certificates — up to seven. Optional,
                but an application carrying proof of trade clears review faster.
              </Text>
              <Button
                disabled={busy || form.documents.length >= 7}
                label={busy ? "Uploading…" : "Add a document"}
                onPress={() => void pickDocument()}
                variant="outline"
              />
            </View>

            {form.documents.length > 0 ? (
              <Card className="gap-2">
                {form.documents.map((document) => (
                  <View className="flex-row items-center gap-2" key={document.url}>
                    <Ionicons
                      color={colors.primary}
                      name="document-attach-outline"
                      size={16}
                    />
                    <Text className="flex-1" numberOfLines={1} variant="caption">
                      {document.fileName}
                    </Text>
                    <Text
                      className="text-destructive"
                      onPress={() =>
                        setForm((current) => ({
                          ...current,
                          documents: current.documents.filter(
                            (item) => item.url !== document.url,
                          ),
                        }))
                      }
                      variant="caption"
                    >
                      Remove
                    </Text>
                  </View>
                ))}
              </Card>
            ) : null}
          </FormSection>
        ) : null}

        {step === "review" ? (
          <FormSection
            subtitle="The platform team reviews new providers in about two days, and emails you either way."
            title="Check it over"
          >
            <Card>
              <ReviewRow label="Name" value={form.fullName} />
              <ReviewRow label="Phone" value={form.phone} />
              <ReviewRow label="Email" value={account.email ?? "—"} />
              <ReviewRow
                label={form.categories.length > 1 ? "Trades" : "Trade"}
                value={form.categories.map(providerCategoryLabel).join(", ")}
              />
              <ReviewRow label="Area" value={`${form.area}, ${form.city}`} />
              <ReviewRow label="Availability" value={form.availability} />
              <ReviewRow label="Experience" value={form.experience} />
              <ReviewRow
                label="Photo"
                value={form.selfie ? "Taken" : "Not taken"}
              />
              <ReviewRow
                label="Documents"
                value={
                  form.documents.length === 1
                    ? "1 file"
                    : `${form.documents.length} files`
                }
              />
            </Card>

            <Text variant="caption">
              By submitting you agree this account is used to receive job offers
              from hostels in your trades and area. Once approved, every job
              arrives in this app — there is no separate provider website.
            </Text>
          </FormSection>
        ) : null}
      </View>
    </Screen>
  );
}

/**
 * The end of the journey, and it genuinely is the end — there is nothing to poll
 * and nowhere else to go until a human has looked at the application. So this
 * says what happens next, in the order it happens, and offers the one thing that
 * is actually available: leaving.
 */
function SubmittedView({ email }: { email: string | null }) {
  const { colors } = useAppTheme();

  return (
    <Screen header={<AppBar showBack title="Application submitted" />} scroll>
      <View className="items-center gap-4 px-2 pt-10">
        <View className="h-16 w-16 items-center justify-center rounded-2xl bg-brand-soft">
          <Ionicons color={colors.primary} name="checkmark-circle-outline" size={32} />
        </View>

        <Text className="text-center" variant="title">
          You&apos;re in the queue
        </Text>

        <Text className="text-center leading-6" variant="muted">
          {email
            ? `The platform team reviews new providers in about two days. We'll email ${email} the moment there's a decision.`
            : "The platform team reviews new providers in about two days, and you'll be notified the moment there's a decision."}
        </Text>

        <Card className="mt-2 w-full gap-2">
          <Text variant="label">What happens after approval</Text>
          <Text className="leading-6" variant="muted">
            Your account becomes a provider account and this app changes with it:
            a Jobs tab, work broadcast by hostels in your trades and area, and a
            provider ID card carrying the photo you just took.
          </Text>
        </Card>

        <Button
          className="mt-2 w-full"
          label="Done"
          onPress={() => router.replace("/service-providers")}
        />
      </View>
    </Screen>
  );
}
