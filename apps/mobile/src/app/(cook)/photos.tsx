import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Grid } from "@/components/ui/layout";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import { readApiError } from "@/lib/api-contract";
import { openAssetViewer } from "@/lib/asset-viewer";
import {
  type CookPhotoDay,
  type FoodReadyAnnouncement,
  listCookFoodPhotos,
  listFoodReadyLogs,
  uploadCookFoodPhoto,
} from "@/lib/cook-api";
import { formatDate, formatDateTime, formatTime, humanizeEnum } from "@/lib/format";
import { mealTypeNow } from "@/lib/food-week";
import { toastError, toastSuccess } from "@/lib/toast";
import { privateAssetSource, uploadAsset } from "@/lib/uploads";

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
 * ## One feed, now readable from both ends
 *
 * `POST /cook/food-photos` writes the same `FoodPhoto` collection the resident
 * and admin routes write to, and publishes on the FOOD topic, so a photo appears
 * on residents' food screens as it is posted. Until 2026-08-18 that route was
 * **POST-only** — the kitchen could post a photo of dinner and had no way to see
 * it, or to see whether anyone had posted at all today, while every resident in
 * the hostel could. `GET /cook/food-photos` closes that, and this screen now
 * shows the same rows the residents see rather than a local approximation of
 * them.
 *
 * ## Grouped by day, by the server
 *
 * Nepal is +05:45, so a breakfast photographed at 05:30 local is `23:45Z` the
 * *previous* day. Grouping on the phone would hand that decision to the
 * handset's timezone, and a cook whose phone is set to anything else would see
 * this morning's breakfast filed under yesterday. `food-photo-days.ts` does it
 * in `Asia/Kathmandu` and sends the day key down.
 *
 * The **meals covered** count per day is the number the kitchen is actually
 * judged on: four photos of dinner is not the same as one of each meal, and a
 * photo count cannot tell those apart.
 */
type PhotoFeed = { days: CookPhotoDay[]; hasMore: boolean; total: number };

export default function CookPhotosScreen() {
  const logs = useResource<FoodReadyAnnouncement[]>(
    useCallback(() => listFoodReadyLogs(), []),
    { topics: [REALTIME_TOPIC.FOOD] },
  );

  /*
   * Its own resource rather than one combined load: the two answer different
   * questions and fail independently, and a kitchen whose announcement log
   * errors should still be able to see its photos.
   */
  const feed = useResource<PhotoFeed>(useCallback(() => listCookFoodPhotos(), []), {
    topics: [REALTIME_TOPIC.FOOD],
  });

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
        // The photo the cook just took should appear in the grid below without
        // them having to pull to refresh to believe it worked.
        feed.refresh();
      } catch (caught) {
        toastError("Could not share that photo", readApiError(caught));
      } finally {
        setBusy(false);
      }
    },
    [feed],
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

        <PhotoFeedSection feed={feed} />

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

/**
 * What the kitchen has posted, newest day first.
 *
 * Each day is a header — the date, the meals it covered, how many photos — and a
 * grid beneath it. Tapping opens the global asset viewer on **that day's**
 * photos, not the whole feed: the day is the unit a cook thinks in, and paging
 * from Tuesday's dinner into last week is not what the tap meant.
 */
function PhotoFeedSection({ feed }: { feed: ReturnType<typeof useResource<PhotoFeed>> }) {
  const days = feed.data?.days ?? [];

  return (
    <View>
      <SectionHeader
        subtitle={
          feed.data && feed.data.total > 0
            ? `${feed.data.total} photo${feed.data.total === 1 ? "" : "s"}${
                feed.data.hasMore ? " · most recent first" : ""
              }`
            : "Everything this kitchen has shared"
        }
        title="Your photos"
      />

      {feed.loading ? (
        <LoadingState label="Loading your photos" />
      ) : feed.error ? (
        <ErrorState message={feed.error} onRetry={feed.reload} />
      ) : days.length === 0 ? (
        <Card>
          <EmptyState
            description="Take a photo above and it appears here, and on every resident's food screen."
            title="No photos yet"
          />
        </Card>
      ) : (
        <View className="gap-4">
          {days.map((day) => (
            <PhotoDayCard day={day} key={day.day} />
          ))}
        </View>
      )}
    </View>
  );
}

function PhotoDayCard({ day }: { day: CookPhotoDay }) {
  const token = useAppSelector((state) => state.auth.accessToken);
  const { colors } = useAppTheme();

  const items = day.photos.map((photo) => ({
    assetId: photo.photoAssetId,
    caption: [
      humanizeEnum(photo.mealType),
      `Posted ${formatTime(photo.uploadedAt)}`,
      photo.source === "RESIDENT" ? "By a resident" : null,
      photo.caption || null,
    ]
      .filter(Boolean)
      .join(" · "),
    title: formatDate(day.day),
  }));

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-1">
          <Text variant="label">{formatDate(day.day)}</Text>
          <Text variant="caption">
            {`${day.photos.length} photo${day.photos.length === 1 ? "" : "s"}`}
          </Text>
        </View>

        {/*
          Out of four, because four is the routine. "2 of 4 meals" is a nudge
          with a number behind it; a bare "2" is not.
        */}
        <Badge
          label={`${day.mealsCovered} of 4 meals`}
          tone={day.mealsCovered >= 4 ? "success" : "neutral"}
        />
      </View>

      <Grid gap={8} maxColumns={4} minCellWidth={84}>
        {day.photos.map((photo, index) => (
          <Pressable
            accessibilityLabel={`${humanizeEnum(photo.mealType)}, posted ${formatTime(
              photo.uploadedAt,
            )}`}
            accessibilityRole="imagebutton"
            className="gap-1 active:opacity-80"
            key={photo.id}
            onPress={() => openAssetViewer(items, index)}
          >
            <Image
              contentFit="cover"
              source={privateAssetSource(photo.photoAssetId, token, "THUMBNAIL")}
              style={{
                aspectRatio: 1,
                backgroundColor: colors.muted,
                borderRadius: 10,
                width: "100%",
              }}
            />
            <Text numberOfLines={1} variant="caption">
              {humanizeEnum(photo.mealType)}
            </Text>
            {/* The "when" the cook asked for: the clock time it went up. */}
            <Text className="text-[10px] text-muted-foreground" numberOfLines={1}>
              {photo.source === "RESIDENT"
                ? `Resident · ${formatTime(photo.uploadedAt)}`
                : formatTime(photo.uploadedAt)}
            </Text>
          </Pressable>
        ))}
      </Grid>
    </Card>
  );
}
