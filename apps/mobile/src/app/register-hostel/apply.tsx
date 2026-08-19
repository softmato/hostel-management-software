import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";

import {
  AttachmentRow,
  ChipGroup,
  FormSection,
  PhotoStrip,
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
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { Toggle } from "@/components/ui/toggle";
import { useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { readApiError } from "@/lib/api-contract";
import {
  buildHostelPayload,
  capacitySummary,
  CITY_OPTIONS,
  emptyHostelForm,
  emptyRoomRow,
  FACILITY_OPTIONS,
  firstIncompleteHostelStep,
  HOSTEL_PLANS,
  HOSTEL_STEPS,
  HOSTEL_TYPES,
  hasHostelErrors,
  hostelStepErrors,
  ID_PROOF_TYPES,
  isHostelStepComplete,
  MEAL_INCLUSIONS,
  ROOM_TYPE_OPTIONS,
  RULES_TEMPLATES,
  type HostelErrors,
  type HostelForm,
  type HostelStepKey,
  type IdProofType,
  type MealInclusion,
  type PlanId,
  type RoomRow,
} from "@/lib/hostel-registration";
import { uploadPublicFile, uploadPublicText } from "@/lib/public-uploads";
import { registerHostelApplication } from "@/lib/registration-api";
import { toastError } from "@/lib/toast";

/**
 * "Register your hostel", filled in on the phone.
 *
 * ## What this replaces, and why the old argument no longer holds
 *
 * `WEB_PUBLIC_PATHS.registerHostel` used to open `/register-hostel/form` in a
 * browser tab. The reason on record was that the application "wants ownership
 * documents that live on a computer", and that a half-native form would give up
 * at the upload step.
 *
 * The upload step was the whole argument, and it was wrong about which computer
 * the documents live on. A Nepali hostel owner's citizenship certificate is not a
 * scan in a Downloads folder; it is a physical card in a drawer, and the device
 * with a camera pointed at it is this one. What the desktop form actually offered
 * was a file picker for a file that mostly did not exist yet.
 *
 * So both blocking requirements are now satisfiable here, and neither is relaxed:
 *
 * - **The ID proof** is photographed (`ImagePicker.launchCameraAsync`) or picked,
 *   and uploaded through the same public route the website's form posts to.
 * - **The rules document** is generated from one of the platform's own three
 *   templates — the applicant edits the text and it is attached as a real
 *   `text/plain` document (`uploadPublicText`). The website offers the same three
 *   templates; it just makes you download and re-upload them.
 *
 * A reviewer therefore sees the same application whichever client filed it.
 *
 * ## What is deliberately not ported
 *
 * The draft autosave to `localStorage`, the plan price calculator with its VAT
 * line, the sidebar of portal cards, and the seven optional document slots (PAN,
 * bank details, licence, ownership proof). The first three are desktop furniture;
 * the last is a judgement call — seven optional uploads on a phone is six chances
 * to abandon the form, and the platform can request any of them afterwards
 * through `requestedDocuments`, which is a flow that already exists.
 */
export default function RegisterHostelApplyScreen() {
  const account = useAppSelector((state) => state.auth.account);
  const { colors } = useAppTheme();

  // Rows need stable keys and `crypto.randomUUID` is not something to rely on
  // across every Android runtime this ships to. A counter is enough: the ids
  // never leave the screen.
  const nextRoomId = useRef(1);
  const makeRoomId = useCallback(() => {
    nextRoomId.current += 1;

    return `room-${nextRoomId.current}`;
  }, []);

  const [form, setForm] = useState<HostelForm>(() => ({
    ...emptyHostelForm("room-1"),
    email: account?.email ?? "",
    ownerName: account?.name ?? "",
    ownerPhone: account?.phone ?? "",
  }));
  const [step, setStep] = useState<HostelStepKey>("basics");
  const [errors, setErrors] = useState<HostelErrors>({});
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittedName, setSubmittedName] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const patch = useCallback((next: Partial<HostelForm>) => {
    setForm((current) => ({ ...current, ...next }));
    setErrors({});
  }, []);

  const index = HOSTEL_STEPS.findIndex((item) => item.key === step);

  const goNext = useCallback(() => {
    const stepErrors = hostelStepErrors(step, form);

    if (hasHostelErrors(stepErrors)) {
      setErrors(stepErrors);
      return;
    }

    setErrors({});
    const next = HOSTEL_STEPS[index + 1];

    if (next) {
      setStep(next.key);
    }
  }, [form, index, step]);

  const goBack = useCallback(() => {
    setErrors({});
    const previous = HOSTEL_STEPS[index - 1];

    if (previous) {
      setStep(previous.key);
    }
  }, [index]);

  /* ---------------------------------------------------------------------- */
  /* Uploads                                                                */
  /* ---------------------------------------------------------------------- */

  const pickImage = useCallback(
    async (source: "camera" | "library"): Promise<ImagePicker.ImagePickerAsset | null> => {
      const permission =
        source === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        toastError(
          source === "camera" ? "Camera access needed" : "Photo access needed",
          source === "camera"
            ? "Allow the camera so you can photograph your documents."
            : "Allow photo access to attach files you already have.",
        );

        return null;
      }

      const result =
        source === "camera"
          ? // `quality: 0.7` keeps a phone photo under the public route's 5 MB
            // cap. A full-quality sensor image clears it unaided, and the
            // rejection would arrive after the whole file had been uploaded.
            await ImagePicker.launchCameraAsync({ quality: 0.7 })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images"],
              quality: 0.7,
            });

      return result.canceled ? null : result.assets[0];
    },
    [],
  );

  const attachIdProof = useCallback(
    async (source: "camera" | "library") => {
      const asset = await pickImage(source);

      if (!asset) {
        return;
      }

      setBusy(true);

      try {
        const uploaded = await uploadPublicFile(asset, { label: "ID proof" });

        patch({ idProof: { fileName: uploaded.fileName, url: uploaded.url } });
      } catch (caught) {
        toastError("That didn't upload", readApiError(caught));
      } finally {
        setBusy(false);
      }
    },
    [patch, pickImage],
  );

  const attachRulesText = useCallback(async () => {
    const body = form.rules.trim();

    if (!body) {
      setErrors({ rulesDocument: "Write your rules, or start from a template." });
      return;
    }

    setBusy(true);

    try {
      const uploaded = await uploadPublicText(body, {
        fileName: "hostel-rules.txt",
        label: "House rules",
      });

      patch({
        rulesDocument: { fileName: "House rules.txt", url: uploaded.url },
      });
    } catch (caught) {
      toastError("Those rules didn't attach", readApiError(caught));
    } finally {
      setBusy(false);
    }
  }, [form.rules, patch]);

  const attachRulesFile = useCallback(async () => {
    const asset = await pickImage("library");

    if (!asset) {
      return;
    }

    setBusy(true);

    try {
      const uploaded = await uploadPublicFile(asset, { label: "House rules" });

      patch({ rulesDocument: { fileName: uploaded.fileName, url: uploaded.url } });
    } catch (caught) {
      toastError("That didn't upload", readApiError(caught));
    } finally {
      setBusy(false);
    }
  }, [patch, pickImage]);

  const addPhoto = useCallback(
    async (source: "camera" | "library") => {
      const asset = await pickImage(source);

      if (!asset) {
        return;
      }

      setBusy(true);

      try {
        const uploaded = await uploadPublicFile(asset, { label: "Hostel photo" });

        setForm((current) => ({
          ...current,
          // The schema caps `photos` at 20.
          photos: [
            ...current.photos,
            { fileName: uploaded.fileName, url: uploaded.url },
          ].slice(0, 20),
        }));
      } catch (caught) {
        toastError("That photo didn't upload", readApiError(caught));
      } finally {
        setBusy(false);
      }
    },
    [pickImage],
  );

  /* ---------------------------------------------------------------------- */
  /* Rooms                                                                  */
  /* ---------------------------------------------------------------------- */

  const updateRoom = useCallback((id: string, next: Partial<RoomRow>) => {
    setForm((current) => ({
      ...current,
      rooms: current.rooms.map((room) => (room.id === id ? { ...room, ...next } : room)),
    }));
    setErrors({});
  }, []);

  const removeRoom = useCallback((id: string) => {
    setForm((current) => ({
      ...current,
      // Never below one. An empty rooms step is a step with nothing on it and no
      // obvious way to get something back.
      rooms:
        current.rooms.length > 1
          ? current.rooms.filter((room) => room.id !== id)
          : current.rooms,
    }));
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Submit                                                                 */
  /* ---------------------------------------------------------------------- */

  const submit = useCallback(async () => {
    const incomplete = firstIncompleteHostelStep(form);

    if (incomplete) {
      setStep(incomplete);
      setErrors(hostelStepErrors(incomplete, form));
      return;
    }

    setSubmitting(true);
    setFailure(null);

    try {
      const hostel = await registerHostelApplication(buildHostelPayload(form));

      setSubmittedName(hostel.name || form.hostelName.trim());
    } catch (caught) {
      setFailure(readApiError(caught, "Your application could not be submitted."));
    } finally {
      setSubmitting(false);
    }
  }, [form]);

  const confirmLeave = useCallback(() => {
    Alert.alert(
      "Leave this application?",
      "Nothing you have typed is saved yet.",
      [
        { style: "cancel", text: "Keep filling it in" },
        { onPress: () => router.back(), style: "destructive", text: "Leave" },
      ],
    );
  }, []);

  if (!account) {
    return (
      <Screen header={<AppBar showBack title="Register your hostel" />} scroll>
        <EmptyState
          action={<Button label="Sign in" onPress={() => router.push("/(auth)/login")} />}
          description="Your application is attached to your account, which is how you can come back and see where it has got to. Without one, the only news you would get is an email."
          title="Sign in to register"
        />
      </Screen>
    );
  }

  if (submittedName) {
    return <SubmittedView hostelName={submittedName} />;
  }

  const summary = capacitySummary(form.rooms);

  return (
    <Screen
      footer={
        <WizardFooter
          loading={submitting}
          nextLabel={step === "review" ? "Submit application" : "Continue"}
          onBack={index > 0 ? goBack : confirmLeave}
          backLabel={index > 0 ? "Back" : "Cancel"}
          onNext={step === "review" ? () => void submit() : goNext}
        />
      }
      header={<AppBar showBack title="Register your hostel" />}
      scroll
    >
      <View className="gap-6 pt-1">
        <StepTracker
          current={step}
          isComplete={(key) => isHostelStepComplete(key as HostelStepKey, form)}
          onSelect={(key) => {
            setErrors({});
            setStep(key as HostelStepKey);
          }}
          steps={HOSTEL_STEPS}
        />

        {failure ? (
          <View className="rounded-xl border border-destructive/30 bg-destructive/10 p-3">
            <Text className="text-destructive" variant="label">
              {failure}
            </Text>
          </View>
        ) : null}

        {step === "basics" ? (
          <FormSection
            subtitle="What residents see first, and how the platform reaches you."
            title="The basics"
          >
            <Input
              autoCapitalize="words"
              error={errors.hostelName}
              label="Hostel name"
              onChangeText={(value) => patch({ hostelName: value })}
              placeholder="As it is written on the building"
              value={form.hostelName}
            />

            <Input
              error={errors.description}
              label="About the hostel"
              multiline
              onChangeText={(value) => patch({ description: value })}
              placeholder="Who it suits, what makes it worth living in."
              style={{ height: 108 }}
              value={form.description}
            />

            <Select<(typeof HOSTEL_TYPES)[number]["value"]>
              label="Who it is for"
              onChange={(value) => patch({ hostelType: value })}
              options={HOSTEL_TYPES.map((type) => ({
                label: type.label,
                value: type.value,
              }))}
              value={form.hostelType}
            />

            <RowDivider />

            <Input
              autoCapitalize="words"
              error={errors.ownerName}
              label="Your name"
              onChangeText={(value) => patch({ ownerName: value })}
              value={form.ownerName}
            />

            <Input
              error={errors.ownerPhone}
              keyboardType="phone-pad"
              label="Your phone"
              onChangeText={(value) => patch({ ownerPhone: value })}
              placeholder="98…"
              value={form.ownerPhone}
            />

            <Input
              autoCapitalize="none"
              error={errors.email}
              hint="The approval is emailed here, and this address becomes your owner login."
              keyboardType="email-address"
              label="Your email"
              onChangeText={(value) => patch({ email: value })}
              value={form.email}
            />
          </FormSection>
        ) : null}

        {step === "location" ? (
          <FormSection
            subtitle="Where it is, and what living there includes."
            title="Location & facilities"
          >
            <Input
              error={errors.address}
              label="Address"
              onChangeText={(value) => patch({ address: value })}
              placeholder="Street or tole"
              value={form.address}
            />

            <Input
              label="Landmark (optional)"
              onChangeText={(value) => patch({ landmark: value })}
              placeholder="Opposite the campus gate"
              value={form.landmark}
            />

            <Input
              autoCapitalize="words"
              error={errors.area}
              label="Area"
              onChangeText={(value) => patch({ area: value })}
              placeholder="e.g. Bagdol, Baneshwor"
              value={form.area}
            />

            <Select<string>
              error={errors.city}
              label="City"
              onChange={(value) => patch({ city: value })}
              options={CITY_OPTIONS.map((city) => ({ label: city, value: city }))}
              value={form.city}
            />

            <ChipGroup<string>
              hint="Everything a resident gets without paying extra."
              label="Facilities"
              onToggle={(facility) =>
                patch({
                  facilities: form.facilities.includes(facility)
                    ? form.facilities.filter((item) => item !== facility)
                    : [...form.facilities, facility],
                })
              }
              options={FACILITY_OPTIONS}
              selected={form.facilities}
            />

            <Input
              inputMode="numeric"
              label="Floors (optional)"
              onChangeText={(value) => patch({ totalFloors: value })}
              value={form.totalFloors}
            />
          </FormSection>
        ) : null}

        {step === "rooms" ? (
          <FormSection
            subtitle={
              summary.totalBeds > 0
                ? `${summary.totalRooms} rooms · ${summary.totalBeds} beds`
                : "Add each kind of room you let, and how many of them there are."
            }
            title="Rooms & pricing"
          >
            {form.rooms.map((room, roomIndex) => (
              <RoomCard
                canRemove={form.rooms.length > 1}
                key={room.id}
                onChange={(next) => updateRoom(room.id, next)}
                onRemove={() => removeRoom(room.id)}
                position={roomIndex + 1}
                room={room}
              />
            ))}

            {errors.rooms ? (
              <Text className="text-destructive" variant="caption">
                {errors.rooms}
              </Text>
            ) : null}

            <Button
              label="Add another room type"
              onPress={() =>
                setForm((current) => ({
                  ...current,
                  rooms: [...current.rooms, emptyRoomRow(makeRoomId())],
                }))
              }
              variant="outline"
            />

            <RowDivider />

            <Input
              hint="One-off, charged when someone moves in. Leave blank if you don't charge one."
              inputMode="numeric"
              label="Admission fee (NPR, optional)"
              onChangeText={(value) => patch({ admissionFee: value })}
              value={form.admissionFee}
            />

            <View className="gap-3">
              <Text variant="label">Food</Text>

              <View className="flex-row items-center justify-between">
                <Text variant="muted">Vegetarian meals</Text>
                <Toggle
                  accessibilityLabel="Vegetarian meals served"
                  onChange={(next) => patch({ servesVeg: next })}
                  value={form.servesVeg}
                />
              </View>

              <View className="flex-row items-center justify-between">
                <Text variant="muted">Non-vegetarian meals</Text>
                <Toggle
                  accessibilityLabel="Non-vegetarian meals served"
                  onChange={(next) => patch({ servesNonVeg: next })}
                  value={form.servesNonVeg}
                />
              </View>

              <Input
                inputMode="numeric"
                label="Meals per day"
                onChangeText={(value) => patch({ mealsPerDay: value })}
                value={form.mealsPerDay}
              />
            </View>
          </FormSection>
        ) : null}

        {step === "documents" ? (
          <FormSection
            subtitle="The platform team verifies these before your listing goes live."
            title="Documents"
          >
            <Select<IdProofType>
              error={errors.idProofType}
              label="Government ID"
              onChange={(value) => patch({ idProofType: value })}
              options={ID_PROOF_TYPES.map((type) => ({ label: type, value: type }))}
              placeholder="Which one are you attaching?"
              value={form.idProofType || null}
            />

            {form.idProof ? (
              <AttachmentRow
                attachment={form.idProof}
                label="Your ID"
                onPick={() => undefined}
                onRemove={() => patch({ idProof: null })}
              />
            ) : (
              <View className="gap-2">
                <Text variant="label">Your ID</Text>
                <Text variant="caption">
                  Photograph it now — the card in your hand is the document, and it
                  does not have to be a scan on a computer.
                </Text>
                {errors.idProof ? (
                  <Text className="text-destructive" variant="caption">
                    {errors.idProof}
                  </Text>
                ) : null}
                <View className="flex-row gap-2">
                  <View style={{ flex: 1 }}>
                    <Button
                      disabled={busy}
                      label="Photograph it"
                      onPress={() => void attachIdProof("camera")}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      disabled={busy}
                      label="Choose a file"
                      onPress={() => void attachIdProof("library")}
                      variant="outline"
                    />
                  </View>
                </View>
              </View>
            )}

            <RowDivider />

            <RulesDocumentField
              busy={busy}
              document={form.rulesDocument}
              error={errors.rulesDocument}
              onAttachFile={() => void attachRulesFile()}
              onAttachText={() => void attachRulesText()}
              onChangeText={(value) => patch({ rules: value })}
              onRemove={() => patch({ rulesDocument: null })}
              rules={form.rules}
            />

            <RowDivider />

            <View className="gap-2">
              <Text variant="label">Photos (optional)</Text>
              <Text variant="caption">
                The outside, a room, the common areas. A listing with photos is the
                one people enquire about.
              </Text>
              <PhotoStrip
                onRemove={(url) =>
                  setForm((current) => ({
                    ...current,
                    photos: current.photos.filter((photo) => photo.url !== url),
                  }))
                }
                photos={form.photos}
              />
              <View className="flex-row gap-2">
                <View style={{ flex: 1 }}>
                  <Button
                    disabled={busy || form.photos.length >= 20}
                    label="Take a photo"
                    onPress={() => void addPhoto("camera")}
                    variant="outline"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    disabled={busy || form.photos.length >= 20}
                    label="From gallery"
                    onPress={() => void addPhoto("library")}
                    variant="outline"
                  />
                </View>
              </View>
            </View>
          </FormSection>
        ) : null}

        {step === "review" ? (
          <FormSection
            subtitle="Check it, choose a plan, and send it to the platform team."
            title="Review & submit"
          >
            <Card>
              <ReviewRow label="Hostel" value={form.hostelName} />
              <ReviewRow
                label="Type"
                value={
                  HOSTEL_TYPES.find((type) => type.value === form.hostelType)?.label ?? ""
                }
              />
              <ReviewRow
                label="Where"
                value={[form.address, form.area, form.city].filter(Boolean).join(", ")}
              />
              <ReviewRow
                label="Capacity"
                value={`${summary.totalRooms} rooms · ${summary.totalBeds} beds`}
              />
              <ReviewRow label="Owner" value={form.ownerName} />
              <ReviewRow label="Phone" value={form.ownerPhone} />
              <ReviewRow label="Email" value={form.email} />
              <ReviewRow
                label="Facilities"
                value={form.facilities.join(", ")}
              />
              <ReviewRow
                label="Documents"
                value={[
                  form.idProof ? form.idProofType || "ID proof" : "",
                  form.rulesDocument ? "House rules" : "",
                  form.photos.length > 0 ? `${form.photos.length} photos` : "",
                ]
                  .filter(Boolean)
                  .join(", ")}
              />
            </Card>

            <View className="gap-2">
              <Text variant="label">Plan</Text>
              <Text variant="caption">
                Nothing is charged now — the platform team confirms pricing with you
                after the hostel is approved.
              </Text>
              {HOSTEL_PLANS.map((plan) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected: form.selectedPlan === plan.id }}
                  className={`flex-row items-start gap-3 rounded-xl border p-3 ${
                    form.selectedPlan === plan.id
                      ? "border-primary bg-brand-soft"
                      : "border-border bg-card"
                  }`}
                  key={plan.id}
                  onPress={() => patch({ selectedPlan: plan.id as PlanId })}
                >
                  <Ionicons
                    color={
                      form.selectedPlan === plan.id ? colors.primary : colors.border
                    }
                    name={
                      form.selectedPlan === plan.id
                        ? "radio-button-on"
                        : "radio-button-off"
                    }
                    size={20}
                  />
                  <View className="flex-1">
                    <Text variant="label">{plan.name}</Text>
                    <Text variant="caption">{plan.summary}</Text>
                  </View>
                </Pressable>
              ))}
            </View>

            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: form.agreed }}
              className="flex-row items-start gap-3"
              onPress={() => patch({ agreed: !form.agreed })}
            >
              <Ionicons
                color={form.agreed ? colors.primary : colors.border}
                name={form.agreed ? "checkbox" : "square-outline"}
                size={22}
              />
              <Text className="flex-1 leading-6" variant="muted">
                I own or manage this hostel, and everything above is true.
              </Text>
            </Pressable>

            {errors.agreed ? (
              <Text className="text-destructive" variant="caption">
                {errors.agreed}
              </Text>
            ) : null}
          </FormSection>
        ) : null}
      </View>
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One room type.
 *
 * `vacantBeds` is asked for because the listing's "beds free" is the single most
 * looked-at number on a hostel card, and a hostel that registers with it unset
 * publishes as full. It defaults to blank rather than to the bed count, though —
 * guessing an occupancy on an owner's behalf is inventing data about their
 * business.
 */
function RoomCard({
  canRemove,
  onChange,
  onRemove,
  position,
  room,
}: {
  canRemove: boolean;
  onChange: (next: Partial<RoomRow>) => void;
  onRemove: () => void;
  position: number;
  room: RoomRow;
}) {
  const { colors } = useAppTheme();

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text variant="label">{`Room type ${position}`}</Text>
        {canRemove ? (
          <Pressable
            accessibilityLabel={`Remove room type ${position}`}
            accessibilityRole="button"
            hitSlop={10}
            onPress={onRemove}
          >
            <Ionicons color={colors.destructive} name="trash-outline" size={18} />
          </Pressable>
        ) : null}
      </View>

      <Select<string>
        label="Kind of room"
        onChange={(value) => onChange({ roomType: value })}
        options={ROOM_TYPE_OPTIONS.map((type) => ({ label: type, value: type }))}
        value={room.roomType}
      />

      <View className="flex-row gap-3">
        <View style={{ flex: 1 }}>
          <Input
            inputMode="numeric"
            label="How many"
            onChangeText={(value) => onChange({ rooms: value })}
            placeholder="0"
            value={room.rooms}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Input
            inputMode="numeric"
            label="Beds each"
            onChangeText={(value) => onChange({ bedsPerRoom: value })}
            placeholder="0"
            value={room.bedsPerRoom}
          />
        </View>
      </View>

      <View className="flex-row gap-3">
        <View style={{ flex: 1 }}>
          <Input
            inputMode="numeric"
            label="Rent / month"
            onChangeText={(value) => onChange({ monthlyRent: value })}
            placeholder="NPR"
            value={room.monthlyRent}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Input
            inputMode="numeric"
            label="Beds free now"
            onChangeText={(value) => onChange({ vacantBeds: value })}
            placeholder="0"
            value={room.vacantBeds}
          />
        </View>
      </View>

      <Select<MealInclusion>
        label="Meals"
        onChange={(value) => onChange({ mealInclusion: value })}
        options={MEAL_INCLUSIONS.map((meal) => ({ label: meal, value: meal }))}
        value={room.mealInclusion}
      />
    </Card>
  );
}

/**
 * The house-rules document, which is the requirement that used to send this whole
 * form to a browser.
 *
 * Two ways in, one slot. Start from a template and edit the words, and the text
 * is attached as a real `text/plain` document — or attach a file you already have.
 * Once something is attached the choice collapses to a single removable row,
 * because a form offering two ways to replace a thing that is already there is a
 * form asking a question it has the answer to.
 */
function RulesDocumentField({
  busy,
  document,
  error,
  onAttachFile,
  onAttachText,
  onChangeText,
  onRemove,
  rules,
}: {
  busy: boolean;
  document: { fileName: string; url: string } | null;
  error?: string;
  onAttachFile: () => void;
  onAttachText: () => void;
  onChangeText: (value: string) => void;
  onRemove: () => void;
  rules: string;
}) {
  const [template, setTemplate] = useState<string | null>(null);

  if (document) {
    return (
      <AttachmentRow
        attachment={document}
        hint="Residents are shown these before they move in."
        label="House rules & policies"
        onPick={() => undefined}
        onRemove={onRemove}
      />
    );
  }

  return (
    <View className="gap-3">
      <Text variant="label">House rules & policies</Text>
      <Text variant="caption">
        Start from a template and change what does not apply to you, or attach a
        document you already have.
      </Text>

      <Select<string>
        label="Template"
        onChange={(value) => {
          setTemplate(value);
          onChangeText(
            RULES_TEMPLATES.find((item) => item.id === value)?.body ?? rules,
          );
        }}
        options={RULES_TEMPLATES.map((item) => ({
          description: item.summary,
          label: item.name,
          value: item.id,
        }))}
        placeholder="Choose a starting point"
        value={template}
      />

      <Input
        label="Your rules"
        multiline
        onChangeText={onChangeText}
        placeholder="One rule per line."
        style={{ height: 200 }}
        value={rules}
      />

      {error ? (
        <Text className="text-destructive" variant="caption">
          {error}
        </Text>
      ) : null}

      <Button
        disabled={busy}
        label={busy ? "Attaching…" : "Attach these rules"}
        onPress={onAttachText}
      />
      <Button
        disabled={busy}
        label="Attach a file instead"
        onPress={onAttachFile}
        variant="ghost"
      />
    </View>
  );
}

/**
 * Submitted.
 *
 * The one thing worth being precise about here is *what has not happened yet*.
 * An owner who reads "registered" believes their hostel is listed, tells people
 * so, and finds out days later that it was under review the whole time.
 */
function SubmittedView({ hostelName }: { hostelName: string }) {
  const { colors } = useAppTheme();

  return (
    <Screen header={<AppBar showBack title="Application submitted" />} scroll>
      <View className="items-center gap-4 px-2 pt-10">
        <View className="h-16 w-16 items-center justify-center rounded-2xl bg-brand-soft">
          <Ionicons color={colors.primary} name="checkmark-circle-outline" size={32} />
        </View>

        <Text className="text-center" variant="title">
          {hostelName} is with the review team
        </Text>

        <Text className="text-center leading-6" variant="muted">
          It is not listed yet. The platform team checks your ID and your details
          first, and emails you when they are done. If they need anything else, the
          request arrives by email too.
        </Text>

        <Card className="mt-2 w-full gap-2">
          <Text variant="label">What arrives with the approval</Text>
          <Text className="leading-6" variant="muted">
            An owner login, a dashboard for the hostel, and portals for your
            wardens, residents, cooks and their guardians — all reachable from this
            app.
          </Text>
        </Card>

        <Button
          className="mt-2 w-full"
          label="Done"
          onPress={() => router.replace("/register-hostel")}
        />
      </View>
    </Screen>
  );
}
