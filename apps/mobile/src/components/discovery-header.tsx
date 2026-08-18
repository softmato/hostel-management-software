import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { IdCardPrompt } from "@/components/id-card-prompt";
import { Text } from "@/components/ui/text";
import { APP_NAME, APP_NAME_PARTS } from "@/constants/branding";
import { useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import { useSystemInsets } from "@/hooks/use-system-insets";
import { idCardNoun, idCardTypeForAccount } from "@/lib/id-card";
import { listNotifications, type NotificationFeed } from "@/lib/notifications-api";

/**
 * The home screen's top bar: who you are, the bell, and the search field.
 *
 * ## Why this is not `<AppBar>`
 *
 * `AppBar` is a title, an optional subtitle and a slot — one row, no leading
 * avatar and no second row. This bar leads with a face and carries the search
 * field underneath it, which is the whole shape of the mockup's header. Bending
 * `AppBar` into both would give every screen in the app a set of props only this
 * one uses.
 *
 * What it does copy from `AppBar`, because both are non-negotiable on Android:
 * it extends *into* the status bar and pads its own content clear of it
 * (edge-to-edge is mandatory from RN 0.86), and it paints an explicit colour
 * from the palette rather than a `bg-*` class — this strip has nothing behind it
 * but the window, so a class that fails to resolve renders as a black band under
 * the clock.
 *
 * ## The wordmark, not a greeting
 *
 * This led with the account's face and "Welcome back, {name}" until the
 * discovery mockup replaced it with the two-tone wordmark. Two reasons it is the
 * better trade, beyond matching the design: the greeting spent the widest row on
 * the screen telling people something they already know, and the avatar had to
 * be non-pressable — this header renders in three different shells and only one
 * of them has a Profile tab, so a tap would land somewhere different depending
 * on how you got here. The Profile tab now draws that face, where tapping it
 * does the obvious thing.
 *
 * ## The chrome adapts to having an account, it does not duplicate
 *
 * Signed out there is nothing to count and no card to hold, so both actions are
 * **absent** rather than disabled — a bell that opens an empty "sign in first"
 * screen is a worse answer than no bell. The wordmark is what is left, which is
 * what the mockup draws.
 *
 * ## The ID card replaced Compare here
 *
 * Compare had a button in this header **and** a tab in `(browse)` **and** a bar
 * that appears in the browse screen the moment two hostels are ticked — three
 * ways to the same screen, one of which sat in the scarcest row in the app. It
 * kept the two that are reached with hostels already chosen, which is the only
 * state in which compare has anything to show.
 *
 * What took its place is the control the web puts in its account menu: the ID
 * card. It does what that menu does — opens the card when there is one, offers
 * to create it when there is not — because those are genuinely one intent, and a
 * button that greys itself out for everyone who has not filled the form is a
 * button that never teaches anybody what it is for.
 *
 * ## Search submits, it does not filter in place
 *
 * The field pushes `?q=` into the browse screen, which is where the results and
 * every filter live. Filtering the home screen's carousels by a query would
 * leave "Popular right now" and "Newly listed" showing the same three matches
 * under two headings that no longer mean anything. The mockup's mic is not here:
 * there is no speech recognition in this app, and a mic that does nothing is the
 * control people decide the app is broken over.
 */

/**
 * The search row, and the button that lives inside it.
 *
 * Measured here rather than written as `h-16` / `h-12 w-12`, for the reason
 * every other dimension in this app is: NativeWind resolves classes at bundle
 * time, and a size nothing else uses can silently resolve to nothing. Keeping
 * the two numbers side by side also makes the proportion explicit — the button
 * is inset 8dp top and bottom, which is what keeps the row reading as one
 * control rather than a field with a square stuck on the end.
 */
const SEARCH_HEIGHT = 54;
const FILTER_BUTTON = 40;

export type DiscoveryHeaderProps = {
  /** Where the filters button goes — the browse screen owns the filter sheet. */
  browseHref: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  query: string;
};

export function DiscoveryHeader({
  browseHref,
  onQueryChange,
  onSearch,
  query,
}: DiscoveryHeaderProps) {
  const insets = useSystemInsets();
  const { colors } = useAppTheme();
  const account = useAppSelector((state) => state.auth.account);
  const [promptingIdCard, setPromptingIdCard] = useState(false);

  /*
   * No account, no request. `useResource` fetches on mount and on every refocus,
   * so a signed-out visitor would otherwise send a 401 to `/notifications` each
   * time they came back to the home tab.
   */
  const feed = useResource<NotificationFeed>(
    useCallback(
      async () =>
        account
          ? await listNotifications("unread")
          : { actionCount: 0, notifications: [], unreadCount: 0 },
      [account],
    ),
  );

  // A failed count is not worth reporting on a home screen: the bell simply
  // shows no badge, which is what it shows when there is nothing unread anyway.
  const unread = feed.data?.unreadCount ?? 0;

  /*
   * Decided from the cached account, not from `/users/resident-identity` — the
   * web header does the same (`user.userResidentId`), and for the same reason:
   * the button has to know which of the two things it does *before* it is
   * pressed, and a fetch on mount would be one more request on every home
   * screen for a control most people will not touch.
   *
   * `userResidentId` is minted by the first successful profile save, so it is
   * exactly "there is a card". `/id-card/edit` calls `revalidateSession()` after
   * that save, which is what flips this without a sign-out.
   */
  const hasCard = Boolean(account?.userResidentId);
  const cardType = idCardTypeForAccount({
    isServiceProvider: account?.isServiceProvider,
    role: account?.role ?? "PUBLIC",
  });
  const cardNoun = idCardNoun(cardType);

  return (
    <View style={{ backgroundColor: colors.background, paddingTop: insets.top }}>
      <View className="gap-3 px-5 pb-3 pt-2">
        <View className="flex-row items-center gap-3">
          {/*
            Sized with `style`, not `text-[30px]`. NativeWind compiles the class
            list at build time, so an arbitrary value that appears nowhere else in
            the app is absent from the generated CSS until the bundler is rebuilt
            — the class resolves to nothing and the text silently renders at its
            default size. Inline styles cannot fail that way, which is why every
            measured dimension in this app is already written this way.
          */}
          <View accessibilityLabel={APP_NAME} accessibilityRole="header" className="flex-1">
            <Text style={{ fontSize: 30, fontWeight: "800", letterSpacing: -0.5 }}>
              <Text style={{ color: colors.foreground }}>{APP_NAME_PARTS.head}</Text>
              <Text style={{ color: colors.primary }}>{APP_NAME_PARTS.tail}</Text>
            </Text>
          </View>

          {account ? (
            <>
              <IconButton
                label={
                  hasCard
                    ? `My ${cardNoun} ID card`
                    : `Create my ${cardNoun} ID card`
                }
                /*
                  The same icon either way. A `+` here reads as "add something"
                  beside a bell, and the button means "my ID card" whether or not
                  one exists yet — which is what the label and the sheet say.
                */
                name="card-outline"
                onPress={() =>
                  hasCard ? router.push("/id-card") : setPromptingIdCard(true)
                }
              />

              <IconButton
                badge={unread}
                label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
                name="notifications-outline"
                onPress={() => router.push("/notifications")}
              />
            </>
          ) : null}
        </View>

        {/*
          One field, with the filter button *inside* it rather than beside it —
          the mockup's shape, and the reason the search row reads as a single
          control instead of a field plus a mystery square.
        */}
        <View
          className="flex-row items-center gap-2 rounded-2xl border border-border bg-card"
          style={{ height: SEARCH_HEIGHT, paddingLeft: 14, paddingRight: 8 }}
        >
          <Ionicons color={colors.mutedForeground} name="search" size={18} />

          {/*
            A bare `TextInput`, not the design system's `Input`: that carries a
            label, its own border and its own height, all of which fight a field
            living inside a pill.
          */}
          <TextInput
            className="h-full flex-1 text-base text-foreground"
            onChangeText={onQueryChange}
            onSubmitEditing={onSearch}
            placeholder="Search by city, hostel or landmark"
            placeholderTextColor={colors.mutedForeground}
            returnKeyType="search"
            value={query}
          />

          {query ? (
            <Pressable
              accessibilityLabel="Clear search"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => onQueryChange("")}
            >
              <Ionicons color={colors.mutedForeground} name="close-circle" size={18} />
            </Pressable>
          ) : null}

          <Pressable
            accessibilityLabel="Filters"
            accessibilityRole="button"
            className="items-center justify-center rounded-xl bg-primary active:opacity-80"
            onPress={() => router.push(browseHref)}
            style={{ height: FILTER_BUTTON, width: FILTER_BUTTON }}
          >
            <Ionicons color={colors.primaryForeground} name="options-outline" size={18} />
          </Pressable>
        </View>
      </View>

      {/*
        Mounted here rather than on the screen: the button that opens it is this
        component's, and both surfaces that render this header — the signed-out
        stack and the browse tabs — would otherwise need the same state and the
        same sheet. It portals to the root provider, so living inside a header
        does not clip it.
      */}
      <IdCardPrompt
        cardType={cardType}
        onClose={() => setPromptingIdCard(false)}
        open={promptingIdCard}
      />
    </View>
  );
}

/**
 * A circled icon action, with an optional count over its corner.
 *
 * Capped at `9+`: the badge is 18px across, and a three-digit count either
 * overflows the circle or shrinks the digits past reading size. Nobody acts on
 * the difference between 47 and 112 unread.
 */
function IconButton({
  badge = 0,
  label,
  name,
  onPress,
}: {
  badge?: number;
  label: string;
  name: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      className="h-10 w-10 items-center justify-center rounded-full border border-border active:opacity-70"
      hitSlop={6}
      onPress={onPress}
    >
      <Ionicons color={colors.foreground} name={name} size={19} />

      {badge > 0 ? (
        <View className="absolute -right-0.5 -top-0.5 h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1">
          <Text className="text-[10px] font-bold text-primary-foreground">
            {badge > 9 ? "9+" : badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
