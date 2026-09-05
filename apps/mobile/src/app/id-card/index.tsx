import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, Pressable, Share, Switch, View } from "react-native";

import { captureRef } from "react-native-view-shot";

import { IdCardFace } from "@/components/id-card-face";
import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import { readApiError } from "@/lib/api-contract";
import { shareDataUrlImage, shareLocalImage } from "@/lib/documents";
import { buildIdCard, hasIdCard, idCardNoun } from "@/lib/id-card";
import {
  clearIdentityPhoto,
  getIdentity,
  getIdentityQr,
  type Identity,
  type IdentityQr,
  type IdentityResponse,
  identityPhotoSource,
  setIdentityPhoto,
  setIdentitySharing,
} from "@/lib/identity-api";
import { toastError, toastSuccess } from "@/lib/toast";
import { uploadAsset } from "@/lib/uploads";

/**
 * The holder's ID card.
 *
 * ## The card does not flip by itself
 *
 * The web cycles front → back every few seconds and pauses on hover. A phone has
 * no hover, and the moment that matters is a resident holding the screen out to a
 * warden — a card that pulls the face away mid-read is worse than one that needs
 * a tap. So the flip is manual, and the tap target is the whole card.
 *
 * ## Sharing off is stated on the card, not just in a toggle
 *
 * `sharingEnabled` is what makes the scanned id resolve. With it off the QR is
 * still a valid image that leads nowhere, which is the one failure a resident
 * would discover at a hostel counter rather than here.
 *
 * ## Saving
 *
 * The QR shares as a real PNG through the OS sheet, which is where "Save to
 * Photos" lives. A single-tap write to the camera roll — and a rasterised copy of
 * the whole two-sided card — needs `expo-media-library` and
 * `react-native-view-shot`, both native modules, so both are a development build
 * rather than a screen change. Tracked in `docs/MOBILE_APP_PHASES.md` §M5.
 */

export default function IdCardScreen() {
  const identity = useResource<IdentityResponse>(useCallback(() => getIdentity(), []));

  const header = <AppBar showBack title="Digital ID" />;

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
          message={identity.error ?? "Your ID card could not be loaded."}
          onRetry={identity.reload}
        />
      </Screen>
    );
  }

  if (!hasIdCard(identity.data.identity)) {
    return (
      <Screen header={header}>
        <NoCardYet cardType={identity.data.identity.cardType} />
      </Screen>
    );
  }

  return (
    <IdCardDetail
      header={header}
      onChanged={(next) => identity.setData(() => next)}
      onRefresh={identity.refresh}
      refreshing={identity.refreshing}
      response={identity.data}
    />
  );
}

/**
 * No profile has been saved, so there is no id and no card.
 *
 * `saveResidentIdentity` is what mints the resident id, so this is not an error
 * state and not an empty list — it is a one-time form standing between the
 * account and the card.
 */
function NoCardYet({ cardType }: { cardType: Identity["cardType"] }) {
  return (
    <EmptyState
      action={
        <Button
          label="Fill it in"
          onPress={() => router.push("/id-card/edit")}
        />
      }
      description={`Fill in your details once and you get a ${idCardNoun(
        cardType,
      )} ID with a QR code. Show it to a hostel and they can complete your registration without you writing anything down.`}
      title="You don't have an ID card yet"
    />
  );
}

function IdCardDetail({
  header,
  onChanged,
  onRefresh,
  refreshing,
  response,
}: {
  header: React.ReactNode;
  onChanged: (response: IdentityResponse) => void;
  onRefresh: () => void;
  refreshing: boolean;
  response: IdentityResponse;
}) {
  const dates = useDates();

  const { colors } = useAppTheme();
  const token = useAppSelector((state) => state.auth.accessToken);
  const { identity, profile } = response;

  /*
   * Its own request, and only reachable from here: `/qr` 404s with
   * `RESIDENT_PROFILE_MISSING` until a profile exists, so it must not be fetched
   * beside the identity on a screen that may have neither.
   */
  const qr = useResource<IdentityQr>(useCallback(() => getIdentityQr(), []));

  const [face, setFace] = useState<"back" | "front">("front");
  const [busy, setBusy] = useState(false);

  const card = buildIdCard(identity, profile);
  const photo = identityPhotoSource(identity, token);

  /*
   * The host the id actually resolves on, taken from the share URL rather than
   * from `API_BASE_URL`. On a phone talking to a LAN dev server those differ, and
   * the card should print where a warden would go, not where the app fetched.
   */
  const siteLabel = identity.shareUrl
    ? identity.shareUrl.replace(/^https?:\/\//, "").split("/")[0]
    : "";

  const run = useCallback(
    async (
      action: () => Promise<IdentityResponse>,
      { failure, success }: { failure: string; success: string },
    ) => {
      setBusy(true);

      try {
        onChanged(await action());
        toastSuccess(success);
      } catch (caught) {
        toastError(failure, readApiError(caught));
      } finally {
        setBusy(false);
      }
    },
    [onChanged],
  );

  const copyId = useCallback(async () => {
    if (!identity.residentId) {
      return;
    }

    await Clipboard.setStringAsync(identity.residentId);
    toastSuccess("ID copied");
  }, [identity.residentId]);

  const shareLink = useCallback(async () => {
    if (!identity.shareUrl) {
      return;
    }

    try {
      await Share.share({
        message: `My ${idCardNoun(identity.cardType)} ID: ${identity.residentId}\n${
          identity.shareUrl
        }`,
      });
    } catch {
      // The sheet was dismissed, or the platform refused it. Nothing to report —
      // the link is on screen and copyable either way.
    }
  }, [identity.cardType, identity.residentId, identity.shareUrl]);

  /*
   * The card, as a picture.
   *
   * ## Why a view capture rather than an image the server renders
   *
   * The card *is* the layout — the photo, the QR, the hostel's accent and the
   * exact fields this resident's card type carries are all decided by
   * `IdCardFace`. Asking the server for a PNG would mean a second
   * implementation of that design, kept in step by hand, and it would be wrong
   * the first time the card changed. Snapshotting what is already on screen is
   * the only version that cannot drift.
   *
   * ## It saves the face you are looking at
   *
   * The card flips on tap, and the capture takes whichever side is showing. That
   * is why the row's subtitle names the face: someone who wants both saves twice,
   * which is clearer than a button that silently picks one.
   *
   * ## Needs a dev build
   *
   * `react-native-view-shot` is a native module, so this does nothing under Expo
   * Go. The failure is caught and reported rather than thrown — a missing native
   * module must not take out the screen.
   */
  // Typed loosely on purpose: `captureRef` accepts a ref to any host view, and
  // naming a concrete component type here would only be a cast at the call site.
  const cardRef = useRef<View>(null);

  const saveCard = useCallback(async () => {
    if (!cardRef.current) {
      return;
    }

    try {
      const uri = await captureRef(cardRef, {
        format: "png",
        // The card is drawn at screen scale; capturing at 2x keeps the QR
        // readable when the saved picture is shown on a counter scanner rather
        // than re-displayed at card size.
        quality: 1,
        result: "tmpfile",
      });

      await shareLocalImage(uri);
    } catch (caught) {
      toastError(
        "Could not save the card",
        readApiError(caught, "This needs the full app rather than Expo Go."),
      );
    }
  }, []);

  const saveQr = useCallback(async () => {
    if (!qr.data?.qrDataUrl) {
      toastError(
        "No QR to save",
        "The server could not render one. Your ID is on the card and can be typed in.",
      );
      return;
    }

    try {
      await shareDataUrlImage({
        dataUrl: qr.data.qrDataUrl,
        fileName: `hostelhub-id-${identity.residentId ?? "card"}`,
      });
    } catch (caught) {
      toastError("Could not save that", readApiError(caught));
    }
  }, [identity.residentId, qr.data]);

  const pickPhoto = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      toastError("Permission needed", "Allow photo access to set your card photo.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      // A card portrait is square-ish, so the crop is offered here rather than
      // leaving a wide holiday photo to be centre-cropped into a circle.
      allowsEditing: true,
      aspect: [1, 1],
      mediaTypes: ["images"],
      quality: 0.85,
    });
    const picked = result.canceled ? null : result.assets[0];

    if (!picked) {
      return;
    }

    setBusy(true);

    try {
      const assetId = await uploadAsset(picked, {
        kind: "GENERIC",
        label: "ID card photo",
      });

      onChanged(await setIdentityPhoto(assetId));
      toastSuccess("Photo added to your card");
    } catch (caught) {
      toastError("Could not set that photo", readApiError(caught));
    } finally {
      setBusy(false);
    }
  }, [onChanged]);

  const removePhoto = useCallback(() => {
    Alert.alert("Remove your photo?", "Your card will show your initial instead.", [
      { style: "cancel", text: "Cancel" },
      {
        onPress: () =>
          void run(clearIdentityPhoto, {
            failure: "Could not remove that photo",
            success: "Photo removed",
          }),
        style: "destructive",
        text: "Remove",
      },
    ]);
  }, [run]);

  return (
    <Screen
      header={header}
      onRefresh={onRefresh}
      refreshing={refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <Pressable
          accessibilityHint={`Shows the ${face === "front" ? "back" : "front"}`}
          accessibilityLabel={`ID card, ${face}`}
          accessibilityRole="button"
          onPress={() => setFace(face === "front" ? "back" : "front")}
        >
          {/*
            The capture target for "Save this card". `collapsable={false}` is
            load-bearing on Android: React Native flattens a view that only wraps
            another into its parent, and a flattened view has no native handle
            for `captureRef` to snapshot — the call fails with an unhelpful
            message about a missing tag.
          */}
          <View collapsable={false} ref={cardRef}>
            <IdCardFace
              card={card}
              face={face}
              photo={photo}
              qrDataUrl={qr.data?.qrDataUrl ?? null}
              siteLabel={siteLabel}
            />
          </View>
        </Pressable>

        <View className="flex-row items-center justify-center gap-2">
          <Ionicons color={colors.mutedForeground} name="sync-outline" size={14} />
          <Text variant="caption">
            Tap the card to see the {face === "front" ? "back" : "front"}
          </Text>
        </View>

        {/*
          Stated on the page, not only in the toggle below. With sharing off the
          QR is a perfectly valid image that resolves to nothing, and the place a
          resident would otherwise find that out is a hostel counter.
        */}
        {identity.sharingEnabled ? null : (
          <Card className="gap-2 border-l-4 border-l-warning">
            <View className="flex-row items-center gap-2">
              <Ionicons color={colors.warning} name="eye-off-outline" size={18} />
              <Text variant="label">Sharing is off</Text>
            </View>
            <Text variant="muted">
              Scanning this card will not open your details. Turn sharing back on
              before you show it to a hostel.
            </Text>
          </Card>
        )}

        {qr.error ? (
          <Card className="gap-1">
            <Text variant="label">The QR code did not load</Text>
            <Text variant="muted">{qr.error}</Text>
          </Card>
        ) : null}

        <View>
          <SectionHeader title="Your ID" />
          <Card>
            <ListRow
              icon="finger-print-outline"
              onPress={() => void copyId()}
              subtitle="Tap to copy"
              title={identity.residentId ?? "—"}
            />
            <RowDivider inset />
            <ListRow
              icon="share-social-outline"
              onPress={() => void shareLink()}
              subtitle="Send the link that opens your details"
              title="Share my ID"
            />
            <RowDivider inset />
            <ListRow
              icon="image-outline"
              onPress={() => void saveCard()}
              subtitle={`Saves the ${face} as a picture — choose Save to Photos`}
              title="Save this card"
            />
            <RowDivider inset />
            <ListRow
              icon="download-outline"
              onPress={() => void saveQr()}
              subtitle="Opens the share sheet — choose Save to Photos"
              title="Save my QR code"
            />
          </Card>
        </View>

        <View>
          <SectionHeader title="Card photo" />
          <Card>
            <ListRow
              icon="camera-outline"
              onPress={() => void pickPhoto()}
              subtitle={busy ? "Working…" : "Square, and cropped before it uploads"}
              title={identity.hasPhoto ? "Replace photo" : "Add a photo"}
            />
            {identity.hasPhoto ? (
              <>
                <RowDivider inset />
                <ListRow
                  icon="trash-outline"
                  onPress={removePhoto}
                  subtitle="Your card falls back to your initial"
                  title="Remove photo"
                />
              </>
            ) : null}
          </Card>
        </View>

        <View>
          <SectionHeader
            subtitle="Who can open your details, and what is on the card"
            title="Sharing"
          />
          <Card>
            <ListRow
              icon="qr-code-outline"
              right={
                <Switch
                  disabled={busy}
                  onValueChange={(next) =>
                    void run(() => setIdentitySharing(next), {
                      failure: "Could not change sharing",
                      success: next ? "Sharing is on" : "Sharing is off",
                    })
                  }
                  thumbColor={identity.sharingEnabled ? colors.primary : undefined}
                  trackColor={{ true: colors.brandSoft }}
                  value={identity.sharingEnabled}
                />
              }
              subtitle="A scanned ID opens your details for a hostel"
              title="Allow scanning"
            />
            <RowDivider inset />
            <ListRow
              icon="create-outline"
              onPress={() => router.push("/id-card/edit")}
              subtitle="Name, contacts, guardian, blood group"
              title="Edit my details"
            />
          </Card>
        </View>

        {identity.shareCount > 0 ? (
          <Text className="text-center" variant="caption">
            {identity.shareCount === 1
              ? "Opened once"
              : `Opened ${identity.shareCount} times`}
            {identity.lastSharedAt
              ? ` · last ${dates.dateTime(identity.lastSharedAt)}`
              : ""}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
