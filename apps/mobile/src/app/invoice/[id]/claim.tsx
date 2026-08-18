import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Screen } from "@/components/ui/screen";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
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
import { formatMoney, formatPeriod } from "@/lib/format";
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
 * ## Why the submit button is not a retry loop
 *
 * `POST .../claims` is rate-limited to **8 an hour**, because each call runs
 * sharp and tesseract over a full-size image — seconds of CPU per submit. A
 * client that retries on failure would spend a resident's whole budget in one
 * frustrated minute. Every check the server does that the phone can do first
 * is done in `lib/claim-form.ts` before a request is made.
 *
 * ## A repeat submit is not a second claim
 *
 * The server is idempotent: a replayed submit collapses onto the existing claim
 * and answers `created: false` with a 200. That is reported as "already
 * submitted", not as a fresh success — telling someone their proof went through
 * twice is how they start wondering whether they paid twice.
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
  const [method, setMethod] = useState<PaymentMethod>("BANK_TRANSFER");
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
    const draft = { amount: amountValue, proofAssetId, transactionCode };
    const found = validateClaim(draft);

    setErrors(found);

    if (hasErrors(found)) {
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

  const header = (
    <AppBar
      showBack
      subtitle={data?.period ? formatPeriod(data.period) : undefined}
      title="Submit payment proof"
    />
  );

  if (instructions.loading) {
    return (
      <Screen header={header}>
        <LoadingState />
      </Screen>
    );
  }

  if (instructions.error || !data) {
    return (
      <Screen header={header}>
        <ErrorState
          message={instructions.error ?? "This invoice could not be loaded."}
          onRetry={instructions.reload}
        />
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <Button
          label="Submit proof"
          loading={submitting}
          onPress={() => void submit()}
        />
      }
      header={header}
      scroll
    >
      <View className="gap-4 pt-1">
        <Card className="gap-1">
          <Text variant="caption">Outstanding on this invoice</Text>
          <Text variant="title">{formatMoney(data.amountDue)}</Text>
          {data.referenceCode ? (
            <Text variant="caption">{`Reference ${data.referenceCode}`}</Text>
          ) : null}
        </Card>

        <Card className="gap-4">
          <Input
            error={errors.amount}
            hint="Whole rupees, no paisa. Change it if you paid part of the month."
            inputMode="numeric"
            keyboardType="number-pad"
            label="Amount you paid"
            onChangeText={(value) => {
              setAmountTouched(true);
              setAmount(value);
            }}
            placeholder="0"
            value={amountValue}
          />

          <View className="gap-2">
            <Text variant="label">How you paid</Text>
            <View className="flex-row flex-wrap gap-2">
              {CLAIM_METHODS.map((option) => {
                const active = option.value === method;

                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    className={`rounded-full border px-3.5 py-2 active:opacity-70 ${
                      active ? "border-primary bg-primary" : "border-border"
                    }`}
                    key={option.value}
                    onPress={() => setMethod(option.value)}
                  >
                    <Text
                      className={`text-sm font-medium ${
                        active ? "text-primary-foreground" : "text-foreground"
                      }`}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Input
            autoCapitalize="characters"
            error={errors.transactionCode}
            hint="From your bank or wallet receipt. Optional, but it confirms your payment faster."
            label="Transaction code"
            onChangeText={setTransactionCode}
            placeholder="e.g. 0KJ2M91X"
            value={transactionCode}
          />
        </Card>

        <View className="gap-2">
          <Text variant="label">Payment screenshot</Text>

          <Card className="gap-3">
            {proofPreview ? (
              <View className="items-center gap-3">
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
              </View>
            ) : (
              <Text variant="muted">
                A photo of the receipt, or a screenshot from your banking app. Your
                hostel checks it against their statement.
              </Text>
            )}

            <View className="flex-row gap-3">
              <Button
                className="flex-1"
                label={proofPreview ? "Replace" : "Choose photo"}
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

          {errors.proofAssetId ? (
            <Text className="text-destructive" variant="caption">
              {errors.proofAssetId}
            </Text>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}
