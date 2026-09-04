import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Screen } from "@/components/ui/screen";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import { type PaymentProfile, updatePaymentProfile } from "@/lib/admin-manage-api";
import { adminQuery } from "@/lib/admin-queries";
import { API_BASE_URL } from "@/lib/api";
import { readApiError } from "@/lib/api-contract";
import { viewerSourceFor } from "@/lib/asset-viewer";
import { toastError, toastSuccess } from "@/lib/toast";
import { uploadAsset } from "@/lib/uploads";

/**
 * Payment setup — where residents are asked to send money.
 *
 * ## The QR was the missing half
 *
 * The web has had a QR upload since the payment profile shipped; the phone had
 * only the two *typed* fields that exist for when the recogniser cannot read
 * one. So an owner could describe their QR poster and never put it in the app,
 * which meant residents paying from the phone had a name and a number and no
 * code to scan. `PAYMENT_QR` is a financial asset kind, so presign scopes it to
 * this hostel — that is what lets the server refuse a QR borrowed from another.
 *
 * ## The image saves on its own; the fields save on Save
 *
 * Uploading patches `staticQrAssetId` immediately rather than holding it in the
 * draft, and that is not laziness. The server runs the recogniser on a **new**
 * QR and fills the payee name and number from it, so patching alone lets those
 * two fields come back filled and be seen before anything else is submitted. It
 * also means the bytes are never stranded: an upload followed by a back-press
 * still leaves a hostel with a working QR.
 *
 * The typed payee fields are sent **only when they differ** from what loaded.
 * Sending them unchanged would stamp `qrPayeeSource: "MANUAL"` on every save,
 * which is what stops a later re-read from correcting them — so a save that
 * touched only the cash threshold would quietly freeze the OCR result forever.
 */

type Draft = Record<string, string>;

export default function ManagePaymentSetupScreen() {
  const { colors } = useAppTheme();
  const token = useAppSelector((state) => state.auth.accessToken);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const query = adminQuery.paymentProfile();
  const resource = useResource<PaymentProfile>(query.load, {
    cacheKey: query.key,
    topics: query.topics,
  });

  const profile = resource.data ?? null;

  const seeded = useMemo<Draft>(
    () => ({
      bankAccountName: profile?.bankAccountName ?? "",
      bankAccountNumber: profile?.bankAccountNumber ?? "",
      bankName: profile?.bankName ?? "",
      cashApprovalThreshold: String(profile?.cashApprovalThreshold ?? 0),
      displayName: profile?.displayName ?? "",
      esewaId: profile?.esewaId ?? "",
      khaltiId: profile?.khaltiId ?? "",
      paymentInstructions: profile?.paymentInstructions ?? "",
      qrPayeeName: profile?.qrPayeeName ?? "",
      qrPayeeNumber: profile?.qrPayeeNumber ?? "",
      statementCadenceDays: String(profile?.statementCadenceDays ?? 7),
    }),
    [profile],
  );

  // A null draft means "nothing typed yet", so the silent refocus revalidate can
  // still update what is shown — and cannot overwrite a half-typed field once it
  // is not. Same reasoning as `finance/rates`.
  const form = draft ?? seeded;

  const edit = useCallback(
    (patch: Draft) => setDraft((prev) => ({ ...(prev ?? seeded), ...patch })),
    [seeded],
  );

  const { reload } = resource;

  const pickQr = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      toastError("Permission needed", "Allow photo access to upload your QR.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
    });
    const picked = result.canceled ? null : result.assets[0];

    if (!picked) {
      return;
    }

    setUploading(true);

    try {
      const assetId = await uploadAsset(picked, {
        kind: "PAYMENT_QR",
        label: "Payment QR",
      });

      await updatePaymentProfile({ staticQrAssetId: assetId });
      toastSuccess("QR saved");
      await reload();
    } catch (error) {
      toastError("That QR did not upload", readApiError(error));
    } finally {
      setUploading(false);
    }
  }, [reload]);

  const removeQr = useCallback(async () => {
    setUploading(true);

    try {
      await updatePaymentProfile({ staticQrAssetId: null });
      toastSuccess("QR removed");
      await reload();
    } catch (error) {
      toastError("Could not remove it", readApiError(error));
    } finally {
      setUploading(false);
    }
  }, [reload]);

  const save = useCallback(async () => {
    setBusy(true);

    try {
      await updatePaymentProfile({
        bankAccountName: form.bankAccountName?.trim() || undefined,
        bankAccountNumber: form.bankAccountNumber?.trim() || undefined,
        bankName: form.bankName?.trim() || undefined,
        cashApprovalThreshold: form.cashApprovalThreshold?.trim()
          ? Number(form.cashApprovalThreshold)
          : undefined,
        displayName: form.displayName?.trim() || undefined,
        esewaId: form.esewaId?.trim() || undefined,
        khaltiId: form.khaltiId?.trim() || undefined,
        paymentInstructions: form.paymentInstructions?.trim() || undefined,
        // Only when actually edited — see the header note on `MANUAL`.
        qrPayeeName:
          form.qrPayeeName === seeded.qrPayeeName ? undefined : form.qrPayeeName.trim(),
        qrPayeeNumber:
          form.qrPayeeNumber === seeded.qrPayeeNumber ? undefined : form.qrPayeeNumber.trim(),
        statementCadenceDays: form.statementCadenceDays?.trim()
          ? Number(form.statementCadenceDays)
          : undefined,
      });
      toastSuccess("Payment setup saved");
      router.back();
    } catch (error) {
      toastError("Could not save", readApiError(error));
    } finally {
      setBusy(false);
    }
  }, [form, seeded]);

  const header = <AppBar accent centerTitle showBack title="Payment setup" />;

  if (resource.loading) {
    return (
      <Screen header={header}>
        <LoadingState label="Reading your payment setup" />
      </Screen>
    );
  }

  if (resource.error || !profile) {
    return (
      <Screen header={header}>
        <ErrorState message={resource.error ?? "No payment setup"} onRetry={resource.reload} />
      </Screen>
    );
  }

  const qrSource = profile.staticQrAssetId
    ? viewerSourceFor({ assetId: profile.staticQrAssetId }, { baseUrl: API_BASE_URL, token })
    : null;

  return (
    <Screen
      footer={<Button label="Save" loading={busy} onPress={() => void save()} />}
      header={header}
      scroll
    >
      <View className="gap-5 pt-1">
        <View>
          <SectionHeader subtitle="What residents see on the pay screen" title="Paid to" />
          <Card>
            <Input
              onChangeText={(displayName) => edit({ displayName })}
              placeholder="Hostel or owner name"
              value={form.displayName}
            />
          </Card>
        </View>

        <View>
          <SectionHeader subtitle="Scanned, then paid from any wallet" title="QR" />
          <Card className="gap-3">
            <View className="flex-row items-center gap-3">
              {qrSource ? (
                <Pressable
                  accessibilityLabel="Replace the QR"
                  accessibilityRole="imagebutton"
                  className="active:opacity-70"
                  disabled={uploading}
                  onPress={() => void pickQr()}
                >
                  <Image
                    contentFit="cover"
                    source={qrSource}
                    style={{
                      borderColor: colors.border,
                      borderRadius: 12,
                      borderWidth: 1,
                      height: 96,
                      width: 96,
                    }}
                  />
                </Pressable>
              ) : (
                <View className="h-24 w-24 items-center justify-center rounded-xl border border-dashed border-border">
                  <Ionicons color={colors.mutedForeground} name="qr-code-outline" size={30} />
                </View>
              )}

              <View className="flex-1 gap-2">
                <Button
                  label={qrSource ? "Replace" : "Upload a QR"}
                  loading={uploading}
                  onPress={() => void pickQr()}
                  size="sm"
                  variant={qrSource ? "outline" : "primary"}
                />
                {qrSource ? (
                  <Button
                    label="Remove"
                    onPress={() => void removeQr()}
                    size="sm"
                    variant="ghost"
                  />
                ) : null}
              </View>
            </View>

            <View className="gap-3 border-t border-border pt-3">
              <Input
                hint="Filled from your QR automatically. Correct it only if it came back wrong."
                label="Name on the QR"
                onChangeText={(qrPayeeName) => edit({ qrPayeeName })}
                value={form.qrPayeeName}
              />
              <Input
                keyboardType="numbers-and-punctuation"
                label="Number on the QR"
                onChangeText={(qrPayeeNumber) => edit({ qrPayeeNumber })}
                value={form.qrPayeeNumber}
              />
            </View>
          </Card>
        </View>

        <View>
          <SectionHeader title="Bank" />
          <Card className="gap-3">
            <Input
              label="Bank"
              onChangeText={(bankName) => edit({ bankName })}
              value={form.bankName}
            />
            <Input
              label="Account name"
              onChangeText={(bankAccountName) => edit({ bankAccountName })}
              value={form.bankAccountName}
            />
            <Input
              keyboardType="numbers-and-punctuation"
              label="Account number"
              onChangeText={(bankAccountNumber) => edit({ bankAccountNumber })}
              value={form.bankAccountNumber}
            />
          </Card>
        </View>

        <View>
          <SectionHeader title="Wallets" />
          <Card className="gap-3">
            <Input
              keyboardType="numbers-and-punctuation"
              label="eSewa ID"
              onChangeText={(esewaId) => edit({ esewaId })}
              value={form.esewaId}
            />
            <Input
              keyboardType="numbers-and-punctuation"
              label="Khalti ID"
              onChangeText={(khaltiId) => edit({ khaltiId })}
              value={form.khaltiId}
            />
            <Text variant="caption">
              A bank account or a wallet ID is what lets us check that a receipt was paid
              to you. With only a QR, every receipt reads as an unknown payee.
            </Text>
          </Card>
        </View>

        <View>
          <SectionHeader title="Rules" />
          <Card className="gap-3">
            <Input
              hint="Zero means every cash entry needs a second approver."
              keyboardType="number-pad"
              label="Cash approval needed above (NPR)"
              onChangeText={(cashApprovalThreshold) => edit({ cashApprovalThreshold })}
              value={form.cashApprovalThreshold}
            />
            <Input
              hint="1–90 days."
              keyboardType="number-pad"
              label="Remind me to upload a statement every"
              onChangeText={(statementCadenceDays) => edit({ statementCadenceDays })}
              value={form.statementCadenceDays}
            />
            <Input
              hint="Shown under the pay options."
              label="Note for residents"
              multiline
              onChangeText={(paymentInstructions) => edit({ paymentInstructions })}
              style={{ height: 96 }}
              value={form.paymentInstructions}
            />
          </Card>
        </View>
      </View>
    </Screen>
  );
}
