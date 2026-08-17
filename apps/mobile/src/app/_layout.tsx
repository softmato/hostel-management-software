import "@/global.css";

import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { Platform, StatusBar as RNStatusBar } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import Toast from "react-native-toast-message";
import { Provider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";

import { BottomChromeProvider } from "@/components/bottom-chrome";
import { BrandSplash } from "@/components/brand-splash";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { bootstrapSession, revalidateSession } from "@/lib/auth-session";
import { persistor, store } from "@/store";
import { setReady } from "@/store/slices/authSlice";

// Held until the boot gate in app/index.tsx has chosen a route. See §0 of
// docs/MOBILE_APP_PHASES.md — hiding it earlier is what causes the login flash.
void SplashScreen.preventAutoHideAsync();

function RootShell() {
  const dispatch = useAppDispatch();
  const { colors, isDark } = useAppTheme();
  const isReady = useAppSelector((state) => state.auth.isReady);

  /*
   * The splash is uncovered here, not in the boot gate.
   *
   * `app/index.tsx` used to own this, which worked for every launch that starts
   * at `/` — but a deep link does not. `hostelhub://ref/<code>` mounts
   * `app/ref/[code].tsx` directly and never renders the gate, so the hide never
   * fired and the splash stayed over the app permanently. The root layout is the
   * one component mounted on every route, deep-linked or not.
   *
   * The timing is unchanged: `isReady` still flips only after
   * `bootstrapSession`, and this effect runs after the commit in which the gate
   * has already resolved its `<Redirect>` — so the first thing drawn is still
   * the destination.
   */
  useEffect(() => {
    if (isReady) {
      void SplashScreen.hideAsync();
    }
  }, [isReady]);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      // Restores the token into memory and returns the *cached* account. No
      // network — index.tsx routes off this synchronously.
      await bootstrapSession();

      if (cancelled) return;

      dispatch(setReady(true));

      // Now that a screen is on its way, confirm the cache against the server.
      // A change in role or activation re-routes; a failure is ignored, because
      // an offline launch should still show the last known dashboard.
      void revalidateSession();
    }

    void boot();

    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }

    /*
     * Force the window to draw under the status bar.
     *
     * Edge-to-edge is mandatory from RN 0.86 — but that is a property of the
     * *activity*, and in Expo Go the activity belongs to Expo Go, not to us.
     * Its theme paints an opaque status bar, so the app window starts below it:
     * `insets.top` comes back as 0, the AppBar sits flush under a black band,
     * and no amount of padding helps because the band is not ours to paint.
     *
     * The giveaway is that changing the system theme fixes it — that is a
     * configuration change, which tears down and rebuilds the activity with the
     * flags re-applied. Setting them here does the same thing at launch.
     *
     * Harmless in a development or production build, where the activity is
     * already edge-to-edge and these are no-ops.
     */
    RNStatusBar.setTranslucent(true);
    RNStatusBar.setBackgroundColor("transparent", false);
  }, []);

  useEffect(() => {
    /*
     * The window's own background shows through during rotation and while a
     * screen is mounting, so it has to match the theme — otherwise a white
     * flash appears on a dark app, and vice versa.
     */
    void SystemUI.setBackgroundColorAsync(colors.background);
  }, [colors.background]);

  return (
    <>
      {/*
        The status bar is always translucent now — edge-to-edge is mandatory in
        SDK 57, so `translucent` was removed from the props entirely and the
        AppBar's colour runs to the top of the screen by default. All that is
        left to choose is the glyph colour: dark on the light theme's white bar,
        light on dark.
      */}
      <StatusBar style={isDark ? "light" : "dark"} />

      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.background },
          headerShown: false,
        }}
      >
        <Stack.Screen name="index" options={{ animation: "none" }} />
        <Stack.Screen name="(public)" options={{ animation: "fade" }} />
        {/*
          The same discovery screens with tabs instead of a Log in pill — where
          a signed-in account that has no hostel yet lands. See
          `constants/roles.ts`.
        */}
        <Stack.Screen name="(browse)" options={{ animation: "fade" }} />
        <Stack.Screen name="(auth)" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="(resident)" options={{ animation: "fade" }} />
        <Stack.Screen name="(guardian)" options={{ animation: "fade" }} />
        <Stack.Screen name="(cook)" options={{ animation: "fade" }} />
        <Stack.Screen name="(provider)" options={{ animation: "fade" }} />
        <Stack.Screen name="(admin)" options={{ animation: "fade" }} />
        <Stack.Screen name="activate" options={{ animation: "fade" }} />
        {/*
          Detail screens live at the root, not inside a role's tab group: a
          folder nested under a `<Tabs>` layout becomes another tab. Pushed
          from the root stack, the invoice slides in over the tab bar the way a
          detail view should.
        */}
        <Stack.Screen name="invoice/[id]/index" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="invoice/[id]/pay" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="invoice/[id]/claim" options={{ animation: "slide_from_right" }} />
        <Stack.Screen
          name="checkout/[reference]"
          options={{ animation: "slide_from_right" }}
        />
        {/*
          Discovery detail screens, also at the root: they are reachable from
          the signed-out public stack *and* from a resident's More tab, so they
          cannot live inside either group.
        */}
        <Stack.Screen name="hostel/[slug]/index" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="hostel/[slug]/inquiry" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="compare" options={{ animation: "slide_from_right" }} />
        {/*
          The referral deep link. The file name is the handler — expo-router
          resolves `hostelhub://ref/<code>` here on a cold start and while the
          app is already running, so there is no cold-start case to forget.
        */}
        <Stack.Screen name="ref/[code]" options={{ animation: "slide_from_right" }} />
      </Stack>

      <Toast topOffset={60} />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Provider store={store}>
        {/*
          The gate cannot read the cached account until rehydration finishes, so
          the same BrandSplash covers that wait — identical pixels to the native
          splash, so the user sees one continuous screen.
        */}
        <PersistGate loading={<BrandSplash />} persistor={persistor}>
          <SafeAreaProvider>
            <BottomSheetModalProvider>
              {/*
                At the root, not inside the tab navigator: the signed-out home
                is a plain stack with a floating Log in pill and no tabs, and it
                must hide and return on scroll exactly like a tab bar does.
              */}
              <BottomChromeProvider>
                <RootShell />
              </BottomChromeProvider>
            </BottomSheetModalProvider>
          </SafeAreaProvider>
        </PersistGate>
      </Provider>
    </GestureHandlerRootView>
  );
}
