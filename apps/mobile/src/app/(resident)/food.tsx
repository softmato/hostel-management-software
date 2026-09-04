import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import {
  FoodRoutineWeek,
  MonthEndSpecial,
} from "@/components/food-routine";
import { NotificationBell } from "@/components/notification-bell";
import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Grid } from "@/components/ui/layout";
import { Input } from "@/components/ui/input";
import { Screen } from "@/components/ui/screen";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import { residentQuery } from "@/lib/resident-queries";
import { readApiError } from "@/lib/api-contract";
import {
  dateForDay,
  type MealType,
  mealTypeNow,
  type RoutineDay,
} from "@/lib/food-week";
import { formatDate, humanizeEnum } from "@/lib/format";
import {
  type ResidentFood,
  submitFoodFeedback,
  uploadFoodPhoto,
} from "@/lib/resident-api";
import { toastError, toastSuccess } from "@/lib/toast";
import { openAssetViewer } from "@/lib/asset-viewer";
import { privateAssetSource, uploadAsset } from "@/lib/uploads";

/**
 * The week's food, and the two things a resident can put back into it.
 *
 * ## Today leads, the week follows
 *
 * The routine is a 7×4 grid and a phone is one column wide, so it is shown a
 * day at a time with today selected. A resident checking the app at 6pm wants
 * tonight's dinner, not a table they have to scroll sideways through — and the
 * day strip makes "what is Friday" one tap rather than a different screen.
 *
 * Day is resolved in **Nepal time**. `getDay()` on a phone left on another
 * timezone selects the wrong column for the last 5h45m of every day, which is
 * exactly the evening window when people check dinner.
 *
 * ## The routine itself moved out
 *
 * The day strip, the meal cards and the month-end card now live in
 * `components/food-routine.tsx`, because the public hostel page shows the same
 * routine from the same payload to someone deciding whether to move in. This
 * screen keeps the two things that are a resident's alone — rating a meal, and
 * posting a photo of it — and passes the first in through `mealFooter`.
 */

export default function ResidentFoodScreen() {
  /*
   * The kitchen changes this screen, not the resident. `food.service.ts` and
   * `cook.service.ts` both publish, so a menu edited at 5pm reaches the phone
   * of somebody deciding whether to eat in.
   */
  const query = residentQuery.food();
  const food = useResource<ResidentFood>(query.load, {
    cacheKey: query.key,
    topics: query.topics,
  });

  const header = (
    <AppBar actions={<NotificationBell />} subtitle="This week's routine" title="Food" />
  );

  if (food.loading) {
    return (
      <Screen header={header} insideTabs>
        {/*
          The day strip, then the day's meals, then the photo wall — the three
          bands `FoodRoutineWeek` and `PhotoGallery` resolve into. See Home's
          note on why this is a skeleton and not a spinner.
        */}
        <View className="gap-4">
          <View className="flex-row gap-2">
            {Array.from({ length: 7 }, (_, index) => (
              <Skeleton height={52} key={index} radius={14} width={42} />
            ))}
          </View>

          <SkeletonCard rows={2} />
          <SkeletonCard rows={2} />

          <View className="flex-row gap-2">
            <Skeleton height={92} radius={14} width="32%" />
            <Skeleton height={92} radius={14} width="32%" />
            <Skeleton height={92} radius={14} width="32%" />
          </View>
        </View>
      </Screen>
    );
  }

  if (food.error || !food.data) {
    return (
      <Screen header={header} insideTabs>
        <ErrorState
          message={food.error ?? "The menu could not be loaded."}
          onRetry={food.reload}
        />
      </Screen>
    );
  }

  const { photos, routine } = food.data;

  return (
    <Screen
      header={header}
      insideTabs
      onRefresh={food.refresh}
      refreshing={food.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <FoodRoutineWeek
          mealFooter={({ day, hasItems, mealType }) =>
            hasItems ? (
              <MealFeedback day={day} key={`${day}:${mealType}`} mealType={mealType} />
            ) : null
          }
          meals={routine.meals}
          timings={routine.timings}
        />

        <MonthEndSpecial special={routine.monthEndSpecial} />

        <PhotoGallery onUploaded={food.refresh} photos={photos} />
      </View>
    </Screen>
  );
}

/**
 * The "Rate this meal" control, and the form it opens into.
 *
 * Its own component because it holds the open/closed state, and that state has
 * to be **per meal card** — hoisting it into the screen would mean one flag for
 * four cards, so opening lunch would open dinner as well. It used to live inside
 * `MealCard`; when that card moved to `components/food-routine.tsx` to be shared
 * with the public hostel page, the rating stayed here, because a visitor
 * deciding where to live has no business rating a dinner they have not eaten.
 *
 * Rating is per meal *per day*, because that is what the server aggregates:
 * feedback with no meal attached cannot tell an owner that Tuesday dinner is the
 * problem, which is the only thing the feedback is for.
 */
function MealFeedback({ day, mealType }: { day: RoutineDay; mealType: MealType }) {
  const [open, setOpen] = useState(false);

  if (open) {
    return <FeedbackForm day={day} mealType={mealType} onDone={() => setOpen(false)} />;
  }

  return (
    <Pressable
      accessibilityRole="button"
      className="self-start active:opacity-70"
      onPress={() => setOpen(true)}
    >
      <Text className="text-primary" variant="label">
        Rate this meal
      </Text>
    </Pressable>
  );
}

function FeedbackForm({
  day,
  mealType,
  onDone,
}: {
  day: RoutineDay;
  mealType: MealType;
  onDone: () => void;
}) {
  const { colors } = useAppTheme();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = useCallback(async () => {
    if (rating < 1) {
      toastError("Pick a rating first");
      return;
    }

    setBusy(true);

    try {
      await submitFoodFeedback({
        comment: comment.trim() || undefined,
        date: dateForDay(day),
        isAnonymous: anonymous,
        mealType,
        rating,
      });

      toastSuccess("Thanks — that's been sent to your hostel.");
      onDone();
    } catch (caught) {
      toastError("Could not send that", readApiError(caught));
    } finally {
      setBusy(false);
    }
  }, [anonymous, comment, day, mealType, onDone, rating]);

  return (
    <View className="gap-3 border-t border-border pt-3">
      <View className="flex-row gap-2">
        {[1, 2, 3, 4, 5].map((value) => (
          <Pressable
            accessibilityLabel={`${value} star${value > 1 ? "s" : ""}`}
            accessibilityRole="button"
            hitSlop={6}
            key={value}
            onPress={() => setRating(value)}
          >
            <Ionicons
              color={value <= rating ? colors.warning : colors.mutedForeground}
              name={value <= rating ? "star" : "star-outline"}
              size={26}
            />
          </Pressable>
        ))}
      </View>

      <Input
        multiline
        onChangeText={setComment}
        placeholder="Anything you'd like them to know? (optional)"
        value={comment}
      />

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: anonymous }}
        className="flex-row items-center gap-2 active:opacity-70"
        onPress={() => setAnonymous((value) => !value)}
      >
        <Ionicons
          color={anonymous ? colors.primary : colors.mutedForeground}
          name={anonymous ? "checkbox" : "square-outline"}
          size={20}
        />
        {/* Worth offering: honest feedback about the cook is hard to give when
            you eat there every day and your name is on it. */}
        <Text variant="muted">Send without my name</Text>
      </Pressable>

      <View className="flex-row gap-3">
        <Button
          className="flex-1"
          label="Send"
          loading={busy}
          onPress={() => void send()}
          size="sm"
        />
        <Button
          className="flex-1"
          label="Cancel"
          onPress={onDone}
          size="sm"
          variant="outline"
        />
      </View>
    </View>
  );
}

function PhotoGallery({
  onUploaded,
  photos,
}: {
  onUploaded: () => void;
  photos: ResidentFood["photos"];
}) {
  const token = useAppSelector((state) => state.auth.accessToken);
  const { colors } = useAppTheme();
  const [busy, setBusy] = useState(false);

  const add = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      toastError("Permission needed", "Allow photo access to share a meal photo.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    const asset = result.canceled ? null : result.assets[0];

    if (!asset) {
      return;
    }

    setBusy(true);

    try {
      const photoAssetId = await uploadAsset(asset, {
        kind: "GENERIC",
        // Every other call site names the task; this one did not, so the
        // toaster and the new shade notification both said "Uploading file".
        label: "Food photo",
      });

      await uploadFoodPhoto({
        date: new Date().toISOString(),
        mealType: mealTypeNow(),
        photoAssetId,
      });

      toastSuccess("Photo shared");
      onUploaded();
    } catch (caught) {
      toastError("Could not share that photo", readApiError(caught));
    } finally {
      setBusy(false);
    }
  }, [onUploaded]);

  /*
   * The grid and the viewer are built from the *same* slice, so the tapped tile
   * and the page it opens cannot drift apart — indexing a 12-tile grid into an
   * unsliced list is how a gallery opens on the wrong photo.
   */
  const shown = photos.slice(0, 12);
  const items = shown.map((photo) => ({
    assetId: photo.photoAssetId,
    caption: [photo.caption, formatDate(photo.date)].filter(Boolean).join(" · "),
    title: humanizeEnum(photo.mealType),
  }));

  return (
    <View>
      <SectionHeader
        action={
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            hitSlop={8}
            onPress={() => void add()}
          >
            <Text className="text-primary" variant="label">
              {busy ? "Uploading…" : "Add photo"}
            </Text>
          </Pressable>
        }
        subtitle="What meals actually look like"
        title="Photos"
      />

      {photos.length === 0 ? (
        <Card>
          <Text variant="muted">
            No photos yet. Be the first — it is the fastest way to show your hostel
            what is working and what is not.
          </Text>
        </Card>
      ) : (
        /*
         * `<Grid>` rather than a fixed 104dp tile: three of those plus their
         * gaps need 328dp, and a 320dp phone has about 280 after the screen's
         * own padding — so the third tile wrapped to its own line and left a
         * hole. The grid measures what it was given and fits what fits.
         */
        <Grid gap={8} maxColumns={3} minCellWidth={96}>
          {shown.map((photo, index) => (
            <Pressable
              accessibilityLabel={`${humanizeEnum(photo.mealType)} on ${formatDate(photo.date)}`}
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
                  borderRadius: 12,
                  width: "100%",
                }}
              />
              <Badge label={humanizeEnum(photo.mealType)} />
              {/*
                The caption is stored by the server and shown by the web, and
                was dropped here. Meal photos are captioned with the thing worth
                knowing — "this was Tuesday's dal" — so a grid without them is
                twelve squares of curry.
              */}
              {photo.caption ? (
                <Text numberOfLines={2} variant="caption">
                  {photo.caption}
                </Text>
              ) : (
                <Text variant="caption">{formatDate(photo.date)}</Text>
              )}
            </Pressable>
          ))}
        </Grid>
      )}
    </View>
  );
}

