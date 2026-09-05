import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useMemo, useState } from "react";
import { Linking, Platform, Pressable, View } from "react-native";

import { MealRow } from "@/components/meal-row";
import {
  ResidentHomeHeader,
  ResidentQuickActions,
  ResidentServiceGrid,
  ResidentStayHero,
  ResidentWaitingActions,
} from "@/components/resident-home";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import { API_BASE_URL } from "@/lib/api";
import { readApiError } from "@/lib/api-contract";
import { formatDueLabel, humanizeEnum } from "@/lib/format";
import { absoluteMediaUrl } from "@/lib/media";
import {
  openQuestionCall,
  type ResidentDashboard,
  type RoutineMeal,
} from "@/lib/resident-api";
import { duesLine, stayPill } from "@/lib/resident-home";
import { prefetchResidentRoute, residentQuery } from "@/lib/resident-queries";
import { toastError } from "@/lib/toast";

/**
 * The resident's home.
 *
 * ## It is the admin Home now, with a resident's subject
 *
 * The two screens had drifted into two products: the admin's is a painted
 * account card under the platform lockup, with a shortcut row straddling the
 * fold, a card of queues and a grid of doors; this was an app bar with a
 * greeting, a bordered dues card, a strip of three metric tiles, a hostel card
 * with a photo thumbnail and a wrap of chips, and then four sections. Same
 * palette, same components, two different ideas of what a home screen is.
 *
 * It is now the same object. `<PortalHeroCard>` and `ui/action-grid.tsx` are
 * literally the same components both roles draw, so the card's corner radius,
 * the column pitch and the badge rules cannot drift apart again. What differs is
 * the content, which is the whole of the difference between the two roles — see
 * the table in `components/resident-home.tsx`.
 *
 * ## What each of the old objects became
 *
 * | was | is |
 * | --- | --- |
 * | `AppBar` with a greeting | the platform lockup, bell and hostel-page eye |
 * | `DuesCard` — amount, pill, due label, button | the hero, with `Pay now` on the figure |
 * | `StatStrip` — three metric tiles | four cells of `Waiting for you`, counts only |
 * | `HostelCard` — photo, address, chips | the hero's ground, its name line, `Call hostel` |
 * | `ComplaintsCard` — a summary of a screen | the `Complaints` cell's badge |
 * | `QuickActions` — Complaints, ID, Review, SOS | the shortcut row and the `Your stay` grid |
 *
 * Nothing was dropped that carried a fact. The complaints *summary* went for the
 * reason the admin Home lost six sections of figures: a home screen whose job is
 * to get you somewhere had become a shorter, worse copy of the screen one tap
 * away. The open count is on the cell that opens it.
 *
 * ## What is still below the fold, and why
 *
 * **Today's food** and **the latest notices**, in that order. Neither is a
 * summary of a screen you can reach in one tap and read properly — a resident
 * checks what is for dinner *here*, without going anywhere, and a notice's first
 * two lines are the whole notice most days. They are the two things this app is
 * opened for that are not money, so they sit between the queues and the grid.
 *
 * ## One request
 *
 * It used to be two. `GET /resident/dashboard` returned `nightStatus` as a
 * hardcoded `{ status: "UNKNOWN", checkedAt: null }` — a value the enum does not
 * even contain — so this screen fetched `/resident/night-status` alongside it.
 * `resident-dashboard.service.ts` reads both properly as of 2026-08-17, so the
 * second request is gone. The absent night status is `NOT_VERIFIED`, which is a
 * real answer, not a missing one.
 *
 * Deliberately **not** ported from the web: its "Unread notices" metric and its
 * "New" badge. `serializeNotice` emits no `isRead` field at all, so
 * `!notice.isRead` is true for every notice and the web marks all of them new.
 * The count comes back the day the serializer carries the flag; until then the
 * `Notices` cell counts the urgent ones, which is a field that does exist.
 */

export default function ResidentHomeScreen() {
  const dates = useDates();

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
   * is granted through its own `hostelIds`.
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
  const hostel = dashboard?.hostel ?? null;

  /*
   * The bell and the eye, on the bar in all three states.
   *
   * `/notifications` is scoped to `principal.userId` with no role branch, so a
   * resident has always had a feed — payment reminders, notice broadcasts, the
   * reply to a complaint. Before the bell, nothing in these five tabs opened it:
   * More's "Notifications" row pushed `/settings`, the *preferences* screen, so
   * the feed was reachable by a push banner and by nothing else — and a banner
   * that has been swiped away is gone.
   *
   * Drawn in the loading and error states too, which is what makes a slow first
   * load look like the app arriving rather than a blank screen with a spinner.
   */
  const header = (
    <ResidentHomeHeader
      onHostelPage={
        hostel?.slug ? () => router.push(`/hostel/${hostel.slug}`) : undefined
      }
    />
  );

  const stay = useMemo(
    () =>
      dashboard
        ? stayPill(dashboard.nightStatus)
        : { label: "Not checked in", settled: false },
    [dashboard],
  );

  const duesNote = useMemo(() => {
    if (!dashboard) {
      return "";
    }

    /*
      `nextDue`, not `latestPayment`.

      The date and the month have to describe the invoice the resident should
      act on, which is the **earliest unsettled** one — and `latestPayment` is
      the opposite of that by construction: the invoice due furthest in the
      future, settled ones included. Pairing it with a total summed across every
      unpaid invoice printed "Across 2 unpaid invoices · Due in 27 days" at
      somebody whose older invoice had been overdue for a month.

      It falls back to `latestPayment` only when nothing is unsettled, where
      there is no date to be wrong about and the month is all the line uses.
    */
    const due = dashboard.feeStatus.nextDue ?? dashboard.feeStatus.latestPayment;

    return duesLine({
      dueAmount: dashboard.feeStatus.dueAmount,
      dueLabel: formatDueLabel(due?.dueDate),
      pendingProofs: dashboard.feeStatus.pendingProofs,
      periodLabel: due ? dates.period(due.month) : null,
      unpaidCount: dashboard.feeStatus.unpaidCount,
    });
  }, [dashboard, dates]);

  if (home.loading) {
    return (
      /*
        Skeletons, not a spinner — the house rule this group was not following.
        The shape is known before the data is, and it is the shape the screen
        actually lands in: a painted card, a row of shortcuts, a row of queues,
        then sections. Drawing it means nothing moves when the figures arrive.
      */
      <Screen header={header} insideTabs padded={false} scroll>
        {/* `px-3.5` is 14 points — `HERO_INSET`, so the card lands where it will. */}
        <View className="px-3.5">
          <Skeleton height={190} radius={18} />
        </View>

        <View className="px-5 pt-3">
          <Skeleton height={96} radius={24} />
        </View>

        <View className="gap-6 px-5 pt-6">
          <View className="gap-3">
            <Skeleton height={18} width="45%" />
            <Skeleton height={96} radius={24} />
          </View>

          <SkeletonCard rows={2} />

          <View className="gap-3">
            <Skeleton height={18} width="45%" />
            <Skeleton height={172} radius={24} />
          </View>
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

  const phone = hostel?.contact.phone;
  const urgentNotices = dashboard.notices.filter((notice) => notice.isUrgent).length;

  return (
    <Screen
      header={header}
      insideTabs
      onRefresh={home.refresh}
      padded={false}
      refreshing={home.refreshing}
      scroll
    >
      <ResidentStayHero
        deposit={dashboard.resident.depositAmount}
        dueAmount={dashboard.feeStatus.dueAmount}
        duesNote={duesNote}
        hostelName={hostel?.name ?? null}
        onNightStatus={() => router.push("/night-status")}
        onNotices={() => router.push("/(resident)/notices")}
        onPay={() => router.push("/(resident)/payments")}
        photoUrl={absoluteMediaUrl(hostel?.photoUrl, API_BASE_URL)}
        /*
          The card's "account number": what a resident is asked at the office, in
          the order they are asked it. Two props rather than one joined string,
          because the card gives each a row of its own — see the note there.

          Residents are placed by room *type*, not by room number, so that is all
          the accommodation detail there is to show.
        */
        roomLabel={humanizeEnum(dashboard.accommodation.roomType)}
        sinceLabel={dates.date(dashboard.resident.moveInDate)}
        stay={stay}
        urgentCount={urgentNotices}
      />

      {/*
        Its own row, not pulled up onto the card's shoulder. The straddle needs a
        full-width painted edge to straddle, and the hero has corners.
      */}
      <View className="pt-3">
        <ResidentQuickActions
          /*
            Only when the listing carries a number. A cell that dials nothing is
            worse than a missing cell — see `<ResidentQuickActions>`.
          */
          onCall={phone ? () => void Linking.openURL(`tel:${phone}`) : undefined}
          onIdCard={() => router.push("/id-card")}
          onRaiseIssue={() => router.push("/complaints/new")}
        />
      </View>

      <View className="gap-6 px-5 pt-6">
        <View>
          {/*
            No "See all". Every cell in the card below opens the screen that owns
            its queue, and the bell in the header opens the feed — a third path
            to the same places, on the heading of a row that is nothing but
            paths, was chrome.
          */}
          <SectionHeader title="Waiting for you" />

          <ResidentWaitingActions
            complaints={dashboard.complaints.openCount}
            invoices={dashboard.feeStatus.unpaidCount}
            onComplaints={() => router.push("/complaints")}
            onInvoices={() => router.push("/(resident)/payments")}
            onNightStatus={() => router.push("/night-status")}
            onNotices={() => router.push("/(resident)/notices")}
            urgentNotices={urgentNotices}
          />
        </View>

        <TodaysMenuCard meals={dashboard.foodMenu} />

        <NoticesCard notices={dashboard.notices} />

        <View>
          <SectionHeader title="Your stay" />

          {/* Touch-down warms the screen the tile opens, where there is one. */}
          <ResidentServiceGrid
            onOpen={(href: string) => router.push(href as never)}
            onPrefetch={prefetchResidentRoute}
          />
        </View>

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
            /*
              Food is a push rather than a tab since Statement took its slot, so
              its read is no longer warmed at the door — this is the tap that
              warms it, on the same `onPressIn` the `Your stay` grid uses.
            */
            onPressIn={() => prefetchResidentRoute("/(resident)/food")}
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
  const dates = useDates();

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
                {`${humanizeEnum(notice.category)} · ${dates.relativeDay(notice.publishedAt)}`}
              </Text>
            </Pressable>
          ))
        )}
      </Card>
    </View>
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
      const { redirectUrl } = await openQuestionCall(
        Platform.OS === "ios" ? "ios" : "android",
      );

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
