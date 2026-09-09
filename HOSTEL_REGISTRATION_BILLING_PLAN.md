# Hostel registration, plans & billing — build tracker

Source of truth: the three handwritten note pages (public register flow, team
management, team payment flow) plus the clarifications in that session. This
file is the work order. **Tick an item only after the code is written and
verified — never batch.**

---

## The two flows, stated once

### Public owner registers their own hostel
`/register-hostel` stops being only a form. It is the owner's **progress
tracking page** for the whole lifecycle.

| Application state | Page shows |
|---|---|
| Nothing submitted | the multi-step form |
| `PENDING` | "we're verifying your details" + **Select a plan** (allowed early, on purpose) |
| `NEEDS_MORE_INFO` | the requested-documents uploader, **on this same page** |
| `APPROVED`, no plan | **Select a plan** |
| `APPROVED` + plan chosen | **Pay now** |
| Pay now clicked | invoice issued + emailed |
| Paid | receipt emailed, plan activated, hostel published |

**Pay now is gated on `verified AND planChosen`.** Choosing a plan is
deliberately allowed while still unverified so that the moment verification
lands the owner can pay without a second visit.

### Team member registers a hostel on the owner's behalf
Same data model, same fields. Differences, all of them deliberate:

- the plan is chosen **inside** the form, and the invoice is issued when they
  move past that step;
- **any** amount may be collected — full, half, or less — by Fonepay QR (mocked)
  or cash;
- on submit the hostel is **instantly APPROVED + VERIFIED + PUBLISHED**, because
  our own staff gathered and checked the data;
- a shortfall becomes a **due** that rides as a banner on the hostel's web and
  app portal, payable from there.

One line: **public pays to get published; team publishes and then owes.**

---

## Phase 1 — Domain

- [x] 1.1 `PLATFORM_AGENT` role (the team member) added to the shared Role enum
- [x] 1.2 Team invites ride in `PlatformAdminInvite` (role enum widened) rather
      than a duplicate model — same mechanism, same hashed token; only the grant
      differs. Also wired `/team` into `route-access.ts`.
- [x] 1.3 `HostelSubscription` model — plan, cycle, amounts, due, activation
- [x] 1.4 `SubscriptionInvoice` model — immutable, numbered, plan snapshot
- [x] 1.5 `SubscriptionPayment` model — method, collector, receipt number
- [x] 1.6 `HostelApplication` gains `source: PUBLIC | TEAM` + `submittedByAgentId`

## Phase 2 — One registration contract for both forms

- [x] 2.1 Single zod schema both forms post (`hostel-registration.validation.ts`)
- [x] 2.2 Registration side-effects refactored into one events module, so each
      step's email is defined exactly once and both flows fire the same ones
- [x] 2.3 Public register endpoint moved onto the shared contract
- [x] 2.4 Team register endpoint on the same contract

### Verified by `modules/billing/subscription-rules.test.ts` (13 cases)
Plan-before-verification, the `Pay now` gate, full vs part payment per source,
double-settle, and cross-hostel settle refusal.

## Phase 3 — Public lifecycle

- [x] 3.1 Application progress endpoint (status + plan + invoice + payment)
- [x] 3.2 Select-a-plan endpoint, allowed while `PENDING`
- [x] 3.3 Pay-now → issue invoice + email
- [x] 3.4 Mock payment settle → receipt + activate plan + publish hostel
- [x] 3.5 Resubmit-documents wired into the progress page

## Phase 4 — Team portal

- [x] 4.1 `/team` route group, gated on `PLATFORM_AGENT`
- [x] 4.2 Normal login — accepting an agent invite sets a password (admins stay Google-only)
- [x] 4.3 Team registration form, plain and dense
- [x] 4.4 Plan step + invoice issue
- [x] 4.5 Payment capture: Fonepay QR (mock) and cash
- [x] 4.6 Instant approve + verify + publish on submit
- [x] 4.7 Superadmin **Team** tab: invite (multiple at once), roster, attribution
- [x] 4.8 Attribution: which member registered which hostel, how much, method, when

## Phase 5 — The due

- [x] 5.1 Due banner on hostel-admin web portal
- [x] 5.2 Due banner in the mobile app (`SubscriptionDueCard` on admin Home)
- [x] 5.3 Owner-side pay-the-due flow

### Verified in the browser
Rail renders with 5 steps, `step-in` replays on step change (0.26s, running),
grid collapses to one column below `lg`, and the invented "Platform Fee (10%)"
is gone from the form.

## Phase 6 — UI

- [x] 6.1 Public form rebuilt as a calm multi-step flow on our own tokens
      (black/white/green — reference gives layout and motion, never colour)
- [x] 6.2 Progress tracking page states
- [x] 6.3 Plan picker reading the **real** plans config, not the hardcoded array

---

## Invoice / receipt seam

The parent company will supply an SDK for invoice and receipt documents. Every
issue point goes through **one** module so that swap is a single edit, and until
then it mocks the document and sends the email.

---

## Verified

**Unit** — `apps/web` 2427 tests green, `apps/mobile` 1380 green. The money
rules have their own file, `modules/billing/subscription-rules.test.ts` (13
cases): plan-before-verification, the `Pay now` gate, full vs part payment per
source, double-settle, cross-hostel settle refusal.

**End to end, against a running server** — two scripts, kept:

- `npm --prefix apps/web run check:public-registration` — 30 assertions. Submit,
  choose a plan while unverified, be refused an invoice, be approved, pay, go
  live. Also proves two *Pay now* clicks raise one invoice and that another
  hostel's payment cannot be settled through yours.
- `npm --prefix apps/web run check:team-registration` — 22 assertions. Invite,
  accept with a password, sign in normally, register collecting half, and check
  the hostel published, the due was set, the receipt issued and the cash was
  attributed to the agent.

Both need the dev server up and write real rows, so they refuse to run against
`NODE_ENV=production`. `npm --prefix apps/web run dev:mint-session` issues a
browser session for looking at authenticated screens.

**In the browser** — the rail renders and replays its animation on step change,
the progress page shows "we are checking your details" with the live plan
catalogue beside it, and choosing a plan while unverified answers "<plan> is
saved. Pay now appears here as soon as your details are verified."

## Three bugs the end-to-end pass caught that unit tests could not

1. `hashPassword` is bcrypt and returns a promise — accepting an agent
   invitation wrote a pending `Promise` into `passwordHash`.
2. `wholeRupees`'s validator rejects `null`, so spreading it onto the
   null-defaulted subscription fields made *every* subscription create fail.
   The unit tests mock the model, so only a real write could find it.
3. The public registration form has always posted `landmark`, `mapLink`,
   `yearEstablished`, `alternatePhone` and `totalCapacity`, and zod stripped
   every one of them silently. They now have schema entries and columns.

## Still mocked, by request

Invoice and receipt documents, and the Fonepay gateway. Both sit behind
`modules/billing/billing-gateway.ts` and nothing else knows they are mocked. A
mocked document returns `url: null` rather than a dead link, and a mocked
settlement writes `isMocked: true` on the payment row so it can never be
mistaken for real money later.

## Not done

- Nothing is committed. Everything is in the working tree.
- The three pre-existing `react-hooks/static-components` lint errors in
  `platform-config-plan-service-page.tsx`, `platform-config-plans-page.tsx` and
  `public-service-detail-page.tsx` are untouched — they predate this work.
