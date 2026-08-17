# Mobile App — Build Phases

Tracker for `apps/mobile`. This is the Phase 6 deliverable from [`PHASES.md`](PHASES.md)
§6, restructured into buildable increments. It supersedes the §6.1 checklist as the
day-to-day work order; §6.1 stays the contractual scope list.

**How to use this file.** One item at a time: write the code, verify it runs, then flip
`☐` to `☑` in this file before starting the next item. Do not batch. A `☑` means the
thing was seen working, not that the file was created.

Reference implementation for stack, notification plumbing and UI feel:
`D:\Jiwan-Mijhar\app` (QuestionCall). Copy its **patterns**, not its palette — this
product is green (`#0a8a4b`), QuestionCall's chrome is incidental.

---

## 0. Decisions taken (do not re-litigate)

| Decision | Choice | Why |
|---|---|---|
| App variants | **One app, role-routed** | Six audiences (Resident, Guardian, Cook, Service Provider, Hostel Admin, Public). One Expo project, one store listing, one push pipeline, one EAS config. After login the router drops each role into its own route group. Cook and resident install the same APK. |
| Routing | `expo-router` (file-based) | Deep links from push notifications map to file paths with no manual linking config. Matches the reference app. |
| Styling | NativeWind v4 + CSS variables | The web theme is already CSS variables; the same token names port across, so a colour changes in one place. |
| State | Redux Toolkit + `redux-persist` (AsyncStorage) | Reference app's shape. Persist gives the offline cache for free (Phase M8). |
| Tokens | `expo-secure-store` | Never AsyncStorage — AsyncStorage is plain text on disk. |
| HTTP | `axios` + request/response interceptors | 401 → silent refresh → retry once → hard logout. Lifted from `lib/api.ts` in the reference. |
| Realtime | `pusher-js/react-native` | The web already publishes on four private channel scopes; mobile subscribes to the same ones. |
| Push | Expo Push API → FCM/APNS | `expo-notifications`. Requires a **new server-side sender** — see §M4. |
| Package manager | `npm` (not pnpm) | Repo-wide rule. `apps/mobile` stays **outside** the root workspaces array with its own lockfile — Metro and npm workspace hoisting fight each other. |

### Shell contract (agreed 2026-08-16)

**Signed out is the public app, not a login wall.** The mobile app is the
website. Someone with no account browses hostels, compares them and sends an
inquiry exactly as they do on the web; a hostel-hunting student has nothing to
sign in with yet, and a login form in front of the product is the fastest way to
lose them. The whole visible difference is what sits at the bottom of the screen:

| | Bottom of screen |
|---|---|
| Signed out | A **Log in** call to action (plus a "create an account" link) |
| Signed in | That role's **tabs**, accented in the role colour |

**Theme defaults to light.** Following the OS would hand a dark app to anyone
whose phone is in dark mode, and the product's identity is the white-and-green
surface the website uses. Dark is a setting people opt into, later, from
Settings — `themePreference` starts at `"light"`, not `"system"`.

**Insets are the `Screen` primitive's job, and no screen opts out.** Android has
been edge-to-edge with no opt-out since RN 0.86, so the app always draws behind
the status bar and the navigation bar.

- *Top:* the `AppBar` **extends into** the status bar and pads its own content
  clear of it, so the colour reaches the top edge and the title sits below the
  clock. Screens with no AppBar reserve `insets.top` themselves.
- *Bottom:* the edge that actually breaks. Under gesture navigation
  `insets.bottom` is a ~20dp hint bar and almost anything looks fine; switch the
  phone to **three-button navigation** and it becomes ~48dp of opaque buttons
  drawn on top of the app — an unpressable submit button, an unreadable last
  row. Exactly one of the tab bar, a sticky footer, or the scroll content
  reserves it. Never two, or the gap doubles.

**Bottom chrome hides on scroll down and returns on a small scroll up.** That
means the role tab bar *and* floating actions — the signed-out Log in pill today,
the resident SOS button later — from one shared value in `BottomChromeProvider`
at the app root. Not inside the tab navigator: the signed-out home is a plain
stack with no tabs and has to feel identical.

Thresholds are asymmetric: 16px of downward intent to hide (so a jittery thumb or
a rubber-band bounce does not flicker it), 6px upward to return (someone
scrolling back up is looking for a way out of the screen). Everything at the
bottom is absolutely positioned, so hiding never reflows the content behind it,
and the whole thing is a Reanimated worklet on the UI thread rather than JS.

`Screen` resets the state on focus — the value is app-wide, so a screen left
scrolled-and-hidden would otherwise hand the next one a missing tab bar that
cannot be scrolled back into view.

### Tab sets (agreed 2026-08-16, against the discovery mockups)

Mockups for the public/discovery side live in
[`docs/mockups/mobile/`](mockups/mobile/README.md). Three decisions came out of
them and are settled:

- **Residents keep `Home · Payments · Food · Notices · More`.** Discovery is an
  **Explore** entry inside More, not a tab. Someone who already has a bed opens
  the app to pay rent or read a notice.
- **`PUBLIC_USER` tabs are `Home · Search · Compare · Profile`.** The mockups'
  *Bookings*, *Messages* and *Saved* are **cut**: there is no booking model, no
  messaging endpoint and no favourites collection anywhere on the server, and a
  tab that opens onto a permanent empty state is the tab people stop trusting,
  not the feature.
- **Signed-out keeps the floating Log in pill and no tab bar**, per the shell
  contract above. The mockups draw a tab bar on signed-out screens; that part
  does not apply, the rest of each screen does.

### Boot contract (agreed)

The splash screen must never flash a wrong screen.

1. Splash is held (`SplashScreen.preventAutoHideAsync()`) while the root layout reads
   the session from SecureStore.
2. If a token exists, decode the role from the persisted user record and `router.replace()`
   **straight into that role's route group**. Splash hides only after that navigation
   commits. The user never sees login.
3. *Then*, in the background, `GET /api/v1/auth/me` confirms the token is still good and
   the role has not changed. If it 401s, the axios interceptor refreshes; if refresh fails,
   the store is wiped and the user lands on `(auth)/login`.
4. If no token exists, go to `(auth)/login` before hiding the splash.

The web session is independent — the mobile client sends `x-hostelhub-client: mobile`,
which is what makes `/auth/login` return `refreshToken` in the JSON body instead of a
cookie (`apps/web/src/lib/mobile-auth.ts`).

---

## 1. Server-side gaps this app depends on

These are **not** mobile work, but the mobile app cannot pass its acceptance tests until
they exist in `apps/web`. Each is tracked as an item in its phase below.

| Gap | Evidence | Blocks |
|---|---|---|
| ☑ ~~**No push sender exists.**~~ **Fixed 2026-08-16.** `push.service.ts` + `push-routing.ts` now batch active tokens to Expo, prune `DeviceNotRegistered` ones, and are called from `publishNewNotification` — the single funnel every notification already goes through, so no call site had to change. 13 tests. | `apps/web/src/modules/notifications/push.service.ts` | — |
| **No mobile Google client IDs.** `POST /api/v1/auth/google` accepts an `idToken` and is portable, but there is no Android/iOS OAuth client configured. | `apps/web/src/app/api/v1/auth/google/route.ts` | Google sign-in on mobile |
| **Cook has one endpoint.** Only `POST /api/v1/cook/food-ready` exists; the cook's own menu/resident-count reads live under `hostel-admin/*` behind staff capability checks. | `api/v1/cook/` | Cook home screen (M7) |
| **Provider job claim is unbuilt.** `/public/service-providers/me/jobs` returns directly-assigned work only; broadcast-and-claim does not exist server-side. | PHASES.md §6.1, superseded note | Provider job feed (M7) — ship assigned-only |
| **No resident-facing invoice line items.** `Invoice.lines` holds the per-line description, signed amount, basis and proration basis, but `toPortalInvoice()` returns only the totals and there is no `GET /resident/finance/invoices/{id}`. A resident can see *what* they owe, never *why*. Reads have to go through the ledger facade (ADR-3), so this is a deliberate finance-module change, not a quick serializer edit. | `apps/web/src/modules/finance/invoice-list.service.ts:54` | Invoice detail line items (M3) — shipped without them |
| **eSewa checkout cannot be handed off from mobile.** `createPaymentIntent` returns a `FORM_POST` handoff for eSewa — signed fields that must reach the provider as a POST body in emitted order. `expo-web-browser` opens URLs only, a `data:` URL form is blocked by Chrome, and re-signing client-side means shipping the merchant secret to a phone. Needs a server page that accepts the reference and performs the POST itself. | `apps/web/src/modules/finance/gateway/esewa.provider.ts:182` | eSewa on mobile (M3) — Khalti works, eSewa falls back to manual + claim |
| **`PaymentIntent.deeplinks` is declared and populated by nothing.** `{ label, url }[]`, "deep links into wallet apps, where the provider offers them" — no adapter sets it and `PaymentIntentView` does not return it, so it never reaches a client. Mobile falls back to `Linking.openURL` on the redirect URL and lets Android App Links / iOS Universal Links find the wallet app. A named "Open in Khalti" button needs the server to fill this in; the client should not keep a table of six vendors' URL schemes in step. | `apps/web/src/modules/finance/gateway/provider.types.ts:94` | Named wallet-app buttons (M3) — OS handoff ships |
| ☑ ~~**No ratings on the public hostel list or detail.**~~ **Fixed 2026-08-17.** `ratingSummariesFor()` is now one aggregation shared by `listPublicHostels`, `getPublicHostelBySlug` and `comparePublicHostels`, and every public payload carries `ratingSummary`. One round trip per page, not one per card — the listing returns up to 60. `VISIBLE` reviews only, unrounded (rounding would have silently changed what compare has always returned), and `total` is the field that says whether a rating exists at all. 6 tests; web suite green at 1,694. | `apps/web/src/modules/hostels/hostel.service.ts` | — |
| **Gateway return URL is web-only.** The intent's `returnUrl` is `{siteUrl}/resident/payments/checkout/{reference}` with no mobile scheme, so the in-app browser never redirects to `hostelhub://`. Mobile polls instead, which is correct regardless — but a deep link would close the browser automatically. | `apps/web/src/modules/finance/gateway/intent.service.ts:152` | Auto-dismissing the checkout browser (M3) — polling ships |
| **No resident-facing `nightStatus`/`complaints` on the dashboard.** Both blocks in `getResidentDashboard()` are hardcoded literals. Mobile Home makes a second request to `/resident/night-status` and hides complaints entirely. | `apps/web/src/modules/residents/resident-dashboard.service.ts:186` | One extra request on every Home load (M3) |

> ☑ **Dead payment endpoints — addressed 2026-08-16.** The old client called
> `/api/v1/resident/payments` and `/resident/payments/{id}/proof`; **both are
> gone**, so that tab could never have worked. `apps/mobile/src/lib/finance-api.ts`
> is now typed against the live surface — `/resident/finance/invoices`,
> `/invoices/{id}/claims`, `/invoices/{id}/checkout`,
> `/invoices/{id}/pay-instructions`, `/receipts/{id}/pdf`, `/statement/pdf`,
> `/checkout/{reference}` — with the old paths named in its header comment so the
> mistake cannot quietly recur.

---

## M0 — Scaffold & toolchain ✅ *(2026-08-16, bar the device run)*

Goal: `npm run mobile:start` opens a green-themed screen on a device, with typecheck
and lint clean.

Landed on **Expo SDK 57** / React Native 0.86.2 / React 19.2.3 — newer than the
reference app's SDK 54, so versions were resolved by `expo install` rather than copied.

- ☑ Re-scaffold `apps/mobile` with `create-expo-app@latest` (default template, expo-router), demo screens stripped
- ☑ `apps/mobile` stays out of the root `workspaces` array, with its own `package-lock.json`
- ☑ Deps installed via `expo install` so SDK-57-compatible versions resolve
  - ☑ Router/UI: expo-router 57, expo-linking, expo-constants, expo-splash-screen, expo-system-ui, safe-area-context, screens, gesture-handler, reanimated 4.5
  - ☑ Styling: nativewind 4.2 + tailwindcss 3.4
  - ☑ State/HTTP: @reduxjs/toolkit, react-redux, redux-persist, async-storage, axios
  - ☑ Native: expo-secure-store, expo-image, expo-image-picker, expo-camera, expo-haptics, expo-linear-gradient, expo-web-browser, expo-clipboard, expo-device, expo-file-system, expo-local-authentication, expo-application
  - ☑ Notifications/realtime: expo-notifications, pusher-js
  - ☑ UX: @gorhom/bottom-sheet, react-native-toast-message, @expo/vector-icons
- ☑ `babel.config.js` (nativewind preset + `react-native-worklets/plugin` last) and `metro.config.js` (`withNativeWind`)
- ☑ `tsconfig.json` with `@/*` alias; `nativewind-env.d.ts` carries the `*.css` declaration
      — **not** `expo-env.d.ts`, which the Expo CLI regenerates and which silently
      dropped it once
- ☑ `app.json`: name **HostelHub**, slug `hostelproject`, scheme `hostelhub`,
      package `com.softmato.hostelhub`, `newArchEnabled`, EAS project id, plugin list
      with permission strings
- ☑ `eas.json` — development / preview / production, APK output
- ☑ Root scripts: `mobile:start`, `mobile:typecheck`, `mobile:test`, `mobile:lint`, `mobile:build:test`, `mobile:build:preview`
- ☑ ESLint (`eslint-config-expo`) — clean, zero warnings
- ☑ Vitest for pure logic (`vitest.config.mts`, node environment, no RN shim)
- ☑ Env contract documented in `apps/mobile/README.md`
- ☑ `npm run mobile:typecheck` clean
- ☑ `expo export --platform android` bundles (1,896 modules), which is the real
      compile check — typecheck alone misses Metro resolution errors
- ☐ App runs on a physical Android device over LAN *(yours to confirm)*

> The in-app Browser pane could not verify this visually: it runs with
> `document.hidden === true`, so React never hydrates and screenshots time out.
> Known environment behaviour, not an app fault. Device verification is the real
> check.

---

## M1 — Design system & app shell ◐ *(core landed 2026-08-16)*

Goal: every later screen is assembled from primitives that already match the web.

- ☑ `global.css` — web tokens ported name-for-name from `apps/web/src/app/globals.css`,
      oklch → hex. Brand `--primary: #0a8a4b`. Role tokens for all six audiences
      (the web's four plus cook `#ea580c` and provider `#7c3aed`)
- ☑ Dark palette under both `@media (prefers-color-scheme: dark)` and `.dark`, so the
      in-app override wins in either direction
- ☑ `tailwind.config.js` maps every token to a utility class
- ☑ `constants/theme.ts` — the JS mirror for consumers that cannot use `className`
      (status bar, splash, notification channel colours)
- ☑ `hooks/use-app-theme.ts` — resolves preference → OS → NativeWind, so the `dark:`
      variants and the JS palette can never disagree
- ☑ Primitives: `Screen` (insets + keyboard + pull-to-refresh), `Text` (variant table),
      `Button`, `Input`, `Card`, `SectionHeader`, `LoadingState`, `EmptyState`, `ErrorState`
- ☑ Toast host wired into the root layout, with a `lib/toast.ts` facade
- ☑ Branded splash: centred mark, wordmark, **"Powered by Softmato"** below, drawn to
      match the native splash so the handover is invisible
- ☑ Placeholder brand assets generated (icon, adaptive layers, monochrome, splash,
      logo marks) with `assets/images/README.md` covering the swap
- ☑ Haptics on every button press by default, opt-out per button
- ☑ **Light by default**; `system`/`dark` remain available for the Settings screen
- ☑ `Screen` owns every inset — top strip, bottom nav bar, sticky footer, tab bar
- ☑ `AppBar` extends into the status bar rather than sitting below it
- ☑ `AnimatedTabBar` — custom (the navigator's default cannot be driven from a
      screen's scroll offset), absolutely positioned, hide-on-scroll
- ☑ Tab shells for all five signed-in roles, each in its own accent colour
- ☑ Public shell with the Login CTA where tabs would be
- ☑ Remaining primitives: ☑ `Badge`, ☑ `StatusPill`, ☑ `ListRow`, ☑ `Money`,
      ☑ `Select`, ☑ `Avatar`, ☑ `Skeleton`, ☑ `Sheet` *(last four 2026-08-17)*
  - ☑ The status→tone **table** lives in `lib/status.ts`, not in the pill. Vitest here
        is node-side with no RN shim, so anything importing `react-native` cannot be
        tested — and the table is the part that needs it. The web's `StatusBadge`
        matches substrings, and `"UNPAID".includes("PAID")` renders an unpaid invoice
        green
  - ☑ `Sheet` is `@gorhom/bottom-sheet`, whose provider had been mounted at the root
        since M1 with nothing using it. A plain `<Modal>` — what `hostel-browser.tsx`'s
        filter panel is — cannot be dragged away, and a bottom sheet with no drag reads
        as broken rather than as a different component. Wrapped declaratively (`open`
        prop, private ref) because every caller already holds the boolean
  - ☑ `Select` is that sheet, not `@react-native-picker/picker`: the picker is a
        spinner on iOS and a dropdown on Android, so one field would be two controls of
        two heights on a form that is otherwise all `Input`s. The trigger mirrors
        `Input` exactly — same height, border, label and error slots
  - ☑ `Avatar` falls back to one initial on a name-hashed tone, matching the web's
        `community-post-card.tsx` so the same person is the same colour in both
        clients. It swaps to the initial `onError` as well as on a null URL — a private
        asset that 401s returns a URL that exists and cannot be drawn. Pure half in
        `lib/avatar.ts`, 10 tests
  - ☑ `Skeleton` pulses from a Reanimated shared value, so it keeps animating while JS
        is parsing the very response it is waiting for. Never for a refresh:
        `use-resource.ts` deliberately keeps data on screen, and swapping it for grey
        blocks throws away what the user was reading
- ☑ Global upload-progress toaster *(2026-08-17)* — `lib/upload-queue.ts` +
      `components/upload-toaster.tsx`, ported from the web's `stores/upload-store.ts`
  - ☑ Every `uploadAsset` call registers itself, so a screen gets progress, a stage
        label and a failure reason without wiring anything up — the web's rule that
        call sites never build their own progress UI. `claim.tsx` lost its inline
        percentage and its failure toast to it; two notices for one event reads as
        two failures
  - ☑ **Not a Redux slice.** `redux-persist` writes to AsyncStorage on change and byte
        progress fires dozens of times a second — dozens of disk writes per photo on
        exactly the low-end handsets this targets. It is also meaningless after a
        relaunch: an upload the app died during did not happen. Plain module store read
        through `useSyncExternalStore`; 15 tests
  - ☑ **Anchored to the top edge**, unlike the web's bottom-right. This is a root
        overlay and the root cannot know what is beneath it: half the app's screens sit
        in a `<Tabs>` navigator with an absolutely-positioned bar and the rest may hold
        a sticky footer with the only submit button. Bottom anchoring would cover one
        or the other — the unpressable button §0 exists to prevent. The transient toast
        host moves down while cards are showing rather than stacking on them
  - ☑ It reports "Dismiss", not "Cancel": `expo-file-system`'s upload has no abort
        handle once in flight, and a cancel that only hides the row is a lie about
        where the bytes went
- ◐ Nepali rupee formatting + date helpers — `lib/format.ts`, 13 tests
  - ☑ `formatMoney`/`formatAmount`: hand-rolled grouping, paisa shown only when the
        amount has any. Not `Intl` — Hermes borrows the *platform's* ICU, so `en-NP`
        resolves differently per handset and an unknown locale silently becomes `en-US`
  - ☑ Dates fixed to NPT (UTC+05:45, no DST) by shifting the instant and reading the
        UTC getters, so a phone left on another timezone still shows Nepali days.
        Without it, "today's menu" serves the wrong dinner for the last 5h45m of
        every day
  - ☐ Bikram Sambat calendar — no converter exists anywhere in the repo and a BS
        month-length table is its own decision; dates are Gregorian in Nepal time
        until you ask for otherwise
- ☐ Real logo replacing the placeholders *(waiting on you)*

---

## M2 — Auth, session & the no-flash boot ◐ *(mechanism landed 2026-08-16)*

Goal: the boot contract in §0 works, on cold start, warm start, and after a token expiry.

- ☑ `lib/api.ts` — axios instance, API URL resolved from Metro's LAN host in dev
      (including the Android emulator `10.0.2.2` swap), `EXPO_PUBLIC_API_URL` otherwise
- ☑ Every request carries `x-hostelhub-client: mobile`, which is what makes
      `/auth/login` return `refreshToken` in the body
- ☑ Request interceptor attaches the bearer from Redux, falling back to SecureStore
- ☑ Response interceptor: 401 → **single** in-flight refresh with a waiter queue →
      retry → on failure wipe store + purge persistor + route to login. Parallel
      refreshes are the bug here: the loser writes an already-rotated token
- ☑ `publicApi` is a separate instance with no interceptors, so a wrong password
      reads as a wrong password instead of triggering a refresh-and-logout
- ☑ `store/` with `authSlice`, `uiSlice`, and a `RESET_STORE` action returning every
      slice to initial state — shared phones must not leak account A's cache to B
- ☑ `accessToken` and `isReady` stripped from the persisted payload: the token's home
      is SecureStore, and a rehydrated `isReady: true` would skip the gate entirely
- ☑ `lib/session.ts` — SecureStore read/write/clear
- ☑ `lib/auth-session.ts` — bootstrap (no network) / revalidate (after first paint) /
      start / end
- ☑ Root `_layout.tsx` — providers, splash hold, boot orchestration
- ☑ `app/index.tsx` — the gate: pure synchronous `resolveHome`, then `<Redirect>`
- ☑ `resolveHome` covered by 8 tests, including platform staff → public app and the
      approved-provider-is-a-PUBLIC-account case
- ☑ `(auth)/login.tsx` — email/phone + password, with the session-ended reason shown
- ☑ Logout: revoke, clear tokens, reset store, purge
- ☑ Unactivated resident routes to `activate` rather than a dashboard that would 404
- ☑ Suspended account (403 on refresh) surfaces its own message, not a silent failure
- ☑ `(auth)/register.tsx` — details → email OTP → verify → session *(2026-08-17)*
  - ☑ **`lib/auth-api.ts` had the OTP contract wrong**, the same way `finance-api.ts`
        did: `requestOtp` was typed `"email" | "sms"` × `"registration" |
        "password-reset"` and `register` took a `phone`. `auth.validation.ts` accepts
        `z.enum(["email"])` and `z.enum(["registration"])` and `registerSchema` has no
        phone field — so an SMS channel would have 400'd and a phone number would have
        been silently stripped, leaving an account whose owner believes it has one.
        Read the *validation schema*, not the route name
  - ☑ One screen with two steps, not two routes: Back from the code step must return
        to the details with everything still filled in, and a `challengeId` threaded
        through navigation params is a second place to lose it
  - ☑ The whole draft is validated **before** the code is requested (`lib/auth-form.ts`,
        21 tests). `/auth/otp/request` sends an email per call and allows five in
        fifteen minutes, so a password the phone could have rejected costs one of five
  - ☑ The resend button counts down 60s locally, because the server's
        `OTP_RESEND_COOLDOWN` 429 also spends an attempt
  - ☑ `ACCOUNT_ALREADY_EXISTS` is reported back on the **details** step next to the
        email. Left on the code step it reads as a bad code, and the user retypes it
        until the attempts run out
  - ☑ The account created is `PUBLIC`, so it lands in `(browse)`. Signing up is not
        how anyone becomes a resident — that is the QR code
- ☑ `(auth)/forgot-password.tsx` → reset flow *(2026-08-17)*
  - ☑ Two steps: request the link, then redeem it. The confirmation is phrased
        conditionally ("if an account exists"), matching the server — `requestPasswordReset`
        returns `{ requested: true }` either way on purpose, because an endpoint that
        says "no such user" is an account-enumeration oracle
  - ☑ **The token is pasted, not deep-linked.** The emailed link is
        `{appUrl}/reset-password?token=…` — a web URL, because the same mail goes to
        people who signed up on the website. Tapping it finishes in the browser, which
        works; the paste path exists so somebody already standing in the app is not at a
        dead end. `extractResetToken` unwraps the whole URL, since the whole URL is what
        a phone copies, and refuses a URL with no `token=` rather than spending an
        attempt on it
  - ☑ Lands on login afterwards, never a session: `resetPasswordWithToken` bumps
        `tokenVersion` and revokes everything, so there is no session to hand back
- ☐ Google sign-in via `expo-auth-session` **(blocked: needs server gap #2)** — the
      exchange endpoint is portable and `signInWithGoogle` is typed, but
      `verifyGoogleIdToken` checks `audience: GOOGLE_CLIENT_ID` and no Android/iOS
      OAuth client exists to issue a token with that audience. Creating those two
      clients in Google Cloud is yours; the screen is an hour once they exist
- ☑ `mustChangePassword` accounts (provisioned cook/warden) forced through a
      set-password step *(2026-08-17)* — `(auth)/set-password.tsx`
  - ☑ The check sits in `resolveHome` **above the role branch**, so it is a gate on
        every launch rather than a prompt with the app visible behind it. Until the
        password is replaced, the admin who issued it can still sign in as that account
        and everything it logs is deniable
  - ☑ No current-password field: `changePassword` requires one only when the flag is
        false, and asking for it would demand back the temporary password this exists
        to retire. A confirmation field instead — the password is being invented and it
        is masked, and a typo nobody catches locks the account out until an admin
        issues another
  - ☑ Sign out lives in the app bar, for the same reason it does on `activate`: the
        gate is on every launch, so without it a forgotten temporary password is a
        locked app
  - ☑ **Fixed while wiring this:** `revalidateSession`'s return value was discarded in
        `_layout.tsx`, which made "and the role has not changed" (§0 step 3) a no-op —
        a resident promoted to warden, an account newly flagged, or a QR activated on
        another device all stayed on the stale screen until the next cold start. The
        result now re-routes, and it only returns an account when something moved
- ☐ Verify on device: cold start with a valid token shows **no login flash**

**Acceptance**
- ☐ Cold start with a valid token lands on the role dashboard with **no login flash**
- ☐ Kill the app, expire the access token server-side, relaunch → silent refresh, still no flash
- ☐ Revoke the refresh token → relaunch → lands on login, store empty
- ☐ Log in as resident, log out, log in as cook → no resident data visible anywhere

---

## M3 — Resident core ◐ *(all five tabs landed 2026-08-16)*

The primary audience. Tabs: **Home · Payments · Food · Notices · More**.

Every tab and every payment flow is built. Two things are **not** done and neither
is client-side: invoice **line items** and **eSewa checkout**, both blocked on
server changes logged in §1.

Verified the same way M0 was: `typecheck` clean, `lint` clean, 65 Vitest cases, and
`expo export --platform android` bundles — which is the real check, since typecheck
alone misses Metro resolution errors. The in-app Browser pane still cannot render
these (it runs with `document.hidden === true`, so React never hydrates); a device
run against a live resident account is yours to confirm, and the three acceptance
tests below are the ones that need it.

- ☑ `(resident)/_layout.tsx` — bottom tabs, resident role colour *(the shell landed with
      M1's `RoleTabs`; Home · Payments · Food · Notices · More, accent `RESIDENT`)*
- ☑ **Home** — `GET /resident/dashboard`: dues summary, room/hostel, today's menu,
      latest notices, night status, quick actions
  - ☑ `hooks/use-resource.ts` — the one GET-with-four-states hook. `loading` is the
        first load only (a pull-to-refresh that swaps the list for a spinner throws
        away what the user is reading); responses are matched to the request that
        asked for them, or a slow first load overwrites a fast refresh; refocus
        revalidates silently, because paying an invoice happens on another screen
  - ☑ **Night status comes from `GET /resident/night-status`, not from the
        dashboard.** `resident-dashboard.service.ts` returns a *hardcoded*
        `{ status: "UNKNOWN", checkedAt: null }` — nothing writes it — so a screen
        reading that field tells every resident their status is unknown, forever.
        Its `complaints: { openCount: 0, recent: [] }` is a literal too, and is not
        rendered at all rather than shown as a confident zero
  - ☑ The night-status request is tolerant: if safety errors, that card drops and
        dues + today's menu still render
  - ☐ Server: give the dashboard a real `nightStatus`/`complaints` block so Home
        stops needing the second request
- ☑ `lib/finance-api.ts` — the whole finance surface typed against the live routes,
      with the dead `/resident/payments` paths named in its header so the old mistake
      cannot recur
- ☑ **Payments** — `GET /resident/finance/invoices` list + detail
  - ☑ List: total outstanding, carried credit (shown only when non-zero), open claims,
        one row per month. The **reference code is on the row**, not only behind
        "Pay now" — a resident paying from their banking app out of habit never opens
        the detail screen, and a transfer with no code is matched to a person by hand
  - ☑ `invoice/[id]` at the **root** stack, not inside `(resident)/`: a folder nested
        under a `<Tabs>` layout becomes another tab
  - ◐ Invoice detail with line items and running balance
    - ☑ Running balance — `lib/invoice-ledger.ts`, 8 tests. Receipts are re-sorted
          oldest-first (the server sends newest-first for the list) and any gap
          between `paidAmount` and the receipt total gets its **own line**. The two
          legitimately disagree — a payment can settle before its receipt is issued,
          and receipts voided with a reversed payment are excluded — and a statement
          that closes on a different number from the headline above it reads as the
          hostel's accounting being broken
    - ☑ Copyable reference code, receipts list, claims filed against this invoice
    - ☐ **Line items — blocked server-side.** `Invoice.lines` exists in the database
          with a description, signed amount, basis and proration basis per line, but
          `toPortalInvoice()` drops it and no resident endpoint exposes it, so *why*
          a month costs what it costs cannot be shown. Needs a server change; see §1
  - ☑ `GET /invoices/[id]/pay-instructions` — `invoice/[id]/pay`. One method
        expanded, the rest folded away: six panels of account numbers open at once
        is how somebody pays the right hostel from the wrong app. The server ranks
        them, so the primary is `methods[0]` and no client opinion can drift from it
    - ☑ **`finance-api.ts`'s pay-instructions and checkout types were wrong** and
          would have thrown on the first real call. They had been written from the
          route names: `PayInstructions` claimed `bankAccounts[]`/`wallets[]`/
          `qrAssetId` when the server returns one ordered discriminated `methods[]`,
          and checkout claimed `{ url, fields, method }` when it returns
          `{ handoff, reference, … }`. Rule that catches it: read the *service*
    - ☑ The static QR goes through `/files/{assetId}/url`, which authorises — so it
          needs `expo-image`'s `headers`, not a bare `<Image src>`
  - ☑ `POST /invoices/[id]/claims` — `invoice/[id]/claim`. Amount prefilled from
        what is *outstanding* (not the invoice total), method chips, optional
        transaction code, evidence picker
    - ☑ Validation mirrors `claim.validation.ts` client-side (`lib/claim-form.ts`,
          9 tests) and **there is no retry on failure**: the endpoint runs OCR over a
          full-size screenshot and allows 8 an hour, so every avoidable round trip
          spends one of a resident's eight
    - ☑ `created: false` is reported as "already submitted", not a second success —
          the server collapses a replay onto the existing claim
  - ☑ Evidence upload: `expo-image-picker` → `/files/presign` → PUT to R2 →
        `/files/[assetId]/complete` (`lib/uploads.ts`)
    - ☑ The PUT carries **no** `Authorization` header — the URL's signature is the
          credential and an extra auth header makes S3-compatible storage reject it
    - ☑ `kind: "PAYMENT_PROOF"`, because presign refuses a financial asset that is
          not tenant-scoped; and `complete` is not optional — until it runs the asset
          is a reservation the finance module will not accept as evidence
    - ☑ SDK 54 replaced `getInfoAsync`/`createUploadTask` with the `File` object;
          the old names still resolve from `expo-file-system/legacy` and typecheck
          clean from the wrong import, so this is worth knowing before the next one
    - ☑ MIME resolution lives in `lib/mime.ts` (7 tests): R2 signs `Content-Type`
          into the URL, so presign and PUT must agree or the failure is a signature
          error that mentions nothing about types
  - ◐ Gateway checkout — `checkout/[reference]`
    - ☑ **The wallet's own app takes the handoff, not a browser tab** (`lib/wallet.ts`).
          A Custom Tab / `SFSafariViewController` loads the launch URL itself and never
          hands it to a native app that claims the domain — so a resident with Khalti
          installed was typing their password into a web form while the app on the same
          phone already held the session, the balance and the biometric unlock.
          `Linking.openURL` goes through App Links / Universal Links instead, so no
          wallet scheme is hardcoded — a guessed `esewa://` is the same class of mistake
          as inventing an API shape, and Android 11+ needs a `<queries>` entry before
          `canOpenURL` answers honestly anyway. Browser only as a fallback
    - ☑ Khalti (`REDIRECT`) hands off, then the status screen polls
          `GET /checkout/{reference}` with geometric backoff, stopping on `settled`,
          a terminal status, or expiry. A failed poll is not a failed payment
    - ☑ **No `hostelhub://` deep link, deliberately.** The intent's `returnUrl` is
          built server-side as `{siteUrl}/resident/payments/checkout/{reference}` — a
          web page with no mobile scheme — so `openAuthSessionAsync` would wait
          forever. The browser closing was never evidence anyway; the provider is
    - ☐ **eSewa is blocked.** Its v2 checkout is a `FORM_POST` whose signature covers
          fields positionally, and `expo-web-browser` can only open a URL. A `data:`
          URL carrying a self-submitting form is blocked from top-level navigation by
          Chrome, and re-signing client-side would ship the merchant secret to a
          phone. Needs a server-side page that performs the POST from a reference —
          see §1
  - ☑ Receipts: `GET /receipts/[id]/pdf` and `GET /statement/pdf` → native share
        (`lib/documents.ts`, `expo-sharing` added). Downloaded **with** the bearer
        header, because these stream through our API: an unauthenticated open saves
        a file containing a JSON 401, which is worse than an error the resident can
        read. Cache directory, not documents — the server can always regenerate them
- ☑ **Food** — `GET /resident/food`: weekly routine, month-end special, photo gallery
  - ☑ A **day at a time**, today selected, with a day strip. The routine is a 7×4
        grid and a phone is one column wide; someone checking at 6pm wants tonight's
        dinner, not a table to scroll sideways through
  - ☑ Day arithmetic in `lib/food-week.ts` (10 tests) — the enums moved there from
        `resident-api.ts` because that module imports the axios client and therefore
        React Native, which makes a node-side test file unloadable
  - ☑ Feedback: `POST /resident/food/feedback`, per meal per day, with the anonymous
        option. The date sent is **this week's occurrence of the selected day** — a
        rating filed against today whatever day is showing blames the wrong dinner,
        and wrong analytics are worse than none because they get acted on
  - ☑ Photo upload: `POST /resident/food/photos`, meal guessed from the Nepali clock
        rather than asked. A picker between "I want to share this" and it being
        shared is where people give up
- ☑ **Notices** — `GET /resident/notices`, category filter, urgent styling,
      `PATCH /notices/[id]/read`
  - ☑ Read is marked **on expand**, not on render: marking on render clears the
        badge for a list somebody scrolled past on the way to Payments, and the water
        cut tomorrow is exactly the notice that gets scrolled past
  - ☑ Optimistic — the row un-bolds immediately, the PATCH runs behind it, and the
        server's `$setOnInsert` makes a replay a no-op. Both failure modes beat a tap
        that appears to do nothing
  - ☑ Urgent is a left border, not a red card. Two red cards on one screen and
        neither reads as urgent
- ☑ **More** — profile card, stay entries, Explore, app settings, sign out
  - ☑ **Explore lives here, not in a tab** (agreed 2026-08-16). Residents keep
        `Home · Payments · Food · Notices · More`; someone who already has a bed
        opens the app to pay rent, not to shop for another hostel
  - ☑ Entries whose screens are M5 (complaints, night status, ID card, referrals,
        reviews) are listed and say which release they land in. A row that navigates
        nowhere is indistinguishable from a bug; a row that explains itself is a
        roadmap
  - ☑ Theme toggle wired to `uiSlice`; sign out confirms first

**Acceptance**
- ☐ Upload a payment claim from the camera roll → it appears in the admin's review queue on web
- ☐ Complete an eSewa checkout in the in-app browser → app returns to the invoice, status updated
- ☐ Marking a notice read on mobile clears the unread badge on web

---

## M4 — Notifications: realtime + push

The one phase with mandatory server work.

**Server (`apps/web`)** ✅ *2026-08-16*
- ☑ `modules/notifications/push.service.ts` — batches to Expo's 100-per-request cap,
      POSTs to `https://exp.host/--/api/v2/push/send`, 10s timeout, optional
      `EXPO_ACCESS_TOKEN`
- ☑ Reads tickets positionally and marks `DeviceNotRegistered` tokens **`REVOKED`**
      (the schema's enum is `ACTIVE | REVOKED` — there is no `INACTIVE`). Not deleted:
      `account-purge` owns removal, and deleting races a re-registration in flight
- ☑ Called from `publishNewNotification` — the one funnel every notification already
      goes through, so no call site changed and none can drift
- ☑ `modules/notifications/push-routing.ts` — server-decided deep link per category,
      opening the specific invoice/complaint/notice when the payload names one, so an
      older app build still lands somewhere sensible
- ☑ `actionUrl` overrides the category default, but only for a single-leading-slash
      path — `//evil.example` is protocol-relative and must not reach a router
- ☑ Fire-and-forget from the request path: an Expo round trip must not hold up the
      complaint submission that created the notification
- ☑ Duplicate tokens de-duplicated, so one phone buzzes once
- ☑ 13 tests; full web suite green (1,653)
- ☐ Respect the account's notification preferences and quiet hours

**Mobile**
- ☐ `lib/push-notifications.ts` — permission request, Expo token fetch,
      `POST /api/v1/mobile/device-token` on launch and on every login
- ☐ Android notification channels (default / urgent-SOS / food-ready), each with its own
      importance and sound
- ☐ Foreground, background, and killed-state handlers
- ☐ Tap → `router.push()` on the payload path
- ☐ App-icon badge count, cleared on read
- ☐ **Stub `@react-native-community/netinfo` in `metro.config.js` before importing
      pusher-js.** `pusher-js/react-native` imports netinfo at load time. Installing
      netinfo for real would drop the app out of Expo Go (it is not in Expo Go's
      bundled native modules), so alias it to a JS-only "always connected" shim the
      way the reference app does. Without this the first `require` crashes.
- ☐ `lib/realtime.ts` — `pusher-js/react-native`, pulling `.Pusher` off the required
      namespace (the v8 webpack bundle ends `module.exports.Pusher = r`, so a default
      import resolves to `undefined` and `new undefined()` throws "constructor is not
      callable"). Subscribes to whatever `GET /api/v1/realtime/config` returns,
      authorised by `/api/v1/realtime/auth`
- ☐ Handle `notification:new`, `notification:updated`, `resource:changed` (invalidate by
      topic), `global:announcement` (de-dupe against the durable row by campaign id)
- ☐ Reconnect on foreground; disconnect on logout
- ☐ `notifications.tsx` — list, filters, mark read, mark all read
- ☐ Local notification fallback for realtime events received while in foreground

**Acceptance**
- ☐ Token registers on first launch; visible in the `DeviceToken` collection
- ☐ Admin verifies a payment on web → resident's phone buzzes within seconds, killed state
- ☐ Tapping it opens the invoice, not the tab root
- ☐ Notice published on web → the bell count updates live on mobile with no push involved
- ☐ Logging out stops delivery to that device

---

## M5 — Resident extended

- ☐ **SOS** — big red button, long-press + 3-second cancellable countdown, `POST /resident/sos`
- ☐ SOS reachable from every resident screen (floating action, not a nav item)
- ☐ **Complaints** — list, create with attachments, thread view, confirm resolution
- ☐ **Night status** — set tonight's status, history list
- ☐ **Profile** — personal details, room/bed, guardians, emergency contacts (add/remove)
- ☐ **Digital ID card** — `GET /users/resident-identity`, front/back, save to gallery
- ☐ **Referral** — code, share sheet, referred-list with status
- ☐ **Reviews** — submit hostel rating (overall/food/cleanliness/safety)
- ☐ **Community** — feed with infinite scroll + pull-to-refresh, create post (text + media),
      Public/Hostel-only toggle, anonymous option, 6 reactions, comment threads, report
- ☐ **Settings** — theme, notification preferences, account deletion request, privacy policy

---

## M6 — Public discovery & QR activation ◐ *(all four work items built 2026-08-17)*

**Status:** every screen in this milestone is written, typechecked, linted, unit
tested and bundling. What is left is a **device pass** (the three acceptance
lines below), a map/list toggle on browse, and two items that are not mobile
code at all — the web's `?ref=` gap and verified app links. **No `☑` here means
"seen working on a phone"**: the in-app Browser pane cannot render React Native,
so nothing in `apps/mobile` has been run against a live account yet.

Built against the mockups in [`docs/mockups/mobile/`](mockups/mobile/README.md).
`lib/public-api.ts` is typed from `hostel.service.ts` and the two Zod query
schemas — the service, not the route names, after `finance-api.ts` showed what
guessing costs.

- ☑ `(public)/` + `(browse)/` groups for `PUBLIC_USER` accounts — the app is usable before anyone is a resident
  - ☑ Signed out: plain stack, floating **Log in** pill, no tab bar
  - ☑ Signed-in `PUBLIC_USER` tabs `Home · Search · Compare · Profile` *(2026-08-17)*.
        **Two groups, not one.** expo-router cannot switch a group between a stack
        and a tab navigator at runtime, and `resolveHome` sent both a signed-out
        visitor and a signed-in `PUBLIC_USER` to `/(public)`. So `(public)` stays
        the signed-out stack untouched and `(browse)` carries the tabs; the
        screens themselves are shared components (`components/public-home.tsx`,
        `hostel-browser.tsx`, `hostel-compare.tsx`), because two copies of the
        home screen is how the hero drifts
  - ☑ Platform staff (`SUPERADMIN`, `PLATFORM_MODERATOR`) also land on `(browse)`.
        They were being sent to the signed-out stack, which has no tab bar and no
        sign-out — its bottom edge belongs to the Log in pill — so a signed-in
        staff account had no way to see who it was or to leave. A test now
        asserts no account with a session resolves to `/(public)`
  - ☑ Profile tab is deliberately thin: account, theme, notifications, privacy,
        sign out. Saved hostels and Inquiries are honest "not yet" rows — there is
        no favourites collection and no public-account inquiry-history endpoint
- ☑ Hostel search + filters (`GET /public/hostels`)
  - ☑ **The filter sheet offers only what the server accepts.** The query schema
        takes *one* `facility` and *one* `roomType`, has no `sort` and no
        pagination, and returns the first 60 cheapest-first. The mockup draws
        facilities as a checkbox group and a Sort dropdown — both would be controls
        that silently do nothing while the user believes the list is narrowed. So
        facilities are single-select and Sort is absent until there is one
  - ☑ Filters edit a **draft** and lift on Apply, so the list behind the sheet does
        not reshuffle under a control still being used
  - ☑ Home shortcuts deep-link into the list pre-filtered (`?type=`, `?facility=`, `?q=`)
  - ☑ `Sort: nearest` chip *(2026-08-17)* — the one sort control, and an honest
        one: it re-orders rows already returned using coordinates already in the
        payload, so unlike a server-side Sort dropdown it does something. A
        toggle rather than a dropdown, because there is exactly one alternative
        to cheapest-first, and above the results rather than in the filter sheet
        so its permission dialogue is attached to a tap the user can see
  - ☐ Map/list toggle on browse — the map itself now exists (`hostel-map.tsx`)
        and the home screen uses it; a full-screen map *mode* over the filtered
        list is still unbuilt
- ☑ Hostel detail: photos, facilities, pricing, rules, room availability, nearby
  - ☑ **Every block is gated on having content.** A published hostel can have no
        rules, no nearby places and no room configurations; drawing the frame anyway
        gives a sparse listing a column of empty headings, which reads as the app
        being broken rather than the listing being thin
  - ☑ `Call hostel` renders only when there is a number — a dead call button fails
        after the tap, not before
- ☑ Compare screen (`GET /public/hostels/compare`)
  - ☑ Pinned label column, scrolling hostel columns: on a phone a real table loses
        the reader halfway across, which is the one thing a comparison must not do
  - ☑ Selection lives on the browse list (compare icon per card), capped at 3
        because the server rejects a fourth id outright
- ☑ Send inquiry (`POST /public/hostels/[slug]/inquiries`)
  - ☑ Called an **inquiry**, not a booking, in the copy and on the button. There is
        no booking model, no availability hold and no confirmation; the mockup's
        "Book a Visit" would promise a reserved bed the product cannot deliver
  - ☑ Name + phone are the only required fields (`lib/inquiry-form.ts`, 7 tests) —
        this form gets filled in on a bus
- ☑ `ratingSummary` now on every public payload, so cards show a real star
  - ☑ An unreviewed hostel shows **"New"**, never `0 ★`. Every average is `0` before
        the first review, so rendering the number puts a one-star badge on each new
        hostel — a searcher filters it out and it never earns a review
- ☑ Shared `HostelCard` in two widths (`carousel`, `list`). A second component for
      the second width is how the verified chip ends up in a different corner
- ☑ **Photos render on device** *(fixed 2026-08-17)*. `827a52c` made stored photo
      URLs **relative** (`/api/v1/files/<id>/url`) so one row works on every web
      origin — correct for a browser, which resolves against the page origin, but
      **a phone has no page origin**, so every `<Image>` failed *silently* and the
      whole app showed grey boxes. `lib/media.ts` (8 tests) resolves them against
      `API_BASE_URL` and leaves absolute URLs alone — the demo hostels carry
      `images.unsplash.com` photos, and prefixing those would break the one set
      that worked. No bearer token is needed: `files/[assetId]/url` 302-redirects
      a `PUBLIC` asset straight to R2 without loading a principal
- ☑ **Home screen brought in line with the mockup** *(2026-08-17)* — hero photo
      with a real listing floating over it, "Premium hostels" with client-side
      type pills, trust tiles, and the stats band. Three decisions taken with the
      product owner rather than copied from the drawing:
  - ☑ **The stats band shows real figures.** The mockup and
        `public-home-page.tsx` both hard-code "500+ Verified Hostels / 10,000+
        Happy Students / 50+ Cities / 4.6 ★"; nothing derives any of it and none
        of it is true yet. Mobile computes them from the payload it already has
        (`lib/home-stats.ts`, 11 tests). "Happy Students" has no honest
        equivalent — nothing counts students — so that tile is **vacant beds**,
        which is real and is what a room-hunter wants. The average is weighted by
        review count, and unrated hostels are excluded rather than counted as
        zero. **The web still ships the invented numbers**
  - ☑ **Tabs stay four** — `Home · Search · Compare · Profile`. The mockup draws
        Bookings and Messages; there is no booking model and no messaging
        endpoint, and a tab that opens onto a permanent empty state is the tab
        people stop trusting
  - ☑ **"Services to make life easy" row skipped.** Its "Book a Room" needs a
        booking model that does not exist, and "Report an Issue" is complaints,
        which is M5. Same for the mockup's "Rent on the go" grid, and for "List
        your Hostel" — there is no hostel-registration screen on mobile to send
        anyone to
  - ☑ Hero imagery is the **best-rated verified listing that has a photo**, not
        stock art: the card over it is tappable and goes where it says
  - ☐ Mockup's "Announcements / Notices" section — no public announcements
        endpoint exists (`/api/v1/public/*` has no notices route), and the mockup
        itself draws it empty. Needs a server endpoint before it can be built
- ☑ `lib/hostel-display.ts` — 24 tests over the branches a screenshot would not
      catch: `NPR 8,000 – 8,000` for a single-price hostel, metres printed as
      `3200 km`, `0 beds vacant` hidden as if it were unknown
- ☑ **Device location → nearby hostels**, plus a map on the home screen *(2026-08-17)*
  - ☑ **Client-side haversine, no server change** (`lib/geo.ts`, 16 tests). The
        server has no `2dsphere` index and no `lat`/`lng` in the query schema, but
        `/public/hostels` already returns `coordinates` on every row and caps at
        60 — so sorting 60 points in JS is correct at this size and costs one
        pass. `haversineMeters` mirrors `apps/web/src/lib/maps/nearby.ts` so a
        distance on the phone matches the one on the web. The server query
        (`Point` mirror field + `2dsphere` + `$geoNear` + a backfill migration)
        becomes a plan item when the dataset outgrows the cap
  - ☑ **Prompted on intent, never on launch** — the "Near me" button in Home's
        *Near you* card and the `Sort: nearest` chip on browse. Nothing runs at
        boot: a dialogue before the product has shown a hostel is the one people
        decline, and on Android a "don't ask again" refusal is permanent
  - ☑ Coarse only: `ACCESS_COARSE_LOCATION` requested, `ACCESS_FINE_LOCATION` in
        `blockedPermissions`, and `Accuracy.Low` at the call site. Sorting by
        rough proximity does not need a street-level fix
  - ☑ **Coordinates are never persisted.** The position is `useState` in
        `use-nearby.ts` and dies with the screen — never dispatched to Redux,
        which `redux-persist` writes to disk. Same line `apps/web` holds
        attendance pings to
  - ☑ Every failure keeps the list usable: denied → cheapest-first with a
        reason; blocked → the chip becomes an *Open settings* link rather than
        vanishing; no fix in 8s → unsorted, never a spinner over working content.
        Last-known fix is used first so an indoor cold GPS lock is not 30s of wait
  - ☑ Un-geocoded hostels sort **last** rather than being dropped, and show no
        distance at all — `0 m away` on a hostel nobody placed is a confident lie
  - ☑ **Map is Leaflet + OSM tiles in a `react-native-webview`**, not
        `react-native-maps` (`components/hostel-map.tsx`). No Google Maps Android
        key exists, and `apps/web` already draws the same OSM tiles — one map
        provider across the product beats a second one for a single platform.
        The map is an addition to the sort and never the only route to a hostel:
        it is blank without a network, and the sorted list beside it is not
- ☑ **QR activation** — `expo-camera` scanner + manual code entry, `POST
      /resident/activate`, then straight into `(resident)` with no relaunch *(2026-08-17)*
  - ☑ **The QR does not contain the code — it contains a URL.**
        `activationUrl()` renders the PNG from
        `<app>/resident-activation?code=…` because the same image is printed for
        the web flow, so a scanner that posts the decoded string gets
        `ACTIVATION_CODE_INVALID` while the code in the picture was perfectly
        good. `lib/activation-code.ts` (13 tests) pulls the code out of the URL,
        accepts a bare code, and rejects a QR for something else — a wifi config
        or a vCard — rather than posting it as a failed attempt
  - ☑ **Activation is a sign-in.** The route runs `requireApiPrincipal` *first*,
        so the user is already signed in; it then promotes them to `RESIDENT`,
        adds the hostel to `hostelIds`, and ends with `issueSessionForUser`. The
        token in memory still names the old role, so the response goes through
        `startSession` exactly as a login would. `isResidentActivated` is then
        set locally rather than re-fetched — the call that just returned *is* the
        activation, and if that extra request failed on a flaky connection the
        boot gate would send them straight back here
  - ☑ Double-submit guarded by a **ref, not state**: `onBarcodeScanned` fires
        every frame the code is in view, several times before React re-renders,
        and each one would burn the single-use code and then 409 on itself
  - ☑ **Manual entry is the other half, not a fallback** — scanning fails on
        cracked screens, photocopied stickers and bad light. Both paths run one
        `submit`; codes are normalised (the server hashes `trim().toUpperCase()`)
  - ☑ Camera permission is **not** requested on mount, for the same reason as
        location: refused-with-don't-ask-again cannot be undone from inside the
        app. Prompt behind a button; permanent refusal offers system settings
  - ☑ A wrong QR is answered **at the camera**, as a strip over the frame; what
        the server says lands under the field holding the code it rejected
  - ☑ **Sign out is in the app bar.** The boot gate sends an unactivated resident
        here on every launch, so without it an expired code is a locked app —
        and an expired code is the normal case for anyone who left it a week
- ☑ Torch toggle for low-light scanning (`enableTorch`)
- ☑ Activation carries device + session info *(2026-08-17)* — `lib/device-info.ts`,
      from `expo-device`/`expo-application`, tagged `source: "mobile"` to mirror the
      web's `{ source: "web" }`. Per-install id only: no location, no phone number,
      no advertising id.
      **Note: nothing renders this yet.** No admin screen reads
      `QRActivation.deviceInfo` — the only `deviceInfo.fingerprint` reader in the
      repo is `operations-analytics.service.ts`, which is `FoodReadyLog`, a
      different collection. It is written because the answer to "which phone
      claimed this code" cannot be reconstructed later, not because a panel shows it
- ☑ Referral deep link `hostelhub://ref/<code>` → `app/ref/[code].tsx` *(2026-08-17)*
  - ☑ **The file name is the handler.** expo-router resolves the scheme to the
        route on a cold start and while the app is running, so there is no
        `getInitialURL`/`addEventListener` pair and no cold-start case to forget
  - ☑ **Fixed a cold-start bug this uncovered:** the splash was hidden from
        `app/index.tsx`, which a deep link never renders — so a link-launched app
        would have sat behind the splash forever. `_layout.tsx` owns the hide now,
        being the one component every route mounts under. This would have hit
        *every* future deep link, not just referrals
  - ☑ Posts to `/public/inquiries/with-referral` — a different endpoint from the
        plain hostel inquiry, and rate limited. One `InquiryFields` component,
        branching only on which function it calls
  - ☑ `lib/referral-link.ts` (12 tests) parses the app scheme **and** the
        `/inquiry?ref=<code>` web link residents actually share. Note the range
        is 4–32, *not* activation's 6–32 — one shared validator would have
        silently rejected valid four-character codes
  - ☑ **The screen cannot name the hostel, and does not pretend to.** The server
        resolves the code to `referralCode.hostelId`; no public endpoint maps a
        code to a hostel, so the copy says "a friend has referred you to their
        hostel". Guessing a name would send someone's details to the wrong place
        confidently
  - ☐ **Server/web gap found while building this: every referral shared so far has
        been dropped.** `referral.service.ts` hands residents a `/inquiry?ref=<code>`
        link, but `public-inquiry-page.tsx` reads only `hostel` and `room` and
        ignores `ref` — and nothing outside a test has ever called
        `/public/inquiries/with-referral`. The mobile screen is the product's
        first real consumer; the web page needs the same treatment
  - ☐ An `https://` referral link still opens the browser, not the app — verified
        app links need `assetlinks.json` on the domain plus `intentFilters`
        (Android) and `associatedDomains` + AASA (iOS), none of which is
        configured. The parser already accepts that form, so it is config, not code

> **Work order, blockers and traps for the rest of M6:**
> [`MOBILE_M6_HANDOFF.md`](MOBILE_M6_HANDOFF.md).

**Acceptance**
- ☐ Fresh install → browse hostels without an account
- ☐ Register → scan QR → dashboard loads, no relaunch, no login flash
- ☐ Manual code entry reaches the same state

---

## M7 — Guardian · Cook · Provider · Admin-lite

Four small role groups sharing the M1 primitives.

**Guardian** — `(guardian)/`, amber role colour
- ☐ Dashboard (`/guardian/dashboard`), safety summary, night-status visibility
- ☐ Payments view (read-only), notices, food
- ☐ Invitation acceptance deep link
- ☐ Respects the per-guardian permission flags — a disabled section is absent, not empty

**Cook** — `(cook)/`
- ☐ Today: menu + resident count
- ☐ Four large **Food Ready** buttons (breakfast / lunch / snacks / dinner) →
      `POST /cook/food-ready`, optional custom message
- ☐ Food photo upload straight from camera
- ☐ Read-only resident list and weekly menu
- ☐ Device fingerprint registered on first login
- ☐ *(server gap #3: cook-scoped read endpoints)*

**Service Provider** — `(provider)/`
- ☐ Jobs feed — `GET /public/service-providers/me/jobs`, open work first
- ☐ Job detail: hostel address + contact, tap-to-call, mark complete
- ☐ Provider ID card with pending/approved status tag
- ☐ *(broadcast-and-claim deferred — server gap #4)*

**Hostel Admin (lite)** — `(admin)/`, cyan role colour. Deliberately not a port of the web portal.
- ☐ Read-only dashboard: occupancy, dues, today's activity
- ☐ Alert inbox: new inquiry, payment claim, complaint, SOS
- ☐ Quick actions only: approve/reject a payment claim, reply to a complaint, acknowledge an SOS
- ☐ Everything else links out to the web portal in a browser

---

## M8 — Native polish & offline

- ☐ Biometric unlock (`expo-local-authentication`) gating app open, opt-in in Settings
- ☐ Offline: persisted slices render cached dashboard/payments/notices with a stale banner
- ☐ Queue payment-claim uploads made offline; flush on reconnect
- ☐ Native image viewer (pinch/pan) for food photos, community media, ID card
- ☐ Share sheet: referral code, hostel listing, receipt PDF
- ☐ `tel:` / `sms:` shortcuts for hostel admin and emergency contacts
- ☐ Deep-link table covering every push payload path; verify cold-start deep links
- ☐ Pull-to-refresh everywhere; optimistic updates on read/react actions
- ☐ Reanimated transitions between tab groups; no layout jump on the boot redirect
- ☐ Sentry (`@sentry/react-native`) with release tagging

---

## M9 — GPS auto-attendance *(deferred — build after the product above ships)*

Explicitly out of scope for the first release. The server side already exists
(`POST /resident/location/ping`, `/resident/consent`, `/resident/attendance`).

> **Privacy invariant, enforced by a test on the web side:** attendance pings must
> **never** persist coordinates. The server stores an inside/outside verdict only.
> Any mobile work here must keep that true — do not add a "last known location" field.

- ☐ Consent screen with the exact wording: coordinates are not stored
- ☐ `expo-location` foreground permission, then background permission as a separate ask
- ☐ `expo-task-manager` background task
- ☐ Geofence around the hostel rather than continuous tracking (battery)
- ☐ Ping at the hostel's configured times, fetched from resident settings
- ☐ Permission denied → report `UNKNOWN`, never fail silently
- ☐ Settings screen to review and revoke
- ☐ Android battery-optimisation exemption prompt with an explanation
- ☐ Verify on a physical device across a full day, screen off

---

## M10 — Release

- ☐ **Before any build: confirm the app identifiers in `apps/mobile/app.json`**
      — `android.package` and `ios.bundleIdentifier` must both read
      `com.softmato.hostelhub`. There is no `apps/mobile/android/` directory to
      check: the app uses Expo CNG, so `app.json` is the only source of truth and
      any prebuild output is regenerated from it. Once a build is published to
      the Play Store or App Store the identifier is permanent — a wrong one means
      a new listing, not an update, so verify it every time rather than assuming
      a previous build got it right.
- ☐ App icons, adaptive icon layers, splash, notification icon — all sizes
- ☐ `google-services.json` (Android FCM) and APNS key (iOS)
- ☐ Privacy policy URL in app config (the web already serves one)
- ☐ Store listing copy + 5–6 screenshots per platform
- ☐ EAS `preview` APK distributed internally
- ☐ Physical Android device pass over every acceptance test above
- ☐ iOS simulator pass (physical device if one is available)
- ☐ EAS `production` build; `expo-updates` channel configured
- ☐ `CHANGELOG.md` entry, `docs/MEMORY.md` updated, PHASES.md §6 ticked

---

## Definition of Done (mirrors PHASES.md §6.3)

- ☐ M0–M8 and M10 fully ticked (M9 tracked separately)
- ☐ Push notifications working end-to-end, killed state included
- ☐ QR scanning reliable in poor light
- ☐ Tested on a real device
- ☐ APK ready for distribution
- ☐ **Complete product delivered: web platform + mobile app**
