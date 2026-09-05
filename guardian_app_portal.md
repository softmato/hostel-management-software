# Guardian Portal App — work order

**Created 2026-09-04**, immediately after the resident tab-shape pass
(`resident_app_portal.md` §11). Scope: `apps/mobile`'s `(guardian)` tab group.

Opened because the owner's instruction was *"complete the flow steps ui flows and
all for resident app, then after make the guardian app"* — and the guardian
portal turned out to have the same three faults the resident portal had just been
cleared of, plus one of its own that was costing four network round trips per
visit.

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

**Baseline at the start of this work: `tsc` clean, lint clean, 1148 tests / 76
files.**

---

## §0 What the portal is, and what it is not

A guardian account is **read-only by construction**, and every design decision
below follows from that.

| | |
|---|---|
| **Tabs** | Home · Safety · Community · Payments · More |
| **Reads** | One: `GET /guardian/dashboard`. The four sibling routes each call the same server function and return a slice of it |
| **Writes** | None. There is no guardian payment route, no claim route, no night-status route anywhere in `apps/web` |
| **Gating** | Six permission flags the **resident** owns. An ungranted section arrives as `[]`, indistinguishable from an empty one — hence `canSee()` on every block |
| **Palette** | black / white / green, `roleAccent.GUARDIAN` for the tab bar. Never a literal hex from a reference image |

Two things this portal must never do, both carried over from the web pages it
replaced and both about telling a parent something the payload does not support:

- **Never assert an all-clear.** The web drew "Emergency Status: Normal — no
  active alerts" from a payload with no SOS field of any kind, so it said
  "Normal" whether or not an alert was live.
- **Never show a time.** `safety.asOf` is truncated to a day by the serializer on
  purpose — PHASES.md §4.1 treats the exact minute a resident was checked as
  surveillance rather than reassurance. Nothing may derive a time from it.

---

## §1 Done in this pass

- [x] **1.1 Four tabs were fetching one payload four times.** *(2026-09-04)*
      Every guardian screen called `useResource` with an inline `useCallback` and
      **no `cacheKey`**, and `useResource` without a key holds its payload in
      component state and loses it on unmount. So Home → Safety → Payments → Home
      was four full round trips for one object, each with its own spinner, on the
      portal whose users are most likely to be on a slow connection.
      <br>`lib/guardian-queries.ts` gives it one descriptor, one key and the
      **union** of the four topics. Per-screen topic lists were wrong once the
      cache entry is shared: the entry's freshness would depend on which tab
      happened to be mounted, so a notice arriving while the guardian sat on
      Payments would leave a stale dashboard for Home to paint.
      <br>Deliberately **no** `prefetchGuardianPortal`: every tab reads the same
      key as the one being landed on, so a warm-up would be a second request
      racing Home's own.
- [x] **1.2 A guardian could not reach their notification inbox.**
      *(2026-09-04)* `/notifications` is scoped to `principal.userId` with no
      role branch, so a guardian has always had a feed — and nothing in these
      five tabs opened it. Identical to the resident group's §2.1, and the same
      fix: `<NotificationBell>` in the `AppBar` `actions` slot on all four
      screens, so the control does not vanish when you change tab, plus a
      **Notifications** row on More.
- [x] **1.3 Home was a longer copy of the two tabs beside it.** *(2026-09-04)*
      It drew night status, the outstanding figure, a metric strip, today's
      meals, the notices, the complaint list *and* a row into Payments — while
      Safety drew night status, complaints and notices, and Payments drew the
      outstanding figure, the dues and the receipts. A guardian with everything
      shared read the same four sections three times, and the screen whose job is
      to say *where to go* was the longest scroll in the portal.
      <br>Home now keeps what lives nowhere else — **today's meals** (Food is not
      a tab) and **the notices**, moved off Safety where they never belonged —
      and points at the rest with two subtitled `<CardRow>` doors.
      <br>The metric strip went with the duplication: `Due` repeated the hero's
      figure, `Night` repeated its pill, and `Paid` is a fact about the dues list,
      so it sits on the Payments card above the rows it sums.
- [x] **1.4 The portal had no hero.** *(2026-09-04)* Home opened with a plain
      white card — an avatar, three lines, a `Call` button — under a 16-point
      bar, while the admin and resident homes opened on the painted account card
      from `ebl-01`. The portal a **parent** uses was the one that looked
      unfinished.
      <br>`<GuardianWardHero>` is that card, third portal in: identity block,
      night pill, the outstanding figure with the same mask toggle, and the
      hostel's number as the themed second register (`NOTES.md` §11). No
      photograph — the guardian payload carries none, and adding one would ship a
      building's picture to an account that does not live in it — so
      `<PortalHeroCard>` falls back to `HeroOrnament`.
      <br>**The money block is absent, not zeroed,** when fees are not shared.
      `summary` is `null` for that reason server-side, and a parent shown `NPR 0`
      would read "nothing is owed".
- [x] **1.5 Payments now leads with the resident's own card.** *(2026-09-04)*
      `<ResidentDuesCard>` reused whole, **without its `footer`** — that register
      carries the reference code and the `Pay now` / `I've paid` buttons, and a
      guardian has neither. A card that silently loses its action half between two
      roles states "you can watch this, you cannot act on it" better than a
      disabled button would, and the sentence under it says so in words too.
      <br>`guardianNextDue` and `guardianLatestPaid` added to `lib/guardian.ts`
      with **7 tests**. `guardianNextDue` picks the **oldest** open month, the
      same rule `paymentStats` holds for the resident — the two must not disagree
      about which month is "next" for one debt. `guardianLatestPaid` orders by
      billing month because `GuardianPayment` carries no payment date, and counts
      a `PARTIAL` row because real money has moved against it.
- [x] **1.6 Four spinners became skeletons.** *(2026-09-04)* `<LoadingState>` on
      Home, Safety, Payments and More, on the house rule's own list of things not
      to do. Each placeholder is the shape of what replaces it.
- [x] **1.7 More.** *(2026-09-04)* An `<Avatar>` on the identity card, which is
      how every other More screen in the app opens and this one did not;
      `<FactRow>` for the access code and expiry, so a two-calendar date wraps
      instead of being squeezed into the ~150dp a 320dp phone leaves a right-hand
      column; `px-4 py-1` on the row cards, matching admin's; the settings row
      names its `?section=privacy` rather than pushing a bare `/settings`; and a
      **Community** `<CardRow>` — the board is platform-wide and this portal's tab
      bar has always had a slot for it that this screen never acknowledged.
- [x] **1.8 `guardian-ward-card.tsx` became `guardian-not-shared.tsx`.**
      *(2026-09-04)* `<GuardianWardCard>` is `<GuardianWardHero>` now and had no
      callers left. `<GuardianNotShared>` also stopped being drawn *under* a ward
      card on the two screens that refuse: an identity block over a refusal reads
      as one empty section of a working screen rather than as the answer to all
      of it.

**Verified after 1.1-1.8: `tsc` clean, lint clean, 1155 tests / 76 files.**

---

## §2 Still open

- [ ] **2.1 [device]** The whole pass on a handset, light and dark: the hero at
      320dp with a long hostel name, the hero with fees **not** shared (no money
      block), the `sharesNothing` state, and both "not shared" screens.
- [ ] **2.2 The tab bar has no badges.** `(admin)`'s custom bar renders them and
      this one does not, so a guardian gets no count anywhere except the bell.
      Decide whether an unpaid count belongs on the Payments tab — and note that
      a badge on a read-only tab is a prompt to act on something they cannot.
- [ ] **2.3 Home's `sharesNothing` card and the two "not shared" screens say
      three slightly different things.** One sentence, written once, would be
      better. Left as-is because the three contexts genuinely differ (nothing at
      all / fees specifically / night status specifically) and merging them
      wrongly is worse than three near-duplicates.
- [ ] **2.4 There is no guardian notices screen.** Home lists them all, with no
      pager, because the payload has no pagination. Fine while a hostel addresses
      a handful of notices to guardians; revisit if one starts posting weekly.

---

## §3 Server-side gaps — [server], not mobile work

Each lists what mobile ships in the meantime. **Do not build a control the server
will ignore.**

- [ ] **3.1 No guardian payment or claim route.** *Mobile ships:* the dues card
      without its action register, and one sentence saying payment is made from
      the resident's own portal or with the office.
- [ ] **3.2 No guardian receipt-PDF route.** `receipts` carry a number and an
      amount and nothing downloadable. *Mobile ships:* the receipt **number** on
      the dues row, never a download icon.
- [ ] **3.3 The payload has no SOS field.** So no guardian screen can say
      anything about an emergency, in either direction — see §0. If an SOS
      summary is ever added it must be able to say "we do not know", not just
      "active" and "none".
- [ ] **3.4 `GuardianPayment` carries no `paidDate`.** `guardianLatestPaid`
      orders by billing month instead, which is right for a monthly ledger and
      wrong the day a hostel bills twice in one period.
- [ ] **3.5 No guardian food history.** `food` is today only, so Home shows
      today only. A parent asking "what did they eat this week" has nowhere to go.

---

## §4 Not in scope, recorded so it is not reopened

- **A guardian does not get an SOS control.** `<SosHeaderButton>` is on the
  resident Home bar because a resident in trouble needs it where nothing can
  scroll it away. A guardian raising an alarm about somebody else is a phone call
  to the office, which is the card on Safety and the register on Home's hero.
- **Community stays one board for everyone.** Signed out, public account,
  resident, staff, guardian — `community.service.ts` is platform-wide, which is
  why it is a root-stack screen rather than something inside a role's tabs.
- **The guardian portal gets no warm-up.** See §1.1.

---

## §5 Discovered mid-task — append only

- **5.1** `(admin)`, `(provider)` and `(guardian)` More screens still push a bare
  `/settings` for at least one row — the §2.4 bug from `resident_app_portal.md`.
  The guardian one was fixed in 1.7; the other two are still open there.

---

## Progress log

| When | What | Next |
|---|---|---|
| 2026-09-04 | Portal read against `(admin)` and `(resident)` after the resident tab-shape pass. Found four tabs refetching one payload, no bell anywhere, Home duplicating both its siblings, and no hero. §1 built whole. **1155 tests / 76 files, lint and tsc clean.** | §2.1 [device] |
