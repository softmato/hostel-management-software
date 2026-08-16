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
- ☐ Remaining primitives as screens need them: `Select`, `Badge`, `Avatar`, `Skeleton`,
      `Sheet`, `ListRow`, `Money`, `StatusPill`
- ☐ Global upload-progress toaster (the web's universal uploader pattern, ported)
- ☐ Nepali rupee formatting + Nepali/English date helpers
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
- ☐ `(auth)/register.tsx` — signup → OTP challenge → verify → session *(screen is a stub;
      `requestOtp`/`verifyOtp`/`register` are already typed in `lib/auth-api.ts`)*
- ☐ `(auth)/forgot-password.tsx` → reset flow *(stub)*
- ☐ Google sign-in via `expo-auth-session` **(needs server gap #2)**
- ☐ `mustChangePassword` accounts (provisioned cook/warden) forced through a set-password step
- ☐ Verify on device: cold start with a valid token shows **no login flash**

**Acceptance**
- ☐ Cold start with a valid token lands on the role dashboard with **no login flash**
- ☐ Kill the app, expire the access token server-side, relaunch → silent refresh, still no flash
- ☐ Revoke the refresh token → relaunch → lands on login, store empty
- ☐ Log in as resident, log out, log in as cook → no resident data visible anywhere

---

## M3 — Resident core

The primary audience. Tabs: **Home · Payments · Food · Notices · More**.

- ☐ `(resident)/_layout.tsx` — bottom tabs, resident role colour
- ☐ **Home** — `GET /resident/dashboard`: room/bed, dues summary, today's menu,
      latest notices, night status, quick actions
- ☑ `lib/finance-api.ts` — the whole finance surface typed against the live routes,
      with the dead `/resident/payments` paths named in its header so the old mistake
      cannot recur
- ☐ **Payments** — `GET /resident/finance/invoices` list + detail
  - ☐ Invoice detail with line items and running balance
  - ☐ `GET /invoices/[id]/pay-instructions` — bank/QR payee details
  - ☐ `POST /invoices/[id]/claims` — submit a payment claim with evidence
  - ☐ Evidence upload: `expo-image-picker` → `/files/presign` → PUT to R2 → `/files/[assetId]/complete`
  - ☐ Gateway checkout: `POST /invoices/[id]/checkout` → eSewa/Khalti via `expo-web-browser`,
        return handled by the `hostelhub://` deep link
  - ☐ Receipts: `GET /receipts/[id]/pdf` and `GET /statement/pdf` → native share/open
- ☐ **Food** — `GET /resident/food`: weekly routine, month-end special, photo gallery
  - ☐ Feedback: `POST /resident/food/feedback` (rating + optional anonymous comment)
  - ☐ Photo upload: `POST /resident/food/photos`
- ☐ **Notices** — `GET /resident/notices`, category filter, urgent styling,
      `PATCH /notices/[id]/read`
- ☐ **More** — profile, complaints, night status, referral, settings, logout entries

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

## M6 — Public discovery & QR activation

- ☐ `(public)/` group for `PUBLIC_USER` accounts — the app is usable before anyone is a resident
- ☐ Hostel search + filters (`GET /public/hostels`), map/list toggle
- ☐ Hostel detail: photos, facilities, pricing, rules, reviews, room availability
- ☐ Compare screen (`GET /public/hostels/compare`)
- ☐ Send inquiry (`POST /public/hostels/[slug]/inquiries`)
- ☐ **QR activation** — `expo-camera` scanner + manual code entry fallback,
      `POST /resident/activate`, then re-route into `(resident)` without a relaunch
- ☐ Torch toggle for low-light scanning
- ☐ Activation carries device + session info for the admin's device-fingerprint record
- ☐ Referral deep link `hostelhub://ref/<code>` prefills the inquiry form

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
