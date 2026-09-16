# Bookings — HostelPalika

The tracker for room booking, web and app. Work one item at a time: code it, verify it
(`web:typecheck`, `web:lint`, `web:test`; mobile `tsc` + tests), then flip `☐` to `☑`.
`◐` = partial, with a note.

## The rules (decided with the owner, 2026-09-15)

**Who pays whom.** The person booking pays **HostelPalika**, not the hostel. For now that is our
collection QR plus a payment screenshot, checked by a superadmin within 24 hours. We hold the money
and later send either a refund to the person or the hostel's share to the hostel — by hand for now,
marked done with the transaction ID. Automatic collection, refunds and payouts come later and slot
under the same records.

**The fee.** 7% of the room type's monthly rent, from the rate card in force on the day of booking,
in whole rupees. It is its own charge: it never comes off the admission fee, deposit or rent.

**The hold.** The hostel has **24 hours** from our payment check to confirm or decline. Once it
confirms, one bed of that room type is held for **7 days** (counted in 24-hour blocks from the
confirmation). The person moves in inside that window.

**Moved in = the card scan.** The hostel admits them through the normal *Register a new resident*
flow by scanning (or typing) their HostelPalika ID card. If that card belongs to the account holding
a confirmed booking at this hostel, the booking closes as **Checked in**, the held bed becomes the
resident's bed, and cancelling is no longer possible. The booking is personal: no other card closes it.

**What happens to the money.** Whatever is not refunded is split **hostel 60% / HostelPalika 40%**.

| What happens | Refund to the person | Kept (split 60/40) |
|---|---|---|
| Person cancels before the hostel confirms | 100% | 0 |
| Hostel declines, doesn't answer in 24 h, or cancels after confirming | 100% | 0 |
| Superadmin cancels (dispute, fraud, mistake) | 100% | 0 |
| Person cancels on day 1–2 of the hold | 75% | 25% |
| Person cancels on day 3–5 | 50% | 50% |
| Person cancels on day 6–7 | 25% | 75% |
| Hold ends and they never came (no-show) | 0% | 100% |
| Checked in | 0% | 100% |

A no-show must always get back less than the last cancel step, or nobody cancels and beds sit empty.

**Strikes.** A missed 24-hour answer or a hostel cancellation is a strike. 3 strikes in 30 days
pauses the Book button on that hostel until a superadmin turns it back on.

**Every number above is a superadmin setting** (Platform → Bookings → Settings). Saving a change
emails a confirm link to the superadmin who made it; nothing changes until that link is opened while
signed in. A booking keeps the terms it was created under, and its documents print them.

**Before booking** the person must be signed in, accept the refund policy (`/refund-policy`, with
the live numbers filled in), and give a refund account (eSewa / Khalti number or bank account). One
open booking per person at a time.

**The Book button shows only when** bookings are switched on platform-wide, the hostel is live and
not suspended, it has a **verified payout account**, bookings on it are not paused, and the room type
has a current rent and a vacant bed.

**Email** goes from `billing@softmato.com` (the parent company, category `billing`).

## Status of a booking

```
AWAITING_PAYMENT ──proof──▶ PAYMENT_IN_REVIEW ──approve──▶ AWAITING_HOSTEL ──confirm──▶ CONFIRMED ──scan──▶ CHECKED_IN
      │                           │ reject (back to AWAITING_PAYMENT)   │                     │
      └─ no proof in time ▶ EXPIRED                                     ├─ decline ▶ DECLINED  ├─ person cancels ▶ CANCELLED_BY_USER
                                                                        ├─ 24 h pass ▶ HOSTEL_NO_RESPONSE ├─ hostel cancels ▶ CANCELLED_BY_HOSTEL
                                                                        └─ person cancels ▶ CANCELLED_BY_USER └─ 7 days pass ▶ NO_SHOW
                                             any paid state ─ superadmin ▶ CANCELLED_BY_PLATFORM
```

## Work items

### A. Server

1. ☑ **Booking settings + the money math** — `modules/bookings/booking-config.ts`: `bookings`
   platform setting (switch, fee %, hostel share %, hold days, hostel answer hours, payment check
   hours, unpaid window, cancel steps, no-show %, strike limit/window, reminder hours) with the
   defaults above and the rules as schema checks (steps cover the hold, refunds never rise, a no-show
   gets less than the last day); `getBookingConfig` never throws and falls back to *off*.
   `booking-terms.ts`: fee from rent, refund for any moment, 60/40 split that always sums, the ladder
   in days and in real times. `booking-terms.test.ts` 41/41.
2. ☑ **Setting changes wait for an email confirm** — `PlatformSettingChange` model (whole proposed
   value, old value, SHA-256 of the token, 30-minute expiry, status);
   `platform-config/setting-change.{registry,service}.ts` (request → email → confirm once, same
   account, not expired, refused if the setting moved since the email; cancel; newest request
   supersedes). Email `platform/setting-change-confirm.ts` (+ `comparisonTable`, `emailDateTime` in
   the shared layout). Routes `platform/bookings/settings` (GET/POST),
   `platform/setting-changes/confirm` (GET preview / POST apply), `platform/setting-changes/[id]`
   (DELETE). Confirm page `/platform/settings/confirm`. The collection QR in Operations now saves
   only through the same link, with a "waiting for confirm" notice and Cancel.
   `setting-change.service.test.ts` 18/18.
3. ☑ **Hostel payout account** — `HostelPayoutAccount` model (bank / eSewa / Khalti, holder, bank
   + branch, number sealed with the finance master key and bound to the hostel, last 4, keyed
   lookup hash, `PENDING_REVIEW` / `VERIFIED` / `REJECTED`). `bookings/payout-account.validation.ts`
   (numbers normalised; bank 6–24 letters/digits; wallets a 10-digit mobile) and
   `payout-account.service.ts`: set (same account re-saved keeps its verification; a change goes
   back to review, emails the admins, bells the superadmins), masked read, `isPayoutAccountVerified`,
   review queue flagging a number used by two hostels, reveal (superadmin only, audited), verify /
   send back with a reason. `secret-store.ts` gained `sealValue` / `openValue`; the key rotation
   script now rewraps payout numbers too. Emails `booking/payout-account.ts`. Routes
   `hostel-admin/payout-account` (GET/PUT, owner only), `platform/bookings/payout-accounts`
   (GET), `…/[hostelId]/review` and `…/[hostelId]/reveal` (POST, superadmin).
   `payout-account.test.ts` 15/15.
4. ☑ **Booking records** — `Booking` (code, hostel + guest snapshots, rent, fee, frozen terms,
   policy acceptance, sealed refund account, invoice/receipt numbers, status with an `isOpen`
   mirror and a unique partial index for one open booking per person, every deadline and reminder
   claim, bed held, check-in, ending, strike, settlement), `BookingPayment` (screenshot claims,
   one row per attempt), `BookingTransfer` (REFUND / PAYOUT, due → sent, unique per booking and
   kind, masked destination snapshot). `Hostel.bookingPause`; `ConsentLog` type
   `BOOKING_REFUND_POLICY`. Document series `HH-BKI` / `HH-BKR` / `HH-BRF` / `HH-BPO` in
   `PlatformDocumentSequence` and `billing/documents/issue.ts` (`allocate` exported). Purge: payout
   accounts are erased with a hostel; bookings, payments and transfers are kept as the platform's
   money records (registry test passes). Key rotation script rewraps refund account numbers.
5. ☑ **Create, pay, check** — `booking-availability.ts` (one answer for button, quote and create:
   switch, live + verified, suspension incl. pre-suspension, pause, verified payout account, rent on
   the rate card, vacant bed); `booking.service.ts`: public quote (hostel, room, 7% fee, policy in
   rupees, policy version, QR ready), create (personal accounts only, policy version must match
   what was shown, email required, one open booking — also a unique index, not a resident here,
   refund account sealed to the booking, `HH-BKI` number, consent log, invoice email + bell),
   send screenshot (own `BOOKING_PAYMENT_PROOF` only, expired window closes the booking), my
   bookings + detail with pay instructions. `booking-review.service.ts`: oldest-first queue;
   approve (superadmin only, once; `HH-BKR` receipt; hostel gets 24 h, email + high-priority bell
   with its share; a hostel gone by then refunds at once) / reject (reason required, fresh window,
   can resend). `booking-lifecycle.ts`: guarded moves, `endBooking` (settlement from frozen terms,
   one DUE refund / payout each, bed release, strike rule + auto-pause). New file kind
   `BOOKING_PAYMENT_PROOF`, never hostel-scoped at presign. `legal.refund` in site config. Emails
   `booking/{parts,guest,hostel,platform}.ts`. Test helper `apps/web/test/fake-mongo.ts`;
   `booking-flow.test.ts` 27/27.
6. ☑ **Answer, cancel, strikes** — `booking-answer.service.ts`: hostel confirm (admin of that
   hostel only; claims the bed first, gives it back if the move loses a race; full room type refused
   with "decline instead") / decline (optional reason, no strike); hostel cancel of a confirmed
   booking (reason required, strike, bed released); person cancel (unpaid owes nothing, waiting on
   hostel 100%, confirmed from the frozen steps; refused while the screenshot is checked; optional
   `expectedRefund` → 409 `REFUND_CHANGED` with the new figure); superadmin cancel of any paid open
   booking (reason, 100%); `setHostelBookingPause` (superadmin; resume stamps
   `bookingPause.resumedAt`, and the strike rule never counts back past it). Every entry reads the
   clock first: a late answer ends as `HOSTEL_NO_RESPONSE` + strike, a cancel after the hold ends as
   `NO_SHOW`. `endForMissedAnswer` / `endAsNoShow` / `endUnpaid` are exported for the sweep.
   `announceEnding` tells the person (refund + masked account), the hostel when someone else ended
   it (bed free, share), and bells superadmins when money is owed; the automatic pause emails the
   hostel and the superadmins once. Emails `bookingConfirmedEmail` (directions from the owner's map
   link → pin → address, cancel times), `bookingEndedEmail`, `bookingClosedForHostelEmail`,
   `bookingsPausedEmail`, `hostelBookingsPausedEmail`. `booking-flow.test.ts` 38/38.
7. ☑ **The sweep** — `booking-sweep.service.ts` `sweepBookings`: ends unpaid (`endUnpaid`), missed
   answers (`endForMissedAnswer`, strike) and ended holds (`endAsNoShow`, bed released) in deadline
   order, one at a time (bed counts are read-modify-write), then reminders. `dueReminder` sends the
   smallest threshold crossed unless one at or below it went already — a sweep that wakes late
   sends the nearest reminder only and never goes back for an earlier one; the `$push` is claimed on
   the status and `…RemindersSent.hoursLeft` so two sweeps send one email. Runs with bookings
   switched off (the switch stops new bookings, not paid ones). Rides the every-minute
   `cron/platform-push` tick, caught on its own so a booking failure never reports the pushes as
   unsent — no new cron-job.org job. Emails `bookingAnswerReminderEmail`,
   `bookingMoveInReminderEmail`. `test/fake-mongo.ts` now reads `items.field` across arrays of
   subdocuments, as Mongo does. `booking-flow.test.ts` 41/41.
8. ☑ **Check-in by card** — `booking-checkin.service.ts`: `findHeldBooking` (the scanned card's own
   account, this hostel, `CONFIRMED`; a lapsed hold is ended as a no-show on the spot and the intake
   claims a bed the ordinary way), `takeHeldBed` (same room type: the held bed becomes the
   resident's; another type: moved across, so a full target refuses before anything is written),
   `returnHeldBed` (resident row failed: the booking keeps its bed), `checkInBooking` (`CHECKED_IN`,
   bed not released, resident id + who admitted them, hostel's share `DUE`, superadmins belled; if a
   cancel or the sweep ended the booking in the same instant, the one bed that ending released is
   claimed back). `createResident` uses all four — only when a card was scanned — and the check-in
   is non-fatal to the intake. `resident.service.test.ts` +2 (wiring), `booking-flow.test.ts` 45/45.
9. ☑ **Sending money out** — `booking-transfer.service.ts`: `listTransfersDue` (oldest first,
   masked destination on file, payouts flagged `NO_PAYOUT_ACCOUNT` / `PAYOUT_ACCOUNT_NOT_VERIFIED`);
   `markTransferSent` (superadmin; transaction ID required, optional `BOOKING_TRANSFER_PROOF`
   screenshot that must be the superadmin's own; payout refused unless the account is verified;
   claimed `DUE → SENT` once, masked destination snapshotted, then numbered `HH-BRF` / `HH-BPO` so a
   lost race never burns a number; audited; refund emails + bells the person, payout emails + bells
   the hostel's admins); `revealTransferDestination` (superadmin, audited — refund opened from the
   booking's sealed account, payout through `revealHostelPayoutAccount`). New platform-only file kind
   `BOOKING_TRANSFER_PROOF`. Emails `bookingRefundSentEmail`, `bookingPayoutSentEmail`.
   `booking-flow.test.ts` 48/48.
10. ☑ **Documents** — `booking-document.ts`: one pdf-lib layout (the receipt's: one centred amount)
    from the plan documents' parts; `bookingDocumentLayout` builds invoice (fee, rate, status, the
    booking's own refund steps in rupees), receipt, refund note (against receipt, rate, reason,
    masked destination, transaction ID) and payout advice (fee, refunded, kept, share %, masked
    destination) from the rows, ASCII punctuation only. `booking-documents.service.ts`:
    `resolveBookingDocument(kind, number, scope)` — guest reads invoice/receipt/refund of their own
    booking, a hostel reads its payout advice only, the platform all; anyone else gets the same 404 as
    a missing number. Routes `bookings/documents/[kind]/[number]` (signed in, own),
    `hostel-admin/bookings/documents/[number]` (payout), `platform/bookings/documents/[kind]/[number]`
    (superadmin). Guest refund and hostel payout views now carry `documentNumber`;
    `describeDestination` / `destinationText` moved to `booking-views.ts`. `booking-flow.test.ts`
    50/50.
11. ☑ **Emails, push, bell** — every step in the chart already sends (items 5–9: invoice, proof,
    receipt/rejection, request + reminders, confirmed, every ending with its refund, move-in
    reminder, pause, refund/payout sent, check-in payout due). Added here: every booking bell carries
    `data.audience` (`GUEST` / `HOSTEL` / `PLATFORM`); `push-routing.ts` routes `BOOKING` ahead of
    `actionUrl` to `/booking/<id>` (guest) or `/manage/bookings` (hostel), platform copies to the
    list; `web-routing.ts` keeps the `actionUrl` and falls back to `/bookings`,
    `/hostel-admin/bookings`, `/platform/bookings`; realtime topic `bookings` (category `BOOKING`)
    refreshes `/api/v1/bookings*`, `hostel-admin/bookings*`, `platform/bookings*`; `BOOKING` icon on
    the web bell and the app list; a superadmin's manual pause / resume bells the hostel's admins.
    `booking-routing.test.ts` 3/3. The app's push allow-list gets `/booking/<id>` and
    `/manage/bookings` with the screens themselves (items 23, 25) — until then they land on the list.
12. ☑ **API routes** — `booking-queries.service.ts` (hostel list by tab — paid bookings only — with
    request/confirmed counts, owed due/sent and pause; platform list by tab `waiting` / `holds` /
    `all` (+ status, hostel) with every queue's count; platform detail; paused hostels). Routes:
    public `GET bookings/quote` (signed out allowed), `GET|POST bookings` (mine / create,
    rate-limited, `MOBILE` when a Bearer token is sent), `GET bookings/[id]`,
    `POST bookings/[id]/payment`, `POST bookings/[id]/cancel`; hostel admin `GET hostel-admin/bookings`,
    `POST hostel-admin/bookings/[id]/{confirm|decline|cancel}`; superadmin `GET platform/bookings`
    (`?tab=paused` adds the hostels), `GET|DELETE platform/bookings/[id]`,
    `GET platform/bookings/payments`, `POST platform/bookings/payments/[id]`,
    `GET platform/bookings/transfers`, `POST platform/bookings/transfers/[id]/{sent|reveal}`,
    `POST platform/bookings/hostels/[hostelId]/pause`; settings, payout accounts (item 2–3) and
    documents (item 10) already existed. `booking-flow.test.ts` 52/52.

### B. Web

13. ☑ **Refund policy page** — `booking-policy.ts` (pure: the shipped policy as sections built from
    the live settings — fee, full-refund cases, hold + every cancel step + no-show, how refunds are
    sent; `fillPolicyText` fills `{feePercent}`-style tokens in an owner's own Legal text and leaves
    unknown ones visible), `booking-policy.service.ts` `getRefundPolicy` (sections or filled custom
    body, updatedAt, the checkout's policy version). `/refund-policy` (server page, revalidates every
    60 s, same layout as Terms), `GET /api/v1/bookings/policy` for the app and checkout, SEO key
    `refundPolicy`, sitemap, footer "Refunds" and the header's More menu. Checkout links it in item 15.
    `booking-policy.test.ts` 3/3.
14. ☑ **Book buttons on the hostel page** — `GET /api/v1/bookings/availability?hostel=` (every room
    type's state in one call); `booking-button.ts` `bookingButton` (pure: Book with the fee, *Full*,
    *Not taking bookings* for a paused / suspended / no-payout hostel, nothing while bookings are off
    or for an unpriced room); `components/bookings/book-button.tsx`. On `public-hostel-detail-page`:
    each room card under See Details, the room sheet above Call, and "Book a room" above the main
    call to action. Links to `/book/<slug>?room=<roomType>` (item 15). `booking-button.test.ts` 3/3.
15. ☑ **Checkout** — `/book/[slug]?room=&booking=` (noindex) → `booking-checkout-page.tsx`. Left
    (sticky): cover photo, hostel, address, room facts, answer and hold times, the fee and what it is
    not. Right, one step at a time: room chooser when no room is named; open-booking and unavailable
    notices; sign in / create account (returns here); your details + planned move-in, refund account
    (eSewa / Khalti / bank), the refund steps in rupees, policy tick linking `/refund-policy`, "Book
    and pay"; a changed policy reloads the quote and clears the tick. Once booked the id goes into the
    URL; pay step: last rejection, QR, amount, pay-by, copyable code for the remarks, screenshot via
    the universal uploader (`BOOKING_PAYMENT_PROOF`), optional transaction ID; then the live status
    (refreshed every 30 s while we or the hostel decide) linking the booking page (item 16).
16. ☑ **My bookings** — `/bookings` (list: hostel, room, code, date, status) and `/bookings/[id]`
    (`my-bookings-page.tsx`): status + what happens next and by when, last screenshot rejection, Pay
    (back to the checkout's pay step), Show / Create my ID card once confirmed, Cancel with the exact
    refund on the button and in the confirm dialog (`expectedRefund`; a moved figure or an ended hold
    reloads the booking), the cancel schedule in real times, details, timeline, and the invoice /
    receipt / refund note through the global downloader. Refreshes every minute while open. Linked
    from the header's account menu and the resident portal's nav. Shared pieces moved to
    `booking-ui.tsx`.
17. ☑ **Superadmin → Bookings** — `/platform/bookings` (`platform-bookings-page.tsx`, Finance nav)
    with `?tab=` so bells land on their queue: payments to check (screenshot, amount, reference,
    promised-by countdown, approve with a confirm / reject with a reason); waiting on hostels and
    holds (countdown, guest + hostel phone, cancel in full with a reason, pause the hostel); refunds
    and payouts to send (masked destination, reveal the number — logged, mark sent with transaction
    ID + optional `BOOKING_TRANSFER_PROOF` + note; blocked payouts say why); payout accounts to verify
    (reveal, verify, send back with a reason, same-number warning); paused hostels (strikes vs
    manual, resume); all bookings with a status filter and the split; settings (switch, every number,
    cancel steps editor, reminder hours) saving only through the emailed confirm, with the pending
    change and Cancel. Tab counts from the queues.
18. ☑ **Hostel admin → Bookings** — workspace screen `bookings` (`hostel-admin-bookings-page.tsx`,
    Finance → Fees & Payments nav; `/hostel-admin/bookings` redirects there for bells and email):
    waiting / owed / paid metrics, pause notice, tabs Requests (guest + phone, countdown, share,
    confirm with a dialog, decline with an optional reason), Confirmed (hold countdown, "Admit by ID
    card" to Residents, cancel with a required reason that warns of the strike), History (ending,
    reason, strike, payout status and the payout advice download). The live "badge" is
    `HostelBookingRequestsReminder` above every workspace screen (the nav is server-built and static);
    it refreshes with the `bookings` realtime topic and draws nothing for wardens. Payment Setup gains
    `HostelPayoutAccountPanel` (status, masked account, review note, change → back to review).
    Shared list/reason/countdown/action pieces moved to `booking-admin-ui.tsx`; `/platform/bookings`
    is superadmin-only in `route-access.ts` and hidden from moderators in the nav.
19. ☑ **Registration** — `components/bookings/payout-account-fields.tsx` (bank / eSewa / Khalti,
    optional, kept out of the saved form draft) on the public form's Review & Submit step and the
    team form's Plan & payment step; `payoutAccount` optional on the shared registration schema;
    `savePayoutAccountFromRegistration` in `hostel.service.ts` saves it after either registration
    (source `REGISTRATION`, never fails the application). The verification screen shows it under
    "Booking Payouts" (`review-payout-account.tsx`, masked, status, same-number warning); the
    payout-accounts list takes `?hostelId=`.
20. ☑ **Intake banner** — `findCardBooking` in `booking-checkin.service.ts` (normalised card → account
    → `findHeldBooking`, the same lookup `createResident` makes) behind
    `GET /api/v1/hostel-admin/bookings/card?card=` (`registerResidents` capability). The web
    add-resident flow asks beside the resident-ID lookup and, when the card holds a confirmed booking
    here, says so above the imported profile: code, room type, guest, hold end, and that registering
    uses the held bed. A failed check draws nothing and never blocks the registration.
    `booking-flow.test.ts` +1.

### C. App

21. ☑ **Book buttons** — `lib/booking-api.ts` (typed from the web services), `lib/booking-button.ts`
    `bookState` (same rules as the website); each room card on `hostel/[slug]` shows Book with the
    fee, *Full*, *Not taking bookings*, or nothing. Built from the app's own kit (`ui_inspiration_folder`
    is not on this machine — owner's call, 2026-09-15).
22. ☑ **Checkout screen** — `book/[slug]?room=&booking=`: package card (photo, hostel, room, rent,
    answer and hold times, fee and what it is not); room chooser; open-booking / unavailable / sign-in
    states; refund account (eSewa / Khalti / bank chips), refund steps in rupees, policy tick + link to
    the policy screen; pay step (last rejection, QR, amount, pay-by, selectable code, screenshot
    through the universal uploader as `BOOKING_PAYMENT_PROOF`, transaction ID); status card. A changed
    policy reloads the quote and clears the tick; the booking id goes into the route.
23. ☑ **My bookings** — Profile tab row (signed in) → `bookings` (Open / Ended groups) →
    `booking/[id]`: status, what happens next, rejection, Pay, ID card, cancel through `openConfirm`
    with the exact refund (`expectedRefund`), cancel schedule in real times, details, invoice /
    receipt / refund note through `downloadToDevice`. Push `/booking/<id>` and `/bookings` are on the
    allow-list. `booking-button.test.ts` 3/3.
24. ☑ **Refund policy screen** — `legal/refund-policy` from `GET /api/v1/bookings/policy` (live numbers,
    or the owner's own filled-in text).
25. ☑ **Hostel admin → Bookings** — `lib/admin-bookings-api.ts`; More → Bookings row →
    `manage/bookings`: pause notice, owed / paid, Requests / Confirmed / History (Segmented with
    counts); confirm through `openConfirm`, decline (optional reason) and cancel (required reason,
    strike warning) in a bottom sheet; "Admit by ID card" to the intake; payout advice download.
    `/manage/bookings` is on the push allow-list.
26. ☑ **Payout account** — `components/manage/payout-account-card.tsx`: `PayoutAccountCard` on
    `manage/finance/payment-setup` (status, masked account, review note, change → back to review;
    draws nothing for a warden) and `RegistrationPayoutFields` on `register-hostel/apply`'s Review step
    (optional, kept out of the saved draft, sent as `payoutAccount`).
27. ☑ **Intake banner** — `manage/resident/new` asks `findCardBooking` beside the card lookup and, when
    the card holds a confirmed booking here, says so above "Who they are". Every booking time on the
    app goes through `useDates()` (the calendar single-source test).

### D. Outside the code (owner's steps)

28. ☐ Deploy web; mobile build or OTA (the owner runs EAS). Before the deploy, check Vercel
    production has `FINANCE_MASTER_KEY` (payout and refund account numbers are sealed with it) and
    `PERSONAL_DATA_ENCRYPTION_KEY`; without the first, saving a payout account fails.
29. ☐ Superadmin sets the collection QR and booking settings (email confirm), then switches
    bookings on.
30. ☐ Live hostels add payout accounts; superadmin verifies them.
31. ☐ Accountant: tax on our share, and whether Nepal Rastra Bank rules on holding customer money
    apply.

### E. After the first switch-on (owner, 2026-09-16)

Turning bookings on showed the Book button still refusing every room with
`NO_PAYOUT_ACCOUNT`, and the one field that fixes that sat on Payment Setup —
a screen about how residents pay the *hostel*, not about how we pay it. These
two items move it to where a hostel goes to read about bookings, and give both
sides one page that explains the whole thing instead of paragraphs wedged into
the screens.

32. ☑ **The payout account lives under Bookings** — hostel admin → Bookings gains a
    **Settings** tab holding the payout account (status, masked account, review note,
    change → back to our check), the way the superadmin's own Bookings screen carries
    its Settings tab. Moved, not copied: it comes off `hostel-admin-payment-profile-page`
    (web) and `manage/finance/payment-setup` (app), so there is one editor for it.
33. ☑ **How booking works** — a page of its own, like `/refund-policy`, built from the
    live settings: what a booking costs, the order it moves in and every deadline, for
    the person booking and for the hostel. `GET /api/v1/bookings/guide` for the app and
    a screen behind it. Linked from the checkout, My bookings, the hostel's Bookings
    screen, the footer and the header's More menu. The screens keep their one-line
    notes and point here instead of explaining.
34. ☑ **The papers ride with the mail** — `bookingDocumentAttachment` renders the
    invoice or receipt from the same layout the download route uses and never
    throws; `notifyGuest` carries attachments through to `sendEmail`. The booking
    mail now arrives with the invoice PDF, and the payment-approved mail with the
    receipt and the invoice together — the reader is not signed into anything at
    the moment they open it, and a paper behind a login is a paper most people
    never fetch.
