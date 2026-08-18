# Mobile task list — created 2026-08-18 07:25

Work order for `apps/mobile`, opened after the audit of 2026-08-18. This file is the
**handoff document**: if a session ends mid-way, the next one starts by reading this
file top to bottom and picks up at the first unticked box.

## How to use this file

- **One item at a time.** Write the code, verify it (typecheck + lint + tests, and the
  browser/API where it applies), then flip `☐` to `☑` **in this file** before starting
  the next item. Do not batch.
- A `☑` means *seen working*, not *file created*. Where "working" needs a phone, the box
  says so and stays `☐` until the device pass — those are marked **[device]**.
- Items marked **[yours]** need an account, a key, or an asset only the owner can supply.
  Leave them and move on.
- Anything discovered mid-task that is out of scope gets appended to §7, not fixed inline.

## Verification commands

```bash
npm run mobile:typecheck && npm run mobile:lint && npm run mobile:test
```

```bash
npm run test --workspace web && npm run lint --workspace web
```

## Standing facts for the next session

- **Deployed web API:** `https://hostel-management-software-web.vercel.app` — live,
  `/api/v1/public/hostels` answers 200. This is what release builds must point at.
- **EAS:** logged in as `siddthecoder`, project `b2b0ab97-162c-425c-8f06-6e7db901e1e6`.
  Checked 2026-08-18: **no environment variables exist** in development, preview or
  production. FCM V1 key: the owner says it is uploaded — verify with
  `eas credentials` (interactive; the owner has to run it, it hangs a non-interactive shell).
- **Google:** the OAuth client IDs and `google-services.json` are *deliberately* separate
  concerns — the client IDs are for sign-in, `google-services.json` is only the FCM
  channel for push. They do not need to be the same Google Cloud project. The audit's
  "two projects" finding is **withdrawn**; what remains is only that neither file reaches
  an EAS build (§1.4).
- Baseline before this work: typecheck clean, lint clean, **459 tests / 36 files** green.
- `apps/mobile` has ~98 untracked files (M4–M7). Do not `git clean` this tree.

---

## 1. Blockers — the app is broken in production until these are done

- ☑ **1.1 Persist the rotated refresh token.** *(2026-08-18)*
      New pure seam `src/lib/refresh-tokens.ts` + 5 tests; `api.ts` now writes both tokens
      via `writeTokens`, and treats a response with no `refreshToken` as "unchanged"
      rather than "clear it", so a server on the cookie branch cannot force a logout.
- ☑ **1.2 Make `useResource` refetch when its loader changes.** *(2026-08-18)*
      Fetch effect now keys on `[load, run]`; four fetch modes (`initial` / `requery` /
      `refresh` / `silent`) decide what a failure does. A changed loader shows the
      refresh spinner through a **derived** `requerying` value, so no `setState` lands in
      an effect body. `run` keeps a stable identity by reading `data` through a ref —
      depending on `data` directly would have made it re-fetch on its own result.
      Fixes the dead controls on browse-hostels, the notification bell and Community.
      **Requirement this creates:** every `useResource` loader must stay memoised — an
      unmemoised inline arrow now fetches in a loop. All 43 call sites were checked.
- ☑ **1.3 Give every build an API base URL.** *(2026-08-18)*
      `eas.json` now carries an `env` block plus an explicit `environment` on all three
      profiles. `EXPO_PUBLIC_API_URL` is set on **preview and production only** — setting
      it on `development` would have silently disabled the Metro-host detection in
      `resolveApiBaseUrl`, because a configured non-private host wins over the LAN branch,
      and every dev build would have talked to production. The Google client IDs are on
      all three (`.env` is gitignored and never reaches EAS). The release fallback also
      moved off `localhost` to the deployed origin, so a misconfigured build degrades to
      working rather than to dead.
- ☑ **1.4 Make an EAS build work from a clean checkout.** *(2026-08-18)*
      **Not committed — this GitHub repo is public** (`softmato/hostel-management-software`,
      confirmed 200 unauthenticated). A committed `AIza…` key gets scraped and the Firebase
      project has to be rotated, so `google-services.json` is now **gitignored** (it was
      merely untracked, i.e. one `git add .` from being public forever) and reaches builds
      as an EAS **file** variable instead: `GOOGLE_SERVICES_JSON`, uploaded secret to
      development + preview + production, read by the new `app.config.js` overlay on
      `app.json`. Verified: `expo config` resolves the package and the file path, and
      `expo export --platform android` bundles (6 MB).
      **Keep a copy of `google-services.json` outside the repo** — a fresh clone has no
      copy and the EAS variable is write-only. It is re-downloadable from the Firebase
      console for `softmato-e65a6` if lost.

## 2. M6 — finish public discovery

- ☑ **2.1 Map/list toggle on browse.** *(2026-08-18)*
      `HostelMap` gained a `fill` prop (take the parent's space instead of a fixed 260dp);
      `hostel-browser.tsx` gained a two-segment `ViewSwitch` beside "Sort: nearest" and a
      map branch that draws the same `ordered` rows. **`<Screen scroll>` is switched off in
      map view** — a full-bleed map inside a vertical ScrollView puts two pan gestures on
      the same pixels and the map loses about half of them. Pull-to-refresh goes with the
      scroll; the filters still refetch, which is the case that matters. List stays the
      default: the map is blank with no network, cannot show an un-geocoded hostel, and
      price and vacancy do not fit on a pin.
      Verified: typecheck, lint, 464 tests, `expo export` bundles (6 MB). Pin taps and
      tile loading are **[device]** — a WebView cannot be exercised from here.
- ☑ **2.2 Web `?ref=` referral handling.** *(2026-08-18)*
      New `apps/web/src/lib/referral-code.ts` (+8 tests) reads and validates the code
      against the server's own 4–32 range — *not* the activation range, which starts at 6
      and would have silently dropped short codes. `public-inquiry-page.tsx` now renders a
      separate `ReferredInquiryForm` when `?ref=` is present: name / phone / optional
      email / optional message only, because `referredInquiryCreateSchema` accepts nothing
      else, posting to `/public/inquiries/with-referral`. The hostel is deliberately not
      named — no public endpoint maps a code to a hostel, and the old page would have shown
      `green-view-hostel` (its hardcoded default) to someone whose friend lives elsewhere.
      The hostel fetch is guarded off for referral visits; an early return does not stop an
      effect.
      **Verified in a browser** against `npm --prefix apps/web run dev`:
      `/inquiry?ref=ABC123` renders the referral form with **no** `public/hostels/…`
      request in the network log, and `/inquiry?hostel=question-call-hostel-narephat`
      still renders the full hostel column, room types and every original field.
      Web suite 1770 passing, src typecheck and lint clean.
- ☑ **2.3 Verified app links.** *(2026-08-18)*
      Three parts, and all three are needed or none of it works:
      1. `apps/web/public/.well-known/assetlinks.json` — static, so it answers fast and
         cacheably at install time with no redirect (Android follows neither). Fingerprint
         read from the local release keystore with `keytool`:
         `AA:45:1C:…:E8:E1`. Verified locally: `200`, `application/json`.
         `public/.well-known/README.md` records how to reread it and the **two ways this
         goes silently wrong** — an EAS-managed keystore signing instead of the local one,
         and Play App Signing re-signing with Google's key (add, never replace).
      2. `app.json` `intentFilters`, `autoVerify: true`, scoped to **three paths only** —
         `/ref/*`, `/inquiry`, `/guardian-invite`. Claiming the whole host would send
         `/hostels`, `/community` and every marketing page into an app that has no such
         routes.
      3. New `apps/mobile/src/app/inquiry.tsx`. expo-router resolves an incoming URL **by
         path**, so `https://…/inquiry?ref=X` looks for `app/inquiry.tsx` — which did not
         exist, meaning a verified link would have opened the app straight onto
         `+not-found`. It redirects to the existing `ref/[code]` screen during render
         (`<Redirect>`, not an effect, so no frame is painted first), and sends a link
         that lost its query string to the public app rather than to an error.
      Remaining and **[yours]**: Android only verifies against the **live** domain, so this
      is provable once the web deploy carries the file. If Play App Signing is turned on,
      add that fingerprint too.
- ☑ **2.4 Public announcements section — cut.** *(2026-08-18, decision recorded in
      `MOBILE_APP_PHASES.md` §M6)*
      No public announcement feed exists anywhere: `Notice` is hostel-scoped and
      resident-only, and `notification-campaign.service.ts` broadcasts to signed-in
      accounts. Building one is a new server module — model, authoring surface,
      moderation, routes — and **the mockup only ever draws this section empty**. Same
      call already taken on the hero copy, trust tiles and stats band. **Say so if you
      want it built anyway** — it is a product decision, not a technical block, and it
      would be a day of server work before any mobile screen changes.
- ☐ **2.5 [device]** Fresh install → browse hostels with no account.
- ☐ **2.6 [device]** Register → scan QR → dashboard, no relaunch, no login flash.
- ☐ **2.7 [device]** Manual code entry reaches the same state.

## 3. M1–M5 — the open items that are code, not a device pass

- ☑ **3.1 Revoke the device token on logout (M4).** *(2026-08-18)*
      Server: `deviceTokenRevokeSchema`, `revokeDeviceToken()` and a `DELETE` handler on
      the existing `/mobile/device-token` route. The filter carries **`userId` as well as
      the token** — push tokens are client-posted and not secret, so without the scope the
      route would let anyone holding an observed token silence that person's device,
      SOS alerts included. Status goes to `REVOKED`, never deleted (`account-purge` owns
      removal, and deleting races a re-registration already in flight). A token matching
      nothing is a success: the caller is signing out and the desired state already holds.
      Mobile: `revokePushToken()` in `push-notifications.ts`, called from `endSession`
      **before `clearTokens()`** because the call is authenticated, and unconditionally —
      `revoke: false` means the refresh token is dead, not that the device should keep
      receiving the old account's alerts. Never throws.
      Verified: 4 new server tests, `DELETE` answers 401 unauthenticated against the local
      dev server, mobile 464 tests / lint / typecheck green, web src clean.
- ☑ **3.2 Notification preferences + quiet hours (M4).** *(2026-08-18)*
      Server: `packages/db/.../NotificationPreference.ts`, a pure
      `notification-quiet-hours.ts` (13 tests), `notification-preference.service.ts`
      (6 tests) and `GET`/`PATCH /account/notification-preferences`. `sendPushToUsers`
      filters recipients **before** the token lookup.
      Four decisions worth not re-litigating:
      • **Urgent bypasses everything** — master switch, muted category and quiet hours
        alike. The urgent channel is SOS; a settings screen able to silence a safety
        alert is a setting whose worst case is a person not being found.
      • **No row means yes.** The absence of an opinion is not an opinion — reading
        `null` as "wants nothing" would have muted every existing user on deploy.
      • **A failed lookup keeps the whole audience.** Over-delivering during a database
        blip is recoverable; silence is the failure nobody reports.
      • **Quiet hours are minutes past local midnight and wrap midnight** (22:00→07:00 is
        `start > end`, the ordinary case). `localMinutesNow` uses `Intl`, not offset
        arithmetic, because Nepal is **+05:45** and whole-hour maths is 45 minutes wrong.
      Mobile: `notification-preferences.ts` (pure, 9 tests) split from
      `notification-preferences-api.ts` — anything importing `lib/api` drags in
      `react-native`, which the node-only runner cannot parse. New `ui/toggle.tsx`
      wrapping the platform `Switch`. Settings' Notifications section is now real
      controls, saved per-field on change with optimistic UI and rollback, plus a card
      stating that urgent alerts always come through. **`MUTABLE_CATEGORIES` has no SOS
      row** — the server overrides it, so the switch would be a lie.
      Verified: mobile 473 tests / lint / typecheck; web 1793 tests / src typecheck /
      lint; both routes answer 401 unauthenticated against the local dev server.
- ☑ **3.3 Bikram Sambat dates (M1) — mobile.** *(2026-08-18)*
      `formatDateBs` / `formatDateBoth` in `lib/format.ts` → `2 Bhadra 2083 · 18 Aug 2026`,
      applied to invoice due dates (both invoice screens), which is where the decision's
      own reasoning lands: a one-calendar due date makes somebody convert in their head
      at the moment a mistake costs money.
      **Dependency, not a hand-copied table.** BS month lengths vary per year and are
      tabulated data; transcribing them from memory would be inventing something
      authoritative that is wrong in one cell nobody notices for a year.
      `nepali-date-converter@3.4.0` (MIT) was checked against five New Year anchors
      before adoption — 2013-04-14, 2023-04-14, 2024-04-13, 2025-04-14, 2026-04-14 all
      land on Baisakh 1 — and 4 tests hold that. Converts on the **Nepal** day so a phone
      on another timezone still reads the hostel's date; a year outside the table falls
      back to Gregorian rather than to a wrong Nepali date. Bundle 6.0 → 6.1 MB.
      Web half is §7.3.
- ☑ **3.4 Save the whole ID card to the camera roll (M5).** *(2026-08-18)*
      `react-native-view-shot@5.1.0` + a new `shareLocalImage()` in `lib/documents.ts`
      (kept separate from `shareDataUrlImage` — one starts from base64 the server sent,
      the other from a path `captureRef` wrote; a function taking "either" is the shape
      that gets passed the wrong one). "Save this card" snapshots what is on screen.
      **Captured, not server-rendered**: the card *is* the layout — photo, QR, hostel
      accent and the fields that card type carries all live in `IdCardFace` — so a
      server-side PNG would be a second implementation of the design, wrong the first
      time the card changed.
      `collapsable={false}` on the wrapper is load-bearing: React Native flattens a view
      that only wraps another, and a flattened view has no native handle for `captureRef`.
      It saves **the face you are looking at** (the card flips on tap), which is why the
      row's subtitle names it.
      Verified: typecheck, lint, 477 tests, bundles at 6.1 MB. Needs a dev build to
      actually run — view-shot is native, so it is inert in Expo Go and the failure is
      caught and explained rather than thrown. **[device]** to confirm the saved image.
- ☐ **3.5 Real logo (M1) — [yours].** Placeholders are in `assets/images/`.

## 4. UI defects from the audit

- ☑ **4.1 Keyboard covers the submit button on 11 screens.** *(2026-08-18)*
      The `footer` moved **inside** the `KeyboardAvoidingView`, and
      `softwareKeyboardLayoutMode` went from `"pan"` to `"resize"`. Both halves are
      needed: `pan` shoved the whole Android window up and pushed the footer off the
      bottom edge, while on iOS `behavior="padding"` padded the scroll body and left the
      footer sitting under the keyboard. Android keeps `behavior: undefined` on purpose —
      the resized window already carries the footer, and padding on top of that would
      compensate twice. Fixed once in `Screen`; no screen changed. **[device]** to
      confirm on both keyboard modes.
- ☑ **4.2 Compare rows scroll independently.** *(2026-08-18)*
      Eleven `ScrollView`s collapsed into **one**, wrapping the header cells, every field
      row and the inquiry buttons together — so the columns share a scroll position by
      construction rather than by keeping several in step. Labels stack above their values
      inside it and travel with them; a pinned label column would need a synchronised
      second scroller, which is a lot of machinery for six short words. The header comment
      that claimed this already worked has been corrected.
- ☑ **4.3 Tab bar hides on the first touch after returning to a scrolled tab.**
      *(2026-08-18)* `reset()` now parks `lastOffset` at `-1` meaning "no baseline", and
      the first scroll event after it establishes the real offset and returns instead of
      being measured. Previously a tab sitting at 800dp produced `delta = 800 - 0` on the
      next event — far past `HIDE_AFTER`, so the bar slid away on the first touch in
      either direction.
- ☑ **4.4 Failed pull-to-refresh blanks the screen.** *(2026-08-18, with 1.2)*
      A failed `refresh` with data on screen now toasts and keeps the list. Setting
      `error` was not survivable: every screen branches `error ? <ErrorState/> : …`
      *before* it looks at `data`, so keeping the data alone would still have blanked.
- ☑ **4.5 Push permission prompt fires during boot.** *(2026-08-18)*
      `requestPushPermission({ ask })` now **defaults to not asking** — it reads the
      permission and stops. Boot and the foreground re-check register silently when
      permission is already granted and do nothing when it is not, so the system dialogue
      never appears over a dashboard nobody has read. The ask moved to Settings, behind a
      card that explains what the alerts are for, with separate copy and a
      settings-deep-link for the `blocked` case (on Android 13+ a second refusal is
      permanent, so a "Turn on notifications" button there would do nothing). The rule was
      already written above the function; the default now enforces it instead of a comment.
- ☑ **4.6 Bottom sheets with text inputs have no keyboard mode.** *(2026-08-18)*
      `android_keyboardInputMode="adjustResize"` (matching the app.json change in 4.1),
      `keyboardBehavior="interactive"` so the sheet follows the keyboard as it animates
      rather than snapping after it, and `keyboardBlurBehavior="none"` so a stray tap
      outside the field does not dismiss a half-typed note. **[device]** to confirm.
- ☑ **4.7 Tab accessibility role.** *(2026-08-18)* `accessibilityRole="tab"`.
- ☑ **4.8 A revalidated deep link redirects away from itself.** *(2026-08-18)*
      The re-route now only fires for a launch that **started at the boot gate**. The
      pathname is captured before any await — by the time revalidation answers the gate has
      long since redirected, so "are we at `/` now" would always be false. A deep-linked
      screen keeps itself; the store is already updated, so the right tabs are underneath
      when the user navigates back. This bit hardest on exactly the links where a flag
      *had* just moved — a QR activated on another device, an invitation accepted.
- ☑ **4.9 Leaflet loads from unpkg at runtime.** *(2026-08-18)*
      Kept on the CDN — the map is useless without a network anyway, so bundling ~150 KB
      into every install to save one request on a screen already making dozens is the
      wrong trade — but now pinned with **subresource integrity**. This is third-party
      JavaScript running inside a WebView our own page hands a `postMessage` bridge to;
      without a hash, whoever controls the CDN chooses what runs beside that bridge. The
      two hashes were **computed from the real 1.9.4 files**, not recalled. A mismatch
      fails to the existing empty-map state rather than to running something unverified.
      Changing the version means changing the hashes in the same edit — a stale hash looks
      exactly like an offline device.

## 5. Screen-by-screen UI pass

Every tab screen and modal, checked against its web counterpart in `apps/web` — same
sections, labels, copy and judgement calls, **optimised for one thumb on a phone**:
larger touch targets, sheets instead of dropdowns, fewer columns, no hover-only
affordances. Mockup layout, never mockup colours — the theme is green.

**The screens already exist and work.** This is a polish pass, not a rebuild — so the
unit of work is *one mobile screen against one web file*, and the output is either a
change or a line here saying why the web version's choice does not carry to a phone.
Do not restructure a screen that is already right.

### How to work one screen

1. Read the web component (mapped below), then the mobile screen.
2. List what the web shows that the mobile does not, and vice versa.
3. For each difference decide: **port it**, or **record why not** (no endpoint, no room
   on a phone, hover-only, desktop-density table). Both are acceptable outcomes; a
   silent omission is not.
4. Apply, then `mobile:typecheck && mobile:lint && mobile:test`, then tick.

### The shared kit this pass introduced (2026-08-18)

Three pieces landed before the first screen, because every screen wanted them:

- **`lib/responsive.ts` + `components/ui/layout.tsx`** — *fit the handset*, not
  web breakpoints. A 320dp phone is 28% narrower than a 430dp one, so a tile row
  hardcoded to four columns truncates its labels on the small end and leaves a
  hole on the large one. `<Grid>` measures the width it was **given** (so it is
  right inside a sheet, a card or a full screen), `columnsThatFit` picks the
  count from a minimum cell width, and `cellWidth` floors the division — rounding
  overflows by a fraction of a pixel and wraps the last cell onto its own line on
  exactly one screen width. 21 tests. Also `<InfoTile>`, `<StatTile>`, `<Chip>`
  and `<FactRow>` — the mockups' card grammar, once, so two screens cannot end up
  with different versions of the same tile.
- **Global asset viewer** (`lib/asset-viewer.ts`, `components/asset-viewer.tsx`,
  mounted at the root). Tap any asset anywhere and it opens full-screen: pinch
  and double-tap zoom, swipe-down to dismiss, paging across the whole gallery, a
  save/share action, and the private-vs-public source decision made **once**
  (`viewerSourceFor`, 17 tests) rather than at each call site — a public R2 URL
  that gets an `Authorization` header is rejected outright, and that branch was
  one copy-paste away from happening. Wired into complaint attachments (which had
  a fixed-height sheet with no zoom), food photos, community media (which left
  for the OS browser), the hostel gallery and the payment QR.
- **Upload progress in the notification shade** (`lib/upload-notification.ts`,
  `lib/upload-notifier.ts`). The web's universal uploader ported the rest of the
  way: the toaster covers the app, this covers the case it cannot — someone
  photographs a rent receipt and switches to their banking app. One notification
  per **batch**, not per file; the percentage floors to 5% so a transfer costs
  ~20 reposts instead of one per network chunk; the finished summary is built
  from a running tally because the queue prunes a succeeded row after 2.5s. It
  **never asks for permission** (§4.5) — it reads it, and stays silent without
  it. 26 tests. Foregrounded, it goes to the shade list only: the handler in
  `push-notifications.ts` now excludes it from the banner path, or it would slide
  over the screen twenty times a file on top of the toaster saying the same thing.

### Rules that already caught things once

- **Screens show data, not marketing.** The mobile home already had hero copy, trust
  tiles and a stats band cut once (M6, second pass). Do not port them back.
- **Never offer a control the server cannot honour.** The filter sheet takes one
  facility and one room type because that is what `publicHostelListQuerySchema` accepts;
  Settings had no notification toggles until the model existed. A dead control is worse
  than a missing one.
- **Mockups are blue; the theme is green.** Copy the layout, never the palette.
- **Every `useResource` loader stays memoised** — since §1.2 an unmemoised inline arrow
  fetches in a loop.

### Mobile screen → web counterpart

| Mobile | Web (`apps/web/src/app/_components/`) |
|---|---|
| `(resident)/index` | `resident-dashboard-page.tsx` |
| `(resident)/payments`, `invoice/[id]/*` | `resident-payments-page.tsx`, `resident-claim-form.tsx`, `resident-checkout-page.tsx` |
| `(resident)/food` | `resident-food-page.tsx` |
| `(resident)/notices` | `resident-notices-page.tsx` |
| `(resident)/more`, `profile`, `id-card/*` | `resident-profile-page.tsx`, `resident-id-share-page.tsx` |
| `complaints/*` | `resident-complaints-page.tsx` |
| `night-status` | `resident-night-status-page.tsx` |
| `(guardian)/*` | `guardian-dashboard-page.tsx`, `guardian-safety-page.tsx` |
| `(cook)/*` | `hostel-admin-food-page.tsx`, `daily-operations-shared.tsx` |
| `(provider)/*`, `job/[id]` | `provider-jobs-page.tsx` |
| `(admin)/*` | `hostel-admin-dashboard-page.tsx`, `hostel-admin-residents-page.tsx`, `hostel-admin-sos-alerts-page.tsx` |
| `(public)/*`, `(browse)/*`, `hostel/[slug]/*` | `public-home-page.tsx`, `public-hostel-listing-page.tsx`, `public-hostel-detail-page.tsx`, `public-compare-page.tsx` |
| `community/*` | `community-page.tsx`, `community-post-card.tsx` |
| `notifications` | `notifications-page.tsx` |
| `settings` | `resident-profile-page.tsx` + `(auth)/account/privacy/page.tsx` |

- ☑ **5.1 Resident** — home, payments, food, notices, more *(2026-08-18)*
      **Home.** Ported from the web: the hostel contact card (phone and email as
      tap-to-call/mail chips), notice **previews** (the rows showed a category
      where the web shows two lines of the body), and **QuestionCall**, which
      existed on the web for students and was absent from mobile entirely — new
      `openQuestionCall()`, opened in an in-app browser so the back gesture
      returns to the app. New metric strip (notices / complaints / night status)
      replaces the full-width night-status card; `feeStatus.unpaidCount` was in
      the payload and drawn nowhere, and now qualifies the amount ("across 2
      unpaid invoices").
      **Ordering differs from the web deliberately: the money leads.** The web
      opens on a full-width hostel photo. A resident opens this app to pay rent or
      read a notice and already knows which building they live in, so the photo is
      a 64dp thumbnail beside the contact chips (tappable into the asset viewer)
      and the outstanding balance is the first thing on the screen.
      **Not ported: the web's "Unread notices" metric and its "New" badge.**
      `serializeNotice` on the dashboard emits no `isRead` at all, so `!isRead` is
      true for every row and the web marks all of them new. The tile counts
      **urgent** instead, which is a field the serializer does emit.
      **Payments.** The web rebuilt this page around "what do I owe and how do I
      pay it" and the screen had not followed — it opened on a total and six
      identical-looking rows. Added the **focus card** (oldest open month, its
      reference code with copy-to-clipboard, and both actions: paying was two taps
      into a detail screen), the **metric strip** (next due / last paid / settled),
      and an **Open/Settled/All** filter as chips rather than the web's tab bar.
      New `paymentStats` and `filterInvoices` in `invoice-ledger.ts` (+10 tests) —
      `nextDue` is the **oldest** open month, not the first row: the list arrives
      newest-first, so taking the head pointed a resident who is two months behind
      at August while July aged into a default.
      **Food.** Meal cards now match the dashboard and the web (soft icon square,
      timing as a badge). The photo grid moved to `<Grid>` — three fixed 104dp
      tiles plus gaps need 328dp and a 320dp phone has ~280, so the third wrapped
      and left a hole — and now shows the **caption**, which the server stores and
      the web displays. Photos open in the asset viewer. Fixed: this was the only
      `uploadAsset` call in the app with no `label`, so the toaster and the new
      shade notification both said "Uploading file".
      *Recorded difference:* the web's upload form takes an optional caption;
      mobile shares in one tap and sends none. Captions from the web still render.
      **Notices.** The web filters by status (All/Unread/Urgent with counts) and
      this screen filtered by category; both now share one chip scroller, because
      two chip rows is one too many on a phone. Ported the web's icon square
      (megaphone / alert), which is what makes a list of ten scannable. Fixed
      along the way: the screen fetched page 1 and dropped `pagination.hasMore`,
      so older notices were unreachable on the phone — there is now a "Load older
      notices" button, hidden while a filter is applied since the filter runs over
      what has been fetched.
      **More.** Now uses the shared `<Avatar>` rather than a local initial circle,
      and the hostel block became contact chips. Fixed stale copy: the
      Notifications row still read "and why you cannot pick yet", which stopped
      being true when §3.2 shipped.
      Verified: typecheck, lint, **557 tests / 41 files**, `expo export` bundles.
      Rendering and gestures are **[device]** — the viewer's pinch/drag and the
      upload notification cannot be exercised from here.
- ☑ **5.2 Guardian** — home, payments, safety, more *(2026-08-18)*
      The screens were already the more careful of the two: they had cut the web's
      **"Make a Payment"** button (no guardian payment route exists anywhere in
      `apps/web`, so it did nothing) and its **"Emergency Status: Normal"** tile
      (the payload has no SOS field, so it printed "Normal" whether or not an
      alert was live). Both stay cut.
      Ported: the web's **metric row** on Home, gated the same way every section
      is — the tiles are *collected* rather than rendered with `null` holes, so a
      guardian who shared only night status gets one tile filling the row instead
      of one tile and two gaps. **"Paid" is new to mobile**: new
      `guardianPaidAmount` (+4 tests) sums `paidAmount`, **not** `PAID` rows — a
      `PARTIAL` month has real money against it — and returns `null` rather than
      zero when finances are not shared, because a confident "NPR 0 paid" states
      something about the ward this app has no basis for. It also joins the
      payments summary card.
      Today's meals now use the same block the resident screens use, so a parent
      and their child are looking at the same thing.
      **One contact card, not the web's two.** The web has "Warden / Hostel
      In-charge" and "Hostel Emergency Contact" and both render the *same*
      `hostel.contact.phone` — there is no warden field in the payload. Two cards
      offering one number reads as two escalation routes and is one. The single
      card gained the address and email the payload already carried, which is what
      a parent wants at the moment their child is not answering.
      Verified: typecheck, lint, 561 tests.
- ☑ **5.3 Cook** — home, menu, photos, more *(2026-08-18)*
      The cook screens were already built for their case — wet hands, in a hurry,
      one-handed — so this was a legibility pass, not a rebuild. The four announce
      cards gained the meal icon square: a cook picks the card by shape before
      reading a word of it, and four cards distinguished only by a heading is the
      version that gets breakfast announced at dinner. The weekly routine now uses
      the same meal block the residents see, because the kitchen reading a
      different rendering of the menu from the people eating it is how "the app
      said chicken" starts.
      **Extracted `components/meal-row.tsx`** while doing it. Four screens show a
      meal — resident home, resident food, guardian home, cook menu — and they
      showed it three different ways: a truncated `<ListRow>`, an icon beside a
      heading, and a row with the timing as trailing text. Same dinner, different
      thing depending on who was looking. Now one component: icon square, timing
      as a badge (it is the second thing anyone looks for, and trailing muted text
      is where it goes to be missed), items on two lines.
      **Recorded, not built:** the cook cannot see their own photos. `/cook/food-
      photos` is POST-only — no route lists what a kitchen has uploaded — so
      residents see the photos and the cook who took them cannot. Appended to §7
      rather than faked from the announcement log, which carries no photo ids.
      Verified: typecheck, lint, 561 tests.
- ☑ **5.4 Provider** — home, card, more *(2026-08-18)*
      **The rows stay rows.** The web draws each job as a full card — title,
      hostel, description, category, location, schedule, phone. Eight of those is
      two jobs per screenful on a phone, and the detail screen already carries the
      description and the call button, which is the tap the web card exists to
      save and a phone does not need saving. Recorded rather than ported.
      What the rows *did* lack was the trade: every row looked identical, so a
      provider scanning for their own work read every title. New
      `jobCategoryIcon` maps all eleven `maintenanceCategorySchema` values (+ a
      fallback tool for one the server adds later, which is the case that
      otherwise renders blank and looks like a broken build). New metric strip —
      open / urgent / done — via `urgentJobCount` and `completedJobCount`; urgent
      counts **open** HIGH and URGENT only, because a completed emergency is a
      record, not something to look at today. +5 tests.
      `card.tsx` unchanged: its status tag already carries the distinction that
      matters (`PENDING_APPROVAL` explains an empty Jobs tab that would otherwise
      look like a bug), and it deliberately does not re-render the platform ID
      card that `app/id-card/` owns.
      Verified: typecheck, lint, 566 tests.
- ☑ **5.5 Admin-lite** — home, residents, alerts, more *(2026-08-18)*
      **The biggest find in this section was on Alerts: `evidenceAssetId` has been
      on the claim payload all along and the screen never showed it.** Approving a
      payment claim is the one action here that moves money, and it was the only
      one an admin had to take on trust. There is now a "View proof" button that
      opens the receipt in the global viewer — it zooms, which matters because the
      amount on a bank screenshot is small and the whole question is whether it
      matches.
      Overview: occupancy and listing reach became tile rows (three figures that
      mean something *together* read badly as a stack of label/value rows, which
      is read one at a time). **"Needs attention" stays rows** — those are a queue
      where each item is a destination, and a tile with a number on it is a worse
      tap target than a row with a label and a chevron. Occupancy still shows "—"
      with "Configure rooms" rather than 0% when `capacitySummary` is missing.
      Residents: a face per row via `<Avatar>`, whose colour is derived from the
      name — which is what makes two adjacent rows of a forty-person roster tell
      themselves apart at a glance. This needed a small `left` slot on `<ListRow>`
      (takes precedence over `icon`, never renders beside it: two leading columns
      and no clear subject).
      The rest of the web dashboard — fee schedules, billing runs, reconciliation,
      warden management, room config, nine report views — stays in the browser,
      which is what the More tab already says.
      Verified: typecheck, lint, 566 tests.
- ☑ **5.6 Public / browse** — home, hostels, search, compare, profile *(2026-08-18)*
      **A real paging bug on the hostel gallery.** The photos were a hardcoded
      `width: 400` inside a `pagingEnabled` ScrollView, and paging snaps to the
      **viewport**, not to the child — so on a 393dp phone every swipe left a 7dp
      sliver of the next photo and drifted further out of alignment with each
      page, and on a 430dp phone it stopped 30dp short. It looked right only on a
      device exactly 400dp wide. Now `useWindowDimensions`, which follows a
      rotation for free. Added the mockup's **thumbnail strip** under the hero
      (twelve photos behind a swipe is twelve swipes to find the bathroom) — it
      drives the carousel rather than opening the viewer, so browsing in place
      still works.
      **Two rows on the browse profile were lying.** "Saved hostels" toasted "it
      lands in the next release" while `lib/saved-hostels.ts` was already storing
      them and Home was already rendering the row — it now shows the count and
      says they are device-local, which is the part worth knowing before you build
      a shortlist. "Notifications" and "Privacy" did the same, and `/settings` has
      held real preferences since §3.2; its routes take `requireApiPrincipal`, so
      a browsing account could always reach them. `soon()` survives for
      **Inquiries** alone, which genuinely has no endpoint.
      Fit fixes on the public home: the four type tiles were `flex-1` in a row —
      about 72dp each on a 320dp screen, where "Co-living" truncates — and
      "Browse by facility" was `w-[47%]`, percentage arithmetic that has to stay
      under half once the gap is counted. Both now measure. Hostel detail's price
      tiles too: "NPR 10,000 – NPR 18,000" in a third of a 320dp screen was
      truncating to "NPR 10,0…".
      **Recorded, not ported:** the mockup's facility tiles carry a sub-label
      ("High Speed" under Wi-Fi, "24/7 Security" under CCTV) drawn from nothing —
      `facilities` is a `string[]`. Chips stay. Same for the mockup's third fee
      tile: `pricing` has no security deposit, and two tiles that are true beat
      three that look complete.
      Verified: typecheck, lint, 566 tests.
- ☑ **5.7 Shared modals and sheets** — filter panel, select, confirm sheets, SOS
      overlay, upload toaster *(2026-08-18)*
      Most of this section was already right and §4.6 had just been through the
      keyboard behaviour, so the pass was a review with one real fix.
      **The SOS countdown circle now grows with the text inside it.** It was a
      fixed 144dp holding `text-6xl`, which is fine at the default font scale and
      clips at the accessibility settings people actually use — Android reaches
      2.0× and a two-digit countdown at 1.3× already overflows. `scaledHeight`
      caps the growth at 1.3 rather than following it all the way: past that the
      circle pushes Cancel off a short screen, and on this screen of all screens
      Cancel must stay reachable. First use of the font-scale half of
      `lib/responsive.ts`.
      Reviewed and left alone, with the reasons: the **filter panel** keeps
      "Clear all" in its header and one primary button in the footer rather than
      the mockup's Reset/Apply pair — a header action plus one primary is the
      phone idiom, and the panel's single-select `Choice` pills already match what
      `publicHostelListQuerySchema` accepts. The **`Sheet`** keyboard modes,
      insets and dynamic sizing are §4.6's and unchanged. The **upload toaster**
      now has the shade notification as its sibling rather than a replacement:
      the toaster is the primary readout while the app is open, and the
      notification covers the case it cannot.
      Verified: typecheck, lint, 566 tests, `expo export` bundles.

## 6. Device pass — [device], after everything above

- ☐ 6.1 M0: runs on a physical Android device over LAN
- ☐ 6.2 M2: five session/boot acceptance tests
- ☐ 6.3 M3: three resident acceptance tests
- ☐ 6.4 M4: five notification acceptance tests
- ☐ 6.5 M6: three discovery acceptance tests
- ☐ 6.6 M7: all four role groups on hardware

## 7. Found along the way

Anything discovered while working the list above, appended here rather than fixed inline.

- ☐ **7.1 `/inquiry` with no `?hostel=` lands on "Hostel unavailable".**
      `public-inquiry-page.tsx` defaults `hostelSlug` to the literal
      `"green-view-hostel"`, a mockup slug that does not exist in the database — the
      request 404s and the page renders its error state. Seen while verifying 2.2; it is
      **pre-existing**, not caused by that change. Every real link carries `?hostel=`, so
      this only bites someone who types `/inquiry` directly, but the honest fix is either
      to redirect to `/hostels` or to ask which hostel.
- ☑ **7.3 A kitchen can see its own food photos.** *(2026-08-18)*
      `/cook/food-photos` was POST-only, so a cook could post a photo of dinner and
      had no way to see it — or to see whether anyone had posted at all today —
      while every resident in the hostel could.
      **Server:** new `GET` on the same route and the same role list
      (`COOK`/`HOSTEL_ADMIN`/`WARDEN`, scoped by `resolveCookHostelId`, so it is
      not a door into another kitchen), plus `listCookFoodPhotos` in
      `cook.service.ts` and a pure `food-photo-days.ts` (+12 tests).
      **Grouped by day in `Asia/Kathmandu`, not UTC** — Nepal is +05:45, so a
      breakfast photographed at 05:30 local is `23:45Z` the *previous* day. Group
      by UTC and the kitchen sees yesterday's breakfast filed under the day
      before, one row out, only ever for the early meals: the kind of wrong nobody
      reports and everybody stops trusting. Doing it on the phone would have handed
      the same decision to the handset's timezone. Each day carries
      **`mealsCovered`**, distinct meals out of four — four photos of dinner is not
      the same as one of each, and a photo count cannot tell those apart.
      **`source: KITCHEN | RESIDENT`, not an uploader id.** The cook login is
      shared kitchen-wide, so `uploadedBy` is the same user for every cook in the
      building and cannot answer "who posted this". Kitchen-or-resident is the
      distinction that is both true and useful.
      **Verified against the running API with a minted COOK token** (never a typed
      password): 200 with 22 photos over 2 days for *Education Light Hostel*,
      `mealsCovered` per day, `source: KITCHEN`; a RESIDENT token gets **403
      FORBIDDEN**; unauthenticated gets **401**.
      **Mobile:** `(cook)/photos.tsx` now shows a day-grouped grid — date, meals
      covered, photo count, and each tile captioned with its meal and the clock
      time it went up — tapping into the global asset viewer scoped to **that
      day**. Refreshes itself after a successful post, so the cook sees the photo
      they just took. Its own `useResource`, so a failing announcement log does not
      take the photos down with it.
      Verified: mobile typecheck/lint/566 tests, web lint/**1805 tests**,
      `expo export` bundles.
- ☐ **7.2 `.next/types/validator.ts` fails `tsc --noEmit` in `apps/web`.**
      Generated route-type errors about `(hostel-admin)` layouts whose `params` are typed
      `Promise<{ hostelSlug: string }>` against Next 16's `LayoutProps`. Pre-existing and
      unrelated to any work here — `src/` itself is clean — but it means
      `npm run typecheck --workspace web` is red by default, which trains people to ignore
      it. Worth either fixing the layout signatures or excluding `.next` from the check.

---

## Session log

| When | Session | Stopped at |
|---|---|---|
| 2026-08-18 07:25 | opened the list after the audit | — |
| 2026-08-18 08:00 | blockers 1.1–1.4, M6 §2.1–2.4, and 3.1 | next: §3.2 notification preferences |
| 2026-08-18 08:12 | 3.2 notification preferences + quiet hours | next: §3.3 Bikram Sambat dates |
| 2026-08-18 08:21 | 3.3 Bikram Sambat, 3.4 save ID card | §3 done bar 3.5 [yours]; next: §4 UI defects |
| 2026-08-18 08:30 | §4 UI defects 4.1–4.9 all closed | next: §5 screen-by-screen UI pass (largest item left) |
| 2026-08-18 09:25 | shared layout kit, global asset viewer, upload notifications, §5.1 resident | next: §5.2 guardian |
| 2026-08-18 10:05 | §5.2–§5.7: guardian, cook, provider, admin, public/browse, shared sheets | §5 complete; next: §6 device pass, or §3.5/§7 |
| 2026-08-18 10:20 | §7.3 cook food-photo GET + day-grouped grid | next: §6 device pass; §7.1/§7.2 still open |
