import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useState } from "react";
import { Linking, Platform, Pressable, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { MealRow } from "@/components/meal-row";
import { NotificationBell } from "@/components/notification-bell";
import { Chip, Grid, InfoTile, StatTile } from "@/components/ui/layout";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Money } from "@/components/ui/money";
import { Screen } from "@/components/ui/screen";
import {
  Skeleton,
  SkeletonCard,
  SkeletonTiles,
} from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import { residentQuery } from "@/lib/resident-queries";
import { API_BASE_URL } from "@/lib/api";
import { readApiError } from "@/lib/api-contract";
import { openAssetViewer } from "@/lib/asset-viewer";
import {
  formatDate,
  formatDueLabel,
  formatPeriod,
  formatRelativeDay,
  greetingFor,
  humanizeEnum,
} from "@/lib/format";
import { absoluteMediaUrl } from "@/lib/media";
import {
  type NightStatus,
  openQuestionCall,
  type ResidentDashboard,
  type RoutineMeal,
} from "@/lib/resident-api";
import { toastError } from "@/lib/toast";

/**
 * The resident's home.
 *
 * ## One request
 *
 * It used to be two. `GET /resident/dashboard` returned `nightStatus` as a
 * hardcoded `{ status: "UNKNOWN", checkedAt: null }` — a value the enum does
 * not even contain, written by nothing — so this screen fetched
 * `/resident/night-status` alongside it and ignored the dashboard's copy. Its
 * `complaints` block was the literal `{ openCount: 0, recent: [] }`, and a
 * confident zero on a resident with three open complaints is worse than an
 * absent card, so it was not rendered at all.
 *
 * `resident-dashboard.service.ts` reads both properly as of 2026-08-17, so the
 * second request is gone and complaints render. The absent night status is
 * `NOT_VERIFIED`, which is a real answer, not a missing one.
 *
 * ## Ordering, against `resident-dashboard-page.tsx` (§5.1)
 *
 * The web leads with a full-width hostel photo. **Here the money leads.** A
 * resident opens this app to pay rent or to read a notice; they already know
 * which building they live in, so a 200dp photo of it above the fold is the
 * marketing row this project has cut twice before — while pushing the one
 * actionable number below the first screenful.
 *
 * What the photo card *is* worth keeping is the part a phone does better than a
 * browser: the hostel's phone number and email are one tap from a call, so they
 * become chips and the photo shrinks to a thumbnail beside them.
 *
 * Ported from the web in this pass: **the hostel contact card** (phone, email,
 * public page), **notice previews** (the web shows two lines of the body; the
 * rows here showed only a category), and **QuestionCall**, which existed on the
 * web for students and was entirely absent from mobile.
 *
 * Deliberately **not** ported: the web's "Unread notices" metric and its "New"
 * badge. `serializeNotice` on the dashboard emits no `isRead` field at all, so
 * `!notice.isRead` is true for every notice and the web marks all of them new.
 * Repeating that would be repeating a bug. The unread count comes back the day
 * the serializer carries the flag.
 */

/**
 * The web offers Payments, Notices, Complaints, SOS and Reviews here. Payments
 * and Notices are **tabs** on this app — a shortcut to the tab you can already
 * see is a wasted target — so this row is the three the web has that mobile has
 * nowhere else, plus the digital ID, which is the thing a resident is asked to
 * produce at a gate.
 */
const QUICK_ACTIONS = [
  { href: "/complaints", icon: "chatbox-ellipses-outline", label: "Complaints" },
  { href: "/id-card", icon: "card-outline", label: "Digital ID" },
  { href: "/review", icon: "star-outline", label: "Review" },
  { href: "/sos", icon: "alert-circle-outline", label: "SOS", tone: "danger" },
] as const;

export default function ResidentHomeScreen() {
  const account = useAppSelector((state) => state.auth.account);

  /*
   * Live, which no resident screen was.
   *
   * Every `(admin)` screen names its topics and this group named none — so the
   * socket was connected app-wide in `_layout.tsx`, publishing to a resident who
   * had subscribed to nothing. A notice posted while the app was open, a claim
   * approved by the office, a warden replying to a complaint: none of it moved
   * this screen until the resident pulled to refresh or left and came back.
   *
   * Five topics because this one payload is five domains — `feeStatus`,
   * `notices`, `complaints`, `foodMenu` and `nightStatus` — and all five are
   * genuinely published to `private-hostel-<id>`, which a resident's principal
   * is granted through its own `hostelIds`. Naming a topic nothing publishes
   * would be decoration; these were checked against the services that emit them.
   *
   * The refetch is silent by `useResource`'s design: the screen does not blank
   * under somebody who is reading it.
   */
  const query = residentQuery.dashboard();
  const home = useResource<ResidentDashboard>(query.load, {
    cacheKey: query.key,
    topics: query.topics,
  });

  const dashboard = home.data;
  const firstName = dashboard?.resident.firstName ?? account?.name?.split(" ")[0] ?? "";

  /*
   * The bell, which this group did not have.
   *
   * `/notifications` is scoped to `principal.userId` with no role branch, so a
   * resident has always had a feed — payment reminders, notice broadcasts, the
   * reply to a complaint. Nothing in these five tabs opened it: there was no
   * bell on any of them, and More's "Notifications" row pushed `/settings`,
   * which is the *preferences* screen. So the feed was reachable by a push
   * banner and by nothing else, and a banner that has been swiped away is gone.
   *
   * On every tab rather than only here, matching `(admin)`: a control that
   * disappears when you change tab is one you stop trusting to be there.
   */
  const header = (
    <AppBar
      actions={<NotificationBell />}
      subtitle={dashboard?.hostel?.name ?? undefined}
      title={firstName ? `${greetingFor()}, ${firstName}` : greetingFor()}
    />
  );

  if (home.loading) {
    return (
      /*
        Skeletons, not a spinner — the house rule this group was not following.
        The shape is known before the data is: a dues card, a strip of three
        tiles, the hostel, then sections. Drawing it means nothing moves when the
        figures land, and the first thing a resident's eye goes to — the amount
        outstanding — is already in the place it will end up.
      */
      <Screen header={header} insideTabs scroll>
        <View className="gap-4 pt-1">
          <View className="gap-3 rounded-2xl border border-border bg-card p-4">
            <Skeleton height={11} width="28%" />
            <Skeleton height={30} radius={10} width="55%" />
            <Skeleton height={12} width="42%" />
            <Skeleton height={44} radius={14} />
          </View>

          <SkeletonTiles />
          <SkeletonCard rows={1} />
          <SkeletonCard rows={3} />
        </View>
      </Screen>
    );
  }

  if (home.error || !dashboard) {
    return (
      <Screen header={header} insideTabs>
        <ErrorState
          message={home.error ?? "Your dashboard could not be loaded."}
          onRetry={home.reload}
        />
      </Screen>
    );
  }

  return (
    <Screen
      header={header}
      insideTabs
      onRefresh={home.refresh}
      refreshing={home.refreshing}
      scroll
    >
      <View className="gap-4 pt-1">
        <DuesCard feeStatus={dashboard.feeStatus} />

        <StatStrip
          complaints={dashboard.complaints}
          nightStatus={dashboard.nightStatus}
          notices={dashboard.notices}
        />

        <HostelCard
          hostel={dashboard.hostel}
          moveInDate={dashboard.resident.moveInDate}
          roomType={dashboard.accommodation.roomType}
        />

        <TodaysMenuCard meals={dashboard.foodMenu} />

        <NoticesCard notices={dashboard.notices} />

        <ComplaintsCard complaints={dashboard.complaints} />

        <QuickActions />

        {/*
          Students only — a working professional has no use for it, and the API
          repeats the check (403 `QUESTIONCALL_NOT_ELIGIBLE`), so hiding the card
          is presentation rather than the gate.
        */}
        {(dashboard.resident.residentType ?? "STUDENT") === "STUDENT" ? (
          <QuestionCallCard />
        ) : null}
      </View>
    </Screen>
  );
}

function DuesCard({ feeStatus }: { feeStatus: ResidentDashboard["feeStatus"] }) {
  const owes = feeStatus.dueAmount > 0;
  const latest = feeStatus.latestPayment;
  const dueLabel = formatDueLabel(latest?.dueDate);

  return (
    <Card className="gap-3">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text variant="caption">{owes ? "Outstanding" : "Balance"}</Text>
          <Money owed size="display" value={feeStatus.dueAmount} />
          {/*
            The web's `unpaidCount` was on the dashboard payload all along and
            drawn nowhere here. It is the difference between "you owe NPR 17,000"
            and "you owe NPR 17,000 across two months", which is the question
            anybody asks next.
          */}
          {owes && feeStatus.unpaidCount > 1 ? (
            <Text variant="caption">Across {feeStatus.unpaidCount} unpaid invoices</Text>
          ) : null}
        </View>

        {feeStatus.pendingProofs > 0 ? (
          <Badge
            label={
              feeStatus.pendingProofs === 1
                ? "1 claim in review"
                : `${feeStatus.pendingProofs} claims in review`
            }
            tone="warning"
          />
        ) : null}
      </View>

      {latest ? (
        <View className="flex-row flex-wrap items-center gap-2">
          <Text variant="muted">{formatPeriod(latest.month)}</Text>
          <StatusPill status={latest.status} />
          {/*
            The due label is the actionable half: "NPR 8,500 outstanding" is a
            fact, "4 days overdue" is a reason to open the tab.
          */}
          {dueLabel ? <Text variant="caption">{dueLabel}</Text> : null}
        </View>
      ) : null}

      <Button
        label={owes ? "Pay now" : "View payments"}
        onPress={() => router.push("/(resident)/payments")}
        variant={owes ? "primary" : "outline"}
      />
    </Card>
  );
}

/**
 * The three numbers worth a glance, as the mockup's metric strip.
 *
 * `<Grid>` decides how many fit: three across on any ordinary phone, two on a
 * 320dp screen where three would truncate "Night status" to "Night s…".
 *
 * The night-status tile replaced a full-width card. Its note ("checked, in
 * room") does not survive the move and is not reproduced here — a tile carries
 * one line, and the note belongs on the screen that owns it, which this tile
 * links to.
 */
function StatStrip({
  complaints,
  nightStatus,
  notices,
}: {
  complaints: ResidentDashboard["complaints"];
  nightStatus: NightStatus;
  notices: ResidentDashboard["notices"];
}) {
  const urgent = notices.filter((notice) => notice.isUrgent).length;

  return (
    <Grid gap={10} maxColumns={3} minCellWidth={104}>
      <StatTile
        icon="megaphone-outline"
        label="Notices"
        onPress={() => router.push("/(resident)/notices")}
        tone={urgent > 0 ? "danger" : "brand"}
        // Not "unread": the dashboard's notices carry no read flag. Urgent is a
        // field the serializer does emit, and is the one worth counting anyway.
        trend={urgent > 0 ? `${urgent} urgent` : "Nothing urgent"}
        value={String(notices.length)}
      />

      <StatTile
        icon="chatbox-ellipses-outline"
        label="Complaints"
        onPress={() => router.push("/complaints")}
        tone={complaints.openCount > 0 ? "warning" : "success"}
        trend={complaints.openCount > 0 ? "Still open" : "All resolved"}
        value={String(complaints.openCount)}
      />

      <StatTile
        icon="moon-outline"
        label="Night status"
        onPress={() => router.push("/night-status")}
        tone={nightStatus.status === "VERIFIED" ? "success" : "neutral"}
        trend={
          nightStatus.checkedAt
            ? `Checked ${formatRelativeDay(nightStatus.checkedAt)}`
            : "Not checked in"
        }
        value={humanizeEnum(nightStatus.status)}
      />
    </Grid>
  );
}

/**
 * Where you live, and how to reach it.
 *
 * The web's version is a banner with a 320dp-wide photo. Shrunk to a thumbnail
 * here, for the reason in the file header — and the thumbnail is tappable, so
 * the photo is still available full-screen through the global asset viewer to
 * anyone who wants it.
 */
function HostelCard({
  hostel,
  moveInDate,
  roomType,
}: {
  hostel: ResidentDashboard["hostel"];
  moveInDate: string;
  roomType: string;
}) {
  const { colors } = useAppTheme();
  const photo = absoluteMediaUrl(hostel?.photoUrl, API_BASE_URL);
  const address = [hostel?.location.address, hostel?.location.area, hostel?.location.city]
    .filter(Boolean)
    .join(", ");

  return (
    <Card className="gap-3">
      <View className="flex-row items-center gap-3">
        {photo ? (
          <Pressable
            accessibilityLabel={`Photo of ${hostel?.name ?? "your hostel"}`}
            accessibilityRole="imagebutton"
            className="active:opacity-80"
            onPress={() =>
              openAssetViewer([{ caption: address || undefined, title: hostel?.name, url: photo }])
            }
          >
            <Image
              contentFit="cover"
              source={{ uri: photo }}
              style={{
                backgroundColor: colors.muted,
                borderRadius: 14,
                height: 64,
                width: 64,
              }}
              transition={150}
            />
          </Pressable>
        ) : (
          <View
            className="h-16 w-16 items-center justify-center rounded-2xl"
            style={{ backgroundColor: colors.brandSoft }}
          >
            <Ionicons color={colors.primary} name="business-outline" size={26} />
          </View>
        )}

        <View className="flex-1 gap-1">
          <Text numberOfLines={1} variant="subtitle">
            {hostel?.name ?? "Your hostel"}
          </Text>
          {address ? (
            <View className="flex-row items-center gap-1">
              <Ionicons color={colors.mutedForeground} name="location-outline" size={12} />
              <Text className="flex-1" numberOfLines={2} variant="caption">
                {address}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {/*
        Chips rather than the web's rows of text. A phone number here is one tap
        to a call and an email is one tap to a draft — the browser version is a
        number you have to copy. Residents are placed by room *type*, not by room
        number, so that is all the accommodation detail there is to show.
      */}
      <View className="flex-row flex-wrap gap-2">
        <Chip icon="bed-outline" label={humanizeEnum(roomType)} />
        <Chip icon="calendar-outline" label={`Since ${formatDate(moveInDate)}`} />

        {hostel?.contact.phone ? (
          <Chip
            icon="call-outline"
            label={hostel.contact.phone}
            onPress={() => void Linking.openURL(`tel:${hostel.contact.phone}`)}
            tone="brand"
          />
        ) : null}

        {hostel?.contact.email ? (
          <Chip
            icon="mail-outline"
            label={hostel.contact.email}
            onPress={() => void Linking.openURL(`mailto:${hostel.contact.email}`)}
          />
        ) : null}

        {hostel?.slug ? (
          <Chip
            icon="open-outline"
            label="Hostel page"
            onPress={() => router.push(`/hostel/${hostel.slug}`)}
          />
        ) : null}
      </View>
    </Card>
  );
}

/**
 * Only when there is something to say.
 *
 * A resident who has never complained does not need a card telling them so. The
 * rows became pressable in M5.2, when `/complaints/[id]` started existing — the
 * dashboard's cut of a complaint carries no thread and no attachments, so the row
 * is a pointer into the real screen rather than a summary that tries to be one.
 */
function ComplaintsCard({
  complaints,
}: {
  complaints: ResidentDashboard["complaints"];
}) {
  if (complaints.openCount === 0 && complaints.recent.length === 0) {
    return null;
  }

  return (
    <View>
      <SectionHeader
        action={
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.push("/complaints")}
          >
            <Text className="text-primary" variant="label">
              See all
            </Text>
          </Pressable>
        }
        subtitle={
          complaints.openCount === 1
            ? "1 still open"
            : `${complaints.openCount} still open`
        }
        title="Your complaints"
      />

      <Card>
        {complaints.recent.map((complaint, index) => (
          <View key={complaint.id}>
            {index > 0 ? <RowDivider /> : null}
            <ListRow
              onPress={() => router.push(`/complaints/${complaint.id}`)}
              right={
                complaint.isOverdue ? (
                  <Badge label="Overdue" tone="danger" />
                ) : (
                  <StatusPill status={complaint.status} />
                )
              }
              subtitle={`${humanizeEnum(complaint.category)} · ${formatRelativeDay(
                complaint.createdAt,
              )}`}
              title={complaint.title}
            />
          </View>
        ))}
      </Card>
    </View>
  );
}

/**
 * Today's meals, in the mockup's arrangement: a soft icon square, the meal, its
 * timing as a badge on the right, and the items underneath.
 *
 * The items get two lines rather than one. A `<ListRow>` subtitle truncates, and
 * "Rice, dal, seasonal vegetable, chicken curry, pickle" is exactly the string
 * that gets cut at the part somebody cares about.
 */
function TodaysMenuCard({ meals }: { meals: RoutineMeal[] }) {
  return (
    <View>
      <SectionHeader
        action={
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.push("/(resident)/food")}
          >
            <Text className="text-primary" variant="label">
              All meals
            </Text>
          </Pressable>
        }
        subtitle="From this week's routine"
        title="Today's food"
      />

      <Card className="gap-2">
        {meals.length === 0 ? (
          <Text variant="muted">No menu published for today yet.</Text>
        ) : (
          meals.map((meal) => (
            <MealRow
              items={meal.items}
              key={meal.mealType}
              mealType={meal.mealType}
              note={meal.note}
              timing={meal.timing}
            />
          ))
        )}
      </Card>
    </View>
  );
}

/**
 * The web shows two lines of each notice's body under its title, and this screen
 * showed only "Category · 3 days ago" — which for a notice titled "Water supply"
 * leaves out the half that says when the water is off. Ported.
 */
function NoticesCard({ notices }: { notices: ResidentDashboard["notices"] }) {
  return (
    <View>
      <SectionHeader
        action={
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.push("/(resident)/notices")}
          >
            <Text className="text-primary" variant="label">
              See all
            </Text>
          </Pressable>
        }
        title="Latest notices"
      />

      <Card className="gap-2">
        {notices.length === 0 ? (
          <Text variant="muted">Nothing from your hostel right now.</Text>
        ) : (
          notices.slice(0, 3).map((notice) => (
            <Pressable
              accessibilityRole="button"
              className="gap-1 rounded-xl border border-border px-3 py-2.5 active:opacity-70"
              key={notice.id}
              onPress={() => router.push("/(resident)/notices")}
            >
              <View className="flex-row items-start justify-between gap-2">
                <Text className="flex-1" numberOfLines={2} variant="label">
                  {notice.title}
                </Text>
                {notice.isUrgent ? <Badge label="Urgent" tone="danger" /> : null}
              </View>

              {notice.content ? (
                <Text numberOfLines={2} variant="muted">
                  {notice.content}
                </Text>
              ) : null}

              <Text variant="caption">
                {`${humanizeEnum(notice.category)} · ${formatRelativeDay(notice.publishedAt)}`}
              </Text>
            </Pressable>
          ))
        )}
      </Card>
    </View>
  );
}

function QuickActions() {
  return (
    <Grid gap={10} maxColumns={4} minCellWidth={78}>
      {QUICK_ACTIONS.map((action) => (
        <InfoTile
          icon={action.icon}
          key={action.href}
          label={action.label}
          onPress={() => router.push(action.href)}
          tone={"tone" in action ? action.tone : "brand"}
        />
      ))}
    </Grid>
  );
}

/**
 * The study-partner hand-off, which existed on the web and nowhere on mobile.
 *
 * Opened in an in-app browser rather than the system one: the resident is two
 * taps from a tutor and should come back to the app with the back gesture, not
 * find themselves in Chrome with the app dropped from the recents stack.
 */
function QuestionCallCard() {
  const { colors } = useAppTheme();
  const [busy, setBusy] = useState(false);

  const open = useCallback(async () => {
    setBusy(true);

    try {
      // Not "web": the server validates the enum, and a wrong value is a 400 on
      // a card that otherwise looks like it worked.
      const { redirectUrl } = await openQuestionCall(Platform.OS === "ios" ? "ios" : "android");

      await WebBrowser.openBrowserAsync(redirectUrl);
    } catch (caught) {
      toastError("Could not open QuestionCall", readApiError(caught, ""));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <Card className="gap-3">
      <View className="flex-row items-start gap-3">
        <View
          className="h-10 w-10 items-center justify-center rounded-xl"
          style={{ backgroundColor: colors.brandSoft }}
        >
          <Ionicons color={colors.primary} name="school-outline" size={20} />
        </View>

        <View className="flex-1 gap-1">
          <Text variant="label">Ask questions, get answers</Text>
          <Text variant="muted">
            QuestionCall connects students with tutors. Your name and hostel are shared
            so you can sign in without filling another form.
          </Text>
        </View>
      </View>

      <Button
        label="Open QuestionCall"
        loading={busy}
        onPress={() => void open()}
        variant="outline"
      />
    </Card>
  );
}
