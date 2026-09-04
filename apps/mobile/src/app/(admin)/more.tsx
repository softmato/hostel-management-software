import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, View } from "react-native";

import { NotificationBell } from "@/components/notification-bell";
import { AppBar } from "@/components/ui/app-bar";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { CardRow, ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import type { AdminHostel } from "@/lib/admin-api";
import { adminQuery, prefetchAdminRoute } from "@/lib/admin-queries";
import { endSession } from "@/lib/auth-session";
import { prefetchCommunity } from "@/lib/community-queries";
import { readableRole } from "@/constants/roles";
import { setThemePreference } from "@/store/slices/uiSlice";

/**
 * More — the doors that are not tabs.
 *
 * ## It used to be a browser
 *
 * This section was called *Manage on the web*: eight rows, each one
 * `WebBrowser.openBrowserAsync` into `/{slug}/admin/...`, and a paragraph here
 * arguing that a phone could not do "nine columns". The owner overruled it on
 * 2026-08-21 and was right — nine columns is a desktop *layout*, not a feature
 * list, and a row that leaves the app is not an app screen. Every one of them is
 * now native, under `app/manage/` (tasks.md §12).
 *
 * `lib/web-portal.ts` survives for nothing on this screen. Before adding a link
 * back to it, note that the argument it encodes has already been tried once.
 *
 * ## The rows overlap the tabs on purpose
 *
 * Money, Residents and Today cover the part of Finance, Residents and Operations
 * a phone does *while walking* — verifying a claim, calling somebody who has not
 * paid, marking a roll call, publishing a notice. These rows are the *rest* of
 * those sections: the rates the invoices are computed from, the room inventory,
 * the reports. The subtitles say which half you are getting.
 */
const MANAGE_ROWS: {
  href: string;
  icon: keyof typeof Ionicons.glyphMap;
  subtitle: string;
  title: string;
}[] = [
  {
    href: "/manage/finance",
    icon: "cash-outline",
    subtitle: "Rate cards, the billing run, payment setup and reconciliation",
    title: "Finance",
  },
  {
    /*
      The one row in this list with no tile in Home's `ServiceGrid`, and the
      divergence is deliberate: Home reaches the ledger from "Waiting for you",
      four cells above where the tile would sit, and two doors to one screen
      inside a single scroll is what that row's own rules forbid. This screen has
      no "Waiting for you", so here it is a row like any other.
    */
    href: "/manage/finance/statement",
    icon: "receipt-outline",
    subtitle: "Every payment received, day by day, searchable and exportable",
    title: "Statement",
  },
  {
    href: "/(admin)/residents",
    icon: "people-outline",
    subtitle: "Register, move in and out, activation codes, guardians",
    title: "Residents",
  },
  {
    /*
      Added when the Store took roll call's cell in Home's shortcut row. This
      list and Home's `ServiceGrid` are the same destinations in the same order,
      bar the `Statement` row above — a tile added there is a row added here in
      the same breath, or a hostel owner ends up learning two maps of one
      product.
    */
    href: "/manage/roll-call",
    icon: "moon-outline",
    subtitle: "Who is in tonight, who is out, and who has not been verified",
    title: "Roll call",
  },
  {
    /*
      Today *is* the complaint queue — the section under the roll call is the
      whole of it, replies included — so this row opens it rather than a screen
      of its own. It moved here off Home's "Waiting for you" card; see
      `WaitingActions` for the trade that made.
    */
    href: "/(admin)/today",
    icon: "chatbox-ellipses-outline",
    subtitle: "What residents have raised, and what is still unanswered",
    title: "Complaints",
  },
  {
    href: "/manage/rooms",
    icon: "bed-outline",
    subtitle: "Room types, beds, vacancies and their photos",
    title: "Rooms",
  },
  {
    href: "/manage/notices",
    icon: "megaphone-outline",
    subtitle: "Schedule, target and expire a notice",
    title: "Notices",
  },
  {
    href: "/manage/food",
    icon: "restaurant-outline",
    subtitle: "The weekly menu, meal times and the cook's login",
    title: "Food",
  },
  {
    href: "/manage/maintenance",
    icon: "construct-outline",
    subtitle: "The repair queue, its notes, and the approved providers",
    title: "Maintenance",
  },
  {
    href: "/manage/reports",
    icon: "bar-chart-outline",
    subtitle: "Collection, occupancy, complaints, roll call, food and growth",
    title: "Reports",
  },
  {
    href: "/manage/settings",
    icon: "settings-outline",
    subtitle: "Hostel profile, photos, wardens and the hostel-wide switches",
    title: "Settings",
  },
];

export default function AdminMoreScreen() {
  const account = useAppSelector((state) => state.auth.account);
  const preference = useAppSelector((state) => state.ui.themePreference);
  const dispatch = useAppDispatch();
  const { colors } = useAppTheme();
  /*
   * The same key Home reads, so whichever of the two loads first fills in the
   * other. It is also in the portal's warm-up, which is why this screen's header
   * is usually already named by the time it is opened.
   */
  const query = adminQuery.hostel();
  const hostel = useResource<AdminHostel | null>(query.load, {
    cacheKey: query.key,
    topics: query.topics,
  });
  const [signingOut, setSigningOut] = useState(false);

  const signOut = useCallback(() => {
    Alert.alert("Sign out?", "You'll need your password to get back in.", [
      { style: "cancel", text: "Cancel" },
      {
        onPress: () => {
          setSigningOut(true);
          void endSession().finally(() => router.replace("/(browse)"));
        },
        style: "destructive",
        text: "Sign out",
      },
    ]);
  }, []);

  const nextTheme = preference === "dark" ? "light" : "dark";

  const area = [hostel.data?.location.area, hostel.data?.location.city]
    .filter(Boolean)
    .join(", ");

  return (
    <Screen
      header={<AppBar actions={<NotificationBell />} title="More" />}
      insideTabs
      onRefresh={hostel.refresh}
      refreshing={hostel.refreshing}
      scroll
    >
      {/*
        Deliberately the calmest screen in the group, and the only one with no
        coloured object on it at all.

        Every other admin tab leads with something painted, because each of them
        is *about* a live figure — money collected, who is accounted for, what is
        waiting. This one is a list of doors, and a settings page that opens with
        a saturated banner is a settings page shouting about itself. What it
        leads with instead is the account, which is the one thing this screen
        genuinely needs to state: half the rows below can be refused by a
        capability, and this is what says which account is being refused.
      */}
      <View className="gap-5 pt-1">
        <Card className="flex-row items-center gap-3">
          <Avatar name={hostel.data?.name ?? account?.name} size="lg" />

          <View className="flex-1 gap-1">
            <Text numberOfLines={1} variant="subtitle">
              {hostel.data?.name ?? account?.name ?? "Your hostel"}
            </Text>

            <Text numberOfLines={1} variant="caption">
              {[account ? readableRole(account.role) : null, account?.email]
                .filter(Boolean)
                .join(" · ")}
            </Text>

            {area ? (
              <View className="flex-row items-center gap-1">
                <Ionicons color={colors.mutedForeground} name="location-outline" size={11} />
                <Text className="flex-1" numberOfLines={1} variant="caption">
                  {area}
                </Text>
              </View>
            ) : null}

            {/*
              Both flags, and both only when a single hostel resolved. They fail
              differently and a reader has to be able to tell which: `DRAFT` is
              the owner's own doing and they fix it in Settings, whereas
              pending verification is on the platform and no amount of editing
              moves it.
            */}
            {hostel.data ? (
              <View className="flex-row flex-wrap gap-1.5 pt-0.5">
                <Badge
                  label={hostel.data.status === "PUBLISHED" ? "Published" : "Draft"}
                  tone={hostel.data.status === "PUBLISHED" ? "success" : "warning"}
                />
                <Badge
                  label={
                    hostel.data.verificationStatus === "VERIFIED"
                      ? "Verified"
                      : "Awaiting verification"
                  }
                  tone={hostel.data.verificationStatus === "VERIFIED" ? "success" : "warning"}
                />
              </View>
            ) : null}
          </View>
        </Card>

        {/*
          Eight separate cards, not eight rows in one.

          A bordered box around a list is a claim that the things inside it
          belong together, and these do not: Finance, Rooms, Food and Reports
          share nothing but a screen. Inside one card with hairlines between them
          they read as a table to be worked down in order. As separate cards with
          air between them they read as what they are — a shelf of doors, and you
          want exactly one.

          The tinted square in front of each is doing the real work. It is the
          same green on all eight rather than eight different tints: the glyph
          tells them apart, and a colour per door would be inventing eight
          meanings the app does not otherwise have.
        */}
        <View>
          <SectionHeader
            subtitle="Everything the portal does, without leaving the app"
            title="Manage"
          />
          <View className="gap-3">
            {MANAGE_ROWS.map((row) => (
              <CardRow
                icon={row.icon}
                key={row.href}
                onPress={() => router.push(row.href)}
                // Same trigger as Home's Manage grid, which lists these same
                // eight doors — see `prefetchAdminRoute`.
                onPressIn={() => prefetchAdminRoute(row.href)}
                subtitle={row.subtitle}
                title={row.title}
              />
            ))}
          </View>
        </View>

        <View>
          <SectionHeader title="Discover" />
          <Card padding="px-4 py-1">
            <ListRow
              icon="search-outline"
              onPress={() => router.push("/hostels")}
              subtitle="See your listing the way a student does"
              title="Browse hostels"
            />
            <RowDivider inset />
            <ListRow
              icon="people-outline"
              onPress={() => router.push("/community")}
              /*
                The same trigger the Manage rows above use, pointed at the one
                registry that is not `admin-queries.ts`: the board is
                platform-wide, so `prefetchAdminRoute` deliberately does not know
                this route. See `lib/community-queries.ts`.
              */
              onPressIn={prefetchCommunity}
              subtitle="What residents are saying, platform-wide"
              title="Community"
            />
          </Card>
        </View>

        <View>
          <SectionHeader title="App" />
          <Card padding="px-4 py-1">
            <ListRow
              icon={preference === "dark" ? "moon-outline" : "sunny-outline"}
              onPress={() => dispatch(setThemePreference(nextTheme))}
              subtitle={`Currently ${preference}`}
              title="Theme"
              value={`Switch to ${nextTheme}`}
            />
            <RowDivider inset />
            <ListRow
              icon="notifications-outline"
              onPress={() => router.push("/notifications")}
              subtitle="Everything the platform has sent you"
              title="Notifications"
            />
            <RowDivider inset />
            <ListRow
              icon="shield-checkmark-outline"
              onPress={() => router.push("/settings")}
              subtitle="Privacy policy and account deletion"
              title="Privacy & account"
            />
          </Card>
        </View>

        <Card padding="px-4 py-1">
          <ListRow
            icon="log-out-outline"
            onPress={signOut}
            right={
              <Ionicons
                color={colors.destructive}
                name={signingOut ? "hourglass-outline" : "chevron-forward"}
                size={18}
              />
            }
            title="Sign out"
          />
        </Card>
      </View>
    </Screen>
  );
}
