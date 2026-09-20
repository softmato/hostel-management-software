# Finance & Payments — Target Design

> **Companion to `FINANCE_CURRENT_STATE.md`.** That document describes what exists.
> This one describes what to build, and why. Every section that replaces existing
> behaviour cites the current-state section it supersedes (e.g. "supersedes §5.4").
>
> **Audience.** The assistant implementing this in the codebase. This document is
> the source of truth for *behaviour, data shape, flows, and screens*. It is
> deliberately opinionated about design decisions and deliberately silent about
> implementation style — follow the repo's existing conventions for Mongoose
> models, service layout, validation, and route structure.
>
> **One-line summary of the target:** a tiered payment system where the hostel is
> always the merchant of record, every payment carries a reference code that
> identifies its invoice, money is recorded as immutable events rather than a
> mutable balance, and the amount of human verification required drops to zero as
> a hostel connects better payment rails.

---

## 0. Reading order

1. §1 Principles — the non-negotiables. Read before designing anything.
2. §2 The tier model — what "done" means at three different levels of hostel setup.
3. §3 Bed types and the fee schedule — how a charge amount is decided.
4. §4 Data model — collections, fields, indexes, what gets deleted.
5. §5 The reference code — the mechanism the whole design rests on.
6. §6 Flows, tier by tier.
7. §7 The matching ladder — how a payment finds its invoice.
8. §8 Fraud controls — what is caught, when, and what is not.
9. §9 Cash, corrections, reversals.
10. §10 Reconciliation and drift detection.
11. §11 UI screens, all tiers, both actors.
12. §12 Notifications.
13. §13 Security fixes that block everything else.
14. §14 Legal and compliance boundaries.
15. §15 Build sequence.
16. §16 Open questions requiring a product decision.

---

## 1. Principles

These are the decisions that everything else follows from. If an implementation
detail conflicts with one of these, the principle wins.

### P1 — The hostel is always the merchant of record

The platform never holds, routes, or settles resident money. Every rupee moves
directly from resident to the hostel's own account — their bank account, their
eSewa, their Fonepay merchant. The platform observes and records; it does not
custody.

This is a legal boundary, not a preference. See §14.

### P2 — Identity of payment is established at send time, not receive time

A payment is matched to an invoice because the payment *carries* the invoice's
reference code, not because the software inspected the payment afterwards and
guessed. Every payable thing gets a reference code. Every payment surface shows
it. Every ingestion path looks for it first.

The rejected alternative was reading Android notifications from banking apps and
fuzzy-matching amounts and timestamps. See §16.4 for why, in case it comes up
again.

### P3 — Money is an append-only event log; balances are derived

`paidAmount` as a mutable field is deleted. A balance is `sum(settled events)`,
computed or projected-with-verification, never typed by a human. Corrections are
new reversing events. There is no code path that edits a recorded amount.

Supersedes §2.1, §5.4, §7.3, §7.5 of the current state.

### P4 — Confirmation authority is tiered and explicit

Not all evidence is equal. A signed gateway webhook that the server independently
re-verified is not the same as a resident's screenshot. Every settlement records
*how* it was confirmed, and only the strongest tier may settle without a human.

### P5 — Unmatched money and unmatched claims are first-class states

Money that arrived with no known owner, and a claim with no matching money, are
normal operational states with their own UI, not errors to be swallowed. The
system's most valuable output is the list of things that do not reconcile.

### P6 — No hostel is blocked from using the product on day one

Tier 0 requires no business registration, no merchant account, no bank
integration — only a QR image and an account number. Everything above that is an
upgrade, never a prerequisite.

### P7 — Every automated rejection happens before a human sees it

Duplicate screenshots, reused transaction IDs, and malformed reference codes are
rejected at submission. The owner's review queue contains only things a human
actually needs to judge.

### P8 — The receipt is per settlement event, not per month

Supersedes §5.5. A resident who pays in two instalments gets two receipts. A
receipt, once issued, is immutable.

---

## 2. The tier model

A hostel sits at exactly one tier at any time. Tier is a property of
`HostelPaymentProfile`, derived from what the hostel has configured. The resident
and owner UI adapt; the data model does not change between tiers.

| | **Tier 0 — Manual** | **Tier 0.5 — Reconciled** | **Tier 1 — Automatic** |
|---|---|---|---|
| Hostel setup needed | QR image + account number | Same, plus a periodic statement export | Merchant credentials from their bank |
| Business registration required | No | No | Yes |
| How resident pays | Scans static QR in their own wallet app, types reference in remarks | Same | Live QR with amount pre-filled, or wallet deeplink |
| How payment is confirmed | Resident submits screenshot + txn ID; owner approves | Owner uploads statement; system auto-matches; owner handles exceptions only | Signed webhook, server-verified with provider |
| Owner effort per month (40 residents) | ~40 taps, ~10 min | 1 upload + ~3 decisions, ~90 sec | 0 |
| Confirmation authority | `MANUAL_REVIEW` | `STATEMENT_MATCH` | `GATEWAY_VERIFIED` |
| Fraud posture | Deterrence + delayed detection | Detection within one statement cycle | Prevention |

Tier 0.5 is not a separate hostel configuration — it is Tier 0 plus the statement
import feature. A Tier 0 hostel that never uploads a statement simply stays at
Tier 0 behaviour. Build it as an always-available capability, not a setting.

**Tier is per hostel, not per platform.** A single deployment will have hostels at
all three tiers simultaneously, forever. Do not design a migration or a flag day.

---

## 3. Bed types and the fee schedule

### 3.1 The bed type enum

Residents are tracked by **bed type**, not by room number. The canonical set:

```
SINGLE            — private room, one bed
DOUBLE_SHARING    — room shared by 2
TRIPLE_SHARING    — room shared by 3
FOUR_SHARING      — room shared by 4
DORMITORY         — open dormitory, 5+
```

This enum is shared vocabulary across billing, room configuration, and public
listings. Define it once in the shared package and import everywhere. Do not let
the finance module carry a private copy.

### 3.2 The problem this replaces

Currently `Resident.monthlyFee` (§3 of current state) is a bare number, set
per-resident or bulk-set across a whole hostel. Consequences noted in the current
state doc: no fee history, so "what was this resident's rent in March?" is
unanswerable, and a bulk fee change silently rewrites the basis for every future
bill with no record of what it was before.

### 3.3 The replacement: a versioned rate card

**`FeeSchedule`** — one document per hostel per effective period.

```
hostelId          ObjectId → Hostel     required
effectiveFrom     Date                  required
effectiveTo       Date                  nullable — null means "current"
rates             [ { bedType, monthlyAmount, currency } ]   one entry per bed type in use
admissionFee      Number                optional, one-time charge at move-in
depositAmount     Number                optional, refundable security deposit
createdBy, createdAt
```

Indexes: `{hostelId, effectiveFrom}` descending; a partial unique index enforcing
at most one row per hostel with `effectiveTo: null`.

**Rules:**

- A `FeeSchedule` is **never edited**. Changing rates means closing the current
  row (`effectiveTo = the day before the new one starts`) and inserting a new one.
- An invoice snapshots the amount it was computed from — it does not hold a
  reference to the schedule and re-derive later. Historical invoices must remain
  correct even if every schedule is later deleted.
- `Resident.monthlyFee` is retained but **demoted to an override**. Nullable, and
  null by default. When null, the resident's charge comes from the schedule via
  their bed type. When set, it wins, and it must carry `feeOverrideReason` and
  `feeOverrideSetBy`. This covers the real cases — a long-staying resident on an
  old rate, a staff member's child, a negotiated discount — without letting
  arbitrary numbers be the norm.

### 3.4 Resolving a resident's monthly charge

```
resolveMonthlyCharge(resident, month):
  1. if resident.monthlyFee is not null  → return it, basis = OVERRIDE
  2. schedule = FeeSchedule for resident.hostelId effective during `month`
  3. if no schedule                      → error FEE_SCHEDULE_MISSING (do not default to 0)
  4. rate = schedule.rates[resident.bedType]
  5. if no rate for that bed type        → error BED_TYPE_NOT_PRICED
  6. return rate.monthlyAmount, basis = SCHEDULE, scheduleId, bedType
```

**Do not silently bill zero.** The current system's `resident.monthlyFee || input.defaultAmount || 0`
chain (§5.1 A2) means a misconfigured resident is billed nothing and nobody
notices. Both error cases above must surface on the billing run's result and in
the owner UI as "3 residents could not be billed — bed type not priced".

### 3.5 Proration

The current state has two billing paths that disagree (§7.8): the matrix view
prorates a mid-month move-in, the bulk fee run charges full. **Delete this
ambiguity — one billing path, one rule.**

```
computeInvoiceAmount(monthlyCharge, moveInDate, moveOutDate, month):
  monthStart, monthEnd = bounds of month
  if moveInDate  > monthEnd    → 0   (not yet resident)
  if moveOutDate < monthStart  → 0   (already left)
  billableStart = max(moveInDate, monthStart)
  billableEnd   = min(moveOutDate ?? monthEnd, monthEnd)
  billableDays  = days between, inclusive
  if billableDays >= daysInMonth → full monthlyCharge
  else → round(monthlyCharge / daysInMonth * billableDays)
```

Note this now also prorates **move-out**, which the current system does not do at
all. Rounding to the nearest rupee; record `prorationBasis` on the invoice line so
the resident-facing explanation can say "18 of 31 days".

---

## 4. Data model

### 4.1 New collections

#### `HostelPaymentProfile`

Fixes §7.11 — currently there is nowhere to record how residents should pay.

```
hostelId              ObjectId → Hostel   required, unique
tier                  TIER_0 | TIER_1     derived, see below
displayName           String              e.g. "Rupak Hostel" — shown on QR screen

// Tier 0 fields — all optional, at least one required to activate
staticQrAssetId       ObjectId → FileAsset
esewaId               String
khaltiId              String
bankName              String
bankAccountName       String
bankAccountNumber     String
paymentInstructions   String              free text shown under the QR

// Tier 1 fields
gatewayProvider       FONEPAY | ESEWA | KHALTI | null
gatewayMerchantCode   String
gatewaySecretRef      String              reference to the secret store — NEVER the secret itself
gatewayWebhookSecret  String              same
gatewayEnabledAt      Date
gatewayLastEventAt    Date                for health monitoring

// Statement import
lastStatementUploadAt Date
statementCadenceDays  Number              default 7, drives the nudge

createdBy, updatedBy, timestamps
```

`tier` = `TIER_1` when `gatewayProvider` is set and `gatewayEnabledAt` is not
null; otherwise `TIER_0`.

**Secrets must not live in this document.** Store a reference and keep the values
in whatever secret mechanism the repo already uses for API keys. If none exists,
that is a prerequisite task, not something to shortcut with an encrypted field
here.

#### `Invoice`

Replaces `Payment` as the obligation record.

```
hostelId          ObjectId → Hostel      required
residentId        ObjectId → Resident    required
period            String "YYYY-MM"       required  (null for one-off invoices)
kind              MONTHLY_RENT | ADMISSION_FEE | DEPOSIT | ADJUSTMENT | OTHER
lines             [ InvoiceLine ]        see below
totalAmount       Number ≥ 0             sum of lines, denormalised
currency          String                 "NPR", explicit, no hardcoding in UI
dueDate           Date                   required
issuedAt          Date
status            DRAFT | OPEN | PAID | PARTIAL | OVERDUE | VOID | WRITTEN_OFF
voidedAt, voidedBy, voidReason
createdBy, updatedBy, timestamps
```

`InvoiceLine`:
```
description       String       e.g. "August 2026 rent — triple sharing"
bedType           BedType      nullable, for rent lines
amount            Number
basis             SCHEDULE | OVERRIDE | MANUAL
feeScheduleId     ObjectId     nullable, the schedule it came from
prorationBasis    String       nullable, e.g. "18/31 days from 14 Aug"
```

Indexes: `{hostelId, residentId, period, kind}` **unique partial** where
`status != VOID` — this prevents double-billing while allowing a voided invoice to
be reissued. Plus `{hostelId, status, dueDate}`, `{residentId, status}`.

**`paidAmount` does not exist on this document.** See §4.2.

#### `PaymentEvent`

One row per attempt to pay, which becomes the settlement record when it succeeds.
This is the immutable money log.

```
hostelId          ObjectId → Hostel      required
invoiceId         ObjectId → Invoice     NULLABLE — money can arrive with no known invoice
residentId        ObjectId → Resident    NULLABLE — same reason
referenceCode     String                 nullable, see §5
amount            Number > 0             required
currency          String
direction         CREDIT | DEBIT         DEBIT is used only for reversals, see §9.3

source            GATEWAY_WEBHOOK | GATEWAY_POLL | STATEMENT_IMPORT
                  | RESIDENT_CLAIM | CASH_ENTRY | ADJUSTMENT
provider          FONEPAY | ESEWA | KHALTI | BANK | CASH | NONE
providerTxnId     String                 nullable for cash

confirmation      UNCONFIRMED | MANUAL_REVIEW | STATEMENT_MATCH | GATEWAY_VERIFIED
status            PENDING | SETTLED | FAILED | EXPIRED | REJECTED | REVERSED

evidenceAssetId   ObjectId → FileAsset   nullable, the screenshot
evidenceHash      String                 nullable, perceptual/content hash — see §8.1
rawPayload        Mixed                  ALWAYS stored — webhook body, statement row, form body
idempotencyKey    String                 required, unique

occurredAt        Date    when the money actually moved, per the provider
observedAt        Date    when we learned about it
settledAt         Date    when we marked it SETTLED
expiresAt         Date    for PENDING gateway intents

reversedByEventId ObjectId → PaymentEvent   nullable
reversesEventId   ObjectId → PaymentEvent   nullable

createdBy, reviewedBy, reviewedAt, rejectionReason
timestamps
```

**Indexes — these are load-bearing, not optimisations:**

- `{idempotencyKey}` **unique** — the single most important index in the system.
- `{hostelId, provider, providerTxnId}` **unique partial** where `providerTxnId` exists — kills transaction-ID reuse (fixes half of §7.2).
- `{hostelId, evidenceHash}` **unique partial** where `evidenceHash` exists — kills screenshot reuse (fixes the other half).
- `{invoiceId, status}`, `{hostelId, status, occurredAt}`, `{referenceCode}`.

**Immutability rule:** once `status` is `SETTLED`, the document's financial fields
(`amount`, `direction`, `invoiceId`, `confirmation`) are never updated. Enforce in
the service layer, and add a Mongoose pre-hook that throws if a settled event is
modified. A settled event can only be *reversed* by writing a new one (§9.3).

#### `InvoiceBalance` — projection, optional but recommended

A read-model to avoid summing events on every page load.

```
invoiceId         ObjectId    unique
hostelId, residentId
settledAmount     Number      sum of SETTLED CREDIT minus SETTLED DEBIT
lastEventId       ObjectId
lastComputedAt    Date
version           Number      increments on every recompute
```

**This is a cache, and must be treated as one.** It is rebuilt from
`PaymentEvent` by the reconciliation job (§10), and any disagreement between it
and the event sum is a `LedgerDrift` alert, never a silent overwrite. If the
implementation is simpler without it, compute on read — but then never store the
result anywhere.

#### `StatementImport`

```
hostelId          ObjectId    required
uploadedBy, uploadedAt
sourceAssetId     ObjectId → FileAsset    the raw CSV/PDF
provider          ESEWA | KHALTI | BANK
parserVersion     String
periodStart, periodEnd    Date
rowCount          Number
matchedCount, unmatchedCount, orphanCount
status            PARSING | READY | FAILED
errorDetail       String
```

Retain the raw file. Parsers will change; historical statements must be
re-parseable.

#### `ReconciliationRun`

Fixes the current state's observation (§5.6) that the dunning job returns stats
that go nowhere, so a silently failing cron is invisible.

```
hostelId          ObjectId    nullable — null means platform-wide run
kind              LEDGER_DRIFT | DUNNING | GATEWAY_HEALTH | STATEMENT_MATCH
startedAt, finishedAt
status            RUNNING | OK | WARN | FAIL
counters          Mixed       { scanned, matched, drifted, notified, errors }
findings          [ { severity, code, entityId, detail } ]
```

Every scheduled job writes one of these. Every job. No exceptions.

### 4.2 Changes to existing collections

| Collection | Change |
|---|---|
| `Payment` | **Deleted after migration.** Becomes `Invoice` + `PaymentEvent`. See §4.3. |
| `PaymentProof` | **Deleted.** A resident claim is now a `PaymentEvent` with `source: RESIDENT_CLAIM`, `status: PENDING`, `confirmation: UNCONFIRMED`. Its `amount`, `providerTxnId`, and `evidenceAssetId` carry what the proof used to. This collapses two concepts that were always the same thing. |
| `Receipt` | Retained, restructured. See §4.4. |
| `Resident` | `monthlyFee` becomes nullable override; add `feeOverrideReason`, `feeOverrideSetBy`, `feeOverrideSetAt`. Add `bedType` (required) if not already present. |
| `Hostel` | `admissionFee` moves to `FeeSchedule.admissionFee`. Keep the field temporarily for the public listing, but billing must read the schedule. |
| `DepositRecord` | Currently dead (§2.4). Either implement the full lifecycle (§16.3) or delete it. **Do not leave it.** |
| `FileAsset` | Add `hostelId`, populated at presign. Add `uploadCompletedAt`. Add `contentHash`. See §13. |

### 4.3 Migration from `Payment`

Every existing `Payment` row becomes:

1. One `Invoice` — `period`, `dueDate`, `totalAmount = dueAmount`, one line
   `{ description: "<Month> rent", amount: dueAmount, basis: MANUAL }`. Status
   mapped: `UNPAID`/`PENDING_PROOF` → `OPEN`, `PAID` → `PAID`, `PARTIAL` →
   `PARTIAL`, `OVERDUE` → `OVERDUE`.
2. If `paidAmount > 0`, one `PaymentEvent`:
   `{ amount: paidAmount, direction: CREDIT, status: SETTLED, source: ADJUSTMENT,
      confirmation: MANUAL_REVIEW, provider: paymentMethod mapped, occurredAt: paidDate,
      idempotencyKey: "migration:" + payment._id,
      rawPayload: { migratedFrom: payment._id, note: "opening balance from pre-migration ledger" } }`

   This is honest: the migrated balance was never event-sourced, so it is recorded
   as a single opening-balance adjustment rather than fabricated as a series of
   payments. Do not invent `providerTxnId` values during migration.
3. Existing `PaymentProof` rows with `status: PENDING` become `PaymentEvent`
   rows with `status: PENDING`. Approved and rejected proofs are archived, not
   migrated — the money is already in the opening balance and migrating them
   would double-count.

Run the migration behind a dry-run flag that reports totals before and after per
hostel. The invariant to assert: for every hostel,
`sum(old Payment.paidAmount) == sum(new SETTLED PaymentEvent.amount)`. Abort if
it does not hold.

### 4.4 `Receipt` restructure

Supersedes §5.5 and fixes §7.7.

```
hostelId, residentId, invoiceId, paymentEventId    all required
receiptNumber     String    required
issuedAt, issuedBy
amount            Number    the amount of THIS event, not the invoice total
periodLabel       String
bedTypeLabel      String    e.g. "Triple sharing"
snapshot          Mixed     hostel name, address, resident name, line items — frozen at issue
timestamps: { createdAt: true, updatedAt: false }
```

- **One receipt per settled `PaymentEvent`**, not per invoice. Two instalments,
  two receipts.
- Indexes: `{paymentEventId}` unique; `{hostelId, receiptNumber}` unique.
- **Numbering is per hostel**, not global. Current state numbers globally, which
  leaks platform volume to every hostel (§5.5). Format:
  `{hostelPrefix}-{FY or YYYY-MM}-{sequence}`.
- Sequence must come from an atomic counter document per hostel per period, not
  from a string-sorted `findOne` — the current approach breaks at 100,000 and is
  a race dressed as a query.
- **Never mutated.** A wrong receipt is voided and reissued, both records kept.
- Needs a PDF render and a download route. The current "Download Statement"
  button has no handler (§7.12).

---

## 5. The reference code

The mechanism principle P2 rests on.

### 5.1 Format

```
{HOSTEL}-{SEQ}-{CHECK}

RUP-4821-K
```

- `HOSTEL` — 3 uppercase letters, assigned per hostel at onboarding, unique
  platform-wide. Human-memorable, appears on the receipt too.
- `SEQ` — 4 characters, Crockford base32 (excludes I, L, O, U to avoid
  transcription errors), derived from the invoice id. ~1M values per hostel.
- `CHECK` — one Crockford base32 check character over the preceding string.

Total 10 characters including hyphens. Short enough to type into a bank remarks
field on a phone, long enough not to collide, and **self-validating** — a typo is
detectable without a database lookup, which matters when parsing statement rows
and free-text remarks.

### 5.2 Rules

- Generated once per `Invoice`, at issue. Stored on the invoice. Never changes.
- Case-insensitive on input. Normalise to uppercase, strip spaces and hyphens
  before comparison, so `rup4821k` and `RUP-4821-K` both match.
- Displayed on: the resident pay screen, the payment reminder email and in-app
  notification, the invoice PDF, and inside every Tier 1 dynamic QR payload.
- When parsing free text (statement remarks, notification bodies), extract with a
  permissive pattern then **validate the check character**. Only a code that
  passes the check counts as a reference match. This is what makes Tier B
  matching (§7) safe enough to auto-settle.

### 5.3 What to do when the resident forgets it

They will. Roughly half the time at Tier 0. This is not a failure case — it just
drops the match down a tier. Design for it:

- The claim form asks the resident to confirm they entered it, but does not block
  submission if they say no.
- An event with no reference code can still match on amount + txn ID + statement,
  it just requires the owner's confirmation.
- Do **not** punish the resident in UI copy. "Adding the code next time will get
  your payment confirmed faster" — not an error.

---

## 6. Flows

### 6.1 Billing — how an invoice comes into existence

**One path only.** The current state has three overlapping paths (§5.1 A1/A2/A3)
that disagree on amount and on which residents to include. Delete two of them.

**`runBillingCycle(hostelId, period, { dryRun })`**

Triggered by: a scheduled job on the 1st of each month, *and* an explicit button
in the owner UI for re-running or catching up. Same code path for both.

```
1. Load residents where hostelId matches and status in (ACTIVE, PENDING)
     — one rule about which statuses are billed, applied everywhere
2. Load the FeeSchedule effective for `period`; if none → fail the whole run,
     do not partially bill
3. For each resident:
     a. resolveMonthlyCharge (§3.4) → amount, basis, bedType
        on BED_TYPE_NOT_PRICED → record as a skip with reason, continue
     b. computeInvoiceAmount with proration (§3.5)
     c. if 0 → skip with reason MOVED_OUT_OR_NOT_YET_RESIDENT
     d. upsert Invoice on {hostelId, residentId, period, kind: MONTHLY_RENT}
        — existing non-VOID invoice → skip with reason ALREADY_BILLED
     e. generate reference code
4. Write a ReconciliationRun with counters and per-resident skip reasons
5. Return { created, skipped: [{residentId, reason}], failed }
```

**Never auto-bill on a read.** The current matrix view creates invoices as a side
effect of an admin opening a screen (§5.1 A1), which is why the same resident can
be billed differently depending on which page was opened first. Reads are reads.

**Owner-visible output.** After a run, the owner sees:
`"Billed 38 residents for August. 3 skipped — bed type 'Dormitory' has no rate set. [ Fix ]"`
Silent skips are how a hostel discovers in November that four residents were
never billed.

### 6.2 Tier 0 — resident pays

```
1. Resident opens app → sees open invoice, amount, due date
2. Screen shows: hostel QR image, reference code with copy button,
   fallback eSewa ID / bank account, and instructions
3. Resident leaves the app, pays in their own wallet or banking app,
   types the reference code into the remarks field
4. Resident returns, taps "I've paid", submits:
     - screenshot (required)
     - method (eSewa | Khalti | Bank | Cash)
     - amount (pre-filled with the outstanding balance, editable)
     - transaction ID (required except for cash)
     - checkbox confirming the reference code was entered
5. Server, before accepting:
     a. hash the image → reject if hash already exists for this hostel (§8.1)
     b. reject if (hostel, provider, providerTxnId) already exists (§8.2)
     c. validate the asset belongs to this resident (§13.2)
     d. reject if amount ≤ 0 or amount > outstanding × 1.5 (sanity bound)
   Any rejection → clear, specific message to the resident, no owner involvement
6. On acceptance → PaymentEvent { source: RESIDENT_CLAIM, status: PENDING,
   confirmation: UNCONFIRMED }
7. Invoice status → unchanged. A claim is not money.
8. Notify owner
```

Note step 7. In the current system a submitted proof flips the payment to
`PENDING_PROOF` (§5.2), which conflates "someone said they paid" with a payment
state. An unconfirmed claim must not change the invoice's status; it appears as a
badge on the invoice, nothing more.

### 6.3 Tier 0 — owner reviews

```
1. Owner opens review queue (§11.4)
2. Each row shows the claim, the screenshot inline, and system checks:
     ✓/⚠ reference code present and valid
     ✓/⚠ amount matches outstanding exactly / partial / over
     ✓/⚠ transaction ID format plausible for the stated provider
3. Owner approves → PaymentEvent.status = SETTLED,
   confirmation = MANUAL_REVIEW, settledAt = now, reviewedBy = owner
4. Recompute invoice balance from events → status transition
5. Issue Receipt for this event
6. Notify resident
```

`Approve all` is enabled only for rows where every check is green, and shows the
count and total it will approve before confirming.

**Rejection takes a reason from a fixed list**, not `window.prompt()` (§5.2 step 5):
`AMOUNT_MISMATCH`, `EVIDENCE_UNCLEAR`, `NO_MATCHING_TRANSACTION`,
`DUPLICATE_OF_EARLIER_PAYMENT`, `OTHER` (requires free text). Fixed reasons let
the resident be told something actionable, and let you count failure modes later.

### 6.4 Tier 0.5 — statement import

```
1. Owner exports a statement from their eSewa / Khalti / bank (CSV or PDF)
2. Uploads it. Server creates StatementImport, stores the raw file
3. Parser (provider-specific, versioned) extracts rows:
     { occurredAt, amount, direction, providerTxnId, counterpartyName, remarks }
4. For each CREDIT row, run the matching ladder (§7)
5. Present three buckets (§11.5):
     MATCHED   — reference code valid and amount agrees → bulk approve
     CLAIMED_NO_TRANSACTION — resident claims exist with no statement row
     ORPHAN    — statement row with no claim
6. Owner acts on buckets 2 and 3 only
7. Write a ReconciliationRun
```

**Parser design notes:**

- One parser per provider, each with a `parserVersion`. Store the version on the
  import so a re-parse is auditable.
- Statement formats will change without warning. Parsers must fail loudly with
  "could not read this file, format may have changed" — never partially parse and
  silently drop rows. A statement import that reads 60 of 84 rows and says nothing
  is worse than one that fails.
- Support CSV first. PDF parsing is a second phase and should be treated as
  best-effort with a manual-correction path.
- Deduplicate against previously imported rows by `providerTxnId` — overlapping
  date ranges across uploads are the normal case, not an edge case.

**Nudge the upload.** If `lastStatementUploadAt` is older than
`statementCadenceDays`, show a persistent banner on the owner dashboard. This
feature only works if it is actually used.

### 6.5 Tier 1 — gateway

```
1. Resident taps "Pay" on an open invoice
2. Server creates PaymentEvent { source: GATEWAY_WEBHOOK, status: PENDING,
   expiresAt: now + 15 min, idempotencyKey: derived from invoiceId + attempt }
3. Server requests a dynamic QR from the provider, passing amount and
   referenceCode as the merchant transaction reference
4. Resident sees live QR (with countdown) and wallet deeplink buttons
5. Resident pays in their own app
6. Provider POSTs a webhook to our endpoint
7. Server:
     a. verify the signature — reject unsigned or mismatched
     b. look up our PaymentEvent by reference / merchant txn id
     c. INDEPENDENTLY call the provider's verify/lookup API and confirm
        amount and status from that response — never trust the webhook body alone
     d. if confirmed → status = SETTLED, confirmation = GATEWAY_VERIFIED
     e. idempotent — a replayed webhook is a no-op, guaranteed by the unique index
8. Recompute balance, issue receipt, push to resident's open screen, notify owner
```

**Critical:** the resident landing on a success/return URL must **never** mark
anything paid. That URL is guessable and carries no authority. Only step 7
settles. The return URL's only job is to show a "checking..." state that polls.

**Expiry sweep.** A job marks `PENDING` gateway events past `expiresAt` as
`EXPIRED`. It must first re-query the provider — a payment that succeeded while
our webhook was down must not be expired away. Run every 5 minutes.

**Gateway health.** If `gatewayLastEventAt` is older than a threshold and there
are open invoices, raise a `GATEWAY_HEALTH` finding and warn the owner in-app. A
silently broken webhook looks exactly like "nobody paid this month", and that
must not be indistinguishable.

---

## 7. The matching ladder

Every ingested payment runs this in order. First match wins. The tier reached
determines whether it settles automatically.

### Tier A — `GATEWAY_VERIFIED`
Signed webhook, our reference code present, amount agrees, and independently
re-confirmed by calling the provider's API.
→ **Auto-settle.** No human.

### Tier B — `STATEMENT_MATCH`
A statement row or gateway poll where:
- a reference code is present **and passes its check character**, and
- the referenced invoice belongs to this hostel, and
- the amount is within tolerance (exact, or ≤ outstanding).

→ **Auto-settle**, flagged in the UI as reference-matched rather than
gateway-confirmed. Included in `Approve all`.

### Tier C — `SUGGESTED`
Any of:
- resident claim whose `providerTxnId` matches a statement row exactly, or
- amount + time window match with no reference code, or
- counterparty name fuzzy-matches a resident name.

→ **Never auto-settles.** Produces a one-tap suggestion with a confidence label
and the evidence side by side. Owner decides.

Scoring inputs, roughly in order of weight: exact `providerTxnId` match >
reference code present but invoice mismatched > exact amount > counterparty name
similarity > time proximity. Show *why* it was suggested, in words: "matches
Suman Tamang — name similar, owes exactly this amount".

### Tier D — `UNMATCHED` (orphan money)
A real credit with no claim, no reference, no plausible suggestion. Money that
arrived and belongs to nobody yet.

→ Sits in a **suspense list**, visible on the owner dashboard with an age
indicator. Assignable to any resident by the owner, which creates a settled event
with `confirmation: MANUAL_REVIEW` and records who assigned it.

This state must not be hidden. An orphan payment ageing past 30 days is the
single strongest signal that something is wrong operationally.

### Tier E — `ORPHAN_CLAIM`
A resident claim with no corresponding money in any statement or gateway feed,
past a grace period.

→ Surfaced to the owner with the claim details and the option to reject, approve
anyway, or ask the resident. `Approve anyway` must exist — statements lag, and
trapping the owner behind incomplete data will make them abandon the feature —
but it records who clicked it, which is the maker-checker trail.

---

## 8. Fraud controls

What is caught, by what, and when. Be honest in the UI about which of these
apply at each tier.

| Attack | Control | When caught | Tier |
|---|---|---|---|
| Re-uploads a previously used screenshot | `evidenceHash` unique per hostel | At submission, instantly | 0+ |
| Reuses a real transaction ID from an earlier month | `{hostelId, provider, providerTxnId}` unique | At submission, instantly | 0+ |
| Submits another resident's asset id | Asset ownership check (§13.2) | At submission, instantly | 0+ |
| Submits an old genuine payment for a new month | Reference code belongs to a different invoice; txn ID already used | At submission | 0+ |
| Inflates the claimed amount | Sanity bound at submission; exact comparison at review | Submission / review | 0+ |
| **Fabricates a transaction ID with a doctored screenshot** | **Not caught at submission.** No matching statement row. | **At the next statement import** | 0.5 |
| Same, at Tier 0 with no statement ever uploaded | **Not caught by the software.** Owner's own bank app is the only truth. | — | 0 |
| Any of the above | Impossible — money is confirmed by the provider, not claimed | N/A | 1 |

### 8.1 Evidence hashing

Compute two hashes on upload: a content hash (SHA-256 of bytes) and a perceptual
hash (pHash or similar) for images. The content hash catches exact re-uploads;
the perceptual hash catches a re-screenshot or a lightly cropped/recompressed
version of the same image. Store both. Compare within hostel scope only —
two residents in different hostels may legitimately have visually similar
screenshots, and cross-hostel comparison is a privacy leak.

Perceptual matches near the threshold should be **flagged for review**, not
auto-rejected. Exact content-hash matches are auto-rejected.

### 8.2 What to tell the resident on rejection

Specific, non-accusatory, actionable:

> **This screenshot was already used.** It was submitted on 2 Jul 2026 for July
> rent. Please upload the screenshot for this payment. If you think this is a
> mistake, contact your hostel admin.

Do not say "fraud detected". Most triggers are genuine confusion — a resident
tapping the wrong image in their gallery.

### 8.3 Honesty about Tier 0's limit

Document this in the product, not just in code:

> At Tier 0, the software does not prove payment. Your bank statement is the
> truth. What the software does is make comparing against that truth take seconds
> instead of an hour — and make a false claim leave a permanent record with a
> name attached.

Owners will trust the system more, not less, for being told this plainly. It also
sets up the Tier 0.5 and Tier 1 upgrades as the answer.

---

## 9. Cash, corrections, reversals

### 9.1 Cash

Its own endpoint and its own UI — **not** the generic invoice update. The current
system's unrestricted `PATCH` (§5.4) is the intended cash path *and* the largest
integrity hole, because they are the same code path.

`recordCashPayment(invoiceId, { amount, receivedAt, collectedBy, cashReceiptNumber, note })`

- `collectedBy` is a named user, required. Not the logged-in user by default —
  the warden entering it may not be the one who took the money.
- `cashReceiptNumber` required — the hostel's own paper receipt book number.
- Creates `PaymentEvent { source: CASH_ENTRY, provider: CASH, confirmation: MANUAL_REVIEW }`.
- Above a configurable threshold (default NPR 20,000), require a second approver
  before it settles. Simple maker-checker; the row sits `PENDING` until a second
  user with the capability approves.

### 9.2 Delete the unrestricted PATCH

`PATCH /hostel-admin/payments/[id]` as it exists must not survive. Its powers are
replaced by specific, audited operations:

| Old capability | Replacement |
|---|---|
| Change `dueAmount` | Void the invoice, issue a corrected one |
| Change `paidAmount` up | `recordCashPayment` or approve a claim |
| Change `paidAmount` down | Reversal event (§9.3) |
| Change `status` to PAID | Not available — status is derived |
| Change `month` | Void and reissue |
| Edit `remarks` | Retained as the only free edit |

### 9.3 Reversals

Fixes §7.5 — currently a wrongly approved proof cannot be undone except via the
raw PATCH, which forces staff into the least auditable path.

`reversePaymentEvent(eventId, { reason, reversedBy })`

- Writes a **new** `PaymentEvent` with `direction: DEBIT`, the same amount,
  `source: ADJUSTMENT`, `reversesEventId` pointing at the original.
- Sets `reversedByEventId` on the original — this is the one permitted write to a
  settled event, and it touches no financial field.
- Requires a reason, minimum length enforced.
- Voids the receipt issued for the original event and records the void.
- Notifies the resident. A reversal that a resident discovers by accident is a
  support disaster.

### 9.4 Overpayment

Fixes §7.4 — currently the excess is silently clamped away with
`Math.min(paid + verified, dueAmount)`.

An event whose amount exceeds the invoice's outstanding balance settles **in
full**. The excess becomes a credit:

- Create or increment a `CREDIT_BALANCE` record for the resident.
- Show it on the resident's screen: "You have NPR 3,000 in credit. It will be
  applied to your next invoice."
- The next billing cycle applies available credit as an invoice line with a
  negative amount, reducing the payable total.
- Credit is refundable at move-out and nets against outstanding dues.

Never destroy money. If the design cannot decide where an amount belongs, it goes
to suspense (Tier D) — it does not evaporate.

---

## 10. Reconciliation

### 10.1 Ledger drift job

Nightly, per hostel:

```
for each invoice with events:
    computed = sum(SETTLED CREDIT) - sum(SETTLED DEBIT)
    if InvoiceBalance.settledAmount != computed:
        raise finding LEDGER_DRIFT { invoiceId, stored, computed }
        DO NOT silently correct — a drift means something wrote where it shouldn't
    if invoice.status != deriveStatus(computed, invoice.totalAmount):
        raise finding STATUS_DRIFT
```

Also check for structural half-completions, which the current state notes are
possible and undetectable (§7.9):

- `SETTLED` events with no `Receipt`
- `Receipt` rows with no settled event
- `PENDING` gateway events past expiry that were never swept
- Invoices marked `PAID` whose events sum to less than the total

### 10.2 Gateway settlement reconciliation (Tier 1)

Weekly, pull the provider's settlement report and diff against `PaymentEvent`:

- Events we recorded that the provider did not settle → investigate.
- Provider settlements we have no event for → missed webhook, create the event.

This is the only thing that catches a webhook endpoint that has been quietly
returning 500 for a week.

### 10.3 Dunning

Rebuild `runPaymentReminders` (§5.6, §7.6). Current defects to fix:

- **`.limit(500)` platform-wide with no pagination** — residents past the 500th
  open invoice are never reminded, silently, forever. Replace with cursor-based
  batching over all open invoices.
- **Exact-day equality** (`daysUntilDue === N`) means a single missed cron run
  skips that resident permanently. Replace with "due in N days *and* not yet
  reminded for this invoice at this stage", tracked per invoice.
- **No run history** — every run writes a `ReconciliationRun`.
- **Sequential awaits inside the loop** — batch the sends.
- **No stop condition** — chases currently continue indefinitely. Add an
  escalation ladder that terminates: reminder → overdue → weekly chase ×4 →
  escalate to owner as a human task → stop automated contact.

---

## 11. Screens

Textual wireframes. Layout is indicative; the labelled information and the
decisions behind it are the specification.

### 11.1 Resident — Tier 0, before paying

```
┌────────────────────────────────────────────┐
│  August 2026                               │
│                                            │
│         NPR 12,000                         │
│         Triple sharing · Due 31 Aug        │
│         25 days left                       │
│                                            │
│  ────────────────────────────────────────  │
│                                            │
│      ┌──────────────────────┐              │
│      │    [ HOSTEL QR ]     │              │
│      └──────────────────────┘              │
│         Rupak Hostel · NIC Asia            │
│                                            │
│  ⚠️  Put this code in the remarks field:   │
│      ┌──────────────────────────┐          │
│      │   RUP-4821-K      [copy] │          │
│      └──────────────────────────┘          │
│  Without this code your payment may take   │
│  longer to confirm.                        │
│                                            │
│  Other ways to pay                      ▾  │
│    eSewa ID    9841XXXXXX      [copy]      │
│    Bank A/C    01234567890     [copy]      │
│                                            │
│  ┌────────────────────────────────────┐    │
│  │       I've paid — submit proof     │    │
│  └────────────────────────────────────┘    │
└────────────────────────────────────────────┘
```

Design notes:
- Bed type shown next to the amount so the resident can sanity-check their own bill.
- The reference code gets the strongest visual treatment on the screen. It is the
  mechanism the entire system depends on; burying it in fine print defeats the design.
- "Other ways to pay" collapsed by default — the QR is the primary path.
- If a credit balance exists, show it above the amount: "NPR 3,000 credit applied".

### 11.2 Resident — Tier 0, claim form

```
┌────────────────────────────────────────────┐
│  ← Submit proof · August 2026              │
│                                            │
│  Screenshot                                │
│  ┌──────────────────────────────────┐      │
│  │   📷  Tap to upload               │      │
│  └──────────────────────────────────┘      │
│                                            │
│  How did you pay?                          │
│  ( eSewa )  ( Khalti )  ( Bank )  ( Cash ) │
│                                            │
│  Amount paid                               │
│  ┌──────────────────────────────────┐      │
│  │  NPR  12,000                     │      │  ← pre-filled with outstanding
│  └──────────────────────────────────┘      │
│                                            │
│  Transaction ID                            │
│  ┌──────────────────────────────────┐      │
│  └──────────────────────────────────┘      │
│  Find this in your eSewa transaction       │
│  history.  [ show me where ]               │
│                                            │
│  ☐ I entered RUP-4821-K in the remarks     │
│                                            │
│  ┌────────────────────────────────────┐    │
│  │              Submit                │    │
│  └────────────────────────────────────┘    │
└────────────────────────────────────────────┘
```

Design notes:
- **Pre-fill the amount.** Most people pay exactly what is owed; a typed amount is
  a mismatch waiting to happen.
- **`[ show me where ]`** opens an annotated screenshot of that provider's
  transaction history with the txn ID circled. This single element will reduce
  support load more than anything else on the screen. One per provider.
- Transaction ID is required for all methods except Cash; for Cash, replace it
  with "Who did you give the cash to?".
- Checkbox is informational, not a gate.

### 11.3 Resident — instant rejections

```
┌────────────────────────────────────────────┐
│  ⛔  This screenshot was already used       │
│                                            │
│  It was submitted on 2 Jul 2026 for        │
│  July rent.                                │
│                                            │
│  Please upload the screenshot for THIS     │
│  payment. If you think this is a mistake,  │
│  contact your hostel admin.                │
│                                            │
│           [ Try again ]                    │
└────────────────────────────────────────────┘
```

```
┌────────────────────────────────────────────┐
│  ⛔  Transaction ID already recorded        │
│                                            │
│  8823119471 was used for July rent.        │
│  Each payment has its own ID.              │
│                                            │
│           [ Try again ]                    │
└────────────────────────────────────────────┘
```

These never reach the owner's queue.

### 11.4 Owner — Tier 0 review queue

```
┌──────────────────────────────────────────────────────────────────┐
│  Payments · August 2026          🔍 [search]      [Approve all ✓]│
│                                                                  │
│  ┌──────────┬─────────┬──────────┬──────────┬──────────┐         │
│  │ To review│ Paid    │ Unpaid   │ Overdue  │ Collected│         │
│  │    12    │   28    │    9     │    3     │ ₨336,000 │         │
│  └──────────┴─────────┴──────────┴──────────┴──────────┘         │
│                                                                  │
│  ── TO REVIEW ────────────────────────────────────────────────   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ ┌────────┐  Ram Bahadur Thapa · Triple sharing             │  │
│  │ │        │  Claims NPR 12,000 · eSewa · 2 hrs ago          │  │
│  │ │ [shot] │  Txn 8823119471                                 │  │
│  │ │        │  Ref RUP-4821-K  ✓ matches                      │  │
│  │ └────────┘  Amount ✓ exact                                 │  │
│  │  tap to                                                    │  │
│  │  enlarge          [ ✓ Approve ]   [ ✗ Reject ]             │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ ┌────────┐  Sita Gurung · Double sharing                   │  │
│  │ │        │  Claims NPR 5,000 · Bank · 5 hrs ago            │  │
│  │ │ [shot] │  Txn NIC77120384                                │  │
│  │ │        │  Ref  ⚠️ not provided                            │  │
│  │ └────────┘  Amount ⚠️ partial — 7,000 will remain          │  │
│  │             [ ✓ Approve ]   [ ✗ Reject ]                   │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

Design notes:
- **Screenshot inline, not behind a click.** Image + amount + txn ID must be in
  one glance. One extra tap × 40 residents × 12 months is where software dies.
- **Green ticks and amber warnings do the triage.** The owner scans for amber, not
  reads rows.
- **`Approve all`** sweeps only all-green rows, and confirms with a count and
  total first: "Approve 9 payments totalling NPR 108,000?"
- Bed type replaces room number throughout — it is the identifying attribute the
  hostel actually thinks in.
- Rejection opens a reason picker (§6.3), never a free-text prompt dialog.

### 11.5 Owner — Tier 0.5 reconciliation

```
┌──────────────────────────────────────────────────────────────────┐
│  Reconcile · statement uploaded 6 Aug, 11:02                     │
│  esewa_statement_aug.csv · 84 transactions read                  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  ✅  38 matched            NPR 456,000    [ Approve all ]  │  │
│  │      Real transaction found. Amount and reference agree.   │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  ⚠️  2 claimed, no transaction found         NEEDS YOU     │  │
│  │                                                            │  │
│  │   Bishal Rai · Four sharing                                │  │
│  │   Claims NPR 12,000, txn 9910233 — not in your statement.  │  │
│  │   [ Reject ]  [ Approve anyway ]  [ Ask resident ]         │  │
│  │                                                            │  │
│  │   Anita Shrestha · Dormitory                               │  │
│  │   Claims NPR 8,000 — closest real txn is 800 on 4 Aug.     │  │
│  │   [ Reject ]  [ Approve anyway ]  [ Ask resident ]         │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  💰  1 payment nobody claimed                NEEDS YOU     │  │
│  │                                                            │  │
│  │   NPR 8,000 · 12 Aug · from "S. TAMANG" · txn 4471192      │  │
│  │   Remarks: (empty)                                         │  │
│  │                                                            │  │
│  │   Assign to:  [ search residents ▾ ]                       │  │
│  │   Suggested:  Suman Tamang (Dormitory, owes 8,000)  [ ✓ ]  │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

Design notes:
- **This is the screen that sells the product.** Three buckets; the owner touches
  two. Three residents out of forty-one. The whole month's finance work in ~90 seconds.
- The name suggestion on the orphan is high-value and must always be a
  *suggestion the owner confirms*, never an automatic match.
- **`Approve anyway` must exist.** Statements lag. Never trap the owner in a
  decision the data cannot resolve — but log who clicked it.
- `Ask resident` sends a templated in-app message requesting a clearer screenshot
  or the correct transaction ID.

### 11.6 Resident — Tier 1

```
┌────────────────────────────────────────────┐
│  August 2026                               │
│                                            │
│         NPR 12,000                         │
│         Triple sharing · Due 31 Aug        │
│                                            │
│      ┌──────────────────────┐              │
│      │  [ LIVE QR ·         │              │
│      │    amount included ] │              │
│      └──────────────────────┘              │
│                                            │
│      ⏱  Expires in 14:32                   │
│                                            │
│   Scan with any bank or wallet app.        │
│   Amount is already filled in.             │
│                                            │
│  ────────── or pay directly ──────────     │
│   [  eSewa  ]   [  Khalti  ]               │
│                                            │
│         ◌  Waiting for payment...          │
└────────────────────────────────────────────┘
```

Then, with no resident action:

```
┌────────────────────────────────────────────┐
│                  ✓                         │
│            Payment received                │
│              NPR 12,000                    │
│         Receipt RUP-2026-08-0042           │
│         [ Download receipt ]               │
│   August 2026 — fully paid                 │
└────────────────────────────────────────────┘
```

Design notes:
- The QR must be regenerable — an expired QR shows `[ Generate new QR ]`, not a
  dead end.
- The "waiting" state polls our own server, never the provider directly.
- No screenshot, no transaction ID, no form. The entire proof flow disappears, and
  residents notice this before owners do.

### 11.7 Owner — Tier 1

```
┌──────────────────────────────────────────────────────────────────┐
│  Payments · August 2026                    ✓ Fonepay connected   │
│                                                                  │
│  ┌──────────┬──────────┬──────────┬───────────────┐              │
│  │  Paid    │  Unpaid  │  Overdue │   Collected   │              │
│  │   38     │    9     │    3     │   ₨456,000    │              │
│  └──────────┴──────────┴──────────┴───────────────┘              │
│                                                                  │
│  Nothing to review. Payments confirm automatically.              │
│                                                                  │
│  ── LIVE ─────────────────────────────────────────────────────   │
│  11:02   Ram Bahadur Thapa   ₨12,000   ✓ confirmed               │
│  09:47   Sita Gurung          ₨5,000   ✓ confirmed  (partial)    │
│  Yesterday                                                       │
│  18:20   Kiran Magar         ₨12,000   ✓ confirmed               │
│                                                                  │
│  ── NEEDS ATTENTION ──────────────────────────────────────────   │
│  9 residents unpaid · 3 overdue         [ Send reminders ]       │
│                                                                  │
│  [ Record cash payment ]                                         │
└──────────────────────────────────────────────────────────────────┘
```

Design notes:
- **State "Nothing to review" explicitly.** The queue does not shrink, it vanishes
  — make that visible, because it is what Tier 1 is being paid for.
- Cash still needs a manual path. It is the one thing no gateway will confirm.
- If `gatewayLastEventAt` is stale, replace the green badge with an amber
  "Fonepay — no payments received in 6 days. [ Check connection ]".

### 11.8 Owner — payment setup (onboarding)

```
┌──────────────────────────────────────────────────────────────────┐
│  How residents pay you                                           │
│                                                                  │
│  ● Currently: Manual                                             │
│    Residents pay to your QR, then send you proof to approve.     │
│                                                                  │
│  ── YOUR PAYMENT DETAILS ─────────────────────────────────────   │
│  QR code image        [ upload ]     ✓ uploaded                  │
│  eSewa ID             [ 9841XXXXXX            ]                  │
│  Bank name            [ NIC Asia              ]                  │
│  Account name         [ Rupak Hostel Pvt Ltd  ]                  │
│  Account number       [ 01234567890           ]                  │
│  Extra instructions   [                       ]                  │
│                                                                  │
│  ── UPGRADE ──────────────────────────────────────────────────   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Confirm payments automatically                            │  │
│  │                                                            │  │
│  │  Connect a Fonepay merchant account and you'll never       │  │
│  │  approve a screenshot again. Money still goes straight     │  │
│  │  to your own bank account — we never hold it.              │  │
│  │                                                            │  │
│  │  You'll need: a registered business and a bank account     │  │
│  │  in the business name.                                     │  │
│  │                                                            │  │
│  │  [ I have merchant details ]   [ Help me set this up ]     │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

Design notes:
- **`Help me set this up` is a real support workflow, not a doc link.** In Nepal,
  walking a hostel owner through their bank's Fonepay merchant form is a genuine
  differentiator, and it converts Tier 0 hostels to Tier 1.
- State "we never hold it" explicitly. Owners are rightly suspicious of software
  that touches their money.
- Never present Tier 1 as required. The Tier 0 section above it must remain fully
  functional and unnagged.

### 11.9 Fee schedule editor

```
┌──────────────────────────────────────────────────────────────────┐
│  Fee schedule · effective from 1 Aug 2026                        │
│                                                                  │
│  Bed type                        Monthly rate                    │
│  ─────────────────────────────────────────────                   │
│  Single                          [ NPR 18,000 ]                  │
│  Double sharing                  [ NPR 14,000 ]                  │
│  Triple sharing                  [ NPR 12,000 ]                  │
│  Four sharing                    [ NPR 10,000 ]                  │
│  Dormitory                       [ NPR  8,000 ]                  │
│                                                                  │
│  Admission fee (one-time)        [ NPR  5,000 ]                  │
│  Security deposit (refundable)   [ NPR 10,000 ]                  │
│                                                                  │
│  ⚠️  Changing rates creates a new schedule from a date you       │
│     choose. Invoices already issued are not changed.             │
│                                                                  │
│  New rates effective from  [ 1 Sep 2026 ▾ ]                      │
│                                                                  │
│  [ Save as new schedule ]        [ View history ]                │
└──────────────────────────────────────────────────────────────────┘
```

The warning text is essential — owners will expect editing to be retroactive, and
must be told plainly that it is not.

---

## 12. Notifications

| Event | Resident | Owner |
|---|---|---|
| Invoice issued | In-app + email, includes reference code and amount | — |
| Reminder (N days before due) | In-app + email | — |
| Overdue | In-app + email, escalating per §10.3 | Digest, not per-resident |
| Claim submitted | Confirmation "we've received it" | In-app + email |
| Claim auto-rejected (dup) | Immediate, in the UI | — (never reaches them) |
| Payment settled | In-app + email + receipt | In-app (live feed at Tier 1) |
| Claim rejected by owner | In-app + email with the reason | — |
| Payment reversed | In-app + email, mandatory | — |
| Orphan payment ageing > 14d | — | In-app |
| Statement upload overdue | — | Persistent banner |
| Gateway silent > threshold | — | In-app, amber |
| Ledger drift found | — | Platform admin only |

Keep the existing `sendPaymentEmails` kill switch, but **fix its scope**: the
current implementation's early return sits above the in-app notification too, so
disabling email silently disables in-app as well (§5.2 step 4). In-app must always
fire.

---

## 13. Security fixes — prerequisites

These are live defects in the current system. They block everything above,
because the whole design increases the amount of financial evidence stored.

### 13.1 Cross-tenant file access (current §7.1) 🔴

The authorization check short-circuits when `fileAsset.hostelId` is absent, and
payment-proof assets never have one. Any authenticated user can read any other
resident's bank screenshot.

Fix, all three parts:
1. Populate `hostelId` on `FileAsset` at presign time. Required for any asset with
   a financial `kind`.
2. Rewrite the condition so a missing `hostelId` **denies** rather than allows.
   Default-deny, explicitly.
3. Backfill `hostelId` on existing payment-proof assets before deploying the
   stricter check, or they become unreadable.

### 13.2 Asset ownership never verified (current §7.2) 🔴

`proofImageAssetId` is stored as an unvalidated string. A resident can submit
another person's asset id.

Fix: on claim submission, load the `FileAsset` and assert `ownerId` equals the
submitting resident's user id, `hostelId` matches, `uploadCompletedAt` is set, and
the asset is not already referenced by another `PaymentEvent`.

### 13.3 Upload verification (current §7.10)

`mimeType` and `sizeBytes` are client-declared and never checked against the
stored object. Fix: after upload, verify the object exists, re-read its actual
content type and size, compute `contentHash`, and set `uploadCompletedAt`.
Presigns never followed by a PUT get swept by a cleanup job.

### 13.4 Capability split

`verifyPayments` is currently one flat capability covering eight operations,
granted to every new warden by default (§6.1). Split it:

| Capability | Covers | Default for warden |
|---|---|---|
| `viewPayments` | Read invoices, events, reports | Yes |
| `approvePayments` | Approve/reject resident claims | Yes |
| `recordCash` | Enter cash payments | Yes |
| `reversePayments` | Reversals, voids, write-offs | **No** |
| `manageFeeSchedule` | Create/close fee schedules | **No** |
| `managePaymentProfile` | Payment details, gateway credentials | **No** |

### 13.5 Audit

Current `PAYMENT_UPDATED` records only status, not amounts — the most dangerous
operation is the least audited (§6.3). Every finance action must log before/after
amounts. Consider a hash chain on finance audit entries; at minimum, restrict
delete/update on the audit collection at the database level.

---

## 14. Legal and compliance boundaries

**Not legal advice — confirm with Nepali counsel before launching Tier 1.**

### 14.1 The line not to cross

Collecting resident money into a platform-controlled account and disbursing to
hostel owners is payment aggregation. In Nepal that requires a Payment Service
Provider licence from Nepal Rastra Bank, with paid-up capital requirements in the
tens of millions of rupees, AML/KYC frameworks, suspicious activity reporting, and
segregation or escrow of client funds. That is a licensed fintech company, not a
feature of a hostel product.

**Therefore:** the platform never holds funds, never has a claim on resident
money, and never appears as a party to the payment. `HostelPaymentProfile` stores
the hostel's own merchant credentials; settlement goes to the hostel's own bank
account.

### 14.2 Revenue model constraint

Charge hostels a **subscription**, not a percentage of transaction volume. A cut
of payment volume drifts toward aggregation both legally and in appearance, and
complicates VAT treatment. This is a product constraint with a legal cause —
document it so it does not get "optimised" later.

### 14.3 Google Play

Hostel rent is a real-world service and is **exempt** from Google Play billing —
the same category as ride-hailing and food delivery. Resident payments through
eSewa/Khalti/Fonepay in the Android app incur no Play commission.

**However:** the platform's own subscription charged to hostel owners *is* a
digital service. If billed inside the Android app, Play billing rules apply. Keep
hostel subscription checkout on the web; the app reads subscription status only.

### 14.4 Data handling

Payment evidence contains bank account fragments, transaction IDs, and personal
names. Define a retention period, restrict access per §13, log every access to a
financial asset, and never compile resident financial data across hostels.

---

## 15. Build sequence

Ordered by dependency and risk. Do not reorder the first block.

### Block 0 — Security (blocks everything) 🔴
1. §13.1 cross-tenant file access
2. §13.2 asset ownership validation
3. §13.3 upload verification
4. §13.5 amount auditing on every finance write

### Block 1 — Foundations, no visible change
5. `BedType` enum in the shared package
6. `FeeSchedule` collection + resolver (§3.4) + proration (§3.5)
7. `HostelPaymentProfile` collection
8. Reference code generation and validation (§5)

### Block 2 — Ledger refactor
9. `Invoice` + `PaymentEvent` collections with all indexes from §4.1
10. Migration from `Payment` / `PaymentProof` with the dry-run invariant check (§4.3)
11. Single billing path `runBillingCycle` (§6.1); delete the other two
12. `Receipt` restructure, per-event, per-hostel numbering, PDF (§4.4)
13. Delete the unrestricted PATCH; add `recordCashPayment` and `reversePaymentEvent` (§9)

### Block 3 — Tier 0 complete
14. Payment profile setup UI (§11.8)
15. Fee schedule editor (§11.9)
16. Resident pay screen with QR + reference (§11.1)
17. Claim submission with instant duplicate rejection (§11.2, §11.3, §8)
18. Owner review queue with checks and Approve all (§11.4)

### Block 4 — Tier 0.5 — highest value per unit of effort
19. `StatementImport` + eSewa CSV parser
20. Matching ladder tiers B–E (§7)
21. Reconciliation screen, three buckets (§11.5)
22. Khalti and bank parsers

### Block 5 — Reliability
23. Ledger drift job + `ReconciliationRun` (§10.1)
24. Dunning rebuild — cursor batching, per-invoice stage tracking, escalation ladder, run history (§10.3)
25. Credit balance handling (§9.4)

### Block 6 — Tier 1
26. Fonepay dynamic QR: intent creation, webhook receiver, signature verification, independent re-verify (§6.5)
27. Expiry sweep + gateway health monitoring
28. Resident live QR screen (§11.6); owner live feed (§11.7)
29. Settlement report reconciliation (§10.2)
30. eSewa / Khalti direct integrations — only if hostels ask

### Block 7 — Deferred
31. Deposit lifecycle (§16.3)
32. Move-out settlement gate
33. Platform subscription billing

**If forced to ship something in two weeks:** Block 0, then items 7, 8, 16.
Security fixed, and residents finally know how to pay with a code that makes
everything downstream possible. That is a coherent release.

---

## 16. Open questions — need a product decision

### 16.1 Partial payments — allowed by default?
Currently any amount is accepted. Options: allow freely; allow above a floor
(e.g. 30% of invoice); require owner opt-in per hostel. Recommend: allow, with a
per-hostel toggle, because instalments are common in this market.

### 16.2 Who owns the reference code when a resident pays for two months at once?
A single payment covering July and August carries one reference. Options: allocate
oldest-invoice-first with the remainder to the next; or force one payment per
invoice. Recommend: oldest-first allocation, shown explicitly to both parties,
with the event linked to multiple invoices via allocation records.

### 16.3 Deposits
`DepositRecord` is dead code with a UI card ("Deposit Status: Tracked") backed by
nothing. Either build collect → hold → net-against-dues → refund at move-out, or
delete the model and the card. Leaving a fake metric on screen is worse than
either.

### 16.4 Notification-listener bridge — rejected, recorded here so it is not re-proposed
Reading eSewa/bank notifications from an Android listener was considered and
rejected as a *foundation*. Reasons: Play policy restricts
`NotificationListenerService` to apps whose core function is notification
handling; OEM battery managers kill background listeners silently, and silent
failure is the worst possible mode for rent tracking; many bank credit alerts are
SMS, not push; notification text is unstable and gets grouped or truncated; and
the sender-visible transaction ID often differs from the one in the receiver's
notification, so the join key is unreliable. Statement import (§6.4) achieves the
same goal with none of these failure modes.

If it is ever revisited, it may only produce Tier C suggestions — never
auto-settle — must allowlist package names, must sign events with a device key,
and must heartbeat with an alert on silence.

### 16.5 Multi-hostel owners
An owner with three hostels: one payment profile each, or shared? Recommend one
each — merchant accounts and bank accounts are per legal entity, and reference
code prefixes are per hostel.

### 16.6 Currency
`currency` is on the models as `"NPR"` throughout. No multi-currency requirement
is known. Keep the field, do not build conversion.

---

*Written 2026-08-06 as the target-state companion to `FINANCE_CURRENT_STATE.md`.
Section references prefixed "current §" point at that document; unprefixed
references point within this one.*
