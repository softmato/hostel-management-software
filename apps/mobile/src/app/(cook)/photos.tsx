import * as ImagePicker from "expo-image-picker";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useResource } from "@/hooks/use-resource";
import { readApiError } from "@/lib/api-contract";
import {
  type FoodReadyAnnouncement,
  listFoodReadyLogs,
  uploadCookFoodPhoto,
} from "@/lib/cook-api";
import { formatDateTime, humanizeEnum } from "@/lib/format";
import { mealTypeNow } from "@/lib/food-week";
import { toastError, toastSuccess } from "@/lib/toast";
import { uploadAsset } from "@/lib/uploads";

/**
 * A photo of the meal, taken with the camera in the kitchen.
 *
 * ## Camera first, library second
 *
 * Food transparency is the point of the feed: a picture of *this* meal, taken
 * now. Opening the library first invites a stock photo or last week's curry, so
 * the primary action launches the camera and the library is the secondary
 * button — the same order the web's uploader offers, inverted for a device that
 * has a camera in hand.
 *
 * ## The meal type is guessed, not asked
 *
 * `mealTypeNow()` reads the Kathmandu clock. A picker between "I want to share
 * this" and the photo being shared is where people give up, and a wrong bucket
 * costs the hostel nothing — nobody audits which meal a curry photo landed in.
 *
 * ## The photo goes to the residents' feed, not a cook gallery
 *
 * `POST /cook/food-photos` writes the same `FoodPhoto` collection the resident
 * and admin routes write to, and publishes on the FOOD topic — so it appears on
 * residents' food screens as it is posted. There is no cook-side photo list
 * endpoint, and inventing a local one would show a gallery that disagrees with
 * what residents see. What this screen lists instead is the **announcement
 * log**, which is the cook's own record of what they have sent.
 */
export default function CookPhotosScreen() {
  const logs = useResource<FoodReadyAnnouncement[]>(
    useCallback(() => listFoodReadyLogs(), []),
    { topics: [REALTIME_TOPIC.FOOD] },
  );

  const [busy, setBusy] = useState(false);

  const share = useCallback(
    async (source: "camera" | "library") => {
      const permission =
        source === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        toastError(
          "Permission needed",
          source === "camera"
            ? "Allow camera access to photograph the meal."
            : "Allow photo access to pick a meal photo.",
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

      setBusy(true);

      try {
        // Progress is reported by `<UploadToaster />` at the app root — call
        // sites never build their own.
        const photoAssetId = await uploadAsset(asset, {
          kind: "GENERIC",
          label: "Meal photo",
        });

        await uploadCookFoodPhoto({
          date: new Date().toISOString(),
          mealType: mealTypeNow(),
          photoAssetId,
        });

        toastSuccess("Photo shared", "Residents can see it on their food screen.");
      } catch (caught) {
        toastError("Could not share that photo", readApiError(caught));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const header = <AppBar title="Photos" />;

  return (
    <Screen
      header={header}
      insideTabs
      onRefresh={logs.refresh}
      refreshing={logs.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <Card className="gap-3">
          <Text variant="subtitle">Show them what&apos;s cooking</Text>
          <Text variant="muted">
            {`A photo of today's ${humanizeEnum(
              mealTypeNow(),
            ).toLowerCase()} appears on every resident's food screen straight away.`}
          </Text>
          <Button
            label="Take a photo"
            loading={busy}
            onPress={() => void share("camera")}
            size="lg"
          />
          <Button
            disabled={busy}
            label="Choose from gallery"
            onPress={() => void share("library")}
            variant="outline"
          />
        </Card>

        <View>
          <SectionHeader
            subtitle="Everything this kitchen has announced"
            title="Announcement history"
          />

          {logs.loading ? (
            <LoadingState label="Loading announcements" />
          ) : logs.error ? (
            <ErrorState message={logs.error} onRetry={logs.reload} />
          ) : (
            <Card>
              {(logs.data ?? []).length === 0 ? (
                <EmptyState
                  description="Announce a meal from the Today tab and it appears here."
                  title="Nothing announced yet"
                />
              ) : (
                (logs.data ?? []).map((log, index) => (
                  <View key={log.id}>
                    {index > 0 ? <RowDivider /> : null}
                    <ListRow
                      right={
                        <Badge
                          label={`${log.notifiedCount} notified`}
                          tone={log.notifiedCount > 0 ? "success" : "warning"}
                        />
                      }
                      subtitle={log.message || undefined}
                      title={`${humanizeEnum(log.mealType)} · ${formatDateTime(
                        log.announcedAt,
                      )}`}
                    />
                  </View>
                ))
              )}
            </Card>
          )}
        </View>
      </View>
    </Screen>
  );
}
