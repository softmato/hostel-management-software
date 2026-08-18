import "@/global.css";

import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { router, Stack, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect, useRef } from "react";
import { Platform, StatusBar as RNStatusBar } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import Toast from "react-native-toast-message";
import { Provider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";

import { BottomChromeProvider } from "@/components/bottom-chrome";
import { AssetViewer } from "@/components/asset-viewer";
import { BrandSplash } from "@/components/brand-splash";
import { UploadToaster } from "@/components/upload-toaster";
import { useAppDispatch } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { usePush } from "@/hooks/use-push";
import { useRealtime } from "@/hooks/use-realtime";
import { useUploads } from "@/hooks/use-uploads";
import { resolveHome } from "@/constants/roles";
import { bootstrapSession, revalidateSession } from "@/lib/auth-session";
import { startUploadNotifications } from "@/lib/upload-notifier";
import { persistor, store } from "@/store";
import { setReady } from "@/store/slices/authSlice";

// Held until the boot gate in app/index.tsx has chosen a route. See §0 of
// docs/MOBILE_APP_PHASES.md — hiding it earlier is what causes the login flash.
void SplashScreen.preventAutoHideAsync();

function RootShell() {
  const dispatch = useAppDispatch();
  const { colors, isDark } = useAppTheme();
  const uploads = useUploads();

  /*
   * The route this launch started on, read through a ref so the boot effect can
   * look at it after an await without re-running when it changes.
   *
   * `/` is the boot gate. Anything else means a deep link mounted its own screen
   * — see the re-route guard below.
   */
  const pathname = usePathname();
  const pathRef = useRef(pathname);

  useEffect(() => {
    pathRef.current = pathname;
  });

  /*
   * Both live at the root, and both are no-ops while signed out.
   *
   * Push registration has to outlive any one screen — a notification tapped
   * from the tray can mount any route, and the listener that routes it must
   * already exist. The socket is here for the same reason the upload toaster
   * is: it belongs to the session, not to whatever happens to be on screen.
   */
  usePush();
  useRealtime();

  /*
   * The shade's half of the universal uploader.
   *
   * At the root for the same reason the toaster is: a transfer outlives the
   * screen that started it, and the case this exists for is the user *leaving*
   * the app mid-upload — where the toaster, and every screen, is gone. It posts
   * nothing unless notification permission has already been granted; it never
   * asks (§4.5).
   */
  useEffect(() => startUploadNotifications(), []);

  /*
   * The splash is uncovered here, not in the boot gate.
   *
   * `app/index.tsx` used to own this, which worked for every launch that starts
   * at `/` — but a deep link does not. `hostelhub://ref/<code>` mounts
   * `app/ref/[code].tsx` directly and never renders the gate, so the hide never
   * fired and the splash stayed over the app permanently. The root layout is the
   * one component mounted on every route, deep-linked or not.
   *
   * It fires on mount rather than waiting for `isReady`, and the handover is
   * still seamless because `BrandSplash` is drawn to the same white ground and
   * the same centred mark as the native splash in app.json. What it buys is the
   * *words*: an Android splash is one image on one colour and cannot draw text,
   * so `HostelHub` and "Powered by Softmato" exist only in `BrandSplash` — and
   * holding the native one to the end of boot meant nobody ever saw them.
   *
   * There is still nothing to flash past. This effect runs after the subtree
   * below has committed, and while `isReady` is false every route under it —
   * the gate, and `PersistGate` above it — renders `BrandSplash`. The login
   * screen the boot contract exists to hide is never among them.
   */
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Captured before anything awaits: by the time revalidation answers, the
    // gate has long since redirected, so "are we at `/` now" would always be
    // false. What matters is where this launch came in.
    const startedAt = pathRef.current;

    async function boot() {
      // Restores the token into memory and returns the *cached* account. No
      // network — index.tsx routes off this synchronously.
      await bootstrapSession();

      if (cancelled) return;

      dispatch(setReady(true));

      /*
       * Now that a screen is on its way, confirm the cache against the server.
       * A failure is ignored, because an offline launch should still show the
       * last known dashboard.
       *
       * The result was previously discarded, which made the "and the role has
       * not changed" half of the boot contract (§0 step 3) a no-op: a resident
       * promoted to warden on the web, an account whose provider application
       * was approved, or a QR activated on another device all stayed on the
       * stale screen until the next cold start. `revalidateSession` only
       * returns an account when something actually moved, so this re-routes
       * exactly then and never on an ordinary launch.
       */
      const changed = await revalidateSession();

      if (cancelled || !changed) {
        return;
      }

      /*
       * Only re-route a launch that started at the boot gate.
       *
       * A deep link mounts its own screen — `hostelhub://ref/<code>`,
       * `guardian-invite?token=…`, a notification's invoice — and the user is
       * looking at the thing they tapped. Replacing it a second later because
       * revalidation noticed a changed role is the app taking the screen away
       * mid-read, and it lands hardest on exactly the links where a flag *has*
       * just moved: a QR activated on another device, an invitation accepted.
       *
       * `/` is the gate's own path, so this is true only for an ordinary launch.
       * Anything else keeps its screen; the store is already updated, so the
       * correct tabs are underneath when they navigate back.
       */
      if (startedAt !== "/") {
        return;
      }

      router.replace(
        resolveHome({
          isApprovedProvider: changed.isServiceProvider,
          isResidentActivated: store.getState().auth.isResidentActivated ?? true,
          role: changed.role,
        }),
      );
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
        {/* The map, opened by the distance badge on any card that has one. */}
        <Stack.Screen name="map" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="directions/[slug]" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="compare" options={{ animation: "slide_from_right" }} />
        {/*
          The SOS floating button's tap destination. At the root rather than in
          `(resident)/`, so pushing it slides over the tab bar — and so the
          button that opens it, which lives in the resident layout, is not
          rendering a screen inside itself.
        */}
        <Stack.Screen name="sos" options={{ animation: "slide_from_bottom" }} />
        {/*
          Complaints, reached from the More tab and from a push. At the root for
          the same reason invoices are — and because a complaint push arrives for
          a resident whose complaint may be open on any tab.
        */}
        <Stack.Screen name="complaints/index" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="complaints/new" options={{ animation: "slide_from_bottom" }} />
        <Stack.Screen name="complaints/[id]" options={{ animation: "slide_from_right" }} />
        {/* Reached from More and from the dashboard's night-status card. */}
        <Stack.Screen name="night-status" options={{ animation: "slide_from_right" }} />
        {/*
          A provider's job detail. At the root for the same reason an invoice is:
          it slides over the tab bar rather than becoming a fourth tab.
        */}
        <Stack.Screen name="job/[id]" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="profile" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="id-card/index" options={{ animation: "slide_from_right" }} />
        {/*
          Bottom, not right: this is a form you open, fill and finish — the same
          shape as `complaints/new` — and on the web it is literally a modal. The
          card it belongs to slides from the right like every other destination.
        */}
        <Stack.Screen name="id-card/edit" options={{ animation: "slide_from_bottom" }} />
        <Stack.Screen name="referrals" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="review" options={{ animation: "slide_from_right" }} />
        {/*
          Community is readable signed out, so it sits on the root stack next to
          the public group rather than inside any role's tabs — and
          `community/[postId]` is a push and share-link target.
        */}
        <Stack.Screen name="community/index" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="community/[postId]" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="settings" options={{ animation: "slide_from_right" }} />
        {/*
          The bell's destination. At the root because `GET /notifications` is
          scoped to the caller's own user id with no role branch — one screen
          serves every audience, so it cannot live inside any one tab group.
        */}
        <Stack.Screen name="notifications" options={{ animation: "slide_from_right" }} />
        {/*
          The referral deep link. The file name is the handler — expo-router
          resolves `hostelhub://ref/<code>` here on a cold start and while the
          app is already running, so there is no cold-start case to forget.
        */}
        <Stack.Screen name="ref/[code]" options={{ animation: "slide_from_right" }} />
        {/*
          The guardian invitation deep link. The file name matches the path in
          the email — `guardian-invite.service.ts` builds
          `{siteUrl}/guardian-invite?token=…` — so the https link routes here
          the day verified app links are configured, and
          `hostelhub://guardian-invite?token=…` already does.
        */}
        <Stack.Screen name="guardian-invite" options={{ animation: "slide_from_right" }} />
      </Stack>

      {/*
        Above the transient toasts and below nothing: an upload can outlive the
        screen that started it, so its report is drawn at the app root.
      */}
      <UploadToaster />

      {/*
        The one asset viewer. At the root because any screen can open it, and
        because a `Modal` mounted inside a tab would still be inside that tab's
        navigator — this one has to draw over the tab bar and the SOS button.
      */}
      <AssetViewer />

      {/*
        Transient toasts move down to clear the upload cards rather than
        stacking on top of them — 88px is one card plus its gap, which is the
        only case that overlaps in practice.
      */}
      <Toast topOffset={uploads.length > 0 ? 60 + 88 * uploads.length : 60} />
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
