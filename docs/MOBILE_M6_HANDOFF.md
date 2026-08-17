# Mobile — M6 handoff

**Written 2026-08-17. §2 was executed the same day — see the status box below
before building anything from it.**

Start the next session by reading this file, then
[`MOBILE_APP_PHASES.md`](MOBILE_APP_PHASES.md) §M6 and
[`mockups/mobile/README.md`](mockups/mobile/README.md).

This is the work order for the rest of M6. Everything below is either *decided*
(build it as written) or *blocked* (named, with what unblocks it). Nothing here
is a suggestion to re-litigate.

---

## 0. Status — all four §2 items are built

| §2 item | State |
|---|---|
| 2.1 `PUBLIC_USER` tabs | **Built.** `(browse)` group, shared `public-home.tsx` |
| 2.2 Location → nearby | **Built.** Haversine sort + "Near me" + `Sort: nearest` + Leaflet map |
| 2.3 QR activation | **Built.** Scanner, torch, manual entry, device info |
| 2.4 Referral deep link | **Built.** `app/ref/[code].tsx` |

Verified after the last item: `mobile:typecheck` clean, `mobile:lint` clean,
`mobile:test` **138 passing / 13 files**, `expo export --platform android`
bundles (5.3 MB). **Still no device run** — that is the next thing worth doing
and it is yours.

Three things were found during the build that the sections below did not know:

1. **The activation QR encodes a URL, not the code** —
   `<app>/resident-activation?code=…`, because the same image is printed for the
   web flow. A scanner posting the decoded string gets `ACTIVATION_CODE_INVALID`
   on a perfectly good code. Handled in `lib/activation-code.ts`.
2. **The splash was hidden from `app/index.tsx`**, which a deep link never
   renders — so a link-launched app sat behind the splash forever. Ownership
   moved to `_layout.tsx`. This would have broken *every* deep link, including
   every push-notification path in M4.
3. **Every referral shared so far has been dropped.** The web generates
   `/inquiry?ref=<code>` links, but its inquiry page ignores `ref` and nothing
   outside a test ever called `/public/inquiries/with-referral`. The mobile
   screen is the product's first real consumer; the web needs the same fix.

What is left in M6: the device pass, a map/list toggle on browse, the web `?ref=`
gap, and verified app links (`assetlinks.json` / `associatedDomains`) so an
`https://` referral link opens the app instead of the browser.

---

## 1. Where we are

`apps/mobile` is at **M3 complete, M6 discovery screens complete**.

| Verified 2026-08-17 | Result |
|---|---|
| `npm run mobile:typecheck` | clean |
| `npm run mobile:lint` | clean |
| `npm run mobile:test` | 96 passing, 10 files |
| `expo export --platform android` | bundles (5.2 MB) |
| `npm run test --workspace web` | 1,694 passing, 116 files |
| `npm run lint --workspace web` / `tsc --noEmit` | clean |

**No device run has happened yet.** The in-app Browser pane cannot render React
Native (it runs with `document.hidden === true`, so React never hydrates), so
every `☑` in the tracker means "typechecks, lints, tests, and bundles" — not
"seen working on a phone". A device pass against a live account is the first
thing worth doing and is not in the list below because it is yours.

### What exists

```
src/lib/          api · api-contract · session · auth-api · auth-session
                  resident-api · finance-api · public-api        ← API seams
                  format · status · mime · food-week · hostel-display
                  invoice-ledger · claim-form · inquiry-form     ← pure, tested
                  uploads · documents · checkout · wallet · toast
src/hooks/        use-resource (the one GET-with-four-states hook)
src/components/   hostel-card · role-tabs · tab-bar · bottom-chrome
src/components/ui badge · button · card · input · list-row · money
                  screen · states · text · app-bar · floating-button
src/app/          (auth) (public) (resident) (guardian) (cook) (provider) (admin)
                  invoice/[id]/{index,pay,claim} · checkout/[reference]
                  hostel/[slug]/{index,inquiry} · compare · activate
```

### Conventions that are settled — follow them, don't reinvent

1. **Read the *service*, not the route name.** `finance-api.ts` was originally
   typed by guessing from endpoint names; its `PayInstructions` and checkout
   shapes were both wrong and would have thrown on the first real call. Every
   API type in `lib/*-api.ts` now cites the `apps/web` serializer it mirrors.
2. **Pure logic lives in `lib/`, never in a screen.** Vitest here is node-side
   with no React Native shim, so anything importing `react-native` — or
   importing a module that does — cannot be tested. This is why the status→tone
   table is in `lib/status.ts` and the day arithmetic is in `lib/food-week.ts`.
3. **`useResource` for every GET.** `loading` is the first load only; refresh
   and refocus keep the stale data on screen. Do not add TanStack Query — the
   M8 offline cache is redux-persist's job and two caches that disagree is
   worse than one.
4. **Detail screens go on the root stack.** A folder nested under a `<Tabs>`
   layout becomes another tab.
5. **Money and dates through `lib/format.ts`.** Hand-rolled, not `Intl`: Hermes
   borrows the *platform's* ICU, so `en-NP` resolves differently per handset.
   Dates are pinned to NPT (UTC+05:45).
6. **Never render a control the server will ignore.** The browse filter sheet is
   single-select on facility and has no Sort because
   `publicHostelListQuerySchema` accepts neither. A control that silently does
   nothing is worse than an absent one — the user believes the list is filtered.
7. **Never render a field nothing writes.** Grep for who *writes* a value before
   trusting it. The resident dashboard's `nightStatus` and `complaints` are
   hardcoded literals; Home fetches night status separately and hides complaints.

---

## 2. Work order

### 2.1 `PUBLIC_USER` tabs — `Home · Search · Compare · Profile`

**Decided.** Residents keep their own five tabs and reach discovery through
More; a signed-in `PUBLIC_USER` gets discovery tabs.

The problem to solve first: `(public)/_layout.tsx` is a plain `<Stack>`, and
`resolveHome` sends **both** a signed-out visitor and a signed-in `PUBLIC_USER`
to `/(public)` ([`constants/roles.ts:78`](../apps/mobile/src/constants/roles.ts)).
The same group therefore has to be a stack for one and tabs for the other, and
expo-router will not switch a layout's navigator type at runtime without
remounting the tree.

Take the split-group approach:

- Keep `(public)/` as the **signed-out** stack exactly as it is — floating Log
  in pill, no tab bar. This is the §0 shell contract and is not negotiable.
- Add `(browse)/` with `RoleTabs accent="PUBLIC"` and four screens:
  `index` (the same home), `search` (the browse list), `compare`, `profile`.
- Point `resolveHome` at `/(browse)` for a signed-in `PUBLIC` account that is
  not an approved provider, and extend `roles.test.ts` — that file is the boot
  contract and every case in it runs before the first frame.
- Extract the home screen's body into `components/public-home.tsx` so both
  groups render one component. Two copies is how the hero drifts.
- `Profile` for a `PUBLIC_USER` is: name/email, saved searches (none yet),
  theme, notification prefs, privacy, sign out. Reuse the `More` tab's card and
  row structure from `(resident)/more.tsx`.

**Do not add Bookings, Messages or Saved.** No booking model, no messaging
endpoint, no favourites collection exists server-side.

### 2.2 Location → nearby hostels

**Decided: build it.** Prompt for location, sort by distance, show a map on the
home screen with nearby hostels on it.

Two things block a naive implementation, both real:

**(a) There is no geospatial query on the server.**
`publicHostelListQuerySchema` has no `lat`/`lng`/`radius`, and the `Hostel`
model has **no `2dsphere` index** — `location.lat` and `location.lng` are plain
numbers, not a GeoJSON `Point`, and the declared indexes are slug,
`status+area+hostelType`, `verificationStatus+status` and `ownerId+status`
([`packages/db/src/models/Hostel.ts:167`](../packages/db/src/models/Hostel.ts)).

Ship **client-side distance first**: `/public/hostels` already returns
`coordinates` for up to 60 hostels, so a haversine sort on the client is
correct, needs no server change, and is honest at this data size. Put the
haversine in `lib/geo.ts` with tests — it is exactly the kind of arithmetic that
looks right and is out by a factor of 1,000 (see `formatDistance`, where metres
were nearly printed as kilometres).

Only add the server query when the dataset outgrows 60 rows. When you do, it is:
a GeoJSON `Point` mirror field on `Hostel`, a `2dsphere` index, `lat`/`lng`/
`radius` on the query schema, and `$geoNear` — and it needs a backfill migration
for existing hostels, so it is a plan item, not a patch.

**(b) `expo-location` is not installed, and the map has no provider.**

- `expo-location` must be added, plus `NSLocationWhenInUseUsageDescription` and
  `ACCESS_COARSE_LOCATION`/`ACCESS_FINE_LOCATION` in `app.json`. **Coarse is
  enough** — the product sorts hostels by rough proximity and never needs a
  street-level fix, and asking for fine location for that is a permission
  dialogue people decline.
- **The map has no key.** `react-native-maps` on Android requires a Google Maps
  Android API key and there is none in `.env` — only `GOOGLE_CLIENT_ID`, which
  is OAuth and unrelated. The web app avoids this entirely by using **Leaflet
  with OSM tiles**. Decide one:
  1. Get a Google Maps Android key → `react-native-maps`, native feel, a key to
     manage and bill.
  2. `react-native-webview` + Leaflet → matches the web exactly, no key, adds a
     dependency and a webview's performance.
  3. Ship the location *sort* without a map, and add the map behind whichever of
     the above lands. **This is the one to build first** — the sort is the part
     that changes what people find; the map is how it is shown.

**Permission timing — decided.** Do **not** prompt on launch. A permission
dialogue before the product has shown its value is the one people decline, and
Android never asks twice. Prompt when the intent is explicit: a "Near me" chip
on the home screen and the `Sort: nearest` option on browse. If declined, the
screen keeps working on the existing area filter and says why the distance
column is missing — never a dead end.

Behaviours to get right:
- Denied, and "don't ask again" → link to system settings, do not re-prompt.
- Permission granted but the fix times out → fall back to the unsorted list, do
  not spin forever.
- Never persist coordinates. There is a test in `apps/web` enforcing that
  attendance pings do not store coordinates; hold discovery to the same line —
  a lat/lng in Redux that `redux-persist` writes to disk is a location history.

### 2.3 QR activation

`expo-camera` is already installed and `app.json` already carries the camera
permission and its usage strings.

- `POST /api/v1/resident/activate` takes
  `{ code: string(6–32), deviceInfo: {}, sessionInfo: {} }`
  (`modules/residents/activation.validation.ts`).
- It returns a **full session** — `accessToken`, `refreshToken` (because the
  mobile client header is sent), `user`, `resident`. So activation is a
  sign-in: write the tokens through `lib/session.ts`, dispatch `setSession`,
  then `router.replace("/(resident)")`. Do not re-login afterwards.
- `deviceInfo`/`sessionInfo` feed the admin's device-fingerprint record —
  populate them from `expo-device` and `expo-application`, both installed.
- Manual code entry is a required fallback, not a nicety: QR scanning fails on
  cracked screens, printed codes and bad light.
- Torch toggle via `expo-camera`'s `enableTorch`.
- `app/activate.tsx` exists as a stub — that is the file.

### 2.4 Referral deep link

- Scheme is `hostelhub` (`app.json`). Target: `hostelhub://ref/<code>`.
- The endpoint is `POST /api/v1/public/inquiries/with-referral`, taking
  `{ name, phone, email?, message?, referralCode: string(4–32) }` — a
  **different** endpoint from the plain hostel inquiry, and rate limited.
- So the deep link prefills `lib/inquiry-form.ts`'s draft and switches the
  submit target. Keep one form component; branch only on which function it calls.
- `expo-linking` is installed. Handle both cold start (`getInitialURL`) and warm
  (`addEventListener`) — a link that only works when the app is already running
  is the half that gets shipped.

---

## 3. Blocked, and on what

| Item | Blocked on | Where it is logged |
|---|---|---|
| Invoice **line items** | `Invoice.lines` exists but no resident endpoint returns it; reads go through the ledger facade (ADR-3), so it is a finance-module change | `MOBILE_APP_PHASES.md` §1 |
| **eSewa checkout** | Its handoff is a `FORM_POST` with positionally-signed fields; `expo-web-browser` opens URLs only. Needs a server page that performs the POST from a reference | `MOBILE_APP_PHASES.md` §1 |
| Named "Open in Khalti" button | `PaymentIntent.deeplinks` is declared and populated by nothing | `MOBILE_APP_PHASES.md` §1 |
| Map on the home screen | No Google Maps Android key; web uses Leaflet/OSM | §2.2(b) above |
| Server-side nearby query | No `2dsphere` index, no lat/lng in the query schema | §2.2(a) above |
| Google sign-in | No Android/iOS OAuth client configured | `MOBILE_APP_PHASES.md` §1 |

---

## 4. Traps that have already cost time

1. **Do not run `expo install` or `npm install` from `apps/mobile` without
   checking `git status` on the lockfiles afterwards.** `apps/mobile` sits
   outside the root `workspaces` array but npm still walks up to the root
   lockfile and re-plans the whole monorepo. Adding `expo-sharing` migrated
   `apps/web` to the hoisted layout mid-session and left it without `vitest`.
   The hoisted layout **is** the correct end state as of `d678566` — let the
   install finish and re-run from the root binaries; do **not** restore the old
   nested `apps/web/package-lock.json`, which re-breaks the Vercel build.
   A Windows-regenerated root lock also prunes native binaries to
   `*-win32-x64-msvc` and kills the Linux build — verify every package's
   platform `optionalDependencies` survive before pushing.
2. **Use `./node_modules/.bin/expo`, not `npx expo`** — `npx` resolves a global
   legacy CLI that rejects Node 17+.
3. **`react-hooks/set-state-in-effect` traces into the callee.** An effect that
   calls a helper is an error if that helper has a synchronous `setState` on any
   path. Hoist spinner-raising into the event handler and leave the async
   function touching state only after its first `await`.
4. **Vitest cannot import anything that reaches `react-native`.** Includes
   `lib/api.ts` (axios + expo-constants) — which is why `food-week.ts` owns the
   day enums and `resident-api.ts` re-exports them.
5. **A `*/` inside a block comment closes it.** Writing `**/*.ts` in a JSDoc
   comment produced twelve syntax errors in a file that was otherwise fine.
6. **`next build` typechecks test files.** `tsconfig` includes every `.ts` with
   only `node_modules` excluded and there is no `ignoreBuildErrors`, so a type
   error in a `.test.ts` is a failed deploy while the suite stays green —
   Vitest does not typecheck. Run `tsc --noEmit`, not just the tests.

---

## 5. Suggested opening prompt for the next session

> Read `docs/MOBILE_M6_HANDOFF.md`, then continue M6 in the order in §2.
> Start with 2.1 (`PUBLIC_USER` tabs), then 2.2 (location sort — **client-side
> haversine only, no map yet**), then 2.3 (QR activation + torch), then 2.4
> (referral deep link).
>
> Work one item at a time: write it, run `npm run mobile:typecheck`,
> `mobile:lint`, `mobile:test` and `expo export --platform android`, then flip
> the `☐` to `☑` in `docs/MOBILE_APP_PHASES.md` before starting the next. Do not
> batch. A `☑` means the thing was seen working, and note explicitly that no
> device run has happened yet.
>
> Before adding any dependency, re-read §4.1 of the handoff.
