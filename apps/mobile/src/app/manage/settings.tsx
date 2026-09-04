import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Chip, FactRow } from "@/components/ui/layout";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { Toggle } from "@/components/ui/toggle";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import {
  addHostelPhoto,
  type AttendanceSettings,
  type CommunitySettings,
  deleteHostelPhoto,
  geocodeHostelLocation,
  type GeocodeHit,
  requestHostelChange,
  updateAttendanceSettings,
  updateCommunitySettings,
  updateManagedHostel,
} from "@/lib/admin-manage-api";
import { type AdminSettingsData, adminQuery } from "@/lib/admin-queries";
import { API_BASE_URL } from "@/lib/api";
import { calendarExample, CALENDAR_LABELS } from "@/lib/calendar";
import { readApiError } from "@/lib/api-contract";
import { openAssetViewer } from "@/lib/asset-viewer";
import { formatMoney, humanizeEnum } from "@/lib/format";
import { absoluteMediaUrl } from "@/lib/media";
import { toastError, toastSuccess } from "@/lib/toast";
import { uploadAsset } from "@/lib/uploads";
import {
  type CalendarPreference,
  setCalendarPreference,
} from "@/store/slices/uiSlice";

/**
 * Settings — the hostel itself, and the switches that change how it behaves.
 *
 * ## Which of these are admin-only, and why the screen does not hide them
 *
 * The profile edits want `editHostelProfile`; the community and attendance
 * switches, and every warden route, want `requireHostelAdminPrincipal` — a
 * *role*, not a grant, so no warden can be given them. Each block loads on its
 * own and a refused one says so where it stands, rather than the screen
 * pretending the hostel has no settings.
 *
 * ## Three fields are not editable here, on purpose
 *
 * After approval a hostel may rename itself a fixed number of times, and the
 * owner's own name and account email are never directly editable. All three go
 * through `POST profile/change-request` to the platform team. The rename counter
 * is shown rather than left to be discovered by typing, because the failure is a
 * 403 at save time and by then the person has retyped their sign.
 *
 * ## The location picker is a search box, not a map
 *
 * `profile/geocode` resolves a place name, a pasted Google Maps link or a raw
 * `lat,lng`. On a phone the pasted-link case is the *common* one — somebody
 * shares the hostel's pin over Viber and it arrives as `maps.app.goo.gl/…` —
 * which is exactly what the server-side resolver exists to handle, since a
 * client cannot follow that redirect.
 */

const HOSTEL_TYPE_OPTIONS = [
  { description: "Men only.", label: "Boys", value: "BOYS" },
  { description: "Women only.", label: "Girls", value: "GIRLS" },
  { description: "Open to everyone.", label: "Co-living", value: "CO_LIVING" },
] as const;

const CHANGE_TYPES = [
  {
    description: "Past the rename limit, or before approval is through.",
    label: "Hostel name",
    value: "HOSTEL_NAME",
  },
  { description: "The registered owner.", label: "Owner name", value: "OWNER_NAME" },
  {
    description: "The address the owner signs in with.",
    label: "Owner email",
    value: "OWNER_EMAIL",
  },
] as const;

/**
 * The two calendars, and the half of the sentence under each that is fixed.
 *
 * Only the naming half lives here. The example beside it is today written in
 * that calendar, so it is built at render by `calendarExample` rather than
 * frozen into a module constant that would still read `18 Aug 2026` in
 * September.
 *
 * Ordered AD first because it is the default, not because it is preferred — the
 * list must not reorder itself around the current choice, or the row under the
 * thumb changes meaning between visits.
 */
const CALENDAR_OPTIONS = [
  {
    label: CALENDAR_LABELS.AD,
    system: "Gregorian",
    value: "AD",
  },
  {
    label: CALENDAR_LABELS.BS,
    system: "Bikram Sambat",
    value: "BS",
  },
] as const satisfies readonly {
  label: string;
  system: string;
  value: CalendarPreference;
}[];

/** Mirrors `PHOTO_LIMITS` for the two gallery kinds in `hostel-profile.service`. */
const GALLERY_LIMIT = 20;

type Panel =
  | "about"
  | "attendance"
  | "change"
  | "contact"
  | "facilities"
  | "location"
  | "pricing"
  | "rules"
  | null;

/*
 * `SettingsData` and its loader are `adminQuery.settings()` — see
 * `lib/admin-queries.ts`.
 */

function toNumber(value: string) {
  const parsed = Number(value.trim());

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export default function ManageSettingsScreen() {
  const query = adminQuery.settings();
  const settings = useResource<AdminSettingsData>(query.load, {
    cacheKey: query.key,
    topics: query.topics,
  });

  const dispatch = useAppDispatch();
  const { colors } = useAppTheme();
  const calendar = useAppSelector((state) => state.ui.calendarPreference);

  const [panel, setPanel] = useState<Panel>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // One draft object rather than a state per field: every panel below edits a
  // slice of the same hostel record, and a save sends only the keys it touched.
  const [form, setForm] = useState<Record<string, string>>({});
  const [listDraft, setListDraft] = useState<string[]>([]);
  const [listEntry, setListEntry] = useState("");
  const [changeType, setChangeType] = useState<"HOSTEL_NAME" | "OWNER_NAME" | "OWNER_EMAIL">(
    "HOSTEL_NAME",
  );
  const [geoQuery, setGeoQuery] = useState("");
  const [geoHits, setGeoHits] = useState<GeocodeHit[]>([]);
  const [geoBusy, setGeoBusy] = useState(false);
  const [attendanceDraft, setAttendanceDraft] = useState<AttendanceSettings | null>(null);

  const hostel = settings.data?.hostel ?? null;
  const community = settings.data?.community ?? null;
  const attendance = settings.data?.attendance ?? null;

  const gallery = useMemo(
    () => (hostel?.photos ?? []).filter((photo) => photo.kind !== "ROOM"),
    [hostel],
  );

  const { reload } = settings;

  const patch = useCallback(
    async (input: Parameters<typeof updateManagedHostel>[0], message: string) => {
      setSaving(true);

      try {
        await updateManagedHostel(input);
        toastSuccess(message);
        setPanel(null);
        await reload();
      } catch (error) {
        toastError("Could not save", readApiError(error, "That did not save."));
      } finally {
        setSaving(false);
      }
    },
    [reload],
  );

  const openPanel = useCallback(
    (next: Panel) => {
      if (!hostel) {
        return;
      }

      if (next === "about") {
        setForm({
          description: hostel.description,
          hostelType: hostel.hostelType,
          name: hostel.name,
          totalFloors: String(hostel.totalFloors ?? 0),
        });
      }

      if (next === "contact") {
        setForm({
          email: hostel.contact.email ?? "",
          phone: hostel.contact.phone ?? "",
        });
      }

      if (next === "location") {
        setForm({
          address: hostel.location.address ?? "",
          area: hostel.location.area ?? "",
          city: hostel.location.city ?? "",
          lat: hostel.location.lat ? String(hostel.location.lat) : "",
          lng: hostel.location.lng ? String(hostel.location.lng) : "",
          province: hostel.location.province ?? "",
        });
        setGeoHits([]);
        setGeoQuery("");
      }

      if (next === "pricing") {
        setForm({
          admissionFee: hostel.pricing.admissionFee ? String(hostel.pricing.admissionFee) : "",
          monthlyRentMax: hostel.pricing.monthlyRentMax
            ? String(hostel.pricing.monthlyRentMax)
            : "",
          monthlyRentMin: hostel.pricing.monthlyRentMin
            ? String(hostel.pricing.monthlyRentMin)
            : "",
        });
      }

      if (next === "facilities") {
        setListDraft([...hostel.facilities]);
        setListEntry("");
      }

      if (next === "rules") {
        setListDraft([...hostel.rules]);
        setListEntry("");
      }

      if (next === "change") {
        setForm({ reason: "", requestedValue: "" });
      }

      if (next === "attendance") {
        setAttendanceDraft(attendance);
      }

      setPanel(next);
    },
    [attendance, hostel],
  );

  const searchPlaces = useCallback(async () => {
    if (geoQuery.trim().length < 2) {
      return;
    }

    setGeoBusy(true);

    try {
      setGeoHits(await geocodeHostelLocation(geoQuery.trim()));
    } catch (error) {
      toastError("Could not look that up", readApiError(error));
    } finally {
      setGeoBusy(false);
    }
  }, [geoQuery]);

  const addGalleryPhoto = useCallback(
    async (kind: "EXTERIOR" | "INTERIOR") => {
      if (gallery.length >= GALLERY_LIMIT) {
        toastError("Gallery full", `The listing holds at most ${GALLERY_LIMIT} photos.`);
        return;
      }

      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        toastError("Permission needed", "Allow photo access to add listing photos.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: true,
        mediaTypes: ["images"],
        quality: 0.85,
        selectionLimit: GALLERY_LIMIT - gallery.length,
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      setUploading(true);

      try {
        for (const asset of result.assets) {
          // PUBLIC: these are the photographs a stranger comparing hostels sees,
          // and a PRIVATE asset is readable only through the authorising route.
          const assetId = await uploadAsset(asset, {
            accessLevel: "PUBLIC",
            label: `${humanizeEnum(kind)} photo`,
          });

          await addHostelPhoto({ alt: hostel?.name, fileAssetId: assetId, kind });
        }

        toastSuccess("Photos added");
      } catch (error) {
        toastError("Upload failed", readApiError(error));
      } finally {
        setUploading(false);
        await reload();
      }
    },
    [gallery.length, hostel?.name, reload],
  );

  const removePhoto = useCallback(
    (photoId: string) => {
      Alert.alert("Remove this photo?", "It disappears from the public listing.", [
        { style: "cancel", text: "Keep it" },
        {
          onPress: () => {
            void (async () => {
              try {
                await deleteHostelPhoto(photoId);
                await reload();
              } catch (error) {
                toastError("Could not remove", readApiError(error));
              }
            })();
          },
          style: "destructive",
          text: "Remove",
        },
      ]);
    },
    [reload],
  );

  const saveCommunity = useCallback(
    async (input: Partial<CommunitySettings>) => {
      try {
        await updateCommunitySettings(input);
        await reload();
      } catch (error) {
        toastError("Could not change that", readApiError(error));
      }
    },
    [reload],
  );

  const saveAttendance = useCallback(async () => {
    if (!attendanceDraft) {
      return;
    }

    if (attendanceDraft.nearbyZoneRadiusMeters <= attendanceDraft.insideZoneRadiusMeters) {
      toastError(
        "Check the geofence",
        "The nearby radius has to be larger than the inside one — the server refuses it otherwise.",
      );
      return;
    }

    setSaving(true);

    try {
      await updateAttendanceSettings(attendanceDraft);
      toastSuccess("Attendance settings saved");
      setPanel(null);
      await reload();
    } catch (error) {
      toastError("Could not save", readApiError(error));
    } finally {
      setSaving(false);
    }
  }, [attendanceDraft, reload]);

  const submitChangeRequest = useCallback(async () => {
    const requestedValue = form.requestedValue?.trim() ?? "";

    if (requestedValue.length < 2) {
      toastError("Say what it should be", "Two characters at least.");
      return;
    }

    setSaving(true);

    try {
      await requestHostelChange({
        changeType,
        reason: form.reason?.trim() || undefined,
        requestedValue,
      });
      toastSuccess("Sent to the platform team", "They will confirm by email.");
      setPanel(null);
    } catch (error) {
      toastError("Could not send it", readApiError(error));
    } finally {
      setSaving(false);
    }
  }, [changeType, form]);

  if (settings.loading) {
    return (
      <Screen header={<AppBar accent centerTitle showBack title="Settings" />}>
        <LoadingState label="Reading your hostel" />
      </Screen>
    );
  }

  if (settings.error || !hostel) {
    return (
      <Screen header={<AppBar accent centerTitle showBack title="Settings" />}>
        <ErrorState message={settings.error ?? "No hostel"} onRetry={settings.reload} />
      </Screen>
    );
  }

  return (
    <Screen
      header={<AppBar accent centerTitle showBack subtitle={hostel.name} title="Settings" />}
      onRefresh={settings.refresh}
      refreshing={settings.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <Card className="gap-3">
          <View className="flex-row items-start gap-3">
            <View className="flex-1">
              <Text variant="subtitle">{hostel.name}</Text>
              <Text variant="caption">{`/${hostel.slug}`}</Text>
            </View>
          </View>

          <View className="flex-row flex-wrap gap-2">
            <Badge
              label={hostel.status === "PUBLISHED" ? "Published" : humanizeEnum(hostel.status)}
              tone={hostel.status === "PUBLISHED" ? "success" : "warning"}
            />
            <Badge
              label={
                hostel.verificationStatus === "VERIFIED" ? "Verified" : "Awaiting verification"
              }
              tone={hostel.verificationStatus === "VERIFIED" ? "success" : "warning"}
            />
            <Badge label={humanizeEnum(hostel.hostelType)} tone="info" />
          </View>

          {hostel.nameChangeCount > 0 ? (
            <Text variant="caption">
              {`Renamed ${hostel.nameChangeCount} time(s) since approval. Past the platform's limit, a rename becomes a change request.`}
            </Text>
          ) : null}
        </Card>

        <View>
          <SectionHeader subtitle="What the public listing says" title="The hostel" />
          <Card padding="px-4 py-1">
            <ListRow
              icon="business-outline"
              onPress={() => openPanel("about")}
              subtitle={hostel.description ? "Name, description, type" : "No description yet"}
              title="About"
            />
            <RowDivider inset />
            <ListRow
              icon="call-outline"
              onPress={() => openPanel("contact")}
              subtitle={hostel.contact.phone || "No phone on file"}
              title="Contact"
            />
            <RowDivider inset />
            <ListRow
              icon="location-outline"
              onPress={() => openPanel("location")}
              subtitle={
                [hostel.location.area, hostel.location.city].filter(Boolean).join(", ") ||
                "Not set"
              }
              title="Location"
            />
            <RowDivider inset />
            <ListRow
              icon="cash-outline"
              onPress={() => openPanel("pricing")}
              subtitle={
                hostel.pricing.monthlyRentMin
                  ? `${formatMoney(hostel.pricing.monthlyRentMin)} – ${formatMoney(hostel.pricing.monthlyRentMax)}`
                  : "No price range set"
              }
              title="Pricing"
            />
            <RowDivider inset />
            <ListRow
              icon="sparkles-outline"
              onPress={() => openPanel("facilities")}
              subtitle={`${hostel.facilities.length} listed`}
              title="Facilities"
            />
            <RowDivider inset />
            <ListRow
              icon="document-text-outline"
              onPress={() => openPanel("rules")}
              subtitle={`${hostel.rules.length} listed`}
              title="House rules"
            />
            <RowDivider inset />
            <ListRow
              icon="bed-outline"
              onPress={() => router.push("/manage/rooms")}
              subtitle={`${hostel.roomConfigurations.length} room type(s)`}
              title="Rooms and beds"
            />
          </Card>
        </View>

        <View>
          <SectionHeader
            action={
              <Button
                label="Add"
                loading={uploading}
                onPress={() => void addGalleryPhoto("EXTERIOR")}
                size="sm"
                variant="outline"
              />
            }
            subtitle={`${gallery.length}/${GALLERY_LIMIT} — room photos live on the Rooms screen`}
            title="Photos"
          />
          <Card className="gap-3">
            {gallery.length === 0 ? (
              <Text variant="muted">
                No photos yet. A listing without one is skipped by most people
                comparing hostels.
              </Text>
            ) : (
              <ScrollView
                contentContainerClassName="gap-2"
                horizontal
                showsHorizontalScrollIndicator={false}
              >
                {gallery.map((photo, index) => {
                  const uri = absoluteMediaUrl(photo.url, API_BASE_URL);

                  if (!uri) {
                    return null;
                  }

                  return (
                    <View className="relative" key={photo.id ?? uri}>
                      <Pressable
                        accessibilityLabel={`Listing photo ${index + 1}`}
                        accessibilityRole="imagebutton"
                        onPress={() =>
                          openAssetViewer(
                            gallery.map((item) => ({
                              title: item.alt || hostel.name,
                              url: item.url,
                            })),
                            index,
                          )
                        }
                      >
                        <Image
                          contentFit="cover"
                          source={{ uri }}
                          style={{ borderRadius: 12, height: 96, width: 132 }}
                        />
                      </Pressable>

                      <Badge
                        className="absolute bottom-1 left-1"
                        label={humanizeEnum(photo.kind)}
                      />

                      {photo.id ? (
                        <Pressable
                          accessibilityLabel="Remove photo"
                          accessibilityRole="button"
                          className="absolute right-1 top-1 rounded-full bg-black/60 p-1"
                          hitSlop={8}
                          onPress={() => removePhoto(photo.id as string)}
                        >
                          <Ionicons color="#ffffff" name="close" size={13} />
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </ScrollView>
            )}

            <View className="flex-row gap-2">
              <Button
                className="flex-1"
                label="Add outside shot"
                loading={uploading}
                onPress={() => void addGalleryPhoto("EXTERIOR")}
                size="sm"
                variant="outline"
              />
              <Button
                className="flex-1"
                label="Add inside shot"
                loading={uploading}
                onPress={() => void addGalleryPhoto("INTERIOR")}
                size="sm"
                variant="outline"
              />
            </View>
          </Card>
        </View>

        <View>
          <SectionHeader subtitle="Who else runs this hostel" title="People" />
          <Card padding="px-4 py-1">
            <ListRow
              icon="people-outline"
              onPress={() => router.push("/manage/wardens")}
              subtitle="Invite, suspend and set what each one may do"
              title="Wardens"
            />
            <RowDivider inset />
            <ListRow
              icon="gift-outline"
              onPress={() => router.push("/manage/referrals")}
              subtitle="Confirm who joined, and record the reward"
              title="Referrals"
            />
          </Card>
        </View>

        <View>
          <SectionHeader subtitle="Hostel-wide behaviour" title="Switches" />

          <Card className="gap-3">
            {community === null ? (
              <Text variant="muted">
                The community switches are for the hostel owner. This account signs in
                as staff, so they are not shown.
              </Text>
            ) : (
              <>
                <View className="flex-row items-center justify-between gap-3">
                  <View className="flex-1">
                    <Text variant="label">Community</Text>
                    <Text variant="caption">
                      Lets your residents post on the platform-wide board.
                    </Text>
                  </View>
                  <Toggle
                    accessibilityLabel="Community enabled"
                    onChange={(enabled) => void saveCommunity({ enabled })}
                    value={community.enabled}
                  />
                </View>

                <View className="flex-row items-center justify-between gap-3 border-t border-border pt-3">
                  <View className="flex-1">
                    <Text variant="label">Profanity filter</Text>
                    <Text variant="caption">
                      Holds posts with flagged language for a moderator instead of
                      publishing them.
                    </Text>
                  </View>
                  <Toggle
                    accessibilityLabel="Profanity filter enabled"
                    onChange={(profanityFilterEnabled) =>
                      void saveCommunity({ profanityFilterEnabled })
                    }
                    value={community.profanityFilterEnabled}
                  />
                </View>
              </>
            )}
          </Card>
        </View>

        <View>
          {/*
            A display preference, and the only one on this screen that is not
            hostel configuration — which is exactly what the subtitle says.

            It sits here rather than in the app-wide Settings screen because the
            person it is for is the owner keeping the hostel's books, and this is
            the screen they are already in when they think about how the hostel
            writes things down. Everything it changes — every date on every admin
            screen — is one tap away from here.

            Radio rows rather than a `<Segmented>`: two options that each need a
            worked example under them do not fit inside a segment, and the
            example is the whole point. Same shape as the theme picker in
            `app/settings.tsx`, deliberately.
          */}
          <SectionHeader
            subtitle="Stored on this phone only"
            title="Dates"
          />
          <Card>
            {CALENDAR_OPTIONS.map((option, index) => {
              const active = option.value === calendar;

              return (
                <View key={option.value}>
                  {index > 0 ? <RowDivider /> : null}
                  <ListRow
                    onPress={() => dispatch(setCalendarPreference(option.value))}
                    right={
                      <Ionicons
                        color={active ? colors.primary : colors.border}
                        name={active ? "radio-button-on" : "radio-button-off"}
                        size={20}
                      />
                    }
                    subtitle={`${option.system} — ${calendarExample(option.value)}`}
                    title={option.label}
                  />
                </View>
              );
            })}
          </Card>
        </View>

        <View>
          <SectionHeader
            subtitle="The nightly roll call, and how long its records are kept"
            title="Attendance"
          />
          {attendance === null ? (
            <Card>
              <Text variant="muted">
                The geofence is hostel-level configuration and belongs to the owner, so
                it is not shown for this account.
              </Text>
            </Card>
          ) : (
            <Card className="gap-3">
              <View className="flex-row items-center justify-between gap-3">
                <View className="flex-1">
                  <Text variant="label">
                    {attendance.enabled ? "Tracking on" : "Tracking off"}
                  </Text>
                  <Text variant="caption">
                    {attendance.enabled
                      ? `${attendance.pingTimes.length} check-in(s) a day`
                      : "Residents are not asked to check in."}
                  </Text>
                </View>
                <Toggle
                  accessibilityLabel="Attendance tracking enabled"
                  onChange={(enabled) => {
                    setAttendanceDraft({ ...attendance, enabled });
                    void updateAttendanceSettings({ enabled })
                      .then(() => reload())
                      .catch((error: unknown) =>
                        toastError("Could not change that", readApiError(error)),
                      );
                  }}
                  value={attendance.enabled}
                />
              </View>

              <View className="gap-1 border-t border-border pt-3">
                <FactRow label="Inside" value={`${attendance.insideZoneRadiusMeters} m`} />
                <FactRow label="Nearby" value={`${attendance.nearbyZoneRadiusMeters} m`} />
                <FactRow label="Check-ins" value={attendance.pingTimes.join(", ") || "—"} />
                <FactRow label="Alert after" value={`${attendance.absenceAlertDays} day(s)`} />
                <FactRow label="Kept for" value={`${attendance.retentionDays} day(s)`} />
              </View>

              <Text variant="caption">
                Only the zone is stored — inside, nearby or outside. A check-in&apos;s
                coordinates are discarded as it lands, so nothing here can be turned
                into a location history.
              </Text>

              <Button
                label="Change the geofence"
                onPress={() => openPanel("attendance")}
                size="sm"
                variant="outline"
              />
            </Card>
          )}
        </View>

        <View>
          <SectionHeader
            subtitle="Locked fields go to the platform team"
            title="Ask for a change"
          />
          <Card padding="px-4 py-1">
            <ListRow
              icon="mail-outline"
              onPress={() => openPanel("change")}
              subtitle="Hostel name past the limit, owner name, owner email"
              title="Request a change"
            />
          </Card>
        </View>
      </View>

      {/* ------------------------------------------------------------------ */}
      <Sheet
        footer={
          <Button
            label="Save"
            loading={saving}
            onPress={() =>
              void patch(
                {
                  description: form.description?.trim(),
                  hostelType: form.hostelType,
                  name: form.name?.trim(),
                  totalFloors: toNumber(form.totalFloors ?? "0"),
                },
                "Saved",
              )
            }
          />
        }
        onClose={() => setPanel(null)}
        open={panel === "about"}
        title="About the hostel"
      >
        <View className="gap-3 pb-2">
          <Input
            hint={
              hostel.nameChangeCount > 0
                ? `Renamed ${hostel.nameChangeCount} time(s) already. Once the limit is reached this becomes a change request.`
                : undefined
            }
            label="Name"
            onChangeText={(name) => setForm((prev) => ({ ...prev, name }))}
            value={form.name ?? ""}
          />
          <Select
            label="Who it is for"
            onChange={(hostelType) => setForm((prev) => ({ ...prev, hostelType }))}
            options={HOSTEL_TYPE_OPTIONS}
            value={form.hostelType ?? null}
          />
          <Input
            hint="Up to 2000 characters. This is the first thing a visitor reads."
            label="Description"
            multiline
            onChangeText={(description) => setForm((prev) => ({ ...prev, description }))}
            style={{ height: 132 }}
            value={form.description ?? ""}
          />
          <Input
            hint="Descriptive only — rooms are a flat list, not grouped by floor."
            keyboardType="number-pad"
            label="Floors"
            onChangeText={(totalFloors) => setForm((prev) => ({ ...prev, totalFloors }))}
            value={form.totalFloors ?? ""}
          />
        </View>
      </Sheet>

      {/* ------------------------------------------------------------------ */}
      <Sheet
        footer={
          <Button
            label="Save"
            loading={saving}
            onPress={() =>
              void patch(
                {
                  contact: {
                    email: form.email?.trim() || undefined,
                    phone: form.phone?.trim() || undefined,
                  },
                },
                "Contact saved",
              )
            }
          />
        }
        onClose={() => setPanel(null)}
        open={panel === "contact"}
        title="Contact"
      >
        <View className="gap-3 pb-2">
          <Input
            hint="Shown on the public listing as a tap-to-call."
            keyboardType="phone-pad"
            label="Phone"
            onChangeText={(phone) => setForm((prev) => ({ ...prev, phone }))}
            value={form.phone ?? ""}
          />
          <Input
            autoCapitalize="none"
            hint="Kept private. Inbound mail goes through the inquiry form instead."
            keyboardType="email-address"
            label="Email"
            onChangeText={(email) => setForm((prev) => ({ ...prev, email }))}
            value={form.email ?? ""}
          />
        </View>
      </Sheet>

      {/* ------------------------------------------------------------------ */}
      <Sheet
        footer={
          <Button
            label="Save"
            loading={saving}
            onPress={() =>
              void patch(
                {
                  location: {
                    address: form.address?.trim() || undefined,
                    area: form.area?.trim() || undefined,
                    city: form.city?.trim() || undefined,
                    lat: form.lat ? Number(form.lat) : undefined,
                    lng: form.lng ? Number(form.lng) : undefined,
                    province: form.province?.trim() || undefined,
                  },
                },
                "Location saved",
              )
            }
          />
        }
        onClose={() => setPanel(null)}
        open={panel === "location"}
        title="Location"
      >
        <View className="gap-3 pb-2">
          <Input
            hint="A place name, a pasted Google Maps link, or a raw lat,lng."
            label="Find it"
            onChangeText={setGeoQuery}
            onSubmitEditing={() => void searchPlaces()}
            placeholder="Baluwatar, Kathmandu"
            returnKeyType="search"
            value={geoQuery}
          />

          <Button
            label="Search"
            loading={geoBusy}
            onPress={() => void searchPlaces()}
            size="sm"
            variant="outline"
          />

          {geoHits.map((hit) => (
            <Pressable
              accessibilityRole="button"
              className="rounded-xl border border-border p-3 active:opacity-70"
              key={`${hit.lat},${hit.lng}`}
              onPress={() => {
                setForm((prev) => ({
                  ...prev,
                  address: hit.address ?? prev.address,
                  area: hit.area ?? prev.area,
                  city: hit.city ?? prev.city,
                  lat: String(hit.lat),
                  lng: String(hit.lng),
                  province: hit.province ?? prev.province,
                }));
                setGeoHits([]);
              }}
            >
              <Text numberOfLines={2}>{hit.displayName ?? `${hit.lat}, ${hit.lng}`}</Text>
              <Text variant="caption">{`${hit.lat.toFixed(5)}, ${hit.lng.toFixed(5)}`}</Text>
            </Pressable>
          ))}

          <Input
            label="Area"
            onChangeText={(area) => setForm((prev) => ({ ...prev, area }))}
            value={form.area ?? ""}
          />
          <Input
            label="City"
            onChangeText={(city) => setForm((prev) => ({ ...prev, city }))}
            value={form.city ?? ""}
          />
          <Input
            label="Street address"
            onChangeText={(address) => setForm((prev) => ({ ...prev, address }))}
            value={form.address ?? ""}
          />
          <Input
            label="Province"
            onChangeText={(province) => setForm((prev) => ({ ...prev, province }))}
            value={form.province ?? ""}
          />

          <Text variant="caption">
            {form.lat && form.lng
              ? `Pinned at ${form.lat}, ${form.lng}. Saving re-checks what is nearby.`
              : "No pin yet — searching above sets one, and the listing map needs it."}
          </Text>
        </View>
      </Sheet>

      {/* ------------------------------------------------------------------ */}
      <Sheet
        footer={
          <Button
            label="Save"
            loading={saving}
            onPress={() =>
              void patch(
                {
                  pricing: {
                    admissionFee: form.admissionFee ? toNumber(form.admissionFee) : undefined,
                    monthlyRentMax: form.monthlyRentMax
                      ? toNumber(form.monthlyRentMax)
                      : undefined,
                    monthlyRentMin: form.monthlyRentMin
                      ? toNumber(form.monthlyRentMin)
                      : undefined,
                  },
                },
                "Pricing saved",
              )
            }
          />
        }
        onClose={() => setPanel(null)}
        open={panel === "pricing"}
        title="Pricing"
      >
        <View className="gap-3 pb-2">
          <Text variant="caption">
            The range shown on the public listing and in search filters. Per-room-type
            rent is set on the Rooms screen and is what a resident is actually billed.
          </Text>
          <Input
            keyboardType="number-pad"
            label="Cheapest room (NPR)"
            onChangeText={(monthlyRentMin) => setForm((prev) => ({ ...prev, monthlyRentMin }))}
            value={form.monthlyRentMin ?? ""}
          />
          <Input
            keyboardType="number-pad"
            label="Dearest room (NPR)"
            onChangeText={(monthlyRentMax) => setForm((prev) => ({ ...prev, monthlyRentMax }))}
            value={form.monthlyRentMax ?? ""}
          />
          <Input
            keyboardType="number-pad"
            label="Admission fee (NPR)"
            onChangeText={(admissionFee) => setForm((prev) => ({ ...prev, admissionFee }))}
            value={form.admissionFee ?? ""}
          />
        </View>
      </Sheet>

      {/* ------------------------------------------------------------------ */}
      <Sheet
        footer={
          <Button
            label="Save"
            loading={saving}
            onPress={() =>
              void patch(
                panel === "rules" ? { rules: listDraft } : { facilities: listDraft },
                panel === "rules" ? "Rules saved" : "Facilities saved",
              )
            }
          />
        }
        onClose={() => setPanel(null)}
        open={panel === "facilities" || panel === "rules"}
        title={panel === "rules" ? "House rules" : "Facilities"}
      >
        <View className="gap-3 pb-2">
          <View className="flex-row items-end gap-2">
            <View className="flex-1">
              <Input
                label={panel === "rules" ? "Add a rule" : "Add a facility"}
                onChangeText={setListEntry}
                onSubmitEditing={() => {
                  const entry = listEntry.trim();

                  if (entry) {
                    setListDraft((prev) => [...prev, entry]);
                    setListEntry("");
                  }
                }}
                placeholder={panel === "rules" ? "No guests after 9pm" : "Hot water"}
                returnKeyType="done"
                value={listEntry}
              />
            </View>
            <Button
              label="Add"
              onPress={() => {
                const entry = listEntry.trim();

                if (entry) {
                  setListDraft((prev) => [...prev, entry]);
                  setListEntry("");
                }
              }}
            />
          </View>

          <View className="flex-row flex-wrap gap-2">
            {listDraft.map((entry, index) => (
              <Chip
                icon="close-circle-outline"
                key={`${entry}-${index}`}
                label={entry}
                onPress={() =>
                  setListDraft((prev) => prev.filter((_, position) => position !== index))
                }
                tone="brand"
              />
            ))}
          </View>

          {listDraft.length === 0 ? (
            <Text variant="muted">Nothing listed yet.</Text>
          ) : (
            <Text variant="caption">Tap one to remove it.</Text>
          )}
        </View>
      </Sheet>

      {/* ------------------------------------------------------------------ */}
      <Sheet
        footer={<Button label="Save" loading={saving} onPress={() => void saveAttendance()} />}
        onClose={() => setPanel(null)}
        open={panel === "attendance"}
        title="Geofence and retention"
      >
        {attendanceDraft ? (
          <View className="gap-3 pb-2">
            <Input
              hint="10–500 m. Inside this circle counts as being in the hostel."
              keyboardType="number-pad"
              label="Inside radius (m)"
              onChangeText={(value) =>
                setAttendanceDraft((prev) =>
                  prev ? { ...prev, insideZoneRadiusMeters: toNumber(value) } : prev,
                )
              }
              value={String(attendanceDraft.insideZoneRadiusMeters)}
            />
            <Input
              hint="20–2000 m, and it must be larger than the inside radius."
              keyboardType="number-pad"
              label="Nearby radius (m)"
              onChangeText={(value) =>
                setAttendanceDraft((prev) =>
                  prev ? { ...prev, nearbyZoneRadiusMeters: toNumber(value) } : prev,
                )
              }
              value={String(attendanceDraft.nearbyZoneRadiusMeters)}
            />
            <Input
              hint="Up to six, as HH:mm, separated by commas."
              label="Check-in times"
              onChangeText={(value) =>
                setAttendanceDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        pingTimes: value
                          .split(",")
                          .map((time) => time.trim())
                          .filter(Boolean)
                          .slice(0, 6),
                      }
                    : prev,
                )
              }
              placeholder="06:00, 22:00"
              value={attendanceDraft.pingTimes.join(", ")}
            />
            <Input
              hint="1–90. How many days away before the hostel and the guardian are told."
              keyboardType="number-pad"
              label="Alert after (days)"
              onChangeText={(value) =>
                setAttendanceDraft((prev) =>
                  prev ? { ...prev, absenceAlertDays: toNumber(value) } : prev,
                )
              }
              value={String(attendanceDraft.absenceAlertDays)}
            />
            <Input
              hint="30–1095. Older check-in rows are deleted."
              keyboardType="number-pad"
              label="Keep records for (days)"
              onChangeText={(value) =>
                setAttendanceDraft((prev) =>
                  prev ? { ...prev, retentionDays: toNumber(value) } : prev,
                )
              }
              value={String(attendanceDraft.retentionDays)}
            />
          </View>
        ) : null}
      </Sheet>

      {/* ------------------------------------------------------------------ */}
      <Sheet
        footer={
          <Button label="Send it" loading={saving} onPress={() => void submitChangeRequest()} />
        }
        onClose={() => setPanel(null)}
        open={panel === "change"}
        title="Request a change"
      >
        <View className="gap-3 pb-2">
          <Text variant="caption">
            These three cannot be edited directly once a hostel is approved — they are
            what the platform verified. A person reads the request and confirms by
            email.
          </Text>

          <Select
            label="What should change"
            onChange={setChangeType}
            options={CHANGE_TYPES}
            value={changeType}
          />

          <Input
            label="It should be"
            onChangeText={(requestedValue) => setForm((prev) => ({ ...prev, requestedValue }))}
            value={form.requestedValue ?? ""}
          />

          <Input
            hint="Optional, but it is what the reviewer reads first."
            label="Why"
            multiline
            onChangeText={(reason) => setForm((prev) => ({ ...prev, reason }))}
            style={{ height: 96 }}
            value={form.reason ?? ""}
          />
        </View>
      </Sheet>
    </Screen>
  );
}
