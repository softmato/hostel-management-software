import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { type ColorValue, View } from "react-native";

import { AnimatedTabBar } from "@/components/tab-bar";
import { Avatar } from "@/components/ui/avatar";
import type { RoleAccentKey } from "@/constants/theme";
import { useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { API_BASE_URL } from "@/lib/api";
import { absoluteMediaUrl } from "@/lib/media";

export type TabDef = {
  /**
   * Draw the signed-in account's picture instead of `icon` — for the Profile
   * tab, which means "you" rather than a category. `icon` still has to be given:
   * `Avatar` falls back to an initial, and a signed-out shell falls back to the
   * glyph.
   */
  avatar?: boolean;
  /**
   * A count over the icon's corner. `0` draws nothing.
   *
   * Whoever passes this owns the fetch behind it. The admin group can afford one
   * because its layout already holds the shared alerts queue; a tab bar that
   * fetched its own counts would be a request per role per launch for a number
   * most people glance at once.
   */
  badge?: number;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  name: string;
};

/**
 * The bottom tab bar for a signed-in role.
 *
 * One component for all five signed-in audiences, differing only in accent
 * colour and the list of tabs — so a fix to inset handling, press feedback or
 * the hide-on-scroll animation lands everywhere at once instead of five times.
 *
 * The bar itself is `AnimatedTabBar`, not the navigator's default: the default
 * cannot be driven from a screen's scroll offset. Screens pass `insideTabs` to
 * `<Screen>`, which both reserves the bar's height and wires the scroll handler.
 */
export function RoleTabs({
  accent,
  hidden,
  tabs,
}: {
  accent: RoleAccentKey;
  /**
   * Routes that live in the group but are not tabs — reached by a push from one
   * of them.
   *
   * Needed because a `<Tabs>` navigator adopts **every** file in its directory:
   * a route left out of `tabs` would otherwise appear as an unlabelled sixth
   * tab. `href: null` is expo-router's own way of saying "not a tab", and it
   * keeps the bar on screen during the drill-down, which is the reason the
   * screen stays in the group rather than moving to the root stack.
   */
  hidden?: readonly string[];
  tabs: readonly TabDef[];
}) {
  const { colors } = useAppTheme();
  const account = useAppSelector((state) => state.auth.account);

  return (
    <Tabs
      // Rendered outside the scene, so it keeps its own animated transform
      // while screens change underneath it.
      tabBar={(props) => <AnimatedTabBar {...props} accent={accent} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            // Ionicons ships each glyph twice: `home` filled and
            // `home-outline` hollow. Swapping between them is the whole
            // selected state, so the tab bar itself needs no icon knowledge.
            tabBarIcon: ({ color, focused, size }) =>
              tab.avatar && account ? (
                <AvatarTabIcon
                  account={account}
                  focused={focused}
                  tint={color}
                />
              ) : (
                <Ionicons
                  color={color}
                  name={focused ? tab.icon : (`${tab.icon}-outline` as typeof tab.icon)}
                  size={size}
                />
              ),
            tabBarBadge: tab.badge && tab.badge > 0 ? tab.badge : undefined,
            title: tab.label,
          }}
        />
      ))}

      {/*
        `?? []`, not `hidden?.map(...)`.

        The optional-chaining form renders `undefined` as a child, and the
        assumption that React drops those is **wrong**: `Children.forEach` maps
        `undefined` to `null` and then invokes the callback with it anyway
        (`mapIntoArray`: `if (null === children) invokeCallback = true`).
        expo-router's `useFilterScreenChildren` receives that null, finds it is
        not a `Screen`, and warns "Layout children must be of type Screen" —
        naming whichever group did not pass `hidden`, which was `(browse)`, the
        only one with no non-tab routes. An empty array iterates zero times and
        the callback never fires.
      */}
      {(hidden ?? []).map((name) => (
        <Tabs.Screen key={name} name={name} options={{ href: null }} />
      ))}
    </Tabs>
  );
}

/**
 * The Profile tab's icon: the account's own face.
 *
 * The selected state cannot be a filled-vs-hollow glyph swap here, so it is a
 * ring in the accent colour — the same signal the label underneath already
 * carries, which is what keeps the tab readable for anyone who cannot tell the
 * two tints apart at 22px.
 *
 * `absoluteMediaUrl` because `user.image` is a Google URL for a Google sign-in
 * and a relative path for anything we stored; `Avatar` handles the third case,
 * where the URL exists and cannot be drawn, by falling back to the initial.
 */
function AvatarTabIcon({
  account,
  focused,
  tint,
}: {
  account: { image: string | null; name: string };
  focused: boolean;
  tint: ColorValue;
}) {
  return (
    <View
      className="items-center justify-center rounded-full"
      style={{
        borderColor: focused ? tint : "transparent",
        borderWidth: 1.5,
        height: 27,
        width: 27,
      }}
    >
      <Avatar
        name={account.name}
        size="xs"
        uri={absoluteMediaUrl(account.image, API_BASE_URL)}
      />
    </View>
  );
}
