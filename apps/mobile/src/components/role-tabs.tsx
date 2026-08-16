import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

import { AnimatedTabBar } from "@/components/tab-bar";
import type { RoleAccentKey } from "@/constants/theme";
import { useAppTheme } from "@/hooks/use-app-theme";

export type TabDef = {
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
  tabs,
}: {
  accent: RoleAccentKey;
  tabs: readonly TabDef[];
}) {
  const { colors } = useAppTheme();

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
            tabBarIcon: ({ color, focused, size }) => (
              <Ionicons
                color={color}
                name={focused ? tab.icon : (`${tab.icon}-outline` as typeof tab.icon)}
                size={size}
              />
            ),
            title: tab.label,
          }}
        />
      ))}
    </Tabs>
  );
}
