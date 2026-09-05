import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Linking, View } from "react-native";

import { NotificationBell } from "@/components/notification-bell";
import { AppBar } from "@/components/ui/app-bar";
import { Avatar } from "@/components/ui/avatar";
import { StatusPill } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/layout";
import { CardRow, ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import {
  prefetchResidentRoute,
  type ResidentMore,
  residentQuery,
} from "@/lib/resident-queries";
import { endSession } from "@/lib/auth-session";
import { prefetchCommunity } from "@/lib/community-queries";
import { humanizeEnum } from "@/lib/format";
import { setThemePreference } from "@/store/slices/uiSlice";

/**
 * Everything that is not a tab.
 *
 * ## The menus are a shelf of cards, not a table of rows
 *
 * This screen used to draw sixteen `<ListRow>`s inside three `<Card>`s, seven of
 * them in the first one. A bordered box around a list is a claim that the things
 * inside it belong together, and Profile, Night status, Complaints and the Offer
 * Program do not — they share a screen and nothing else. Inside one card with
 * hairlines between them they read as a table to be worked down in order, and
 * `NOTES.md` §3 is blunt about it: a menu of destinations is never full-width
 * rows of sentences.
 *
 * `(admin)/more.tsx` had the same problem and fixed it first, so the fix here is
 * that one rather than a second invention: **`<CardRow>`** — each door its own
 * card, a tinted glyph square in front of it, air in between. That component's
 * own doc comment carries the argument in full. The two portals' More screens
 * are now the same object with different doors on it, which is the whole of what
 * "the resident app should read as clean as the hostel-admin app" asks for.
 *
 * The tint is the same brand green on every one of them, as it is on admin's.
 * The glyph tells them apart, and a colour per door would be inventing eleven
 * meanings the app does not otherwise have — the four *tones* it does have are
 * spent on Home's queue cells, where a colour genuinely carries a state.
 *
 * ## What stayed a hairline group, and why
 *
 * **App**. Those four are not doors — they are one switch and three views of
 * this account's preferences, and a card around them is a true claim rather than
 * a false one. Same split as admin: the menu on a shelf, the settings in a box.
 *
 * ## Every row opens a real screen, as of M5.9
 *
 * This file used to carry a `soon()` helper that toasted "it lands in the next
 * release" for the M5 entries — a row that navigates nowhere is indistinguishable
 * from a bug, and one that explains itself is a roadmap. All of them now navigate:
 * **complaints** (`/complaints`), **night status** (`/night-status`), **profile**
 * (`/profile`), the **digital ID** (`/id-card`), **community** (`/community`),
 * **referrals** (`/referrals`), **reviews** (`/review`) and both App rows
 * (`/settings`). The helper is gone with them.
 *
 * If a later milestone wants a row listed before its screen exists, bring `soon()`
 * back rather than pointing the row at nothing.
 *
 * **Explore** is the discovery entry (agreed 2026-08-16): residents keep their
 * own five tabs, and hostel browsing lives here rather than taking a tab from
 * rent, meals or notices.
 */

/**
 * The doors, in the order Home's `<ResidentServiceGrid>` draws them.
 *
 * That grid's own doc comment is explicit that the two lists are the same list —
 * "More is the exhaustive list with a sentence of explanation on each; this is
 * the same list with the explanations off" — so a tile added there is a row
 * added here in the same breath, or a resident ends up learning two maps of one
 * product. The three More has that the grid does not (Night status, Complaints,
 * Digital ID) are on Home too, as cells of the queue row and the shortcut row:
 * doors here, queues there, which is the difference between the two screens
 * rather than a divergence between the two lists.
 */
const STAY_ROWS: {
  href: string;
  icon: keyof typeof Ionicons.glyphMap;
  subtitle: string;
  title: string;
}[] = [
  {
    href: "/profile",
    icon: "person-outline",
    subtitle: "Personal details, guardians, emergency contacts",
    title: "Profile",
  },
  {
    href: "/night-status",
    icon: "moon-outline",
    // Replaced at render by tonight's actual answer when there is one — see
    // `nightSubtitle`. A menu row that can state a fact should state it.
    subtitle: "Tell your hostel you're in for the night",
    title: "Night status",
  },
  {
    /*
      Directly under Night status, because they are the same subject from
      opposite ends: what the resident *says* about their night, and what their
      phone *reported*. A resident who wonders "how does my hostel know?" is
      looking at one of these two rows when the question occurs to them, and the
      answer should be the next one down.
    */
    href: "/attendance",
    icon: "location-outline",
    subtitle: "What has been recorded, and switching it off",
    title: "Location & attendance",
  },
  {
    /*
      Its own row rather than only a link inside Profile. Sharing your record
      with a parent is a decision people revisit — after a fee goes unpaid, after
      an argument — and having to remember it lives two screens deep under
      "Profile" is how a resident ends up leaving access switched on for somebody
      they meant to remove.
    */
    href: "/guardians",
    icon: "shield-outline",
    subtitle: "Who can see your record, and exactly what they see",
    title: "Guardians",
  },
  {
    href: "/complaints",
    icon: "chatbox-ellipses-outline",
    subtitle: "Raise an issue and follow it to resolution",
    title: "Complaints",
  },
  {
    href: "/id-card",
    icon: "card-outline",
    subtitle: "Your hostel identity card",
    title: "Digital ID",
  },
  {
    /*
      Under "Your stay" rather than "Discover": the programme is something a
      resident is already in, not something to go and find. `/offer-program` —
      the public explainer — stays where it is, on the Profile tab, because that
      one is written for somebody who has not signed in.
    */
    href: "/offer-program/mine",
    icon: "ribbon-outline",
    subtitle: "Your reference codes and certified receipts",
    title: "Offer Program",
  },
];

const DISCOVER_ROWS: {
  href: string;
  icon: keyof typeof Ionicons.glyphMap;
  subtitle: string;
  title: string;
}[] = [
  {
    /*
      Discovery lives here, not in a tab (agreed 2026-08-16): someone who already
      has a bed opens the app to pay rent or read a notice.
    */
    href: "/hostels",
    icon: "search-outline",
    subtitle: "Browse and compare hostels across Nepal",
    title: "Explore hostels",
  },
  {
    /*
      One community for everyone — signed out, public account, resident, staff —
      which is why it is a root-stack screen rather than something inside a
      role's tabs. See `community.service.ts`.
    */
    href: "/community",
    icon: "people-outline",
    subtitle: "Ask, answer and see what other residents are saying",
    title: "Community",
  },
  {
    href: "/referrals",
    icon: "gift-outline",
    subtitle: "Share your code with a friend",
    title: "Refer a friend",
  },
  {
    href: "/review",
    icon: "star-outline",
    subtitle: "Rate food, cleanliness and safety",
    title: "Review your hostel",
  },
];

export default function ResidentMoreScreen() {
  const dates = useDates();
  const account = useAppSelector((state) => state.auth.account);
  const preference = useAppSelector((state) => state.ui.themePreference);
  const dispatch = useAppDispatch();
  const { colors } = useAppTheme();
  /*
    The loader moved to `lib/resident-queries.ts` so the warm-up and this screen
    run the same request under the same key — otherwise the prefetch warms a key
    nobody reads and More loads twice. `safety` is the topic because the
    night-status subtitle is the one value on this menu a warden can change from
    the roll-call screen.
  */
  const query = residentQuery.more();
  const more = useResource<ResidentMore>(query.load, {
    cacheKey: query.key,
    topics: query.topics,
  });
  const [signingOut, setSigningOut] = useState(false);

  const profile = more.data?.profile;
  const resident = profile?.resident;

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

  const nightSubtitle = more.data?.nightStatus
    ? humanizeEnum(more.data.nightStatus.status)
    : null;

  return (
    <Screen
      header={
        /*
          `large`, which the resident tabs did not set and the admin tabs did —
          so the same job was titled at 16 points in one role and 22 in the
          other. A tab is a destination and its name is a page heading; see the
          prop's own note. Notices keeps the 16-point bar because it is reached
          by a push and carries a back arrow, which is the distinction the prop
          is actually drawing.
        */
        <AppBar actions={<NotificationBell />} large title="More" />
      }
      insideTabs
      onRefresh={more.refresh}
      refreshing={more.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <Card className="gap-3">
          <View className="flex-row items-center gap-3">
            {/*
              The shared `<Avatar>`, not a local initial circle. It already
              handles the case this screen has to handle anyway — an account
              with a Google photo, one with none, and one whose photo URL exists
              but cannot be drawn — and it colours the fallback the same way the
              same person is coloured in Community.
            */}
            <Avatar name={resident?.fullName ?? account?.name} size="lg" uri={account?.image} />

            <View className="flex-1">
              <Text variant="subtitle">
                {resident?.fullName ?? account?.name ?? "Your account"}
              </Text>
              <Text variant="caption">
                {resident?.email || account?.email || resident?.phone || ""}
              </Text>
            </View>

            {resident ? <StatusPill status={resident.status} /> : null}
          </View>

          {profile?.hostel ? (
            <View className="gap-2 border-t border-border pt-3">
              <Text variant="label">{profile.hostel.name}</Text>

              {/*
                Chips rather than a joined sentence, matching the dashboard's
                hostel card — and the phone number becomes a tap-to-call, which
                is the whole reason a phone shows contact details at all.
              */}
              <View className="flex-row flex-wrap gap-2">
                <Chip
                  icon="bed-outline"
                  label={humanizeEnum(profile.accommodation.roomType)}
                />
                {resident ? (
                  <Chip
                    icon="calendar-outline"
                    label={`Since ${dates.date(resident.moveInDate)}`}
                  />
                ) : null}
                {profile.hostel.contact.phone ? (
                  <Chip
                    icon="call-outline"
                    label={profile.hostel.contact.phone}
                    onPress={() =>
                      void Linking.openURL(`tel:${profile.hostel?.contact.phone}`)
                    }
                    tone="brand"
                  />
                ) : null}
              </View>
            </View>
          ) : null}
        </Card>

        <View>
          <SectionHeader
            subtitle="Your record, and who else can see it"
            title="Your stay"
          />
          <View className="gap-3">
            {STAY_ROWS.map((row) => (
              <CardRow
                icon={row.icon}
                key={row.href}
                onPress={() => router.push(row.href)}
                // Same trigger as Home's `Your stay` grid, pointed at the same
                // registry — see `prefetchResidentRoute`. A row it does not know
                // simply loads the way it always did.
                onPressIn={() => prefetchResidentRoute(row.href)}
                subtitle={
                  row.href === "/night-status"
                    ? (nightSubtitle ?? row.subtitle)
                    : row.subtitle
                }
                title={row.title}
              />
            ))}
          </View>
        </View>

        <View>
          <SectionHeader
            subtitle="The rest of the platform, from inside your stay"
            title="Discover"
          />
          <View className="gap-3">
            {DISCOVER_ROWS.map((row) => (
              <CardRow
                icon={row.icon}
                key={row.href}
                onPress={() => router.push(row.href)}
                /*
                  Community is the one destination here with a warm-up, and it is
                  deliberately not in `prefetchResidentRoute`: the board is
                  platform-wide, so it belongs to `lib/community-queries.ts`
                  rather than to any one role's registry. Same divergence
                  `(admin)/more.tsx` carries.
                */
                onPressIn={
                  row.href === "/community"
                    ? prefetchCommunity
                    : () => prefetchResidentRoute(row.href)
                }
                subtitle={row.subtitle}
                title={row.title}
              />
            ))}
          </View>
        </View>

        <View>
          <SectionHeader title="App" />
          {/*
            `px-4 py-1`, which this screen did not pass and admin's does. The
            default `p-4` on a card whose rows already carry their own `py-3`
            adds 16 points of inset above the first row and below the last, so
            the same group of settings stood 32 points taller in this portal than
            in the other one — see `<Card>`'s note on why the padding is one slot
            rather than something `className` can override.
          */}
          <Card padding="px-4 py-1">
            <ListRow
              icon={preference === "dark" ? "moon-outline" : "sunny-outline"}
              onPress={() => dispatch(setThemePreference(nextTheme))}
              subtitle={`Currently ${preference}`}
              title="Theme"
              value={`Switch to ${nextTheme}`}
            />
            <RowDivider inset />
            {/*
              Three rows, three destinations.

              This block used to be two rows that both pushed a bare
              `/settings` — two subtitles promising two different things, and one
              screen delivering whichever half happened to be scrolled to. Worse,
              the row *called* "Notifications" went to the preferences screen,
              so the notification **feed** had no entry point in this group at
              all; see the bell in this screen's app bar.

              So: the feed is its own row, and the two settings rows name their
              `section`, which is the parameter `app/settings.tsx` already reads
              to draw one half. Same fix, same reasoning as `(browse)/profile.tsx`.
            */}
            <ListRow
              icon="notifications-outline"
              onPress={() => router.push("/notifications")}
              subtitle="Everything your hostel and the platform have sent you"
              title="Notifications"
            />
            <RowDivider inset />
            <ListRow
              icon="options-outline"
              onPress={() =>
                router.push({
                  params: { section: "notifications" },
                  pathname: "/settings",
                })
              }
              // Was "…and why you cannot pick yet", which stopped being true
              // when the preference model shipped (§3.2). A row that describes
              // a screen it no longer matches is worse than no subtitle.
              subtitle="Choose what reaches you, and set quiet hours"
              title="Notification settings"
            />
            <RowDivider inset />
            <ListRow
              icon="shield-checkmark-outline"
              onPress={() =>
                router.push({
                  params: { section: "privacy" },
                  pathname: "/settings",
                })
              }
              subtitle="Your data, and closing your account"
              title="Privacy & your data"
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
