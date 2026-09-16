# Team registration — full-setup rebuild

Work order for bringing `/team/register` up to the standard of the public flow
and past it, because the agent is collecting **everything** a warden would
otherwise set up themselves.

Source: the session request. **Tick an item only after the code is written and
verified — never batch.**

---

## What is wrong today

`/team/register` is one long dense page. That was a deliberate choice for an
agent filling it in for the fifteenth time, and it is the wrong choice now that
the form has to collect a whole hostel: photos by kind, rules, food, the weekly
routine, per-room pricing. A page that long with no rail gives the agent no idea
how much is left or what is missing.

It also collects **less than the public form**, so a team-registered hostel goes
live thinner than an owner-registered one — the exact opposite of the intent,
since our own staff are standing in the building.

### The gap, precisely

| The public hostel page shows | Team form collects it? |
|---|---|
| Cover + gallery (exterior / interior / per-room) | ✗ no photos at all |
| Hostel rules | ✗ |
| Food: veg / non-veg / meals per day / notes | ✗ |
| Weekly food routine (timings + per-day items) | ✗ |
| Pricing: admission fee, rent range | ✗ (only per-room rent) |
| Capacity: rooms / beds / vacant | partial (per-room only) |
| Room configurations | ✓ |
| Facilities | ✓ |
| Location, contact, description | ✓ |

`photos[]` is the sharpest one: the registration zod schema declares
`{alt, fileAssetId, url}` and the model stores `{kind, roomType}` as well, so
even a form that uploaded a categorised photo would have the category silently
stripped on the way in.

---

## Phase 1 — Contract first

The UI cannot collect what the API discards, so this precedes every screen.

- [x] 1.1 `photos[]` in `hostel-registration.validation.ts` gains
      `kind: EXTERIOR | INTERIOR | ROOM` and `roomType`, and the room-type value
      is checked against the submitted `roomConfigurations` rather than accepted
      free-form
- [x] 1.2 Registration contract gains the weekly `foodRoutine` (per-meal timings,
      per-day items, month-end special) — optional, and only the team form sends
      it for now
- [x] 1.3 `registerTeamHostelApplication` writes the `FoodRoutine` document when
      one is submitted
- [x] 1.4 Contract test: a photo with a kind survives the round trip, and a room
      photo naming a room type that was not submitted is rejected
      — `hostel-registration.validation.test.ts`, 11 cases, green

## Phase 2 — The form, rebuilt as a flow

Depends on Phase 1 for the fields to exist.

- [x] 2.1 `/team/register` moves onto `StepRail` + `StepFlow` — the same shell
      and the same motion as the public form, so there is one registration
      vocabulary and not two
- [x] 2.2 Steps, named not numbered: **Owner & hostel · Where it is · Rooms &
      pricing · Photos · House rules & food · Documents · Plan & payment ·
      Review**
- [x] 2.3 Per-step completeness feeds the rail's ticks, and the review step
      lists what is still missing with a jump to the step that owns it
- [x] 2.4 Draft is kept in local storage per agent, as the public form does —
      an agent on a patchy connection must not lose forty fields. Plus an
      explicit **Save draft** button and a **Start over**: the autosave already
      writes on every keystroke, but it is invisible, and somebody twenty minutes
      into a form has no way of knowing their work is safe. The button does
      nothing the typing has not already done — being told "Saved" is the point

## Phase 3 — The modules the form was missing

- [x] 3.1 Photos: upload by kind, exterior first, with the cover picked from
      the exteriors; room photos attach to a submitted room type. A thumbnail
      opens the app-wide media viewer on the whole set, so the agent can check
      at full size that the right photo went into the right section
- [x] 3.2 House rules: the public form's rules templates, reusable here
- [x] 3.3 Food: veg / non-veg / meals per day / notes
- [x] 3.4 Weekly routine: per-meal timings and per-day items, compact enough for
      an agent to fill from what the owner says out loud — and **pre-filled with
      a typical Nepali hostel week** so the job is correcting rather than typing
      twenty-eight cells. The review step calls out a routine still identical to
      the sample, because a default nobody looked at is a menu the hostel never
      agreed to. The draft **merges onto** the defaults rather than replacing
      them — a draft saved before the sample existed carries `{}`, and `{}` is
      defined, so a plain restore handed the form an empty grid; merging also
      keeps a cell the agent deliberately emptied empty, since that is stored as
      an empty string rather than as nothing. Drafts carry a `version`: a draft
      written before the sample existed cannot be read at face value — its empty
      cells are indistinguishable from cells somebody cleared on purpose — so its
      routine is dropped and everything else it holds is kept.
      "Use this day for every day" now refuses a blank day, which is how a draft
      full of empty strings got written in the first place.
      The timings themselves come from `MEAL_TIMING_DEFAULTS` in
      `packages/shared/src/food/meal-window.ts`, shared with the hostel's own
      Food & Menu screen: a hostel an agent registered must not open with
      different serving times from one the owner set up, and the announce lead's
      "these four windows never overlap" claim is only checkable against one set
      of strings. `meal-window.test.ts` now pins the constant and proves the
      windows stay disjoint at a 30-minute lead
- [x] 3.5 Pricing: admission fee and the rent range, derived from the room rows
      where the agent does not override it
- [x] 3.6 Documents: real typed uploads with per-row progress, retry and remove

## Phase 4 — Plan and money

- [x] 4.1 Plan step reads the live catalogue and shows what the plan actually
      is — name, cycle price, saving, description — not a name and a number
- [x] 4.2 **Online now shows a QR.** Choosing online renders the payment QR on
      the spot for the owner to scan; the agent then types the amount that
      actually arrived and proceeds. (See the note below — this trades a
      verified settlement for a staff assertion, by request.)
- [x] 4.3 Cash unchanged: amount, optional slip reference
- [x] 4.4 Part payment stays legal on both methods, and the shortfall is stated
      as a due before the agent commits

## Phase 5 — Publishing is a decision

- [x] 5.1 A confirm step before publish, stating in plain words what is about to
      happen: this hostel goes live now, on this plan, this much was collected,
      this much becomes a due
- [x] 5.2 Publish only on explicit confirmation

## Phase 6 — Emails

- [x] 6.1 The owner is emailed that their hostel is live, with the listing link
      (exists — verify it fires and reads correctly with the new fields)
- [x] 6.2 The owner is emailed how to sign in. The team path used to pass
      `sendEmailNotification: false` and hand the temporary password to the
      agent to read out — which works on the day and is useless a week later,
      when the owner has lost the receipt they wrote it on. Now both: read out
      to get them in today, emailed to get them in on the second visit
- [x] 6.3 Receipt email on a collected payment

## Phase 7 — Chasing the money

- [x] 7.1 Desk table carries the owner's phone and a call affordance — the point
      of the row is that somebody rings them
- [x] 7.2 Row shows plan, price, paid and outstanding together, so the call has
      the figures in front of it
- [x] 7.3 Past-due rows sort first, oldest deadline leading. The query is
      newest-first, which buries the row that most needs a call a little deeper
      every time anybody files a new registration

## Phase 8 — The setup data the form still left to the warden

A hostel filed by an agent went live able to take residents and unable to bill
them. `roomConfigurations[].monthlyRent` is the *listed* rent, not a rate card:
with no `FeeSchedule` behind it every rent line resolves `basis: "MANUAL"` with
no `feeScheduleId`, and a room type filed without a rent fails outright with
`BED_TYPE_NOT_PRICED`. The deposit — half of what a resident hands over on day
one, since `raiseAdmissionInvoice` puts it on the joining invoice with the
admission fee — had nowhere to be typed at all.

- [x] 8.1 Contract gains `securityDeposit` and `referralAdmissionDiscount`,
      whole rupees, with the discount refused when it exceeds
      `pricing.admissionFee`. The rate card already refuses that, but it refuses
      it when the card is written — which on this path is *after* the hostel is
      published and the plan invoice raised, so the refusal has to happen while
      the agent is still looking at the form
- [x] 8.2 `registerTeamHostelApplication` opens the hostel's first rate card
      from what the form collected — rents per room type, admission fee,
      deposit, referral discount, effective from today. Non-fatal and logged
      like the payout account beside it: the hostel is live and invoiced by the
      time it runs, so a refused card is something to fix from the Rate Card
      screen, not a reason to report a finished registration as failed.
      `createFeeSchedule` projects the card back onto the listing, so the rate
      card becomes the single price the moment it is written
- [x] 8.3 Step 3's "Pricing" card is now the **Rate card**: admission fee,
      security deposit and referral discount, with what a resident pays on
      joining totalled beside the rent range. Every room type now *must* carry a
      rent — blocking, per row, because an unpriced room type is a resident
      nobody can bill and the agent is standing next to the person who knows the
      number
- [x] 8.4 Cook count, which the public form has always collected and this one
      never did. It sets the plan's cook seats
- [x] 8.5 The payout account survives a draft restore, and the review step calls
      out a missing one — bookings stay switched off until a payout account is
      verified, so a hostel filed without one publishes unable to take a booking.
      A missing deposit is called out the same way rather than blocked: a hostel
      is allowed to take none, but "none" and "nobody typed it" look identical
      afterwards

**Verified** — `hostel-registration.validation.test.ts` is now 14 cases: the
deposit and discount survive the round trip, a discount larger than the
admission fee is refused on `referralAdmissionDiscount`, and a discount with no
admission fee at all is refused. `src/modules/hostels` + the fee-schedule suites
run 155 green across 11 files; `tsc --noEmit` and eslint are clean on the three
changed files.

### Still left to the warden after this

Named rather than built, because each is its own piece of work:

- **How residents pay this hostel** — `HostelPaymentProfile` holds the eSewa /
  Khalti / Fonepay configuration and its signing keys live in
  `EncryptedSecret`. Merchant credentials are not something a field agent should
  be typing, so this stays on Payment Setup.
- **Per-hostel operational settings** — `HostelSettings` (geofence radii,
  attendance ping times, the night prompt's hour, community feed, per-trade
  maintenance call-out charges). Every field has a defensible default and none
  of them stops a hostel operating on day one.
- **The cook's own account** — `cookCount` sizes the roster; issuing credentials
  is the Cook Portal's flow.

---

---

## The one thing being traded away, stated plainly

Phase 4.2 was asked for directly, so it is being built. It is worth writing down
what it changes.

Today an online payment opens a checkout and settles later on a signed webhook —
the platform learns the money arrived from the payment rail, not from a person.
Showing a QR and letting the agent type in what they saw replaces that with a
staff assertion, which is the claim a payment rail exists to remove. An agent who
mistypes, or who is shown a screenshot of somebody else's transfer, produces a
settled invoice with no money behind it.

It is still the right call for now because the QR is a mock and there is no live
Fonepay merchant account yet, so there is no webhook to wait for and a checkout
link that goes nowhere is worse than an honest manual entry. Two things keep it
recoverable:

- the payment row is written `isMocked: true`, so it can never be mistaken for
  reconciled money later;
- the amount is attributed to the agent exactly as cash is, so the same
  reconciliation conversation covers both.

When a real merchant account lands, 4.2 becomes a webhook again and the manual
entry becomes the exception rather than the path.

---

## Verified

**Unit** — `hostel-registration.validation.test.ts`, 11 cases: photo kinds
survive, an untagged photo defaults to INTERIOR, a room photo naming an
unsubmitted room type is refused, the routine parses, and the team schema still
demands a plan. The modules touched here run 220 green across 20 files.

**End to end, against a running server** — `check:team-registration`, now 33
assertions (was 24). The nine added ones read the stored hostel back and assert
the things that were previously accepted and dropped:

```
PASS  all three photos stored — 3
PASS  photo kinds survived the round trip — EXTERIOR,INTERIOR,ROOM
PASS  the room photo kept its room type — Double Sharing
PASS  rules stored — 2
PASS  food stored — 3
PASS  admission fee stored — 2000
PASS  weekly routine written — yes
PASS  routine kept both meals — 2
PASS  routine kept the timings — 7:30 pm
```

Run it with `CHECK_BASE_URL=http://localhost:3000` — the script defaults to 3001.

**The QR is set.** The real Fonepay QR is uploaded and live: the account name
reads `SOFTMATO TECHNOLOGY PRIVATE LIMITED`, the image is in the public R2
bucket, and the agent's payment step renders it at 224px with a tap-to-fullscreen
for scanning in a badly lit lobby. It was supplied as a PDF — the QR is object
`8 0 obj` inside it, a 350×350 DeviceRGB image, extracted to PNG rather than
embedded as a PDF because a PDF in a 224px box is not something a phone camera
can read.

**In the browser** — the rail renders eight steps and ticks them as they fill;
a photo thumbnail opens the app-wide viewer on the whole gallery; the plan step
shows the live catalogue with cycle savings; choosing Online renders the
configured QR with the account name to read out; and the desk lists plan, price,
collected, outstanding, a `tel:` link and the due date, owed-first.

### Emails, and how far they are verified

`onRegisteredByTeam` (published) and `onPaymentSettled` (receipt) both fire from
the shared services the team path already goes through, and the end-to-end run
proves the receipt is *issued* — `SRC-0001-4C7E`. Delivery itself has no
queryable outbox: `deliver` calls `sendEmail` and logs a warning on failure, so
whether a message left the building is only visible in the server log. Anything
stronger needs a mail catcher, which is worth having and is not this change.
