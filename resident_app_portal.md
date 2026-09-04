# Resident Portal App — work order

**Created 2026-09-04.** Scope: `apps/mobile`'s resident surface — the `(resident)`
tab group plus every root-stack screen a resident reaches from it.

This file is the **handoff document** for that work. A session that picks it up
starts by reading it top to bottom and works at the first unticked box.

---

## How to use this file

- **One item at a time.** Write the code, verify it, then flip `☐` to `☑`
  **in this file** with the date before starting the next item. Do not batch, and
  do not open a PR per box — the repo's convention is a tracker file, not a queue
  of branches.
- A `☑` means *seen working*, not *file created*. Where "working" needs a handset,
  the box is marked **[device]** and stays `☐` until the device pass.
- **[server]** marks work that lives in `apps/web`, not here. Those are listed in
  §7 with the client behaviour that ships in the meantime; do not fake them on the
  client.
- **[decision]** needs the owner. Leave it and move on.
- Anything found mid-task that is out of scope gets appended to **§9**, not fixed
  inline.

## Order of work — set by the owner 2026-09-04

Originally: everything else first, attendance last. **Revised the same day**, once
the owner set out what the product is actually for:

> *"the hostel keeps this app coz they can know either the resident are at hostel
> at night or not, so we need to make it auto."*

That makes §3.1 the feature the customer is buying rather than a trailing item,
so it moves up — but only its **Phase 1**, which needs no native rebuild.

**§2 ☑ → §3.2 ☑ → §3.3 ☑ → §5.2 ☑ → §3.1 Phase 1 → §4 → rest of §5 → §6 →
§3.1 Phase 2.**

Phase 2 is last because it installs a native dependency, flips background-location
flags and needs a Play Store data-safety change plus a device pass on a real
Xiaomi — none of which should sit in front of work that needs none of it.

The standing brief for all of it: **the resident app must read as clean as the
hostel-admin app.** That app is the bar — its tab bar, its skeletons, its tile
grids, its date grouping, its bottom sheets. Where the two roles disagree today,
the resident side is the one that is behind.

## Verification

```bash
npm run mobile:typecheck && npm run mobile:lint && npm run mobile:test
```

```bash
npm run test --workspace web && npm run lint --workspace web
```

> **`npm run mobile:typecheck` lies.** It exits **0 with errors printed**, because
> the npm wrapper swallows `tsc`'s status. Do not trust its exit code — read the
> output, or run the compiler directly:
>
> ```bash
> npx --prefix apps/mobile tsc --noEmit -p apps/mobile
> ```
>
> This is how a broken build sat in the tree unnoticed; see §9.2.

### Baseline, measured 2026-09-04 before any of this work

Both of these were **already broken** when this file was written, in admin
scope, and both were fixed first because they made it impossible to tell a new
regression from the existing damage.

- ☑ `tsc` — **1 error**, not clean. `manage/resident/new.tsx:643` called
      `nepaliDayLabel`, which **is defined nowhere in the app**. Recorded here as
      "clean" in the first draft of this file, on the strength of npm's exit code;
      that was wrong. *Fixed 2026-09-04* — the hint now uses `useDates().dateBoth`,
      which is what every other `manage/` screen uses, and stays empty while the
      date is half-typed.
- ☑ `mobile:test` — **1066 pass, 1 file fails to collect.**
      `src/lib/fee-schedule-standing.test.ts` threw
      `ReferenceError: Cannot access 'get' before initialization` — `vi.mock` is
      hoisted above the `const get` its factory closes over, so **the suite had
      never run once**. *Fixed 2026-09-04* with `vi.hoisted()`; its 7 tests now run
      and pass.

**Current baseline: `tsc` clean, lint clean, mobile 1117 tests / 73 files,
web 2123 tests / 148 files — all green.**

---

## §0 Decisions taken — do not re-litigate

| Decision | The shape | Why |
|---|---|---|
| **Tabs** | Home · Payments · **Community** · Food · More | Community sits third in every signed-in role so the tab does not move when the same phone changes hands. Notices gave up the slot and is reached from Home and More (`(resident)/_layout.tsx`). |
| **Palette** | black / white / green. `--brand` `#0a8a4b` light, `#12a95d` dark; role accent `RESIDENT` `#16a34a` / `#22c55e` | `CLAUDE.md`, `NOTES.md`, `docs/DESIGN.md`. Take layout, icons, assets and flow from the references; **never colour**. |
| **Discovery lives on More** | "Explore hostels" is a row, not a tab | Agreed 2026-08-16 — someone who already has a bed opens the app to pay rent or read a notice. |
| **One notifications screen** | `app/notifications.tsx`, root stack, every role | `GET /notifications` is scoped to `principal.userId` with no role branch. |
| **One settings screen** | `app/settings.tsx`, sliced by `?section=notifications\|privacy` | Three views share every hook; splitting them would be three screens fetching the same deletion status. |
| **Read-only is stated, never drawn** | No Edit button for personal details, emergency contacts or guardians-as-records | The server has no resident-facing write for them. A control the server ignores makes the resident believe it worked. See `app/profile.tsx`, `app/sos.tsx`. |
| **Loading is skeletons** | `SkeletonCard` / `SkeletonRows`, not `ActivityIndicator` | `CLAUDE.md`; NOTES §"Loading is skeletons, not spinners". §2.3 is the resident group catching up. |
| **Night presence is automatic** *(owner, 2026-09-04)* | The app determines it; the resident is **not** asked as the primary flow | It is why a hostel buys the product. Self-declaration is the fallback for when the automatic answer is missing, not the source of truth. See §3.1. |
| **The phone is not the person** | The roster says "her phone was in the building", never asserts she was | Every presence product of this kind has this limit. Overstating it is how a hostel is misled about a resident's safety — the one thing this feature must not do. |
| **Coarse trigger, fine measurement** | OS geofence at ≥100m wakes the app; the **server** computes `INSIDE`/`NEARBY`/`OUTSIDE` from the coordinate | Android and iOS geofencing both degrade badly below ~100m, but `zoneForDistance` still gets an exact distance to work from. |

---

## §1 Current state — the honest audit

The resident app is **not** a greenfield. Thirteen surfaces ship and most are
good. What follows is measured, not assumed.

| Surface | Mobile | Web counterpart | State |
|---|---|---|---|
| Home / dashboard | `(resident)/index.tsx` (638) | `resident-dashboard-page.tsx` | ✅ ahead of web — money leads, contact chips, QuestionCall |
| Fees & Payments | `(resident)/payments.tsx` (413), `invoice/[id]/{index,pay,claim}`, `checkout/[reference]` | `resident-payments-page`, `-pay-invoice-panel`, `-claim-form`, `-checkout-page` | ✅ parity |
| Food | `(resident)/food.tsx` (394) + `components/food-routine.tsx` | `resident-food-page.tsx` | ✅ parity — rating + photo upload |
| Notices | `(resident)/notices.tsx` (349) | `resident-notices-page.tsx` | ✅ ahead — status *and* category filters, real pager |
| More | `(resident)/more.tsx` (292) | sidebar `RESIDENT_NAV` | ◐ two rows mis-target, no notifications row (§2.1) |
| Complaints | `complaints/{index,new,[id]}` | `resident-complaints-page.tsx` | ◐ capped at 100 by the route (§7.4) |
| Night status | `night-status.tsx` (246) | `resident-night-status-page.tsx` | ◐ no history — server gap (§7.2) |
| SOS | `sos.tsx` (199) + `components/sos-fab.tsx` | `resident-sos-page.tsx` | ✅ ahead — fan-out honesty, two gestures |
| Profile | `profile.tsx` (318) | `resident-profile-page.tsx` | ◐ read-only; guardians shown, not managed (§3.2) |
| Digital ID | `id-card/{index,edit}` | `resident-id-share-page.tsx` | ✅ ahead |
| Review | `review.tsx` (244) | `resident-reviews-page.tsx` | ◐ cannot read back — server gap (§7.3) |
| Referral | `referrals.tsx` (293) | `resident-referral-page.tsx` | ✅ ahead — shares the code, not the dead link |
| Settings | `settings.tsx` (706) | `resident-settings-page.tsx` (27) | ✅ far ahead |
| Notifications | `notifications.tsx` (335) | `resident-notifications-page` | ✅ screen is good — **unreachable** (§2.1) |
| **Attendance** | — | `resident-attendance-page.tsx` | ❌ **missing entirely** (§3.1) |
| **Guardians** | — | `resident-guardians-page.tsx` | ❌ **missing entirely** (§3.2) |
| **Offer Program (own view)** | `offer-program.tsx` is the *public explainer* only | `resident-offer-program-page.tsx` | ❌ **missing** (§3.3) |

Not in scope: the supply store (`app/store/*`) sells to hostels, not residents;
the `(guardian)`, `(cook)`, `(provider)` and `(admin)` groups; the `(browse)`
discovery screens a resident shares with signed-out users.

---

## §2 Blockers — wrong today, cheap to fix

- ☑ **2.1 A resident cannot reach their notification inbox.** *(2026-09-04)*
      `<NotificationBell>` now sits in the `AppBar` `actions` slot on all five
      tabs — Home, Payments, Food, Notices, More — matching `(admin)`, so the
      control does not vanish when you change tab. More gained its own
      **Notifications** row into `/notifications`, separate from the two settings
      rows. Payments' statement button was converted from a bare `Pressable`
      around an **uncoloured** `Ionicons` (black glyph, invisible on a dark bar in
      dark mode) to `IconButton`, which is the header-action shape the bell uses
      and reads `colors.foreground`.
      <br>The original finding, kept for the record:
      `app/notifications.tsx` exists and is good. Nothing in `(resident)` opens it:
      no `<NotificationBell>` on any of the five tabs (grep — the bell appears only
      in `(admin)/*`, `community-board.tsx`, `discovery-header.tsx`), and More's
      "Notifications" row pushes `/settings`, which is the *preferences* screen.
      Admin, cook and provider More screens all have a `/notifications` row.
      So a resident's payment reminder is reachable by push banner and by nothing
      else — and once the banner is swiped away it is gone.
      **Fix:** add the bell to `(resident)/index.tsx`'s `AppBar` via `actions`
      (the prop exists), and give More its own Notifications row pointing at
      `/notifications`.
- ☑ **2.2 No resident screen is live.** *(2026-09-04)*
      **The finding as first written was too broad and is corrected here:**
      `complaints/index`, `complaints/[id]`, `night-status` and `notifications`
      already declared topics. The gap was **the five tab screens**, which had
      none — the original grep only covered `app/(resident)/*` and `app/(admin)/*`
      and missed the root-stack screens.
      <br>Now live: Home `[payments, notices, complaints, food, safety]` (one
      payload, five domains), Payments `[payments]`, Notices `[notices]`,
      Food `[food]`, More `[safety]`, plus `profile` `[residents, safety]` and
      `sos` `[safety]` — the two read-only screens, which are the strongest case
      for it, since the resident has no action of their own to refetch with.
      <br>**Checked before wiring, not assumed:** each topic is genuinely
      published by a service (`notice.service.ts`, `food.service.ts`,
      `cook.service.ts`, `claim.service.ts`, `finance/review.service.ts`,
      `reconcile.service.ts`, `statement-import.service.ts`, `safety-notify.ts`),
      each publishes to `private-hostel-<id>`, and `realtimeChannelsFor` grants a
      resident that channel off their own `hostelIds`. Naming a topic nothing
      publishes would have been decoration.
- ☑ **2.3 Resident screens spin; admin screens skeleton.** *(2026-09-04)*
      All four tab screens now draw their own shape. Each placeholder matches what
      replaces it, which is the only thing that makes a skeleton worth more than a
      spinner — Home: dues card / tile strip / hostel / section; Payments: focus
      card / tile strip / filter chips / months; Notices: chip row / notice rows;
      Food: 7-cell day strip / meal cards / photo wall.
      <br>**`SkeletonTiles` was added to `components/ui/skeleton.tsx`** — the kit
      had `SkeletonCard` and `SkeletonRows`, both full-width rows, and nothing for
      a `<Grid>` of tiles, so the metric strips visibly re-flowed into columns
      when the numbers landed. `(admin)/index.tsx` still spins and could use it.
- ◐ **2.4 More's two account rows lie about how many destinations they have.**
      "Notifications" and "Privacy & account" both `router.push("/settings")`.
      `(browse)/profile.tsx` already fixed this by passing
      `{ pathname: "/settings", params: { section } }` and explains why in a comment.
  - ☑ `(resident)/more.tsx` *(2026-09-04)* — now three rows, three destinations:
        the feed, **Notification settings** (`section: "notifications"`) and
        **Privacy & your data** (`section: "privacy"`).
  - ☐ The same bug in `(admin)`, `(provider)` and `(guardian)` More. One line
        each; left until the resident work is done so a failure is attributable.

---

## §3 Missing screens

### 3.1 Automatic night presence — the feature the hostel is buying

**Decided with the owner, 2026-09-04.** Asking the resident to declare their own
status is **not** the primary flow. A hostel pays for this app so that it *knows*
whether its residents are in at night without anybody being asked. Self-declaration
stays, demoted to a fallback for when the automatic answer is missing.

That decision is what this section is now about, and it replaces the earlier
"display + consent only" plan.

#### What already exists, and what it actually answers

| Piece | State | Answers |
|---|---|---|
| `recordLocationPing` | **built** | Distance from `Hostel.location.lat/lng` → `INSIDE` ≤50m, `NEARBY` ≤200m, else `OUTSIDE`. No pin → `UNKNOWN`, deliberately |
| `runAttendanceMaintenance` cron | **built** | A **14-day** absence alert — "has this resident stopped living here". Not a nightly answer |
| `night-status` | **built** | What the resident *says*. 17:00→17:00 Nepal night window |
| `manage/roll-call` | **built** | What a warden verified. The exception queue |
| Mobile attendance | **nothing** | No screen, no api module, no ping is ever sent |

So the server half of automatic presence is already there. Nothing on the phone
has ever called it.

#### The accuracy problem, stated once so it is not rediscovered

GPS is **3–10m** under open sky, **20–50m** in dense urban outdoors, and
**50–200m indoors in a concrete building** — where it often falls back silently to
wifi/cell triangulation and can be hundreds of metres out. A resident asleep in
their room at 22:00 is in the worst environment GPS has.

That squeezes the radius between two failures:

- **50m** (`insideZoneRadiusMeters`) → residents asleep in bed read `OUTSIDE`.
  False absences are the expensive kind: a parent is told their daughter is not
  home while she is upstairs. One of those and the hostel stops trusting it.
- **200m** → covers the neighbouring building, the alley and the momo shop, so
  `INSIDE` stops meaning inside.

**Both OS geofencing APIs want ≥100m anyway** (Android Geofencing, iOS region
monitoring both degrade badly below it), which lines up with `nearbyZoneRadiusMeters`
and not with `insideZoneRadiusMeters`. So: **the geofence trigger is coarse, and
the precise zone is still computed server-side from the coordinate in the ping.**
Coarse wake-up, fine measurement.

**The residual limit no engineering removes: the phone is not the person.** This
tells the hostel where the *device* was. Every product of this kind has that
limit. It is still worth far more than nothing — but the wording on the warden's
roster must say "her phone was in the building", never assert that she was.

#### The design

- ☑ **3.1.1 [server] Fix the day bucket.** *(2026-09-04)* — `dayKey` now
      delegates to `hostelCalendarDay`, the same normalisation move-in dates and
      billing periods already use, so the shape stored is unchanged and every
      index and query bound still works. **An existing test asserted the bug**
      (`"buckets a timestamp to UTC midnight"`) and was replaced by four that pin
      the fix, including the regression itself: an evening reading and a 02:00
      return must land in different buckets. Rows written before the fix are left
      alone — a migration would have to guess, and a wrong guess is
      indistinguishable from the bug. Web suite green at 2123.
      <br>The original finding: `dayKey` files by **UTC** midnight
      while the hostel day is **UTC+05:45**. A resident pinging at 02:00 Nepal
      lands at 20:15 UTC the *previous* day — so a late return files under
      yesterday **and overwrites yesterday's 22:00 reading**, because it is one
      row per day with last-write-wins. That corrupts exactly the nights this
      feature exists for. Move it onto the Nepal hostel day. *(Owner approved
      2026-09-04.)*
- ☐ **3.1.2 [server] The night answer must be sampled, not last-write-wins.**
      **Moved to Phase 2** — it only bites once automatic pings arrive, and no
      ping is sent today, so changing the schema now would be a change nothing
      exercises.
      Related to 3.1.1 and worse under automatic pings: with geofence transitions
      arriving at arbitrary times, the stored zone becomes *whatever happened
      last that day*. A resident who steps out for cigarettes at 23:50 reads
      `OUTSIDE` for the whole night. The night reading needs to be the zone **at
      the check time**, not the final event of the day.
- ☑ **3.1.3 `lib/attendance.ts` + `lib/attendance-api.ts`** *(2026-09-04)* —
      types and wording in the pure module, the four calls in the api module,
      **14 tests**. The tests enforce the design rule rather than the code: no
      zone may return a `danger` tone, `OUTSIDE` and `NEARBY` are `neutral`,
      `INSIDE` is `brand` and explicitly **not** `success` (which would frame
      being out as a failure), and every location claim says "your **phone**".
      <br>The original text: typed off
      `attendance.service.ts`. Zone → label and tone, day grouping, streaks.
      `OUTSIDE` is **neutral**, not a warning — `docs/DESIGN.md` is explicit that
      students leaving the hostel is normal life. Only SOS is red.
- ☑ **3.1.4 `app/attendance.tsx`** *(2026-09-04)* — consent switch, what is and
      is not stored in plain words, months grouped with the heading outside the
      card, and erasure behind a destructive confirm that says it takes the
      hostel's copy too.
      <br>**Two separate controls, deliberately.** *Stop recording* and *delete
      what was recorded* are different decisions the server models separately
      (`ConsentLog` vs `AttendanceLogModel`); collapsing them into one switch
      would mean somebody who wanted to stop being tracked silently destroyed
      their own record, or the reverse.
      <br>**No percentage.** "Present 78% of the time" invites a location log to
      be read as an attendance grade — the denominator is days the phone happened
      to report, not days of the tenancy. Two plain counts instead.
      <br>Reached from More (directly under Night status, same subject from
      opposite ends) and from **Settings → Privacy & your data**, because that is
      where somebody looking for the tracking control actually goes.
      <br>The original text: — consent switch, what is and is not stored in
      plain words, days grouped by date with the heading outside the card, and
      erase behind a destructive confirm. Ships **before** any pinging: a resident
      must be able to see and delete what is held about them before the app starts
      producing more of it.
- ☑ **3.1.5 Coordinates are never persisted client-side.** *(2026-09-04)* —
      `attendance-api.ts`'s `sendLocationPing` takes the pair, posts it and returns
      only the server-derived zone. Nothing is cached, stored or dispatched to
      Redux on the way through. The mobile twin of the web's invariant test is
      still owed and belongs with the ping caller in Phase 2, not before it.
      <br>The original text: `lib/location.ts`
      already holds this line. Read a position, send it, drop it. No Redux — it is
      `redux-persist`-backed, and a lat/lng on disk is a location history. The web
      has a test on this invariant; add the mobile twin.
- ☐ **3.1.6 [native rebuild] Geofencing.** `expo-location@57` already ships
      `startGeofencingAsync`, but:
      - `expo-task-manager` is **not installed** (peer requirement)
      - `app.json` sets `isAndroidBackgroundLocationEnabled: false` and
        `isIosBackgroundLocationEnabled: false`
      - `ACCESS_BACKGROUND_LOCATION` is not in the permission list
      All three need changing, and that is a **native rebuild, not a JS reload**.
      OS-registered geofences are woken *by the OS* on enter/exit, which is why
      this is preferred over a periodic background task — see 3.1.8.
- ☐ **3.1.7 A nightly confirmation, because transitions alone are not enough.**
      If a resident came home at 19:00 and never left, **no geofence event fires
      at 22:00** — so transitions must maintain an inside/outside state *and* a
      scheduled check must confirm it at the hostel's `pingTimes`.
- ☐ **3.1.8 [risk, market-specific] Battery optimisers.** Xiaomi, Redmi, Realme
      and Oppo aggressively kill background work, and those handsets dominate
      Nepal. A killed task produces **no ping, which reads identically to
      absence** — the failure this feature can least afford. OS geofencing is far
      more resilient than a periodic task for exactly this reason, but it is not
      immune. Needs a device pass on a real Xiaomi before anyone is told it works.
- ☐ **3.1.9 Self-declaration becomes the fallback,** not the primary flow: used
      when consent is off, when the automatic reading is `UNKNOWN`, and when the
      OS killed the task. The roster must show **which** — `AUTO` / `RESIDENT` /
      `WARDEN` — because a warden acting on "she said so" and on "her phone was in
      the building" are two different decisions.
- ☐ **3.1.10 [server] `NightStatusLog` is written and read by nothing.** Every
      status change has been recorded since launch and no route reads it back.
      That is where the real signal is: *"not verified four nights running"* is
      worth an alert; any single night's zone is not.

#### Sequencing, so the build does not break the running app

**Phase 1 — no native change**, works with the binary on the phone today:
3.1.1, 3.1.2, 3.1.3, 3.1.4, 3.1.5.
**Phase 2 — needs a rebuild**: 3.1.6, 3.1.7, 3.1.8, then 3.1.9 and 3.1.10.

### 3.2 Guardians — invite, permissions, revoke

The server has the full verb set — `GET`/`POST /resident/guardians`,
`PATCH`/`DELETE /resident/guardians/{id}` — driven by
`guardian-invite.service.ts`. Mobile reads guardians as static rows on
`profile.tsx` and offers nothing else, so a resident cannot grant a parent access,
narrow it, or take it back from the phone.

The six flags, with the web's exact copy (`PERMISSION_FIELDS`), which must not be
paraphrased — each is deliberately concrete about its limit (PRD §10):
`canViewPayments` "Fee status (paid / unpaid / due)" · `canViewReceipts` "Payment
receipts" · `canViewNotices` "Hostel notices" · `canViewFood` "Food menu" ·
`canViewSafety` "Night safety summary (day-level only)" · `canViewComplaintStatus`
"Complaint status (titles only)".

- ☑ **3.2.1 The client, split in two** *(2026-09-04)* — `lib/guardian-access.ts`
      holds the types, `GUARDIAN_PERMISSIONS` and the pure rules;
      `lib/guardian-access-api.ts` holds the four calls. **The split is not
      cosmetic**: anything importing `lib/api` drags in React Native, whose Flow
      source the node-side runner cannot parse, so the first draft (types in the
      api module) could not be tested at all. Same shape as
      `notification-preferences{,-api}.ts`. **17 tests.**
      <br>**Label wording changed from the plan.** The tracker said use the web
      page's `PERMISSION_FIELDS`; the *service's* `PERMISSION_LABELS` are used
      instead, because those are the strings `enabledPermissionLabels` puts in the
      **invitation email**. A resident ticking a box and a guardian reading what
      they were granted now see the same sentence — and the service's wording is
      the more honest one ("titles only, **never the details**").
- ☑ **3.2.2 `app/guardians/index.tsx`** *(2026-09-04)* — a row per guardian
      subtitled by *what they can see*, not by status: the enum has four values
      and this list only ever contains two, so a status pill would carry almost no
      information. Pending invitations show their expiry instead. Tapping opens the
      six switches in a `<Sheet>`.
- ☑ **3.2.3 `app/guardians/new.tsx`** *(2026-09-04)* — all six default **off**,
      and the card above the button names what has been switched on, so an
      all-off invitation is visible rather than an accident.
- ☑ **3.2.4 Permission edit** *(2026-09-04)* — one `PATCH` per switch (the
      schema is `.partial()`), optimistic, reverting on failure, settling on the
      server's returned set rather than the client's guess.
      <br>**The draft is keyed by `accessId`.** The sheet is reused rather than
      remounted per guardian, so an unkeyed draft would paint the previous
      guardian's switches onto the next one — which would tell a resident their
      uncle can see the rent when it is their mother who can.
- ☑ **3.2.5 Revoke** *(2026-09-04)* — destructive confirm naming both the action
      and the person, and saying that the emailed link dies with it.
- ☑ **3.2.6 `profile.tsx`'s guardian section** *(2026-09-04)* — its footnote said
      guardians "are invited by your hostel and manage their own accounts", which
      was **wrong**: `inviteGuardian`'s own comment says the resident owns the link
      and the permissions on it. Now "You decide who is linked, and what each of
      them can see", with a Manage action in the section header. Emergency
      contacts deliberately did **not** get one — that section really is read-only
      (§7.1), and giving both a door would put one on a wall.
- ☑ **3.2.7** Routes registered in `_layout.tsx`; reached from Profile **and**
      from its own More row, because sharing your record with a parent is a
      decision people revisit and two screens deep under "Profile" is how access
      gets left switched on for somebody the resident meant to remove.

### 3.3 Offer Program — the resident's own view

`app/offer-program.tsx` is the **public explainer** and correctly renders signed
out. The web has a second, private page answering different questions: *which
reference code is live for me right now*, *how much of what I paid was matched
automatically*, *where are my certified receipts*. Mobile has none of it.

It reads the payments endpoint, not one of its own — everything on it is a
rearrangement of facts `getFinanceView()` already returns, and a second endpoint
would be a second chance for two screens to disagree about one resident's money.

- ☑ **3.3.1 `app/offer-program/mine.tsx`** off `getFinanceView()` *(2026-09-04)*.
      No new API, plus `lib/offer-program.ts` for the three derivations and
      **13 tests**. The existing public explainer moved to
      `offer-program/index.tsx` so the pair follows the repo's own
      `dir/index + sibling` convention (`id-card/`, `complaints/`); `/offer-program`
      keeps its URL, so nothing that links to it breaks.
- ☑ **3.3.2** *(2026-09-04)* Live codes as tap-to-copy cards in tracked type,
      the three figures as a `StatTile` strip, receipts through `downloadToDevice`
      — the global downloader, so no share sheet, no per-screen spinner, no
      permission prompt.
- ☑ **3.3.3** *(2026-09-04)* Reached from a **row under the Payments focus card**
      and from More's "Your stay", not as a sixth tab and not as a third icon in
      the Payments app bar — three glyphs would crowd the title, and this is a
      destination rather than a header action.
- ☑ **3.3.4 Two bugs in the web page were fixed rather than ported.** Both are
      pinned by tests, and both still stand on the web — see §9.5.

> **Why this screen exists at all**, in one line, because it is the item most
> likely to be mistaken for duplication of Payments: Payments answers *what do I
> owe and how do I pay it*, arranged around a due date. This answers *which code
> is live, what has been certified, where are my receipts* — asked at a different
> moment, usually when nothing is due.

---

## §4 Screen-by-screen field pass

One box per screen. Each is a read of the shipped screen against its web
counterpart *and* against the payload, checking that every field the server
returns is either drawn or deliberately not. Record the "deliberately not" in the
screen's doc comment, in this codebase's house voice.

- ☐ **4.1 Home** (`(resident)/index.tsx`) — bell (§2.1), skeleton (§2.3), topics
      (§2.2). Then: is `feeStatus.pendingProofs` still the only claim signal? Does a
      live SOS have a banner here the way admin Home has one? `resident.residentType`
      gates QuestionCall — confirm `WORKING_PROFESSIONAL` genuinely has nothing to
      lose by its absence.
- ☐ **4.2 Payments** (`(resident)/payments.tsx`) — the focus card, metric strip,
      filter chips and statement download all ship. Check: invoice **line items**
      (`lines`: description, signed amount, basis, proration basis) landed
      server-side 2026-08-17 — are they drawn on `invoice/[id]`? Partial payments and
      remaining balance? Receipt download per settled month? One-off invoices carry
      `period: null` — no month-keyed reader may assume otherwise.
- ☐ **4.3 Food** (`(resident)/food.tsx`) — rating is per meal per day; photo upload
      goes through the universal uploader and the global toaster. Check the month-end
      card, and that Nepal-time day resolution holds on a phone left on another
      timezone during the 17:00–23:45 window.
- ☐ **4.4 Notices** (`(resident)/notices.tsx`) — status + category chips, pager,
      optimistic read. Check `expiresAt` is honoured, and that Home's urgent tile and
      this screen's urgent filter agree on the count.
- ☐ **4.5 Complaints** (`complaints/*`) — new, detail, thread, attachments, voice
      notes, and **confirm-resolution**, which is the only row with something for the
      resident to do. Verify that confirm is prominent, not buried. Pager blocked by
      §7.4.
- ☐ **4.6 Night status** (`night-status.tsx`) — three choices, not five; nothing
      preselected from a stale answer; the night runs 17:00 → 17:00 Nepal time.
      History blocked by §7.2.
- ☐ **4.7 SOS** (`sos.tsx` + `sos-fab.tsx`) — numbers first and tappable;
      `describeFanout` tells the truth when nobody was reached. Contacts stay
      read-only until §7.1.
- ☐ **4.8 Profile** (`profile.tsx`) — every field on `ResidentProfile` drawn or
      accounted for: deposit held, resident type, move-in, room type. Guardians
      section rewritten by §3.2.6.
- ☐ **4.9 Digital ID** (`id-card/*`) — manual flip, sharing-off stated on the card
      face itself, edit path for the photo.
- ☐ **4.10 Review** (`review.tsx`) — seven fields in the web's order, the merge
      notice, the `ACTIVE | MOVED_OUT` gate read up front.
- ☐ **4.11 Referral** (`referrals.tsx`) — the code is minted by the GET, the share
      sends the code and not the dead link, three tiles, referred-inquiry list.
- ☐ **4.12 Settings** (`settings.tsx`) — every notification switch is real and
      round-trips; the four deletion pathways keep their verbatim copy; each
      `?section` slice lands on the right heading.
- ☐ **4.13 Notifications** (`notifications.tsx`) — once §2.1 makes it reachable,
      re-read it as a resident: is `actionUrl`'s "says so and stops there" behaviour
      right for the rows a *resident* gets, or do payment reminders now have a real
      in-app destination to push to?
- ☐ **4.14 More** (`(resident)/more.tsx`) — §2.1 and §2.4, plus rows for Attendance
      (§3.1.5), Guardians (§3.2) and Offer Program (§3.3.3). Re-check the grouping
      once four rows are added: NOTES says a menu of destinations is a **tinted icon
      grid or tinted icon rows**, never full-width rows of sentences.

---

## §5 Shell, navigation and performance

- ☐ **5.1 The Home stat strip is at capacity.** Three tiles (Notices, Complaints,
      Night status) at `minCellWidth={104}`. Attendance would want a fourth. Decide:
      four at a smaller cell, or attendance stays a More row. Do not silently make it
      a 2×2 that pushes the dues card off the fold.
- ☑ **5.2 `lib/resident-queries.ts` + a `(resident)/_layout.tsx` warm-up.**
      *(2026-09-04)* — and the item turned out to be hiding something worse than
      a missing prefetch.
      <br>**Every resident tab was throwing its answer away.** `useResource`
      without a `cacheKey` holds its payload in component state and loses it on
      unmount — the right default for a screen visited once, the wrong one for a
      tab. **Not one resident screen passed a `cacheKey`**, so Home → Payments →
      Home refetched the dashboard from scratch, with a loading state, every
      time. The admin tabs have painted from cache since they got their registry.
      <br>Fixed by giving the resident portal the same registry: seven
      descriptors (`dashboard`, `finance`, `food`, `notices`, `more`, `profile`,
      `guardians`), each with its key and topics defined once so the warm-up and
      the screen run the *same* request under the *same* key — a prefetch against
      a different key warms something nobody reads and the screen loads twice.
      The More screen's `loadMore` moved into it for that reason.
      <br>The warm-up is **one wave, not the admin's three**: a warden has seven
      reads at the door and a dozen behind it; a resident has five tabs with one
      payload each. Home is deliberately excluded — it is the tab they land on and
      is already asking. `notices` warms **page 1 only**, and its key says so,
      because that screen pages by appending rather than re-keying.
- ☐ **5.3 Tab titles.** Admin tabs set `large` on the `AppBar`; resident tabs do
      not, so two role bars are 16pt and 22pt for the same job. Pick one.
- ☐ **5.4 [decision] Does Attendance or Guardians deserve a tab?** Assumed **no** —
      five tabs are settled and both are occasional errands. Recorded so the next
      session does not reopen it by accident.

---

## §6 Design conformance

Read `ui_inspiration_folder/app_recordings/NOTES.md` and
`ui_inspiration_folder/hostelhub_master_ui_screens/` **before** writing any of
this, not after. Then:

- ☐ **6.1 No raw hex** anywhere this work order adds. Role and brand tokens only.
      Attendance zones map onto `success` / `warning` / neutral — and `OUTSIDE` is
      **neutral**.
- ☐ **6.2 Accent headers are painted blocks with rounded bottom corners**, with
      something straddling the bottom edge, on pushed screens — `AppBar`'s `accent`
      and overlap props already do this.
- ☐ **6.3 Date-grouped lists** put the heading on the page background, outside the
      card (attendance days, notification days).
- ☐ **6.4 Overflow is a `<Sheet>`.** No anchored menus.
- ☐ **6.5 Reuse before inventing.** `Card`, `DataCard`, `CardRow`, `ListRow`,
      `InfoTile`, `Grid`, `Segmented`, `Sheet`, `Meter`, `Skeleton`, `AppBar`,
      `StatusPill`, `Money`, `Toggle`, `StarRating` cover essentially all of this. If
      a primitive's doc comment argues against what you are about to do, read it
      before overriding it.
- ☐ **6.6 Dark mode** on every new screen, checked on a device, not inferred.

---

## §7 Server-side gaps — [server], not mobile work

These live in `apps/web`. Each lists what mobile ships in the meantime. **Do not
build a control the server will ignore.**

- ☐ **7.1 Residents cannot add or remove their own emergency contacts.**
      `/resident/emergency-contacts` is GET-only; the sole `EmergencyContactModel.create`
      sits inside admin resident creation. Needs POST/DELETE scoped to the caller.
      *Mobile ships:* a read-only list on `sos.tsx` and `profile.tsx` that says who
      can change it.
- ☐ **7.2 Night-status history is written and never read.** Every change appends a
      `NightStatusLog` and nothing in the repo reads it back. Needs
      `GET /resident/night-status/history`, paginated.
      *Mobile ships:* no History section at all — an empty heading would suggest a
      broken feature where there is none.
- ☐ **7.3 A resident cannot read their own review back.** There is no
      `GET /resident/reviews`, and `serializePublicReview` strips `residentId`. Also:
      a scored category cannot be cleared, because the POST is a merging `$set`
      upsert.
      *Mobile ships:* an empty form and one sentence saying the submission replaces
      what came before.
- ☐ **7.4 `GET /resident/complaints` parses no query.** The service already takes a
      `PaginationQuery` and the response already carries `pagination`; the route never
      reads `?page`, so it is always the newest 100.
      *Mobile ships:* no pager, and `complaints-api.ts` says why in its header.
- ☐ **7.5 A resident can set their own night status to `SOS_TRIGGERED`.** The
      resident route validates against the full five-value enum, so a client could
      write an emergency status that creates no `SOSAlert`, runs no fan-out and
      notifies nobody — a word on the warden's roster. Needs a narrower resident
      schema.
      *Mobile ships:* `lib/night-status.ts` offers three.
- ☐ **7.6 The gateway return URL is web-only**, so the in-app browser never
      redirects to `hostelhub://`. *Mobile ships:* polling, which is correct
      regardless.
- ☐ **7.7 Community avatars show the viewer's own face on other people's posts.**
      `serializePost` returns the ID-card photo route, which has no id in its path and
      by design returns only the caller's own photo. Leaks nothing; still wrong.

---

## §8 Device verification — [device]

`adb` against the owner's own handset. Per `device-is-the-users-phone`: **ask
before launching, and stop after the shot you came for.**

- ☐ **8.1** Attendance: consent on, consent off, erase, empty state.
- ☐ **8.2** Guardians: invite → pending → permissions → revoke, end to end.
- ☐ **8.3** Offer Program (own view) beside the web page.
- ☐ **8.4** The bell on Home, and a push landing while the app is foregrounded.
- ☐ **8.5** Skeletons on all four tabs, throttled to 3G.
- ☐ **8.6** Dark-mode sweep of every screen this work order touched.
- ☐ **8.7** A 320dp screen — the stat strip and any new grid.

---

## §9 Discovered mid-task — append only

- ☑ **9.1** `src/lib/fee-schedule-standing.test.ts` failed to collect — `vi.mock`
  hoisted above the `const get` its factory closed over, so the suite had never
  run. **Fixed 2026-09-04** with `vi.hoisted()`; 7 tests now run and pass.
  It is also the only test in `apps/mobile` that mocks `@/lib/api` at all —
  everywhere else the pure half is split into its own module so the node-side
  runner can import it without touching React Native. Splitting it that way is
  still worth doing and is **not** done.
- ☑ **9.2 `npm run mobile:typecheck` exits 0 with errors printed.** The npm
  wrapper swallows `tsc`'s status, which is how `nepaliDayLabel` — a function
  that exists nowhere — sat in `manage/resident/new.tsx` uncaught. Fixed the call
  site 2026-09-04; **the script itself is still lying** and should be changed to
  fail properly. Until then use the direct `tsc` command at the top of this file.
- **9.3 `IconButton`'s `onAccent` badge text is `text-[#0e7490]`** — a cyan
  literal left over from the admin portal's pre-2026-08-21 accent, on a component
  whose own doc comment explains why the colours there are deliberate literals.
  The reasoning still holds; the value is stale and should be the brand green.
  `components/ui/icon-button.tsx`.
- ☑ **9.4** An unused `Toggle` import in `manage/resident/new.tsx` — the only
  lint warning in the tree. Removed 2026-09-04 while fixing 9.2 in the same file.
- **9.5 Two live bugs in `resident-offer-program-page.tsx` (web), found
  2026-09-04 porting it. Mobile does not reproduce either; the web still has
  both.**
  1. **It hides the reference code for an `UNPAID` invoice.** Its local
     `OPEN_STATUSES` is `["OPEN", "PARTIAL", "OVERDUE"]`, which omits `UNPAID`
     and `PENDING_PROOF` — both statuses the server genuinely emits, and `UNPAID`
     is the ordinary state of a month nobody has paid yet. So the page hides the
     code for precisely the invoice a resident opening it is about to pay. The
     correct list is the five in `invoice-ledger.ts`'s `isOpenInvoice`, which
     match the server's own `buildFeeSummary`.
  2. **An undated receipt sorts to the top.** Its comparator coerces a missing
     `issuedAt` to `""`, which sorts *above* every real date — so a migrated
     receipt pushes this month's genuine one off the first screenful.
  3. Minor, same file: it prints `invoice.month` raw, which renders `null` for an
     admission fee (`Invoice.period` is nullable — one-off invoices have no
     month). Mobile puts it through `formatPeriod`.
- **9.6 `react-hooks/preserve-manual-memoization` is an error, not a warning,**
  and a reflexive `useCallback` around a handler that is only ever called from an
  inline arrow trips it — the React Compiler drops the memo, sees the mismatch,
  and **skips optimising the whole component**. Worth knowing before writing the
  next form screen: `useCallback` is for a value something else depends on being
  stable (`useResource`'s loader), not a habit.

---

## §10 Location policy — a release gate, not a nice-to-have

**Set by the owner 2026-09-04.** Ask about this section before ever answering
"is it finished". Shipping background location without these being true and
written down is how an app gets pulled from the Play Store.

### The rule

| Who | Foreground location | Background location |
|---|---|---|
| **Public / signed-out / non-resident** | Yes — only while the app is open, only to sort hostels by distance and to navigate | **Never.** Not once, not opportunistically, not "while we have the permission" |
| **Resident, consent granted** | Yes | Yes — **time-limited**, only within the hostel's configured night windows, and only while they are a resident |

Two things follow that the code must enforce rather than merely promise:

- **The permission is requested from residents only**, and only at the point
  attendance is switched on — never during onboarding, never from a browse
  screen. A public user must never see a background-location prompt.
- **Background collection stops** when consent is withdrawn, when the hostel
  disables attendance, and when the resident stops being a resident. The last of
  those is the one most likely to be forgotten: a `MOVED_OUT` resident with a
  live geofence is collecting location for a hostel they no longer live in.

### Where it has to be written, and it is not one place

- ☐ **10.1 Play Store Data safety form** — declare background location, its
      purpose, that it is optional, and that it is deletable in-app. A mismatch
      between this form and observed behaviour is the usual reason for removal.
- ☐ **10.2 Play Store background-location declaration** — Google requires a
      written justification **and a demo video** for `ACCESS_BACKGROUND_LOCATION`.
      Budget real time for this; it is reviewed by a human and is often rejected
      first time.
- ☐ **10.3 Privacy policy** — the copy is **site config**, not a file: it lives
      in the `content` section and is served to both the website's `/privacy` and
      the app's `app/legal/privacy.tsx` through `DocumentScreen`. Editing
      `docs/PRIVACY_POLICY.md` alone changes nothing a user reads.
- ☐ **10.4 Terms** — same mechanism, same trap.
- ☐ **10.5 In-app consent copy** — already written on `app/attendance.tsx` and
      must be kept in step with whatever 10.3 ends up saying. Where the two
      disagree, the one the resident actually read is this one.
- ☐ **10.6 `docs/PRIVACY_POLICY.md`** — the internal reference. Two problems in
      it today, both found 2026-09-04:
      1. **It has no public-user distinction at all.** It describes location
         tracking as though every user is a resident.
      2. **§3.6 is factually wrong against shipped code.** It says consent can be
         withdrawn only by "requesting account deletion" or "contacting your
         hostel administrator (may affect your residency)". `POST /resident/consent`
         with `granted: false` exists, and `app/attendance.tsx` now puts that
         switch in the resident's hand. A policy that understates a right the
         product already grants is still a policy that is wrong.

### Also worth fixing while in there

- ☐ **10.7** §3.1 of that document promises pings "3 times per day" at fixed
      example times. If the sampling design lands on several windows through the
      night (which is what the owner has asked for — see
      `night_presence_research_prompt.md`), this section is describing a product
      that no longer exists.

---

## Progress log

| When | What | Next |
|---|---|---|
| 2026-09-04 | Audited the resident surface against `apps/web`, `portal-nav.ts`, the `/api/v1/resident/*` routes and the service layer. Wrote this file. | §2.1 |
| 2026-09-04 | Fixed the two broken baselines first (§9.1, §9.2) so a new regression could be told from the existing damage. Then §2 whole — the bell and the notifications row, five tab screens made live, four skeleton states, the settings `section` params. | §3.2 |
| 2026-09-04 | §3.2 Guardians, complete: two lib modules + 17 tests, list, invite form, per-switch permission edit, revoke, and Profile rewired. **tsc clean, lint clean, 1090 tests / 71 files.** | §3.3 |
| 2026-09-04 | §3.3 Offer Program, complete: `lib/offer-program.ts` + 13 tests, the resident's own screen, explainer moved to `offer-program/index`, reached from Payments and More. Two web bugs found and not ported (§9.5). | §5.2 |
| 2026-09-04 | §5.2 `lib/resident-queries.ts` — seven descriptors, six screens rewired, one-wave warm-up. Found and fixed that **no resident screen had a `cacheKey`**, so every tab switch was a cold reload. | §3.1 |
| 2026-09-04 | §10 added: the public-vs-resident location policy, as a **release gate**. Found `docs/PRIVACY_POLICY.md` §3.6 is wrong against shipped code and has no public-user distinction. `night_presence_research_prompt.md` written for the owner's cloud assistant. | §4 |
| 2026-09-04 | Owner reset the priority: automatic night presence is what the hostel is buying. §3.1 rewritten as that design, and **Phase 1 built** — the UTC day-bucket bug fixed server-side (an existing test had pinned the bug), `lib/attendance{,-api}.ts` + 14 tests, and `app/attendance.tsx`. **Mobile 1117 / 73, web 2123 / 148, lint and tsc clean.** | §4, then §3.1 Phase 2 — and a device pass on everything so far |
