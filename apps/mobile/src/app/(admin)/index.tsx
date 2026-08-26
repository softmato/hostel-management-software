import { router } from "expo-router";
import { useCallback, useMemo } from "react";
import { View } from "react-native";

import {
  AlertCard,
  DeniedNotice,
  useAdminAlerts,
  useAlertActions,
} from "@/components/admin-alerts";
import {
  AdminHomeHeader,
  HostelHero,
  QuickActions,
  ServiceGrid,
  WaitingActions,
} from "@/components/admin-home";
import { SectionHeader } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ROLE } from "@/constants/roles";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useAppSelector } from "@/hooks/redux";
import { useResource } from "@/hooks/use-resource";
import {
  type AdminHostel,
  type AdminPeriodSummary,
  type AdminReport,
  getAdminHostel,
  getAdminPeriodSummary,
  getAdminReport,
} from "@/lib/admin-api";
import { buildAlertFeed, occupancyRate } from "@/lib/admin-alerts";
import { earningsSummary, listingState, monthOverMonth } from "@/lib/admin-home";

/**
 * The hostel at a glance — and the first screen a hostel owner ever sees.
 *
 * ## What changed, and the complaint it answers
 *
 * The previous Home was a correct screen that nobody could read: an app bar, a
 * card with one number in it, and then four grids of bordered boxes — nine
 * tiles and eleven rows, every one of them the same weight, in the same grey
 * rectangle, with no answer to "what am I looking at". An owner who is not a
 * software person opened it and had to *study* it.
 *
 * It is now shaped like the thing these people already use every day, which is
 * a mobile banking app: a painted header carrying the identity and the money,
 * a row of shortcuts straddling its edge, and then a short body of things that
 * want a decision. Nothing was invented to fill it — every figure below comes
 * from a route the portal already serves.
 *
 * ## Three questions, in this order
 *
 * 1. **Whose hostel is this and what has it earned** — the hero. Lifetime
 *    collections lead, because that is the number a phone can give that a
 *    laptop is currently the only way to get. Residents / vacant / occupancy
 *    ride along inside it: context, never a tap target.
 * 2. **What can I do from here** — four shortcuts, pinned to the fold.
 * 3. **What is waiting for me** — the queue, then this month's money, then
 *    tonight, then the listing.
 *
 * ## It is still not the web dashboard
 *
 * Fee schedules, billing runs, reconciliation, warden management, room config
 * and nine report views stay in the browser and are reached from More. What
 * this screen adds over the previous one is *depth on what it already showed*,
 * not breadth.
 *
 * ## Those counts come from the queues, not from the dashboard report
 *
 * `report.complaints` is every complaint the hostel has ever had, settled ones
 * included, and `report.maintenanceRequests` is every non-deleted request in
 * any status. Under a heading saying "what is open right now" both were quietly
 * wrong, in the direction that makes an owner stop trusting the screen. The
 * rows read the live queues instead — the same data the tab badges show.
 *
 * ## SOS is in the hero, above the money
 *
 * Unchanged in substance and stronger in placement: the alarm is a white strip
 * inside the gradient, which cannot be scrolled past because it is above the
 * fold by construction, and the acknowledge control is on the card immediately
 * below. Two surfaces on purpose — the alarm has to be seen, the decision needs
 * the resident's name and message next to it.
 */
type Overview = {
  hostel: AdminHostel | null;
  /** Null when the caller's role has no `viewPayments` grant. */
  periods: AdminPeriodSummary | null;
  report: AdminReport;
};

async function loadOverview(): Promise<Overview> {
  const [report, hostel, periods] = await Promise.all([
    getAdminReport(),
    // A warden may be scoped to several hostels, in which case the profile read
    // needs a hostelId it has no way to choose. The numbers above still apply
    // across all of them, so the header simply loses its name.
    getAdminHostel().catch(() => null),
    /*
     * Tolerant for a different reason: `viewPayments` is a per-warden grant, so
     * this is the one read here that a legitimate user can be refused. Falling
     * back rather than failing keeps the rest of the screen — see
     * `earningsSummary`, which decides what the hero says without it.
     */
    getAdminPeriodSummary().catch(() => null),
  ]);

  return { hostel, periods, report };
}

export default function AdminHomeScreen() {
  // Read for one decision only: whether the shortcut row's lead cell is the
  // Store or roll call. See the `onStore` note on `<QuickActions>` below.
  const account = useAppSelector((state) => state.auth.account);
  const overview = useResource<Overview>(useCallback(() => loadOverview(), []), {
    topics: [
      REALTIME_TOPIC.PAYMENTS,
      REALTIME_TOPIC.RESIDENTS,
      REALTIME_TOPIC.COMPLAINTS,
      REALTIME_TOPIC.SAFETY,
    ],
  });

  const alerts = useAdminAlerts();
  const actions = useAlertActions();

  const sosRows = useMemo(
    () =>
      buildAlertFeed({
        claims: [],
        complaints: [],
        inquiries: [],
        sos: alerts.data?.sos ?? [],
      }),
    [alerts.data],
  );

  const report = overview.data?.report ?? null;
  const periods = overview.data?.periods ?? null;

  const earnings = useMemo(
    () =>
      earningsSummary({
        months: periods?.months ?? null,
        overall: periods?.overall ?? null,
        report: report ?? { monthlyDues: 0, paidAmount: 0 },
      }),
    [periods, report],
  );

  const delta = useMemo(() => monthOverMonth(periods?.months ?? []), [periods]);

  /*
   * Read before the guards below, because the header is drawn in all three
   * states and needs them. Both are null-tolerant: `listingState(null)` is
   * `{ live: false }`, so a header built mid-load simply has no eye on it yet.
   */
  const hostel = overview.data?.hostel ?? null;
  const listing = listingState(hostel);

  /*
   * The same fixed bar in every state, including the two that have no data to
   * draw. It is what makes a slow first load look like the app arriving rather
   * than like a blank screen with a spinner on it.
   */
  const header = (
    <AdminHomeHeader
      /*
       * Only once the listing is actually live. `getPublicHostelBySlug` matches
       * on `PUBLISHED` + `VERIFIED` and 404s otherwise, so handing this button
       * to an owner whose application is still in review would answer "show me
       * my hostel" with "Hostel was not found". `listing.note` is already on the
       * hero saying which of the two it is waiting on.
       */
      onPreview={
        listing.live && hostel
          ? () => router.push(`/hostel/${hostel.slug}`)
          : undefined
      }
    />
  );

  if (overview.loading) {
    return (
      <Screen header={header} insideTabs>
        <LoadingState label="Loading your hostel" />
      </Screen>
    );
  }

  if (overview.error || !overview.data || !report) {
    return (
      <Screen header={header} insideTabs>
        <ErrorState
          message={overview.error ?? "The dashboard could not be loaded."}
          onRetry={overview.reload}
        />
      </Screen>
    );
  }

  return (
    <>
      <Screen
        header={header}
        insideTabs
        onRefresh={() => {
          overview.refresh();
          alerts.refresh();
        }}
        padded={false}
        refreshing={overview.refreshing || alerts.refreshing}
        scroll
      >
        <HostelHero
          delta={delta}
          earnings={earnings}
          hostel={hostel}
          listing={listing}
          occupancy={occupancyRate(report)}
          onSos={() => router.push("/(admin)/alerts")}
          residents={report.residents}
          sosCount={sosRows.length}
          vacantBeds={report.vacantBeds}
        />

        {/*
          Its own row now, not pulled up onto the card's shoulder. The straddle
          needed a full-width painted edge to straddle, and the hero stopped
          having one when it became an object with corners.
        */}
        <View className="pt-3">
          <QuickActions
            onNewResident={() => router.push("/manage/resident/new")}
            /*
             * The camera, not a search box. Everything about this action happens
             * with a card in one hand and the phone in the other, which is why
             * it took the slot `Post notice` had: see `QuickActions`.
             */
            /*
             * The fallback for the lead cell, and a warden's own nightly job.
             * `QuickActions` uses it whenever `onStore` is absent.
             *
             * Every shortcut here opens the screen that *owns* its job, and this
             * is the rule's original case: roll call used to push
             * `(admin)/today` and rely on somebody finding the roster inside a
             * digest screen.
             */
            onRollCall={() => router.push("/manage/roll-call")}
            onScan={() => router.push("/manage/scan")}
            /*
             * HOSTEL_ADMIN only. The store's routes are
             * `requireHostelAdminPrincipal` — spending the hostel's budget is
             * not what a warden's permissions are about — so a warden gets roll
             * call in this cell rather than a tile that 403s.
             *
             * The **group**, not `(store)/index`: pushing the group lets
             * expo-router pick its initial route, so the store opens on its Shop
             * tab with the bar already drawn. Pushing the screen directly would
             * mount it outside the tab navigator and lose the bar entirely.
             */
            onStore={
              account?.role === ROLE.HOSTEL_ADMIN
                ? () => router.push("/(store)")
                : undefined
            }
          />
        </View>

        <View className="gap-6 px-5 pt-6">
          {sosRows.length > 0 ? (
            <View className="gap-3">
              {sosRows.map((row) => (
                <AlertCard actions={actions} key={row.id} row={row} />
              ))}
            </View>
          ) : null}

          <View>
            {/*
              One card of four, not four cards of one.

              This started as five full-width rows in a bordered card, became a
              two-by-two grid of separately bordered tiles, and is now the same
              object as the shortcut row that sits directly above it:
              `WaitingActions` and `QuickActions` are both an `ActionCard` with
              four icon cells in it, differing only in that these carry a count.

              Each step was the same correction. The question this section
              answers is "is anything waiting, and roughly how much", which is a
              *looking* question — and every bit of chrome that made it four
              separate objects, or gave each one a sentence of explanation, was
              turning a glance back into a read.
            */}
            {/*
              No "See all". Every cell in the card below opens the screen that
              owns its queue, and the bell in the header opens the combined feed
              — a third path to the same places, sitting on the heading of a row
              that is already nothing but paths, was chrome.
            */}
            <SectionHeader title="Waiting for you" />

            <DeniedNotice denied={alerts.data?.denied ?? []} />

            <WaitingActions
              claims={alerts.counts.claim}
              inquiries={alerts.counts.inquiry}
              onClaims={() => router.push("/(admin)/money")}
              onInquiries={() => router.push("/(admin)/residents")}
              /*
                `manage/notices` opens on its list with a "Write a notice"
                floating button, so the time-sensitive case — water off until
                4pm — is one tap past this cell. It carries no badge because a
                notice is written rather than queued; the complaint count it
                replaced now lives in the Manage grid below and on Today.
              */
              onNotice={() => router.push("/manage/notices")}
              /*
                No badge on this one: Today is a **door**, not a queue — roll
                call, complaints, maintenance, the menu and notices — and there
                is no single number that means "how much of that is waiting".
              */
              onToday={() => router.push("/(admin)/today")}
            />
          </View>

          <View>
            {/*
              Where the rest of the product is, and where Home stops.

              Six sections stood here — this month's collection, the trend, what
              is still owed, tonight's roster, the listing's view counts — and
              every one of them is the *summary* of a screen that is one tap
              away and shows the same thing properly. A home screen whose job is
              to get you somewhere had turned into three scrolls of somewhere
              else's figures.

              The trend chart moved to Money, which is the screen it belongs to.
              Nothing else moved because nothing else needed to: Money, Today and
              `manage/settings` were already drawing all of it.
            */}
            <SectionHeader title="Manage" />

            <ServiceGrid onOpen={(href: string) => router.push(href as never)} />
          </View>
        </View>
      </Screen>

      {actions.sheet}
    </>
  );
}
