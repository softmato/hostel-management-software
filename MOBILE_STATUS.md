# MOBILE_STATUS.md — `apps/mobile`

**Last verified:** 2026-08-02 (files counted, `npm run mobile:typecheck` clean)

**Read this first if any other document disagrees with it.** Two earlier
statements were both wrong:

- This file previously claimed "Phase 1 & 2 complete, Phase 3 ready to build"
  using its *own* phase numbering, dated 2026-06-25 — before `docs/` was even
  finalised. It undersold what exists: it listed 6 screens; there are 17.
- `docs/MEMORY.md` claimed "nothing of `apps/mobile` exists yet beyond a stub".
  Also wrong — there is a working Expo app with a 32-function API client.

Phase numbers below follow **PHASES.md**, where all mobile work is **Phase 6**.
The old local "Phase 1/2/3" numbering is retired.

---

## Stack

| | |
|---|---|
| Framework | Expo SDK 56 / React Native 0.85.3 |
| Navigation | React Navigation v7 (native stack) |
| Token storage | `expo-secure-store` |
| Camera / QR | `expo-camera` (`barcodeScannerSettings: { barcodeTypes: ["qr"] }`) |
| Image picking | `expo-image-picker` |
| API | Same REST surface as web, `/api/v1`, with `x-hostelhub-client: mobile` |
| Base URL | `EXPO_PUBLIC_API_BASE_URL` (use your machine's LAN IP for device testing) |

Android native project is committed under `apps/mobile/android/`.

---

## What is actually built

**17 screens, ~2,200 lines, typecheck clean.**

### Auth
`LoginScreen` · `SignupScreen` · `OtpVerificationScreen`

Email/phone + password, phone-OTP and email-OTP registration, refresh-token
rotation, logout with session cleanup. Google sign-in accepts an ID token but
has no native SDK wired up — it is a placeholder.

### Public
`PublicHomeScreen` · `PublicHostelDetailScreen`

Listing with search and hostel-type filter, pull-to-refresh, hostel detail with
verification badge and capacity, and inquiry submission.

### Resident
`ResidentActivationScreen` (**QR camera scan works** — this was listed as
"Phase 3 todo" and is done) · `ResidentHomeScreen` · `ResidentProfileScreen` ·
`ResidentPaymentsScreen` (proof upload) · `ResidentFoodScreen` (menu, photos,
feedback) · `ResidentNoticesScreen` · `ResidentComplaintsScreen` ·
`ResidentNightStatusScreen` · `ResidentSOSScreen` · `ResidentReviewsScreen` ·
`ResidentReferralScreen` · `ResidentNotificationsScreen`

### Infrastructure
- `src/api/client.ts` — 32 typed functions covering auth, public and the whole
  resident surface. Includes `saveDeviceToken()` already.
- `src/auth/token-store.ts` — secure access/refresh storage, session persistence.
- `src/navigation/AppNavigator.tsx` — native stack, role-based routing
  (public vs resident).

---

## What is missing for Phase 6

| Gap | Notes |
|---|---|
| **Push notification receipt** | `expo-notifications` is not a dependency. `saveDeviceToken()` exists in the client but nothing calls it with a real token, because nothing obtains one. |
| **Push notification delivery** | Server-side. Every "sends push" line in Phases 3–5 currently means "wrote an in-app `Notification`". Tracked as `TODO.md` Track C1 — delivery goes through the **Expo push service**, so no Firebase Admin SDK is needed server-side. |
| **Background location service** | `expo-location` + `expo-task-manager` are not dependencies. `POST /api/v1/resident/location/ping` is live and the zone maths is tested; only the device side is missing. |
| **Guardian screens** | None. |
| **Cook screens** | None. `POST /api/v1/cook/food-ready` works and the analytics read its output. |
| **Global floating SOS button** | There is an SOS *screen*; PHASES.md §6 wants it reachable from anywhere. |
| **Google sign-in** | Needs `@react-native-google-signin/google-signin` or Expo's Google auth module. |
| **Automatic refresh on 401** | The client can refresh, but does not retry a 401 automatically. |

---

## Commands

Run from the repo root (**npm**, not pnpm):

```bash
npm install
```

```bash
npm run mobile:start
```

```bash
npm run mobile:typecheck
```

```bash
npm --prefix apps/mobile run android
```

Set the API base URL before starting — `localhost` will not resolve from a
physical device:

```bash
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.100:3000
```

---

## API reference

`docs/MOBILE_API.md` is the endpoint-by-endpoint reference (method, path, auth,
params, response shape, error codes) written for mobile work. Use it instead of
reading route handlers. `docs/API.md` remains the general API document.

---

## Design tokens

The mobile app hardcodes its palette in `src/screens/styles.ts`. The web app
moved to oklch tokens with a green brand (`--brand-teal: #0a8a4b`) and four
per-portal role colours — see DESIGN.md §2. The two are close but not
generated from one source; reconcile before the app ships publicly.

Current mobile values: primary `#10b981`, background `#f8fafc`, card `#ffffff`,
text `#0f172a` / `#475569` / `#64748b`, border `#e2e8f0`, chip `#dcfce7` on
`#047857`.
