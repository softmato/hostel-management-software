import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback } from "react";
import { Pressable, TextInput, View } from "react-native";

import { Avatar } from "@/components/ui/avatar";
import { Text } from "@/components/ui/text";
import { APP_NAME } from "@/constants/branding";
import { useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import { useSystemInsets } from "@/hooks/use-system-insets";
import { API_BASE_URL } from "@/lib/api";
import { absoluteMediaUrl } from "@/lib/media";
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
 * ## The chrome adapts to having an account, it does not duplicate
 *
 * Signed out there is no name to greet and no notifications to count, so the
 * left side becomes the wordmark and the bell is **absent** rather than disabled
 * — a bell that opens an empty "sign in first" screen is a worse answer than no
 * bell. Signed in, the same slot is the greeting and the bell appears with its
 * unread count.
 *
 * The avatar is deliberately **not** pressable. This header renders inside three
 * different shells — the signed-out `(public)` stack, the `(browse)` tabs, and a
 * resident who arrived from More → Explore — and only one of those has a Profile
 * tab to open. A tap that lands somewhere different depending on how you got
 * here is worse than a tap that does nothing.
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

export type DiscoveryHeaderProps = {
  /** Where the filters button goes — the browse screen owns the filter sheet. */
  browseHref: string;
  compareHref: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  query: string;
};

export function DiscoveryHeader({
  browseHref,
  compareHref,
  onQueryChange,
  onSearch,
  query,
}: DiscoveryHeaderProps) {
  const insets = useSystemInsets();
  const { colors } = useAppTheme();
  const account = useAppSelector((state) => state.auth.account);

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

  return (
    <View style={{ backgroundColor: colors.background, paddingTop: insets.top }}>
      <View className="gap-3 px-5 pb-3 pt-2">
        <View className="flex-row items-center gap-3">
          {account ? (
            <>
              <Avatar
                name={account.name}
                size="md"
                uri={absoluteMediaUrl(account.image, API_BASE_URL)}
              />
              <View className="flex-1">
                <Text variant="caption">Welcome back</Text>
                <Text className="font-semibold" numberOfLines={1} variant="subtitle">
                  {account.name}
                </Text>
              </View>
            </>
          ) : (
            <View className="flex-1">
              <Text className="font-semibold" numberOfLines={1} variant="subtitle">
                {APP_NAME}
              </Text>
              <Text numberOfLines={1} variant="caption">
                Hostels across Nepal
              </Text>
            </View>
          )}

          <IconButton
            label="Compare hostels"
            name="git-compare-outline"
            onPress={() => router.push(compareHref)}
          />

          {account ? (
            <IconButton
              badge={unread}
              label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
              name="notifications-outline"
              onPress={() => router.push("/notifications")}
            />
          ) : null}
        </View>

        <View className="flex-row items-center gap-2">
          <View className="h-12 flex-1 flex-row items-center gap-2 rounded-2xl bg-muted px-3">
            <Ionicons color={colors.mutedForeground} name="search" size={18} />
            {/*
              A bare `TextInput`, not the design system's `Input`: that carries a
              label, its own border and its own height, all of which fight a
              field living inside a pill.
            */}
            <TextInput
              className="h-full flex-1 text-base text-foreground"
              onChangeText={onQueryChange}
              onSubmitEditing={onSearch}
              placeholder="Search hostels, areas or landmarks"
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
          </View>

          <Pressable
            accessibilityLabel="Filters"
            accessibilityRole="button"
            className="h-12 w-12 items-center justify-center rounded-2xl bg-primary active:opacity-80"
            onPress={() => router.push(browseHref)}
          >
            <Ionicons color={colors.primaryForeground} name="options-outline" size={20} />
          </Pressable>
        </View>
      </View>
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
