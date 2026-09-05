import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Screen } from "@/components/ui/screen";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { FailureState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { WalletMark } from "@/components/ui/wallet-mark";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import { readApiError } from "@/lib/api-contract";
import {
  CLAIM_METHODS,
  type ClaimErrors,
  hasErrors,
  parseClaimAmount,
  validateClaim,
} from "@/lib/claim-form";
import {
  getPayInstructions,
  type PayInstructions,
  type PaymentMethod,
  submitClaim,
} from "@/lib/finance-api";
import { formatMoney } from "@/lib/format";
import { toastError, toastInfo, toastSuccess } from "@/lib/toast";
import { uploadAsset, type UploadProgress } from "@/lib/uploads";

/**
 * "I've paid" — a claim against one invoice (target §11.2).
 *
 * ## The evidence is the claim
 *
 * Without a screenshot there is nothing for the hostel to check against their
 * bank statement, and the server refuses the submit. So the picker is the
 * loudest control on the screen and the amount is prefilled from what is
 * actually owed — the two things a resident gets wrong are attaching nothing
 * and typing the invoice total when they paid half.
 *
 * ## The picker is a dropzone, and it was two outline buttons
 *
 * `Choose photo` and `Camera` sat side by side under a paragraph, inside a card
 * with the same border as the three fields above it. Three problems. The
 * mandatory field looked exactly like the optional one two rows up; the two
 * buttons were the same weight as each other so neither read as the way in; and
 * the *thing being asked for* — an image — had no visual presence on the screen
 * at all until one was attached.
 *
 * It is a dashed drop target now: a tinted disc, `Tap to upload`, and `or take a
 * photo` as a second target inside the same box. Dashed rather than solid,
 * because a dashed rectangle is the one border convention that reads as "a slot
 * with nothing in it yet" rather than as a container. Once an image is attached
 * the box becomes the image, which is the only state where a preview is worth
 * more than the invitation.
 *
 * ## Why the submit button is not a retry loop
 *
 * `POST .../claims` is rate-limited to **8 an hour**, because each call runs
 * sharp and tesseract over a full-size image — seconds of CPU per submit. A
 * client that retries on failure would spend a resident's whole budget in one
 * frustrated minute. Every check the server does that the phone can do first
 * is done in `lib/claim-form.ts` before a request is made.
 *
 * That limit is now *stated*, in the notice at the top of the form. A resident
 * who hits it otherwise gets a 429 with no way to know it was a quota rather
 * than a rejection.
 *
 * ## A repeat submit is not a second claim
 *
 * The server is idempotent: a replayed submit collapses onto the existing claim
 * and answers `created: false` with a 200. That is reported as "already
 * submitted", not as a fresh success — telling someone their proof went through
 * twice is how they start wondering whether they paid twice.
 *
 * ## "Method" is a `<Select>`, and was six pills
 *
 * `CLAIM_METHODS` has **six** entries, and they were drawn as a wrapping row of
 * hand-rolled filled pills between two `<Input>`s — so the middle field of a
 * three-field form was two rows tall, a different shape from its neighbours, and
 * a re-implementation of a control the kit already has.
 *
 * Not a `<Segmented>`: that component's own doc caps it at five and says where
 * to go instead, because a sixth segment takes every label below the width its
 * text needs. `<Select>` is that place — a trigger built to be
 * indistinguishable from an `<Input>` until it is tapped, and a sheet of rows
 * behind it.
 *
 * ## The fields are on the page, not in a card
 *
 * They were wrapped in a `<Card>`, which put a border around three controls that
 * already have borders — a box of boxes, and 16 points of the narrowest screen
 * in the app spent on an outline that groups things nothing else was going to be
 * confused with. A form is the page.
 */

export default function SubmitClaimScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useAppTheme();

  const instructions = useResource<PayInstructions>(
    useCallback(() => getPayInstructions(id), [id]),
    // The amount is prefilled from this, and re-reading it while the resident
    // is mid-form would move the number under their fingers.
    { refetchOnFocus: false },
  );

  const [amount, setAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [transactionCode, setTransactionCode] = useState("");
  const [proofAssetId, setProofAssetId] = useState<string | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<ClaimErrors>({});

  const data = instructions.data;
  // Prefilled once loaded, but never overwritten after the resident has typed:
  // someone paying half of a part-paid month must be able to say so.
  const amountValue = amountTouched ? amount : String(data?.amountDue ?? "");

  /*
   * The six methods with their marks.
   *
   * `CLAIM_METHODS` is a plain label/value table in `lib/claim-form.ts`, which
   * has to stay node-testable and therefore cannot import a component. The
   * marks are attached here — and it matters on this list more than anywhere
   * else in the app, because getting the method wrong sends the hostel looking
   * for the payment in the wrong statement, and six wallet names in identical
   * grey type is exactly the list that gets mis-tapped.
   *
   * Memoised: a fresh array of six JSX nodes on every keystroke of the two
   * inputs either side of it would re-render the sheet's whole list.
   */
  const methodOptions = useMemo(
    () =>
      CLAIM_METHODS.map((option) => ({
        ...option,
        // 28, not 32: the same node is drawn on the `<Select>` trigger, which
        // is `h-12` and would grow past the `<Input>`s either side of it.
        leading: <WalletMark name={option.value} size={28} />,
      })),
    [],
  );

  const pick = useCallback(
    async (source: "camera" | "library") => {
      const permission =
        source === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        toastError(
          "Permission needed",
          source === "camera"
            ? "Allow camera access to photograph your receipt."
            : "Allow photo access to attach your screenshot.",
        );
        return;
      }

      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images"],
              quality: 0.8,
            });

      const asset = result.canceled ? null : result.assets[0];

      if (!asset) {
        return;
      }

      setProofPreview(asset.uri);
      setProofAssetId(null);
      setErrors((current) => ({ ...current, proofAssetId: undefined }));

      try {
        const assetId = await uploadAsset(asset, {
          kind: "PAYMENT_PROOF",
          label: "Payment proof",
          onProgress: setUpload,
        });

        setProofAssetId(assetId);
      } catch {
        /*
         * The preview is cleared: leaving a thumbnail on screen after a failed
         * upload is how somebody submits believing they attached something.
         *
         * No toast — `uploadAsset` registers with the global upload queue, and
         * the toaster at the root already shows this failure with its reason.
         * Two notices for one event reads as two failures.
         */
        setProofPreview(null);
      } finally {
        setUpload(null);
      }
    },
    [],
  );

  const submit = useCallback(async () => {
    // Built here rather than during render: a fresh object every render would
    // change this callback's identity on every keystroke.
    const draft = { amount: amountValue, method, proofAssetId, transactionCode };
    const found = validateClaim(draft);

    setErrors(found);

    /*
     * `!method` is redundant against `hasErrors` — the validator already refuses
     * a null one — and is kept because TypeScript cannot see that, and the
     * request below needs a narrowed `PaymentMethod`.
     */
    if (hasErrors(found) || !method) {
      return;
    }

    setSubmitting(true);

    try {
      const result = await submitClaim(id, {
        amount: parseClaimAmount(draft.amount) as number,
        paymentMethod: method,
        proofImageAssetId: proofAssetId as string,
        transactionCode: transactionCode.trim() || undefined,
      });

      if (result.created) {
        toastSuccess("Proof submitted", "Your hostel will confirm it shortly.");
      } else {
        toastInfo("Already submitted", "We had this proof on file already.");
      }

      router.replace(`/invoice/${id}`);
    } catch (caught) {
      // Deliberately no retry: the endpoint costs seconds of server CPU per
      // call and allows eight an hour.
      toastError("Could not submit", readApiError(caught));
    } finally {
      setSubmitting(false);
    }
  }, [amountValue, id, method, proofAssetId, transactionCode]);

  const header = <AppBar showBack title="I've paid" />;

  if (instructions.loading) {
    return (
      /* The notice, the three fields, then the dropzone. */
      <Screen header={header} scroll>
        <View className="gap-4 pt-1">
          <Skeleton height={64} radius={16} />
          <Skeleton height={72} radius={12} />
          <Skeleton height={72} radius={12} />
          <Skeleton height={72} radius={12} />
          <Skeleton height={18} width="52%" />
          <Skeleton height={168} radius={16} />
        </View>
      </Screen>
    );
  }

  if (instructions.error || !data) {
    return (
      <Screen header={header}>
        <FailureState
          message={instructions.error ?? "This invoice could not be loaded."}
          onRetry={instructions.reload}
          title="Failed to load"
        />
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <Button
          label="Submit claim"
          loading={submitting}
          onPress={() => void submit()}
        />
      }
      header={header}
      scroll
    >
      <View className="gap-4 pt-1">
        {/*
          What is owed and the quota, in one line each.

          The outstanding figure used to be a card of its own straddling a
          painted bar — the same object the pay screen leads with. It is a form
          now, and a form does not need a hero: the number matters here only as
          the thing being confirmed, and it is already sitting in the amount
          field two rows down. What a resident genuinely cannot find out
          elsewhere is the rate limit, so that is what the notice carries.
        */}
        <Card className="flex-row items-start gap-2.5">
          <Ionicons color={colors.primary} name="time-outline" size={18} />
          <View className="flex-1 gap-0.5">
            <Text variant="label">
              {`Claiming against ${formatMoney(data.amountDue)}`}
            </Text>
            <Text variant="caption">
              {data.referenceCode
                ? `Reference ${data.referenceCode}. You can submit up to 8 claims per hour.`
                : "You can submit up to 8 claims per hour."}
            </Text>
          </View>
        </Card>

        <Input
          error={errors.amount}
          hint="You can edit it for part payment."
          inputMode="numeric"
          keyboardType="number-pad"
          label="Amount"
          onChangeText={(value) => {
            setAmountTouched(true);
            setAmount(value);
          }}
          placeholder="0"
          value={amountValue}
        />

        <Select
          error={errors.method}
          label="Method"
          onChange={setMethod}
          options={methodOptions}
          placeholder="Select method"
          sheetTitle="How did you pay?"
          value={method}
        />

        <Input
          autoCapitalize="characters"
          error={errors.transactionCode}
          hint="UTR, txn id or reference id."
          label="Transaction code"
          onChangeText={setTransactionCode}
          placeholder="Enter transaction code"
          value={transactionCode}
        />

        <View className="gap-2">
          <Text variant="label">Payment screenshot (required)</Text>

          {proofPreview ? (
            <Card className="items-center gap-3">
              <Image
                contentFit="cover"
                source={{ uri: proofPreview }}
                style={{
                  backgroundColor: colors.muted,
                  borderRadius: 12,
                  height: 220,
                  width: "100%",
                }}
              />

              {upload ? (
                /*
                 * Attachment state, not progress: the percentage is on the
                 * upload card at the top of the screen, and printing it twice
                 * on one screen is how the two end up disagreeing by a frame.
                 */
                <View className="flex-row items-center gap-2">
                  <ActivityIndicator color={colors.primary} size="small" />
                  <Text variant="caption">Attaching…</Text>
                </View>
              ) : proofAssetId ? (
                <View className="flex-row items-center gap-1.5">
                  <Ionicons color={colors.success} name="checkmark-circle" size={16} />
                  <Text variant="caption">Attached</Text>
                </View>
              ) : null}

              <View className="flex-row gap-3 self-stretch">
                <Button
                  className="flex-1"
                  label="Replace"
                  onPress={() => void pick("library")}
                  variant="outline"
                />
                <Button
                  className="flex-1"
                  label="Camera"
                  onPress={() => void pick("camera")}
                  variant="outline"
                />
              </View>
            </Card>
          ) : (
            <Dropzone
              onCamera={() => void pick("camera")}
              onLibrary={() => void pick("library")}
            />
          )}

          {errors.proofAssetId ? (
            <Text className="text-destructive" variant="caption">
              {errors.proofAssetId}
            </Text>
          ) : null}
        </View>

        {/*
          The three things that get a claim rejected, said before it is
          submitted rather than after. A rejection round-trip costs the resident
          a day and the hostel a review; three lines of caption cost neither.
        */}
        <View className="gap-1.5">
          <Text variant="label">Tips</Text>
          <Tip text="Make sure the amount and date are visible." />
          <Tip text="Do not crop important details." />
          <Tip text="Supported: JPG, PNG (max 10MB)." />
        </View>
      </View>
    </Screen>
  );
}

/**
 * The empty picker.
 *
 * Two press targets in one dashed box, because the box is one *slot* and the
 * two ways to fill it are not two different jobs. `Tap to upload` takes the
 * whole area — the common case is a screenshot the resident already has — and
 * `or take a photo` is a smaller target inside it for the paper receipt case.
 *
 * The inner `<Pressable>` stops propagation implicitly: React Native does not
 * bubble a handled press to an ancestor `Pressable`, so tapping the camera line
 * does not also open the library.
 */
function Dropzone({
  onCamera,
  onLibrary,
}: {
  onCamera: () => void;
  onLibrary: () => void;
}) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityHint="Opens your photo library"
      accessibilityLabel="Upload a payment screenshot"
      accessibilityRole="button"
      className="items-center gap-2 rounded-2xl border-2 border-dashed border-border bg-muted/20 px-6 py-8 active:opacity-70"
      onPress={onLibrary}
    >
      <View className="h-12 w-12 items-center justify-center rounded-full bg-brand-soft">
        <Ionicons color={colors.primary} name="cloud-upload-outline" size={24} />
      </View>

      <Text className="text-center" variant="label">
        Tap to upload
      </Text>

      <Pressable
        accessibilityHint="Opens the camera"
        accessibilityLabel="Take a photo of your receipt"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onCamera}
      >
        <Text className="text-primary" variant="caption">
          or take a photo
        </Text>
      </Pressable>

      <Text className="text-center" variant="caption">
        Clear, full screenshot of the payment
      </Text>
    </Pressable>
  );
}

function Tip({ text }: { text: string }) {
  const { colors } = useAppTheme();

  return (
    <View className="flex-row items-start gap-2">
      <Ionicons
        color={colors.mutedForeground}
        name="ellipse"
        size={5}
        style={{ marginTop: 7 }}
      />
      <Text className="flex-1" variant="caption">
        {text}
      </Text>
    </View>
  );
}
