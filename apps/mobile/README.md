# HostelHub Mobile

One Expo app for every audience — resident, guardian, cook, service provider,
hostel admin (lite) and public browser. After sign-in the router drops each role
into its own group under `src/app`; there is no second build and no second store
listing.

Build plan and phase tracker: [`docs/MOBILE_APP_PHASES.md`](../../docs/MOBILE_APP_PHASES.md).

## Run it

```bash
npm --prefix apps/mobile install
npm run mobile:start
```

Scan the QR with Expo Go (or a development build once native modules need it —
push notifications and the camera do). The API base URL is derived from
whichever machine is serving Metro, so a phone on the same Wi-Fi reaches
`npm run web:dev` with no configuration.

| Command | What it does |
|---|---|
| `npm run mobile:start` | Metro dev server |
| `npm run mobile:typecheck` | `tsc --noEmit` |
| `npm run mobile:test` | Vitest — pure logic only (routing, formatting) |
| `npm run mobile:lint` | ESLint |
| `npm run mobile:build:test` | Bundle for Android without EAS; proves it compiles |
| `npm run mobile:build:preview` | EAS internal APK |

### Before you build

Confirm the app identifiers in [`app.json`](app.json) first — `android.package`
and `ios.bundleIdentifier` are both `com.softmato.hostelhub`. This app uses Expo
CNG, so there is no checked-in `android/` directory: `app.json` is the sole
source of truth and prebuild regenerates the native project from it every time.
Store identifiers cannot be changed after a release is published, so a wrong one
costs you a new listing rather than an update.

## Environment

All client env vars must be prefixed `EXPO_PUBLIC_` to reach the bundle. None of
them are secret — anything in here ships inside the APK and can be read out of it.

| Variable | Needed for | Default |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | Production/staging API origin | Metro's host in dev, else `http://localhost:3000` |
| `EXPO_PUBLIC_WEB_DEV_PORT` | Dev web server port | `3000` |
| `EXPO_PUBLIC_PUSHER_KEY` | Live notifications | — |
| `EXPO_PUBLIC_PUSHER_CLUSTER` | Live notifications | — |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google sign-in — the only one code reads on Android | — |
| `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` | Reference only; see below | — |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Google sign-in (iOS) | — |

> **These live in `apps/mobile/.env`, not the repo-root `.env`.** That is the one
> deliberate exception to the single-env-file rule: Expo loads `.env` from the
> project directory it is started in and does not walk up to the monorepo root,
> so an `EXPO_PUBLIC_` var at the root never reaches the bundle. The root `.env`
> keeps `GOOGLE_CLIENT_ID` for the *server's* audience check; all three IDs below
> must come from the same Google Cloud project as it, or the token the phone gets
> will not verify.

### Google sign-in

Two OAuth clients in one Google Cloud project, doing two different jobs:

- The **web** client is what the ID token is *addressed to*. `configure({
  webClientId })` makes Google mint a token whose `aud` is that client, and the
  server verifies with `audience: GOOGLE_CLIENT_ID` — the same web client the
  website uses. This is the only client id any mobile code reads.
- The **Android** client is what authorises *this APK* to reach Google at all,
  matched on `com.softmato.hostelhub` plus the signing certificate's SHA-1. It
  must exist, and every keystore that signs a build needs its SHA-1 registered
  on it — the EAS one **and** the local debug keystore, or `expo run:android`
  fails while an EAS build works. It is never named in code.

Naming the Android client in `configure()` is the obvious mistake and produces a
token the server rejects as `GOOGLE_TOKEN_INVALID`, with nothing in the message
to say why.

**It needs a dev or preview build** — `@react-native-google-signin/google-signin`
is a native module and is not in Expo Go. Nothing on the boot path imports
[`src/lib/google-auth.ts`](src/lib/google-auth.ts), so the rest of the app still
runs under Expo Go; only the Google button is dead there.

No config plugin is registered for it. The plugin's bare form is its *Firebase*
mode and demands a `google-services.json` this project does not have; the other
form exists only to add an iOS URL scheme. Android needs neither. Add
`["@react-native-google-signin/google-signin", { "iosUrlScheme": "…" }]` to
`app.json` when an iOS client is created.

In development you normally set none of these. `resolveApiBaseUrl` in
[`src/lib/api.ts`](src/lib/api.ts) reads the LAN address Metro is being served
from and points the API at port 3000 on the same machine — which is almost
always also running the web app. Hardcoding a LAN IP goes stale every time the
router hands out a new DHCP lease.

## How it is put together

```
src/
  app/            expo-router routes; one group per audience
    index.tsx     the boot gate — see below
    (auth)/       login, register, OTP, password reset
    (public)/     hostel discovery, usable with no account
    (resident)/   the primary product
    (guardian)/ (cook)/ (provider)/ (admin)/
  components/     ui/ primitives + shared pieces
  constants/      theme tokens, role→route map, branding
  hooks/          typed redux hooks, theme resolver
  lib/            api client, session, per-domain API modules
  store/          Redux Toolkit slices, persisted with redux-persist
```

### The boot gate

The splash must never flash the login screen on the way to a dashboard.

1. `app/_layout.tsx` holds the native splash and calls `bootstrapSession()`,
   which reads the tokens out of SecureStore. No network.
2. `app/index.tsx` renders a JS splash drawn to match the native one, then
   redirects using `resolveHome()` — a pure function of the *cached* account.
3. Only after that does `revalidateSession()` confirm the token and role against
   `/auth/me`, re-routing if something changed.
4. If the refresh token is dead, the axios interceptor wipes every slice, purges
   what is on disk, and lands on login.

`resolveHome` is covered by [`src/constants/roles.test.ts`](src/constants/roles.test.ts).
Every case in it runs before the first frame, so a wrong answer is a visible
wrong screen.

### Tokens

Access and refresh tokens live in `expo-secure-store` (Keychain /
EncryptedSharedPreferences) and are stripped from the redux-persist payload —
AsyncStorage is a plaintext file that ends up in device backups. Only the cached
*account* is persisted, because the gate has to read it before the first frame,
and it holds nothing secret.

### Styling

NativeWind v4. Colours are CSS variables in [`src/global.css`](src/global.css),
ported name-for-name from `apps/web/src/app/globals.css`, with the JS mirror in
[`src/constants/theme.ts`](src/constants/theme.ts) for the handful of consumers
that cannot use `className` (status bar, splash, notification channels).

**The brand is green (`#0a8a4b`), not blue.** Mockups in `docs/` are blue for
historical reasons — see `docs/DESIGN.md`. Never write a colour literal in a
component.

## Assets

Everything in `assets/images/` is a **generated placeholder** — see
[`assets/images/README.md`](assets/images/README.md) for what each file is and
the two constraints that matter when the real logo replaces them.

## Testing

Vitest runs Node-only, over pure logic. There is deliberately no React Native
render harness: shimming RN under vitest mostly tests the shim. Component
behaviour is verified on a device, which is what the acceptance tests in the
phase tracker are for.
