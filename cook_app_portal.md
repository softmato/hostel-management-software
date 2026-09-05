# Cook Portal App — work order

**Created 2026-09-04**, after the resident tab-shape pass
(`resident_app_portal.md` §11) and the guardian pass (`guardian_app_portal.md`).
Scope: `apps/mobile`'s `(cook)` tab group.

Opened because the owner asked for it directly — *"make the cook app portal too"*
— and because the portal turned out to have the same four faults the other two
had just been cleared of, plus one of its own: **two tabs were fetching the same
payload, neither of them caching it.**

This file is the **handoff document** for that work. A session that picks it up
starts by reading it top to bottom and works at the first unticked box.

---

## How to use this file

- **One item at a time.** Write the code, verify it, then flip `[ ]` to `[x]`
  **in this file** with the date before starting the next item. Do not batch, and
  do not open a PR per box — the repo's convention is a tracker file, not a queue
  of branches.
- A `[x]` means *seen working*, not *file created*. Where "working" needs a
  handset, the box is marked **[device]** and stays `[ ]` until the device pass.
- **[server]** marks work that lives in `apps/web`. Do not fake it on the client.
- Anything found mid-task that is out of scope gets appended to §5, not fixed
  inline.

## Verification

```bash
npx --prefix apps/mobile tsc --noEmit -p apps/mobile
```

```bash
npm run mobile:lint && npm run mobile:test
```

> `npm run mobile:typecheck` **exits 0 with errors printed** — the npm wrapper
> swallows `tsc`'s status. Use the direct command above. See
> `resident_app_portal.md` §9.2.

**Baseline at the start of this work: `tsc` clean, lint clean, 1155 tests / 76
files.**

---

## §0 What the portal is, and what it is not

| | |
|---|---|
| **Tabs** | Today · Menu · Community · Photos · More |
| **Reads** | `GET /cook/today` (today's meals, today's announcements, the head count **and the whole week's routine**), the roster, the photo feed, the announcement log |
| **Writes** | Two, and only two: announce a meal, post a photo |
| **The account** | **One login per hostel.** `provisionCookAccount` creates a single account the whole kitchen shares; per-announcement attribution comes from `FoodReadyLog.deviceInfo`, not from separate users (PHASES.md §3.1) |
| **Palette** | black / white / green, `roleAccent.COOK` for the tab bar. Never a literal hex from a reference image |

Three rules that follow from the shared login and must not be softened:

- **"Signed in as" is not a person.** More names the *handset*, because that is
  the thing actually stamped on an announcement. An account name up there would
  imply an accountability the system does not have.
- **The roster is a noticeboard.** `CookResident` is three fields with nothing
  contactable in it, because a shared, effectively static password makes this the
  list most exposed by a leak.
- **No account-deletion pathway.** Every other portal's More has one; this login
  is the hostel's, and the person holding the phone at 6am is not the person
  entitled to close it. The office switches the cook portal off from
  `manage/settings`, which is where that decision has an owner.

And one about the product itself: **nothing on this portal is editable.**
`PUT /hostel-admin/food/routine` sits behind `manageFood`, which a COOK does not
hold — the menu is what the hostel promised its residents, and a kitchen changing
it silently is how a hostel serves something other than what it advertised.

---

## §1 Done in this pass

- [x] **1.1 Two tabs were fetching one payload, neither caching it.**
      *(2026-09-04)* Today calls `GET /cook/today` for the four buttons. Menu
      called it **again**, inside its own `loadMenu`, because the same payload
      carries the whole week's routine — which is the right call, made under an
      inline `useCallback` with **no `cacheKey`**. `useResource` without a key
      holds its payload in component state and loses it on unmount, so
      Today → Menu → Today was three round trips for one object.
      <br>`lib/cook-queries.ts` gives the portal four descriptors — `today`,
      `residents`, `photos`, `announcements` — and both tabs now read
      `cook:today`. The roster keeps a descriptor of its own so a roster that
      fails does not blank the week's menu, and it is the one query on the
      `residents` topic rather than `food`: it changes when somebody moves in or
      out, and a head count a day stale is the number on this portal that costs
      food.
      <br>A **warm-up** on `(cook)/_layout.tsx` covers the three tabs the cook is
      certain to reach but is not landing on. `today` is excluded for the reason
      the resident portal excludes Home: it is already asking.
- [x] **1.2 No cook screen had the bell.** *(2026-09-04)* More had a
      Notifications row and the other three tabs had nothing, so the control
      vanished the moment you left that one screen — `/notifications` is scoped
      to `principal.userId` with no role branch, so this account has a feed like
      any other. `<NotificationBell>` is in the `AppBar` `actions` slot on all
      four now, matching every other portal.
- [x] **1.3 Five spinners became skeletons.** *(2026-09-04)* `<LoadingState>` on
      Today, Menu, both sections of Photos, and nothing at all on More. Each
      placeholder is now the shape of what replaces it.
- [x] **1.4 The portal had no painted lead.** *(2026-09-04)* Today opened with a
      plain bordered box — `Cooking for` / `42` / a sentence — under a 16-point
      bar, while the other three portals all open on paint. Four portals of one
      product, one of which looked like a different app, and it is the one read
      at arm's length across a worktop.
      <br>`<CookShiftCard>`: the head count as the figure, `N of 4` on the
      shoulder, and a two-up of what has been called against what is next. Its
      shape is the **inset** card's (`AdminMoneyCard` / `ResidentDuesCard`), not
      the full-bleed hero's — this screen is a worktop rather than a front door,
      and the four announce buttons are the point of it.
      <br>**No percentage.** A shift is four discrete acts; a kitchen that has
      done breakfast and lunch at 2pm is on schedule, not half-failing. Same
      reasoning `app/attendance.tsx` records for refusing a presence percentage.
      <br>`nextUnannounced` (+3 tests) decides what "next" means: the first meal
      in **serving order** with nothing sent against it, not the one the clock
      suggests — a kitchen running an hour late would otherwise be told to
      announce the meal it has already served. The card that meal sits in is
      outlined in the brand, so one of four identical cards can be found without
      being read.
- [x] **1.5 Menu was a third hand-rolled copy of the week's routine.**
      *(2026-09-04)* Its own horizontal `ScrollView` of filled pills, then a
      `MEAL_TYPES.map` into `<MealRow>`s — which is exactly what
      `components/food-routine.tsx` already does, off the same payload, for the
      resident's Food tab and for `(admin)/today.tsx`. Three renderings of one
      menu is how "the app said chicken" starts, and the kitchen's was the copy
      nobody was looking at while editing the others.
      <br>It is `<FoodRoutineWeek>` now, which also brings two things this screen
      lacked: today stays marked on the strip when another day is selected, and
      each meal gets the icon square the rest of the app uses.
- [x] **1.6 The roster is searchable, once it is long enough to need it.**
      *(2026-09-04)* A hostel of forty gave a forty-row flat card.
      `searchCookResidents` (+4 tests) matches name and room type **as the row
      reads on screen** — `double sharing` finds `DOUBLE_SHARING` — and the field
      appears from twelve residents up, which is the rule `(admin)/money.tsx`
      states for its own search: a search box over eight rows is a control that
      exists to be ignored.
- [x] **1.7 The announcement history moved off Photos onto More.**
      *(2026-09-04)* It sat under the photo feed, on a tab named "Photos", and it
      is the list that grows — a hostel serving four meals a day adds ~120 rows a
      month underneath the control a cook opens that tab to press.
      <br>On More it is beside the block it belongs with: the device section says
      which handset is stamped on an announcement, and this says which
      announcements were stamped. Together they are the whole of what a shared
      kitchen login can be held to.
      <br>*"Did I already announce lunch?"* is **not** this list's question — it
      is answered on Today, on the meal's own card, which carries `Sent 12:04`.
- [x] **1.8 More.** *(2026-09-04)* An `<Avatar>` on the identity card, as every
      other More opens — and the only one in the product where the initial is
      deliberately not a person, which the caption says. `<FactRow>` for the
      three device facts, so a fingerprint wraps instead of being squeezed into
      the ~150dp a 320dp phone leaves a right-hand column (`NOTES.md` §8).
      `px-4 py-1` on the row cards, matching admin's.

**Verified after 1.1-1.8: `tsc` clean, lint clean, 1162 tests / 76 files.**

---

## §2 Still open

- [ ] **2.1 [device]** The whole pass on a handset, light and dark: the shift
      card at 320dp with a three-digit head count and a long hostel name, the
      "all called" state, the four announce cards with wet hands, the roster
      search over forty, and the photo grid's skeleton throttled to 3G.
- [ ] **2.2 The Today tab has no badge on the tab bar.** `N of 4 still to call`
      is the one count in this portal worth surfacing from another tab, and
      `(admin)`'s custom bar already knows how to draw badges. Decide whether a
      kitchen wants that nag or would learn to ignore it.
- [ ] **2.3 The photo feed pages and the screen does not.**
      `listCookFoodPhotos` returns `hasMore` and nothing reads it — the same
      fault the resident notices screen had before §11.5. A kitchen posting daily
      loses last month off the bottom.
- [ ] **2.4 `Menu`'s roster and `Today`'s head count can disagree.**
      `residentCount` comes from `GET /cook/today` and the roster from
      `GET /cook/residents`, under two keys with two lifetimes. They are the same
      population, so a stale one of either shows two different numbers for one
      hostel on two tabs. Probably wants the count derived from the roster, or
      both from one read.

---

## §3 Server-side gaps — [server], not mobile work

- [ ] **3.1 No cook-side device registration.** The fingerprint is written by the
      first announcement, so More reads `collectDeviceInfo()` locally rather than
      showing what the server has on file. A kitchen cannot see, or revoke, the
      other handsets signed into the shared login.
- [ ] **3.2 The cook cannot see a meal's feedback.** Residents rate per meal per
      day and the aggregate is the only thing that tells a kitchen Tuesday dinner
      is the problem — which is what the rating exists for. There is no
      `GET /cook/feedback`. *Mobile ships:* nothing, rather than a section that
      would have to invent a number.
- [ ] **3.3 The announcement log is unpaginated.** `listFoodReadyLogs` returns
      what it returns; a kitchen a year in has no way to reach last February.

---

## §4 Not in scope, recorded so it is not reopened

- **Nothing on this portal edits the menu.** See §0. If a hostel wants the
  kitchen to be able to correct a cell, that is a capability change on the
  server, not a form here.
- **The cooldown stays the server's.** `foodReadyCooldownMinutes` returns a 429
  naming the wait; the button says "Announce again" rather than disabling itself,
  because a cook re-calling a late sitting must be able to try and a client-side
  copy of that rule drifts the moment an admin changes it.
- **The meal type of a photo is guessed, not asked.** `mealTypeNow()` reads the
  Kathmandu clock. A picker between "I want to share this" and the photo being
  shared is where people give up, and a wrong bucket costs the hostel nothing.

---

## §5 Discovered mid-task — append only

- **5.1** `mealButtons` is the only thing standing between a blank routine cell
  and a missing announce button, and it is right — but nothing on the *server*
  stops an admin publishing a routine with all four cells empty, in which case
  the kitchen announces four meals whose message is built from nothing. Worth a
  look at what `announceFoodReady` composes in that case.

---

## Progress log

| When | What | Next |
|---|---|---|
| 2026-09-04 | Portal read against `(admin)`, `(resident)` and `(guardian)` after both earlier passes. Found Today and Menu refetching one payload with no cache, no bell on any tab, five spinners, no painted lead, a third copy of the week's routine, and the announcement log growing on the Photos tab. §1 built whole. **1162 tests / 76 files, lint and tsc clean.** | §2.1 [device] |
