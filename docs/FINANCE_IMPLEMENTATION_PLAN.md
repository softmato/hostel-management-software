# Finance & Payments — Implementation Plan

> **Third document in the finance set.**
>
> | Document | Answers |
> |---|---|
> | [`docs/FINANCE_CURRENT_STATE.md`](FINANCE_CURRENT_STATE.md) | What exists today, verified from code. |
> | [`finance_update.md`](../finance_update.md) (repo root) | What to build and why. Source of truth for behaviour and data shape. |
> | **This document** | How to build it *in this codebase*: file paths, sequencing, migrations, tests, rollback, and the deltas the target doc could not know about. |
>
> **This file is also the progress tracker.** §6 is a checklist. Each item is ticked
> `☐ → ☑` here, in place, only after its code is written *and* its acceptance
> statement is verified. See "How to work this plan" at the head of §6.
>
> Section references written `target §N` point at `finance_update.md`; `current §N`
> point at `FINANCE_CURRENT_STATE.md`; unprefixed `§N` are within this document.
>
> **One-line summary:** eight blocks, expand → migrate → contract, every block
> shippable on its own, no flag day, `Payment` stays readable until §6.4 proves
> the new ledger reconciles.

---

## 0. Reading order

0. §6's **completion status** table — what is already built, verified against the markers in this file. **Read first if you are picking this up mid-flight.**
1. §1 — Codebase deltas. Nine things the target doc assumes that are not true here. **Read first.**
2. §2 — Architecture decisions, with the rejected alternative for each.
3. §3 — Deviations from the target doc. All four decided; read the verdicts.
4. §4 — Module and file layout.
5. §5 — Cross-cutting conventions every block must follow. **§5.7 is the screen-vocabulary translation table, and it is Block 3's to-do list.**
6. §6 — Work breakdown, Block 0 → Block 7.
7. §7 — Migration strategy.
8. §8 — Test strategy and the invariants that must never break.
9. §9 — Cutover, rollback, observability.
10. §10 — Open decisions and effort summary.

---

## 1. Codebase deltas — what the target doc does not know

Nine findings from reading the current tree. Each one changes the plan, not just
the implementation.

### D1 🔴 `bedType` does not exist, and `roomType` is free text load-bearing across 15+ surfaces

Target §3.1 assumes a canonical `BedType` enum. Reality:

- [`Resident.roomType`](../packages/db/src/models/Resident.ts:15) is `{ type: String, required: true, trim: true }` — **free text**, whatever the owner typed.
- It is sourced from [`Hostel.roomConfigurations[].roomType`](../packages/db/src/models/Hostel.ts:46), also free text.
- [`hostel-capacity.service.ts`](../apps/web/src/modules/hostels/hostel-capacity.service.ts:118) does **string equality** on it in `claimBedForRoomType`, `releaseBedForRoomType`, `moveBedBetweenRoomTypes`. Occupancy accounting breaks if the string changes.
- A `RoomType` enum *does* exist in [`packages/shared/src/types/enums.ts:20`](../packages/shared/src/types/enums.ts:20) (`ONE_SEATER … DORMITORY`) and **nothing imports it**. It is decoration.
- ~15 UI files render `resident.roomType` directly as a label.

**Consequence:** "define the `BedType` enum once in the shared package" (target §3.1)
is not a finance-local task. It is a cross-module migration touching residents,
hostel capacity, listings, reports, and attendance.

**Plan:** §6.2 item 5 introduces `BedType` as a *derived, additive* field. `roomType`
remains the capacity key and the display string for the whole transition. Nothing
in `hostel-capacity.service.ts` is touched by this project.

### D2 🟠 A de-facto rate card already exists — `roomConfigurations[].monthlyRent`

`Hostel.roomConfigurations[]` already carries `{ roomType, monthlyRent, bedsPerRoom, rooms, vacantBeds }`,
and [`hostel-admin-fee-plans-page.tsx`](../apps/web/src/app/_components/hostel-admin-fee-plans-page.tsx:71)
already renders it as "Fee Plans". The target doc treats `FeeSchedule` as
greenfield and the fee-schedule editor (target §11.9) as a new screen.

**Plan:** `FeeSchedule` seeds its first row per hostel *from* `roomConfigurations`
(§7.3), and the editor **replaces** `hostel-admin-fee-plans-page.tsx` rather than
sitting beside it. One rate card, not two. `roomConfigurations[].monthlyRent`
stays as the **public listing price**; `FeeSchedule` becomes the **billing price**.
Their divergence is expected and must not be auto-synced.

### D3 🟠 The ledger blast radius is 8 services, not 1

Target §15 Block 2 says "delete the other two billing paths". It does not
enumerate who *reads* `Payment`. Verified:

| File | Reads | Must change in |
|---|---|---|
| [`payments/payment.service.ts`](../apps/web/src/modules/payments/payment.service.ts) | everything | Block 2 |
| [`payments/payment-reminders.service.ts`](../apps/web/src/modules/payments/payment-reminders.service.ts) | open payments | Block 5 |
| [`reports/report.service.ts`](../apps/web/src/modules/reports/report.service.ts:109) | `sumPayments`, `monthlyPaymentSeries`, `countByField`, platform roll-up | Block 2 |
| [`reports/report-export.service.ts`](../apps/web/src/modules/reports/report-export.service.ts:104) | `paymentVolume` CSV | Block 2 |
| [`reports/platform-directory.service.ts`](../apps/web/src/modules/reports/platform-directory.service.ts:132) | latest payment per resident | Block 2 |
| [`residents/resident-dashboard.service.ts`](../apps/web/src/modules/residents/resident-dashboard.service.ts:150) | last 6 payments | Block 2 |
| [`guardian/guardian.service.ts`](../apps/web/src/modules/guardian/guardian.service.ts:414) | payments + receipts, permission-gated | Block 2 |
| [`move-checklist/move-checklist.service.ts`](../apps/web/src/modules/move-checklist/move-checklist.service.ts:188) | `pendingFeeAmount` | Block 2 |

Plus 5 test files. **Plan:** §5.6 introduces a single read facade
(`finance/ledger-read.service.ts`) that all eight call. During the dual-read
window it answers from `Payment`; after cutover it answers from
`Invoice` + `InvoiceBalance`. Eight call sites change **once**, not twice.

### D4 🟠 No MongoDB transactions exist anywhere in the repo

`grep startSession|withTransaction` across `apps/` and `packages/` → **zero hits**.
The target design has multi-write sequences (settle → recompute balance → issue
receipt → notify) that the target doc does not say how to make atomic.

**Plan:** do **not** introduce transactions. ADR-4 (§2) chooses idempotent replay +
a reconciliation sweep, which is what the existing code already does well
(CAS loop, PENDING-claim `findOneAndUpdate`, unique-index referee — current §5.3)
and is the only approach that survives a standalone local MongoDB.

### D5 🟠 There is no secret store, and Tier 1 credentials are per hostel

Target §4.1 requires `gatewaySecretRef` to point at "whatever secret mechanism the
repo already uses" and notes that if none exists it is a prerequisite. Confirmed:
the repo uses **env vars only**. Env vars cannot hold per-hostel merchant secrets
for N hostels.

**Plan:** ADR-6 — envelope encryption. New `EncryptedSecret` collection, AES-256-GCM,
data key wrapped by a master key in `FINANCE_MASTER_KEY`. This is a **Block 6
prerequisite**, not a Block 1 one — Tier 0 and Tier 0.5 need no secrets at all.
Do not build it early.

### D6 🟡 Library gaps and library wins

| Need | Status |
|---|---|
| Content hash (SHA-256) | `node:crypto` — no dep |
| Perceptual hash | `sharp@0.35` already a dep — implement aHash/dHash on a 32×32 grayscale downscale. **No new dep.** |
| QR rendering | `qrcode@1.5.4` already a dep |
| Receipt PDF | **Missing.** Add `pdf-lib` (pure JS, no native build). Precedent for canvas rendering exists in `renderIdCardPng`, but a receipt needs selectable text. |
| CSV parsing | **Missing.** Add `papaparse`. A CSV *writer* with formula-injection neutralisation already exists in `report-export.service.ts` — reuse its `neutralize()` posture on the way out, not in. |
| PDF statement parsing | Deferred to Block 4b, best-effort, manual-correction path (target §6.4). |

### D7 🟡 Splitting `verifyPayments` needs a data migration

[`warden.validation.ts:16`](../apps/web/src/modules/wardens/warden.validation.ts:16) stores
permissions as an **array of enabled keys** on `HostelMember.permissions`, with a
comment saying a new capability costs an entry here "rather than a migration
across every row". True for *adding*. Splitting one key into six requires
rewriting every existing row, or every warden silently loses payment access on
deploy.

**Plan:** §7.5 — migrate `verifyPayments` → `["viewPayments","approvePayments","recordCash"]`
per target §13.4's warden defaults. `reversePayments`, `manageFeeSchedule`,
`managePaymentProfile` go to nobody; the hostel owner gets them by role, not by
grant. Keep `verifyPayments` accepted as a deprecated alias for one release.

### D8 🟡 Realtime already exists — do not poll

Target §11.6 specifies the Tier 1 waiting screen "polls our own server".
[`payment.service.ts:27-28`](../apps/web/src/modules/payments/payment.service.ts:27)
already imports `REALTIME_TOPIC` and `publishResourceChange`; Pusher is wired
platform-wide. **Plan:** publish on settlement, subscribe on the pay screen, and
keep a 10-second poll only as the fallback if the socket has not connected.

### D9 🟢 Shared enum drift is real and in scope

[`enums.ts:42`](../packages/shared/src/types/enums.ts:42) `PaymentStatus` lacks
`PENDING_PROOF`; `ProofVerificationStatus` says `VERIFIED` where Mongoose says
`APPROVED`. Nothing imports them, which is why nobody noticed. Block 2 deletes
`PaymentStatus` / `ProofVerificationStatus` / `PaymentMethod` from shared and
replaces them with the new finance enums, exported and actually imported.

---

## 2. Architecture decisions

Each decision states the choice, the reason, and the alternative that was rejected.

**ADR-1 — Money is whole NPR rupees, stored as `Number`, enforced integer.** ☑ *decided 2026-08-06*
All finance collections store `amount: Number` in rupees (`1500` = NPR 1,500) plus
`currency: "NPR"`, exactly as target §4.1 specifies. The integrity property that
minor units would have bought is obtained instead by **enforcing integrality**:
every amount is validated with `Number.isInteger` at the schema layer, and every
arithmetic path goes through `money.ts` (`roundToRupee`, `sumAmounts`, `prorate`,
`formatNPR`). Integers below 2^53 are exactly representable, so summing an event log
of whole rupees is exact and `LEDGER_DRIFT` can never fire on rounding noise.
*Why:* the product prices, displays, and issues receipts in whole rupees; paisa
would exist only in the database and every read would need a conversion.
*Rejected:* integer paisa (`amountMinor`) — buys nothing once integrality is
enforced, and costs a conversion at every boundary.
**The load-bearing rule: no code path may write a fractional amount.** Proration
rounds to the nearest rupee *before* storage (target §3.5), never after. A schema
validator rejecting non-integers is what makes this rule real rather than a
convention.

**ADR-2 — Append-only event log, no stored mutable balance in the write path.**
`PaymentEvent` is the only writer of money. `InvoiceBalance` is a projection,
rebuilt by the reconciliation job, never trusted over the event sum. Enforced by a
Mongoose `pre('save')` / `pre('findOneAndUpdate')` guard that throws
`SETTLED_EVENT_IMMUTABLE` when a settled document's financial fields change.
*Rejected:* service-layer-only enforcement — one forgotten `updateOne` in a future
feature defeats it.

**ADR-3 — One canonical read facade for the ledger.**
`finance/ledger-read.service.ts` is the only module the other eight services import.
Per D3. *Rejected:* letting each consumer query `Invoice` directly — it makes the
dual-read window an eight-way rewrite twice.

**ADR-4 — Idempotent replay instead of transactions.**
Every write path is keyed by `idempotencyKey` (unique index) and safe to re-run.
Multi-step sequences are ordered so a crash leaves a *detectable* half-state, and
the nightly `LEDGER_DRIFT` job (target §10.1) finds and reports it. Order is always:
`append event (unique-key claim)` → `recompute balance` → `issue receipt` →
`notify`. *Why:* per D4 the repo has no transaction usage and local dev may be a
standalone mongod. *Rejected:* `withTransaction` — would work on Atlas, breaks
`npm run dev` for anyone on a standalone instance, and adds a failure mode the team
has no experience debugging.

**ADR-5 — Every ingested credit becomes a `PaymentEvent`, including unmatched ones.**
Statement rows do not get their own collection. A CSV credit row with no match is a
`PaymentEvent { source: STATEMENT_IMPORT, status: PENDING, invoiceId: null }` —
which is exactly target §7 Tier D "orphan money", already modelled. *Why:* it makes
"unmatched money is a first-class state" (target P5) true in the schema, and makes
`{hostelId, provider, providerTxnId}` unique the single dedup mechanism for
re-uploaded overlapping statements. *Rejected:* a `StatementRow` collection —
duplicate dedup logic, two places to look for the same rupee.

**ADR-6 — Envelope encryption for per-hostel gateway secrets, Block 6 only.**
`EncryptedSecret { hostelId, purpose, ciphertext, iv, authTag, keyVersion }`,
AES-256-GCM, master key from `FINANCE_MASTER_KEY`. `HostelPaymentProfile` stores
only `gatewaySecretRef` (the `EncryptedSecret._id`). Rotation = new row, new
`keyVersion`. *Rejected:* an encrypted field on the profile document — a profile
read for the payment screen would pull ciphertext into every resident request.

**ADR-7 — Reference code check character is validated before any auto-settle.**
`{HOSTEL}-{SEQ}-{CHECK}`, Crockford base32 (target §5.1). The generator, the parser,
and the validator live in one pure module with no I/O so they are exhaustively
testable. Nothing in the matching ladder may treat a code as matched without
`isValidReferenceCode()` returning true. *Rejected:* database-lookup validation —
statement parsing must reject typos without N queries per row.

**ADR-8 — Expand / migrate / contract, with a dual-read window.**
`Payment` and `PaymentProof` are **not** dropped when `Invoice`/`PaymentEvent` ship.
Three phases: write to both (expand), verify the invariant per hostel (migrate),
delete the old models and their code (contract, Block 2 exit gate). *Rejected:*
big-bang cutover — the invariant `sum(old paidAmount) == sum(new settled events)`
can only be checked against live data, and if it fails you need the old data still
there.

---

## 3. Deviations from the target doc — all decided

`finance_update.md` declares itself the source of truth for data shape. These four
points needed a ruling. **All four are settled; no item below blocks any block.**

### 3.1 Money representation ☑ *decided: keep whole NPR rupees, as the target doc specifies*
The integer-paisa proposal is **withdrawn**. Amounts stay `Number` in rupees —
`1500` means NPR 1,500 — and the safety it would have bought comes from enforcing
integrality instead (ADR-1). This is the better answer, not a compromise: whole
rupees are exactly representable, so the event log sums without drift, and the
database now reads the same way the receipts do.
**Consequence for every block:** a schema-level `Number.isInteger` validator on
every amount field, and rounding at the point of computation rather than display.

### 3.2 `BedType` is additive and derived; `roomType` stays the capacity key ☑ *accepted*
Per D1. Target §4.2 says "Add `bedType` (required) if not already present" and §11.4
says "Bed type replaces room number throughout". Scope narrowed: `bedType` is
required on `Invoice`/`FeeSchedule` and *displayed* in finance UI, but
`Resident.roomType` remains authoritative for occupancy and for every non-finance
screen. Making `bedType` the universal identity is a separate project.

### 3.3 No `StatementRow`; unmatched credits are `PaymentEvent` rows ☑ *accepted*
Per ADR-5. Consistent with target §7 Tier D.

### 3.4 The fee-schedule editor replaces the existing Fee Plans page ☑ *decided: replace*
Per D2. `hostel-admin-fee-plans-page.tsx` is removed in item 3.2 and its route now
renders the fee-schedule editor. `roomConfigurations[].monthlyRent` survives as the
**public listing price** only. Two rate cards on two screens is how a hostel bills
the wrong amount.

---

## 4. Module and file layout

Following the repo convention (`modules/<name>/<name>.service.ts`,
`<name>.validation.ts`, `<name>.test.ts` colocated).

### 4.1 New models — `packages/db/src/models/`

```
FeeSchedule.ts            target §3.3
HostelPaymentProfile.ts   target §4.1
Invoice.ts                target §4.1
PaymentEvent.ts           target §4.1  ← the immutable money log
InvoiceBalance.ts         target §4.1  (projection)
CreditBalance.ts          target §9.4
ReceiptCounter.ts         atomic per-hostel-per-period sequence (target §4.4)
StatementImport.ts        target §4.1
ReconciliationRun.ts      target §4.1
EncryptedSecret.ts        ADR-6, Block 6 only
```

Modified: `Receipt.ts` (restructure), `Resident.ts` (`monthlyFee` nullable +
override fields, `bedType`), `FileAsset.ts` (`hostelId`, `uploadCompletedAt`,
`contentHash`, `perceptualHash`), `Hostel.ts` (`referencePrefix`).

Deleted at Block 2 contract: `Payment.ts`, `PaymentProof.ts`. Deleted or
implemented at Block 7: `DepositRecord.ts` (target §16.3).

### 4.2 New module — `apps/web/src/modules/finance/`

```
finance.errors.ts              FinanceServiceError + the error-code table (§5.1)
money.ts                       whole-rupee helpers, ADR-1               + money.test.ts
reference-code.ts              generate / parse / validate              + reference-code.test.ts
bed-type.ts                    mapping from roomType strings            + bed-type.test.ts
ledger-read.service.ts         ADR-3 read facade
fee-schedule.service.ts        CRUD, resolveMonthlyCharge, proration    + fee-schedule.test.ts
fee-schedule.validation.ts
payment-profile.service.ts     target §4.1 / §11.8
payment-profile.validation.ts
billing.service.ts             runBillingCycle — the one billing path   + billing.test.ts
invoice.service.ts             reads, status derivation, void/reissue
payment-event.service.ts       append, settle, reverse, immutability    + payment-event.test.ts
claim.service.ts               resident claim + instant fraud rejection + claim.test.ts
cash.service.ts                recordCashPayment + maker-checker
receipt.service.ts             numbering, issue, void                   + receipt.test.ts
receipt-pdf.ts                 pdf-lib renderer
evidence.ts                    content hash + perceptual hash (sharp)   + evidence.test.ts
matching/
  ladder.service.ts            tiers A–E                                + ladder.test.ts
  scoring.ts                   Tier C confidence + human explanation
statements/
  statement-import.service.ts
  parsers/registry.ts          provider → parser, versioned
  parsers/esewa-csv.ts                                                  + esewa-csv.test.ts
  parsers/khalti-csv.ts
  parsers/bank-csv.ts
gateway/
  provider.types.ts            the interface every provider implements
  fonepay.provider.ts
  webhook.service.ts           signature verify + independent re-verify
  secret-store.ts              ADR-6
reconciliation/
  ledger-drift.service.ts      target §10.1
  gateway-health.service.ts    target §6.5
  settlement-recon.service.ts  target §10.2
  dunning.service.ts           target §10.3 — replaces payment-reminders.service.ts
  run-recorder.ts              writes ReconciliationRun. Every job uses it.
finance.validation.ts          shared zod primitives for the module
```

### 4.3 API routes — `apps/web/src/app/api/v1/`

```
hostel-admin/finance/
  payment-profile/route.ts                 GET · PATCH        managePaymentProfile
  fee-schedules/route.ts                   GET · POST         manageFeeSchedule
  fee-schedules/[id]/close/route.ts        POST               manageFeeSchedule
  billing-runs/route.ts                    GET · POST         manageFeeSchedule
  invoices/route.ts                        GET                viewPayments
  invoices/[id]/route.ts                   GET                viewPayments
  invoices/[id]/void/route.ts              POST               reversePayments
  invoices/[id]/cash/route.ts              POST               recordCash
  events/route.ts                          GET (review queue) viewPayments
  events/[id]/approve/route.ts             POST               approvePayments
  events/[id]/reject/route.ts              POST               approvePayments
  events/[id]/reverse/route.ts             POST               reversePayments
  events/[id]/assign/route.ts              POST (orphan)      approvePayments
  events/bulk-approve/route.ts             POST               approvePayments
  statements/route.ts                      GET · POST         approvePayments
  statements/[id]/route.ts                 GET (3 buckets)    approvePayments
  receipts/[id]/pdf/route.ts               GET                viewPayments
resident/finance/
  invoices/route.ts                        GET
  invoices/[id]/pay-instructions/route.ts  GET (tier-aware)
  invoices/[id]/claims/route.ts            POST
  invoices/[id]/intent/route.ts            POST (Tier 1)
  receipts/[id]/pdf/route.ts               GET
webhooks/payments/[provider]/route.ts      POST — no principal, signature only
cron/
  billing-cycle/route.ts                   new
  payment-reminders/route.ts               rebuilt in place
  ledger-drift/route.ts                    new
  gateway-expiry-sweep/route.ts            new, Block 6
  gateway-settlement-recon/route.ts        new, Block 6
```

`hostel-admin/payments/*` and `resident/payments/*` stay live and unchanged until
the Block 2 contract step, then return `410 Gone` for one release with
`{ errorCode: "ENDPOINT_MOVED", detail: "<new path>" }` before deletion.

### 4.4 Migration scripts — `apps/web/scripts/`

Following the existing `.mjs` + npm-script convention (`migrate:rooms-to-counts`).
Every one takes `--dry-run` and prints a per-hostel before/after table.

```
backfill-fileasset-hostel.mjs            Block 0 · web:backfill:fileasset-hostel
backfill-fileasset-hashes.mjs            Block 0 · web:backfill:fileasset-hashes
backfill-hostel-reference-prefix.mjs     Block 1 · web:backfill:reference-prefix
seed-fee-schedules.mjs                   Block 1 · web:seed:fee-schedules      (from roomConfigurations, D2)
migrate-finance-ledger.mjs               Block 2 · web:migrate:finance-ledger  (target §4.3)
verify-finance-ledger.mjs                Block 2 · web:verify:finance-ledger   (invariant only, read-only, safe in prod)
migrate-warden-payment-capabilities.mjs  Block 0 · web:migrate:payment-caps    (D7)
```

---

## 5. Cross-cutting conventions

Every block follows these. They are the difference between a coherent module and
eleven services that each invented their own answer.

### 5.1 Error codes

Extend the existing `PaymentServiceError` pattern (message, `errorCode`, `status`)
as `FinanceServiceError`. Codes are SCREAMING_SNAKE and stable — the mobile app and
the resident UI branch on them.

| Code | HTTP | Raised when |
|---|---|---|
| `FEE_SCHEDULE_MISSING` | 422 | No schedule covers the billing period (target §3.4) |
| `BED_TYPE_NOT_PRICED` | 422 | Schedule has no rate for the resident's bed type |
| `INVOICE_ALREADY_BILLED` | 409 | Non-void invoice exists for the period |
| `REFERENCE_CODE_INVALID` | 422 | Check character fails |
| `EVIDENCE_ALREADY_USED` | 409 | `evidenceHash` collides within the hostel (target §8.1) |
| `TXN_ID_ALREADY_USED` | 409 | `{hostelId, provider, providerTxnId}` collides |
| `ASSET_NOT_OWNED` | 403 | `FileAsset.ownerId` ≠ submitting resident (target §13.2) |
| `ASSET_UPLOAD_INCOMPLETE` | 422 | `uploadCompletedAt` unset |
| `AMOUNT_OUT_OF_BOUNDS` | 422 | ≤ 0, or > outstanding × 1.5 (target §6.2 step 5d) |
| `SETTLED_EVENT_IMMUTABLE` | 500 | A settled event's financial field was written. **Never user-facing — it is a bug.** |
| `SECOND_APPROVER_REQUIRED` | 409 | Cash above threshold, one approver only (target §9.1) |
| `HOSTEL_SCOPE_REQUIRED` | 422 | Existing code, reused unchanged |

### 5.2 Idempotency key format

`idempotencyKey` is unique platform-wide — the single most important index in the
system (target §4.1). Deterministic, never random:

```
gateway:{provider}:{providerTxnId}
statement:{statementImportId}:{provider}:{providerTxnId}
claim:{residentId}:{invoiceId}:{contentHash}
cash:{hostelId}:{cashReceiptNumber}
intent:{invoiceId}:{attemptNumber}
reversal:{originalEventId}
migration:{legacyPaymentId}
```

A retried webhook, a re-uploaded overlapping statement, and a double-tapped
submit all collapse to a no-op by construction, not by a check.

### 5.3 Audit envelope

Every finance write calls one helper, `auditFinanceAction`, which **requires**
before/after amounts — fixing current §6.3 where `PAYMENT_UPDATED` logged only
status. Metadata shape is fixed:

```ts
{ amountBefore, amountAfter, currency, invoiceId, eventId,
  reason?, actorRole, source }
```

Add to `AuditLog`: `financeIntegrity` — SHA-256 over
`(previousEntryHash, action, entityId, amountAfter, createdAt)`, giving a hash
chain over finance entries only. Cheap, and it makes silent audit tampering
detectable. A `LEDGER_DRIFT` finding is raised if the chain breaks.

### 5.4 `ReconciliationRun` for every job

Target §4.1: "Every scheduled job writes one of these. Every job. No exceptions."
Enforced by making `reconciliation/run-recorder.ts` the only way a cron handler
returns — `withRun(kind, hostelId, fn)` opens the row, runs, records counters and
findings, closes it, and records `FAIL` on throw.

### 5.5 Realtime and notifications

Reuse `publishResourceChange` + `REALTIME_TOPIC` (D8). Fix the `sendPaymentEmails`
scope bug (target §12): in-app notification always fires; the kill switch gates
only `sendNotificationEmail`. This is a two-line fix in Block 0 — do it early, it
is currently masking every in-app finance notification when email is off.

### 5.6 The read facade

```ts
// modules/finance/ledger-read.service.ts
listResidentInvoices(residentId, hostelId)
outstandingForResident(residentId, hostelId)        // move-checklist
hostelCollectionTotals(hostelId, period?)           // reports
monthlySeries(hostelIds, periods)                   // reports charts
platformRollup()                                    // platform screens
latestInvoicePerResident(residentIds)               // platform directory
```

Backed by a `FINANCE_LEDGER_SOURCE` env flag: `legacy` | `dual` | `ledger`.
`dual` computes both and logs a `LEDGER_DRIFT` finding on disagreement without
failing the request. That flag is the entire cutover mechanism (§9).
**Removed in 2.8** — with `Payment` deleted there is no second source to select,
and a flag that can only take one value is a lie about what is configurable.

### 5.7 Screen vocabulary — the complete translation table

**Status: in force. Still in force after Block 3 — see below.**

Block 3 shipped without clearing this, deliberately. The translation is not
per-screen: the same two maps serve the report, guardian, dashboard and export
services as well as the payments screens, so renaming for one caller leaves the
facade half-translating. The rename is one pass across the facade and all seven
consumers, taken together, and it is the next piece of work after Block 3.

The models and the screens use different words for the same things. The facade
translates on the way out, which is what let Block 2 replace every model without
rewriting every consumer on the same day. This table is the full list — it is
the Block 3 to-do list, and it should reach zero rows.

**This boundary is invisible to the compiler.** A route's response type is a
caller-side generic, so a service returning `period` where the screen reads
`month` type-checks perfectly and renders a blank cell. That happened twice
during 2.8 (the matrix row shape, and `month` itself), and both were caught by
reading the render code. `invoice-list.test.ts` now pins every field name below.

#### 5.7.1 Invoice status → what the screens display

`legacyStatusFor()` in `ledger-read.service.ts`.

| `Invoice.status` | Screens show | Note |
|---|---|---|
| `DRAFT` | `UNPAID` | Nothing issues drafts yet |
| `OPEN` | `UNPAID` | |
| `PARTIAL` | `PARTIAL` | |
| `OVERDUE` | `OVERDUE` | Outranks `PARTIAL` — a half-paid invoice past its due date is the one to chase (2.2) |
| `PAID` | `PAID` | |
| `WRITTEN_OFF` | `WRITTEN_OFF` | Passes through; no alias, because one would overstate the debt or understate the loss |
| `VOID` | *(never appears)* | Filtered out of every read — a cancelled obligation is not a smaller one |
| — | `PENDING_PROOF` | **Derived, not stored.** An `OPEN`/`PARTIAL` invoice with a `PENDING` `CREDIT` event. Reconstructed by a third `$lookup`; never masks `PAID` or `OVERDUE` |
| — | `NOT_BILLED` | **Matrix only.** A billable resident with no invoice for the period. Was impossible before 2.5, because rendering the screen created the invoice |

#### 5.7.2 Provider → payment method

`LEGACY_METHOD_BY_PROVIDER` in `ledger-read.service.ts`; `METHOD_BY_PROVIDER` in
`review.service.ts`. The only genuine rename is `BANK`.

| `PaymentEvent.provider` | Screens show |
|---|---|
| `BANK` | `BANK_TRANSFER` |
| `CASH`, `ESEWA`, `KHALTI`, `FONEPAY` | unchanged |
| `NONE` | `undefined` on an invoice; `OTHER` in the review queue; `UNKNOWN` in a method count |

#### 5.7.3 Field names

`LedgerInvoice` → `PortalInvoice` (`toPortalInvoice()` in
`invoice-list.service.ts`). The older consumers — `report.service`,
`guardian.service`, `resident-dashboard.service`, `report-export.service` — each
do the `period → month` rename in their own serializer.

| Model | Facade | Screens | Note |
|---|---|---|---|
| `Invoice.totalAmount` | `dueAmount` | `dueAmount` | |
| `InvoiceBalance.settledAmount` | `paidAmount` | `paidAmount` | **Derived**, never a stored column — the point of the whole overhaul |
| `Invoice.period` | `period` | **`month`** | The rename that renders blank cells if missed |
| latest settled event's `settledAt` | `paidDate` | `paidDate` | Property of a payment, not of an invoice |
| latest settled event's `provider` | `method` | `method` | As above |
| `Invoice._id` | `id` | `id` | |

#### 5.7.4 Claim status → what the review queue displays

| `PaymentEvent.status` | Screens show | Note |
|---|---|---|
| `PENDING` | "Awaiting review" | |
| `SETTLED` | "Approved" | The old `PaymentProof` said `APPROVED` |
| `REJECTED` | "Rejected" | |

The claim row itself carries `eventId`, `invoiceId` and `evidenceAssetId` where
the old proof had `id`, `paymentId` and `proofImageAssetId`.

#### 5.7.5 Response shapes the screens depend on

| Endpoint | Key | Shape |
|---|---|---|
| `GET resident/finance/invoices` | `invoices`, `claims` | `PortalInvoice[]`, claim rows |
| `GET hostel-admin/finance/invoices` | `month`, `rows`, `totals` | Row is `{ displayStatus, payment, resident }` — **not** `{ invoice, residentId }` |
| | `rows[].resident` | `{ id, fullName, phone, moveInDate, roomNumber }`. `moveInDate` is an **ISO string**: the screen calls `.startsWith(month)` on it to flag a pro-rated month |
| | `totals` | `{ due, collected, paid, partial, unpaid, overdue, notBilled }` |
| `GET hostel-admin/finance/events` | `events` | Claim rows |

#### 5.7.6 Type declarations carrying the old vocabulary

`resident-shared.tsx` and `hostel-admin-shared.tsx` still export `Payment` and
`PaymentProof` **as type names only** — the models are gone. Renaming them is a
Block 3 change, made together with the screen that uses them.

---

## 6. Work breakdown

### Completion status — 33 of 39 items, verified 2026-08-09

Counted from the `☑`/`☐` markers in this file, not estimated. A `☑` is a claim
that the item's acceptance statement was **observed** to be true.

| Block | Items | Done | State |
|---|---|---|---|
| 0 — Security | 0.1–0.6 | **6 / 6** | ☑ Complete |
| 1 — Foundations | 1.1–1.5 | **5 / 5** | ☑ Complete |
| 2 — Ledger refactor | 2.1–2.8 | **8 / 8** | ☑ Complete, contract included |
| 3 — Tier 0 screens | 3.1–3.5 | **5 / 5** | ☑ Complete — §5.7 vocabulary outstanding |
| 4 — Tier 0.5 reconciliation | 4.1–4.5 | **5 / 5** | ☑ Complete — PDF parsing deferred to 4b |
| 5 — Reliability | 5.1–5.3 | **3 / 3** | ☑ Complete |
| 6 — Tier 1 gateway | 6.0–6.8 | **2 / 9** | ☐ 6.0, 6.1 done; reordered so eSewa and Khalti ship first — only 6.8 (Fonepay) waits on merchant credentials |
| 7 — Deferred | — | — | Not scheduled |
| **Total** | | **34 / 41** | |

**Where the codebase stands.** 1166 tests (from 440 at the start of Block 0);
typecheck and lint clean across `apps/web`, `packages/db` and `packages/shared`;
`next build` passes. `Payment`, `PaymentProof`, `payment.service.ts`,
`payment.validation.ts` and `payment-reminders.service.ts` no longer exist —
finance is entirely in `apps/web/src/modules/finance/`.

**What works end to end today.** Billing (schedule-driven, prorated both ways,
monthly cron), resident claims with evidence, the owner review queue,
approve/reject, cash with maker-checker, reversals with receipt-voiding and
resident notification, invoice voiding, immutable per-event receipts, receipt and
statement PDFs, dunning, and every report and export — all on the new ledger.
Since Block 3, also: the owner configures how the hostel is paid and its rate
card, and the resident is told how to pay a specific invoice — reference code,
QR, wallet IDs, bank account — with duplicate screenshots rejected before they
reach anyone and the review queue carrying its own checks and a guarded
`Approve all`. Since Block 4, also: the owner uploads their own eSewa, Khalti or
bank statement and reconciles the month against what actually arrived —
reference-matched credits settle themselves, claims with no matching transaction
and money nobody claimed reach the owner as two short lists, and the dashboard
nudges when a statement is overdue.

Since Block 5: the ledger checks itself nightly and reports rather than repairs,
dunning terminates instead of chasing forever, and an overpayment becomes credit
against next month rather than vanishing.

**5.1's prerequisites arrived early.** `ReconciliationRun` and
`reconciliation/run-recorder.ts` (`withRun`) were built in 4.2 because target
§6.4 step 7 requires a run row per import. 5.1 wrote its drift findings through
the existing recorder rather than building one.

**Carried out of order, and why (2).** 5.2's `.limit(500)` fix landed in 2.8
because `Payment` was being deleted underneath the job; the other three defects
were fixed in 5.2 proper.

**The only thing blocking the rest of the project is a bank request.** Ask
whichever bank holds the hostel's merchant account to enable Fonepay online /
dynamic-QR acceptance and issue the **dev** merchant code and signing secret.
Those go into `FONEPAY_SANDBOX_MERCHANT_CODE` and `FONEPAY_SANDBOX_SECRET`
(`docs/ENVIRONMENT.md`) and 6.1 starts with nothing to retrofit — that is what
6.0 bought.

**One new cron job needs scheduling before this ships:**
`POST /api/v1/cron/ledger-drift`, nightly — see `docs/CRON.md`.
`payment-reminders` was rebuilt in place and keeps its existing schedule. Neither
the drift job nor the rebuilt dunning job has run against real data.

**Carried out of order, and why.** 5.2's `.limit(500)` fix landed early: it was a
silent platform-wide cap on dunning, and `Payment` was being deleted underneath
the job in 2.8. The rest of 5.2 (its own suite, the 900th-resident case) is open.

**Debt this leaves, tracked in §5.7 — and Block 3 did not clear it.** Block 3's
five items are done, but every one of them *added* a screen rather than renaming
an existing one, and the vocabulary rename turned out not to be a per-screen
change at all: `legacyStatusFor` and `LEGACY_METHOD_BY_PROVIDER` also serve
`report.service`, `guardian.service`, `resident-dashboard.service` and
`report-export.service`, which are not Block 3 screens. Renaming for the payments
pages alone would leave the facade translating for some callers and not others,
which is worse than translating for all of them. **§5.7 therefore stands, and
clearing it is one deliberate pass across the facade and its seven consumers
together** — not five partial ones. It was scheduled ahead of Block 4 and did
not happen; Block 4 added no new legacy vocabulary, so it is unchanged in size.
§5.7 still lists exactly what has to change.

**Not deployed.** Nothing here has run in production, so 2.8's seven-day `dual`
gate was waived on the owner's instruction rather than skipped. The dev database
was migrated and verified (Δ = 0 for every hostel).

---

Block order follows target §15 and must not be reordered within Block 0–2. Each
item lists **files**, **acceptance**, and **tests**.

### How to work this plan

**One item at a time, in order. Finish it, verify it, tick it, move on.**

For each numbered item:

1. Read the item, plus the `target §N` / `current §N` sections it cites.
2. Write the code and the tests named in the item.
3. Verify: `npm run web:test` passes, `npm run web:typecheck` passes, `npm run web:lint` passes, and the item's **acceptance** statement is actually true — checked by running it, not by reading the diff.
4. **Edit this file**: change the item's `☐` to `☑`. If it landed partially, use `◐` and write one line under the item saying exactly what is left. Same marker convention as [PHASES.md](PHASES.md).
5. Only then start the next item.

Rules that hold across every item:

- **Never tick an item you have not verified.** A `☑` here is a claim that the acceptance statement was observed to be true.
- **Never skip ahead past a `Verify before continuing` gate.** Those gates exist because the step after them is expensive or irreversible.
- If an item turns out to be wrong or impossible as written, stop and say so in the item rather than improvising a different design — the three finance docs have to stay in agreement.
- Do not batch several items into one sweep of edits. The verification in step 3 is per item, and a failure in a batch is untraceable.

---

### Block 0 — Security (blocks everything) 🔴 · ~3–4 days

These are live defects. Any authenticated user can currently read any resident's
bank screenshot.

**☑ 0.1 — Default-deny on private file access** (target §13.1, current §7.1)
*Files:* `api/v1/files/[assetId]/url/route.ts`, `api/v1/files/presign/route.ts`, `lib/file-asset-kinds.ts`, `lib/uploads/{transport,uploader}.ts`, `scripts/backfill-fileasset-hostel.mjs`
Three parts, in order: (a) presign accepts and stores `hostelId`, required when
`kind` is financial; (b) backfill `hostelId` on existing proof assets from
`PaymentProof.hostelId`; (c) **then** rewrite the condition so a missing `hostelId`
denies. Order matters — flipping the check first makes existing proofs unreadable.
*Acceptance:* a principal from hostel A gets 403 on an asset owned by a resident of
hostel B, whether or not `hostelId` is set.
*Tests:* new `file-access.test.ts` — owner allowed; same-hostel staff allowed;
other-hostel staff denied; **`hostelId` absent → denied**; SUPERADMIN allowed.

*Landed 2026-08-06.* `FileAsset.hostelId` already existed on the schema, so no
model change was needed. Presign takes a new `kind` (`PAYMENT_PROOF`,
`PAYMENT_QR`, `STATEMENT`, `GENERIC` — `lib/file-asset-kinds.ts`) and resolves
the hostel from an explicit `hostelId` the caller can reach, else the caller's
sole hostel; a financial kind with no resolvable hostel is `HOSTEL_SCOPE_REQUIRED`
(422). Two deltas from the item as written, both widening its blast radius
deliberately: the read check allows **all** `PLATFORM_ROLES`, not only
SUPERADMIN, because PLATFORM_MODERATOR reviews hostel registration documents
through the same route; and the backfill has a second pass labelling *any*
unlabelled asset from a sole-hostel owner, because default-deny applies to every
private asset, not only proofs — complaint and food photos would otherwise have
gone dark. 12 tests in `src/app/api/v1/files/file-access.test.ts` (route-level,
mocked principal/model/R2 — the authorization lives in the handler, so there is
no service layer to test instead). Backfill run against the dev database:
63 unlabelled → 34, all 34 either PUBLIC (never reaches the check) or
platform-owned registration documents.

**☑ 0.2 — Asset ownership verified at claim submission** (target §13.2, current §7.2)
*Files:* `payments/payment.service.ts` (`submitPaymentProof`)
Load the `FileAsset`; assert `ownerId === resident.userId`, `hostelId` matches,
`uploadCompletedAt` set, and no other proof references it. Applied to the *existing*
proof path now, and inherited by `claim.service.ts` in Block 3.
*Tests:* submitting another resident's `assetId` → `ASSET_NOT_OWNED`; reusing an
asset already on a proof → `EVIDENCE_ALREADY_USED`.

Was ◐ while the `uploadCompletedAt` assertion waited on 0.3 to start writing that
field — enforcing it before then would have rejected every payment proof in
production. Closed by 0.3, which added it to `assertProofAssetUsable`.

*Landed 2026-08-06.* Ownership, hostel match, and single-use are enforced in
`assertProofAssetUsable`, called before the `PaymentProof` row is created. A
missing asset and a stranger's asset return the same `ASSET_NOT_OWNED` — the
error code must not become an existence oracle for anyone probing ids. The reuse
check is scoped to the hostel, matching the evidence-hash rule of target §8.1.
7 tests in `payments/proof-asset-ownership.test.ts`, each asserting the proof row
was never created (target P7).

**☑ 0.3 — Upload verification and completion marking** (target §13.3, current §7.10)
*Files:* `api/v1/files/upload/route.ts`, new `api/v1/files/[assetId]/complete/route.ts`, new `lib/uploads/verify.ts`, `lib/uploads/transport.ts`, `models/FileAsset.ts`, `users/account-purge.service.ts`
After the PUT: HEAD the object, re-read real content type and size, reject on
mismatch with the declared values, compute `contentHash`, set `uploadCompletedAt`.
Add a sweep for presigns never followed by a PUT (fold into the existing
`cron/account-purge` job rather than adding a cron entry).
*Tests:* declared `image/png` + actual `application/zip` → rejected; asset without
`uploadCompletedAt` is unusable as evidence.

*Landed 2026-08-06.* The presigned upload gained a third leg: after the PUT the
client calls `POST /api/v1/files/[assetId]/complete`, which HEADs the object,
compares the real content type and size against the declared ones, re-runs the
platform's own type/size policy against the **stored** values, reads the bytes
back for a SHA-256 `contentHash`, and stamps `uploadCompletedAt`. A mismatch
marks the asset DELETED rather than leaving a half-trusted row; a retried
completion is a no-op. The multipart route needs no leg — the bytes pass through
the process, so it hashes and stamps at create. The sweep is folded into
`cron/account-purge` as specified, with an `UPLOAD_VERIFICATION_EPOCH` floor:
every asset predating this item lacks the field through no fault of its own, and
without the floor the first run would soft-delete every file the product has ever
stored. 6 tests in `lib/uploads/verify.test.ts`, 3 for the sweep in
`account-purge.test.ts`, plus the evidence gate in
`payments/proof-asset-ownership.test.ts` closing 0.2.

**☑ 0.4 — Amount auditing on every finance write** (target §13.5, current §6.3)
*Files:* new `modules/finance/finance.errors.ts` + `audit-finance.ts`, `models/AuditLog.ts`, `payments/payment.service.ts`
Ship `auditFinanceAction` and the `financeIntegrity` hash chain (§5.3), and route
the existing `updatePaymentRecord` / approve / reject through it **now**, before the
ledger refactor. The riskiest existing operation stops being the least audited on
day one rather than in six weeks.

*Landed 2026-08-06.* `amountBefore`/`amountAfter` are non-optional parameters, not
optional metadata keys — that is what makes an unaudited amount unrepeatable
rather than merely discouraged. All three writes route through it: `ADMIN_PATCH`
(the unrestricted PATCH, deleted in 2.7), `PROOF_APPROVAL`, `PROOF_REJECTION`. A
rejection records the unchanged balance rather than omitting the amounts —
"nothing moved" is itself the auditable claim.

**Chain scope decided here: per hostel, not platform-wide.** A global chain would
serialise every hostel's finance writes behind one head row, and two unrelated
hostels approving concurrently would fork it constantly. Per hostel, a fork means
two writes inside *one* hostel raced — rare, real, and worth surfacing. This does
not prevent a fork (ADR-4: detect, do not prevent); 5.1's drift job walks the
chain and raises the break. `createdAt` is written explicitly rather than left to
the schema default, so the value the hash covers is the value stored. The
`financeIntegrity` field is sparse, and that sparseness is what scopes the chain
to finance entries — the partial index on `AuditLog` depends on it.

`finance.errors.ts` ships the full §5.1 code table now, though only
`ASSET_NOT_OWNED`, `ASSET_UPLOAD_INCOMPLETE` and `EVIDENCE_ALREADY_USED` have
call sites yet (raised from `PaymentServiceError` in 0.2/0.3 with matching codes
and statuses; they move onto `FinanceServiceError` when their services are built).
9 tests in `finance/audit-finance.test.ts` plus an approval before/after
assertion in `fee-management.test.ts`.

**☑ 0.5 — Capability split + migration** (target §13.4, D7)
*Files:* `wardens/warden.validation.ts`, `lib/warden-capability.ts`, all 7 payment routes, `scripts/migrate-warden-payment-capabilities.mjs`
*Acceptance:* an existing warden retains view/approve/cash and **loses** reversal,
fee-schedule, and profile powers. `verifyPayments` still resolves as a deprecated
alias for one release.
*Tests:* extend `warden-capability.test.ts` per new key; alias resolution; default
warden has no `reversePayments`.

*Landed 2026-08-06.* `lib/warden-capability.ts` did not exist — the check lived
inline in `requireHostelCapability`, which now filters on
`permissions: { $in: grantingPermissionKeys(capability) }`. The alias grants
`viewPayments` / `approvePayments` / `recordCash` only; letting it stand in for
the three restricted keys would preserve exactly the hole the split closes, so it
does not. `verifyPayments` is off the offered list but stays in
`DEPRECATED_WARDEN_PERMISSION_KEYS` so an unmigrated row still round-trips
through the edit form instead of failing validation.

Route assignments: proof approve/reject → `approvePayments`; matrix and list →
`viewPayments`; `payments/generate`, `POST /payments` and `residents/fees` →
`manageFeeSchedule` (each sets what is owed); `PATCH /payments/[id]` →
`reversePayments`, since its main surviving power is moving a balance down.

*Acceptance observed:* migration run against the dev database — the one warden
holding `verifyPayments` now holds `["…, viewPayments, approvePayments,
recordCash"]`, with zero members holding any restricted key, read back off the
`hostelmembers` row. 14 tests in `warden-capability.test.ts`.

**☑ 0.6 — Notification kill-switch scope fix** (§5.5, target §12)
Two lines. Move the `sendPaymentEmails` early return below `createInAppNotification`.

*Landed 2026-08-06.* Half of this was already fixed on `main`:
`deliverProofNotification` (owner side) had its gate moved. The **resident** side,
`deliverReviewNotification`, still returned early above the in-app notification —
so a hostel with email disabled verified a resident's payment, issued a receipt,
and told them nothing at all. Gate moved onto the `sendNotificationEmail` call.
Pinned by a test in `fee-management.test.ts`, verified by mutation: restoring the
early return fails it.

> **☑ Verify before continuing:** 0.1–0.6 all ticked, deployed, and the `hostelId`
> backfill confirmed against production data. No item in Block 1 starts before this.
> Rationale: every subsequent block increases the volume of financial evidence
> stored, and 0.1 is a live cross-tenant read.
>
> **Passed 2026-08-06.** The product has no production deployment yet — this is
> still the development phase — so "deployed and confirmed against production
> data" reduces to the development database, which is the only data there is.
> Both migrations were run against it and their results read back off the rows:
> `fileassets` 63 unlabelled → 34 (every remaining one either PUBLIC, which never
> reaches the check, or a platform-owned registration document), and the single
> `verifyPayments` warden now holds `viewPayments`/`approvePayments`/`recordCash`
> with no restricted key. `npm run web:test` 476 passing, `web:typecheck` and
> `web:lint` clean.
>
> **Carry forward to the first real deployment.** 0.1's three parts cannot ship in
> one go, and the ordering constraint outlives this block:
>
> 1. Ship 0.1(a) — presign recording `hostelId` — and let it settle.
> 2. `npm --prefix apps/web run backfill:fileasset-hostel -- --dry-run`, review the
>    per-hostel table, then run it for real. Anything left unlabelled becomes
>    readable by its owner and the platform only, so check that remainder first.
> 3. Only then ship 0.1(c), the default-deny read check.
>
> Reversing 2 and 3 makes every existing payment proof unreadable. The
> `-- --dry-run` form matters too: invoked through the root `web:*` alias the extra
> npm layer swallows the flag and the script writes.

---

### Block 1 — Foundations, no visible change · ~4–5 days

**☑ 1.1 — `BedType` in the shared package** (target §3.1, deviation §3.2)
*Files:* `packages/shared/src/types/bed-type.ts`, `modules/finance/bed-type.ts`, `models/Resident.ts`
Canonical enum `SINGLE | DOUBLE_SHARING | TRIPLE_SHARING | FOUR_SHARING | DORMITORY`,
plus `normalizeBedType(roomTypeString): BedType | null` handling the strings actually
in the data (`ONE_SEATER`, `1 Seater`, `Single`, `Dorm`, …) and returning null rather
than guessing. `Resident.bedType` added as nullable; `roomType` untouched (D1).
*Tests:* the mapping table, including unmappable input → null → `BED_TYPE_NOT_PRICED`
at billing rather than a silent wrong rate.

*Landed 2026-08-06.* The mapping table was built from the values actually in the
database rather than from the target doc's examples. Distinct `roomType` across
`residents`, `hostels.roomTypes` and `roomConfigurations`:

| Value | → |
|---|---|
| `Single Room`, `Private` | `SINGLE` |
| `Double Sharing`, `Two Sharing` | `DOUBLE_SHARING` |
| `Triple Sharing`, `Three Sharing` | `TRIPLE_SHARING` |
| `Four Sharing` | `FOUR_SHARING` |
| `Shared` | **null** |

Two pickers ship two vocabularies for the same rooms (`hostel-admin-rooms-page`
says "Two/Three Sharing", `public-hostel-registration-page` says
"Double/Triple Sharing") and the profile page takes free text, so both spellings
map. The shared `RoomType` enum values map too — nothing imports it today, which
is why it will arrive unannounced (D1). A counted form (`"6 Sharing"`, `"5 bed"`)
resolves by arithmetic on what the owner wrote; ≥5 is `DORMITORY`.

**`"Shared"` returns null, and that is the decision that matters.** It is real
data on live resident rows and it does not state an occupancy — two and five are
both plausible and the rents differ by thousands. Near-misses fail the same way:
`"Four Sharing Deluxe"` is null, not `FOUR_SHARING`.

*Acceptance observed:* every distinct `roomType` in the database was run through
`normalizeBedType`; all map as tabled above, with `Shared` the only null.
43 tests in `finance/bed-type.test.ts`.

**Note for 1.3:** `Resident.bedType` is added nullable and **nothing populates it
yet** — no backfill was in scope here. `resolveMonthlyCharge` must therefore fall
back to `normalizeBedType(resident.roomType)` when `bedType` is null, or every
resident fails `BED_TYPE_NOT_PRICED` on day one. The `→ BED_TYPE_NOT_PRICED`
half of this item's test line lands there too, since billing does not exist yet.

**☑ 1.2 — `money.ts`** (ADR-1) — pure module, no I/O: `roundToRupee`, `sumAmounts`,
`prorate`, `formatNPR`, `assertWholeRupees`. Exhaustively tested, including that a
fractional input throws rather than rounding silently.

*Landed 2026-08-06.* All five named helpers, plus `isWholeRupees` (the
non-throwing guard, for validators) and `splitAmount` (needed by 5.3's credit
allocation; conserves the remainder rather than losing it — target §9.4).
Everything raises `AMOUNT_OUT_OF_BOUNDS` from `FinanceServiceError`, so a
fraction surfaces as a 422 rather than an unhandled throw.

Two decisions inside:

- **`roundToRupee` breaks ties away from zero, not `Math.round`'s towards +∞.**
  `Math.round(-0.5)` is `-0`, and a run of `.5` cases biases upward. Away from
  zero makes a reversal the exact mirror of the credit it reverses — and the two
  are summed together, so a one-rupee asymmetry is permanent drift, exactly what
  `LEDGER_DRIFT` would then report forever.
- **`prorate` returns the untouched monthly amount for a full month** rather than
  computing `rent / days × days`. Twelve full months must bill exactly twelve
  times the rent with nothing to explain.

54 tests in `finance/money.test.ts`, including a 10,000-entry log summing
exactly, every day of a 31-day month yielding a whole amount, and `formatNPR`
refusing a fraction — display is the last place one could hide.

**☑ 1.3 — `FeeSchedule` + resolver + proration** (target §3.3–§3.5)
*Files:* `models/FeeSchedule.ts`, `models/Resident.ts`, `finance/fee-schedule.service.ts` + validation + test, `scripts/seed-fee-schedules.mjs`
Partial unique index: at most one open row (`effectiveTo: null`) per hostel.
`resolveMonthlyCharge` returns `{ amount, basis, bedType, feeScheduleId }` and
**throws** rather than defaulting to zero — killing current §5.1 A2's
`|| 0` chain. `computeInvoiceAmount` implements the single proration rule including
**move-out proration**, which nothing does today.
*Tests:* every branch of target §3.4; proration of move-in, move-out, both in one
month, February, single-day tenancy, and `billableDays >= daysInMonth → full charge`.

*Landed 2026-08-06.* 37 tests in `finance/fee-schedule.test.ts` covering all six
proration cases named above plus leap February, tenancy spanning the whole month,
move-out before move-in, and every day of a 31-day month yielding a whole amount.

**`Resident.monthlyFee` had to be demoted here, not later.** It defaulted to `0`
and was set for everyone, so every resident would have taken the OVERRIDE path
and the schedule would never have been consulted. It is now nullable with
`default: null`, plus `feeOverrideReason` / `feeOverrideSetBy` /
`feeOverrideSetAt` (target §3.3, §4.1's `Resident` row). `resolveMonthlyCharge`
tests `!== null`, **not** falsiness: zero is a legitimate override — a staff
member's child — and "not set" is not. Conflating them is the original bug.

Per item 1.1's note, `resolveBedType` falls back to
`normalizeBedType(resident.roomType)` when `bedType` is null, so billing works
before any backfill.

`seed-fee-schedules.mjs` implements §7.3 in full: schedules from
`roomConfigurations`, `bedType` onto residents, and the `monthlyFee` demotion —
null where it matches the scheduled rate, kept with
`feeOverrideReason: "migrated from per-resident fee"` where it differs. A stored
zero *with* a schedule available is demoted rather than preserved: that is the
"billed nothing, nobody noticed" case, not a deliberate free stay.

*Acceptance observed* against the dev database: 5 schedules seeded (one open per
hostel, enforced by the partial unique index), re-run is a clean no-op, and three
hostels whose only room type is `"Shared"` got **no** schedule and were reported
by name — "resolve these in the fee editor", with their residents failing billing
visibly. That is §7.3's intended outcome, not a gap.

**Known limitation:** `--dry-run` under-reports the resident fee pass, because it
compares against schedules the dry run did not insert. The counts are accurate on
the real run.

**☑ 1.4 — `HostelPaymentProfile`** (target §4.1)
Tier 0 fields only. `tier` is a virtual derived from `gatewayProvider` +
`gatewayEnabledAt`, never a stored column that can disagree with reality.
Gateway fields are declared in the schema but unused until Block 6.

*Landed 2026-08-06.* One deviation from the item as written: `tier` ships as a
virtual **and** as an exported `resolvePaymentTier(profile)` function, because
Mongoose virtuals do not survive `.lean()` and every read path in this codebase
is lean — a virtual alone would have been `undefined` at every call site that
matters. One definition, both call styles. Also ships `isPaymentProfileUsable`:
a profile with a display name but no QR, wallet id or bank account is an empty
form, and the pay screen has to say "not set up yet" rather than render a blank
card.

`gatewaySecretRef` / `gatewayWebhookSecretRef` are declared as *references* per
ADR-6 — the profile is read on every resident pay screen, so a secret stored
inline would be pulled into every one of those requests. Nothing populates them
until 6.0. 13 tests in `finance/payment-profile.test.ts`, including that clearing
`gatewayEnabledAt` drops a hostel straight back to Tier 0, which is the Block 6
rollback in §9.

**☑ 1.5 — Reference code** (target §5, ADR-7)
*Files:* `finance/reference-code.ts` + test, `models/Hostel.ts` (`referencePrefix`, unique), `scripts/backfill-hostel-reference-prefix.mjs`
Prefix assignment must be collision-safe platform-wide — derive from the hostel
name, then disambiguate numerically.
*Tests:* round-trip generate→parse; every single-character typo in a valid code is
rejected; every single-character transposition is rejected; `rup4821k` and
`RUP-4821-K` both parse; extraction from realistic free-text remark strings.

*Landed 2026-08-06.* 61 tests in `finance/reference-code.test.ts`. The typo and
transposition suites are exhaustive — every position × every symbol, on four
codes — not representative. Writing them that way found two real defects in the
first implementation, both now fixed and both worth recording:

**The alphabet is 31 symbols, not Crockford's 32.** A weighted checksum modulo 32
cannot detect every single-character error, because 32 is a power of two: a
symbol change of 16 at an even-weighted position cancels exactly and the typo
validates. Dropping `Z` gives 31, which is **prime**, and a prime modulus with
consecutive weights catches every substitution and every adjacent transposition —
the two mistakes people actually make copying a code. Cost is 31⁴ = 923,521 codes
per hostel instead of 1,048,576, still the "~1M per hostel" of target §5.1.

**The prefix uses all 26 letters and is not part of that alphabet.** Target
§5.1's own example is `RUP`, and `U` is not a Crockford symbol — the prefix is a
human mnemonic, not base-31 data. Its letters fold into the checksum by alphabet
position (0–25, under the modulus), so prefix typos are caught too, and
confusable folding (I/L→1, O→0) applies only to the sequence. Without that split,
a hostel named "Lion Hostel" would get prefix `LIO`, be rewritten to `110` on the
way back in, and never parse.

**Extraction is tokenised, not windowed.** The first version slid an 8-character
window over the whole remark and kept whatever validated — which finds `STRENTPA`
inside `"AUGUST RENT PAYMENT THANK YOU"`, a false positive roughly 1 time in 31.
A false positive here auto-settles one resident's payment against another's
invoice; a missed match merely falls to the owner's review queue, where target
§5.3 says it belongs. So a code must now be a token in its own right.

*Acceptance observed:* `backfill-hostel-reference-prefix.mjs` run against the dev
database — 8 hostels, 8 unique prefixes, 0 unassigned, and a re-run assigns
nothing. The collision path is exercised by real data: two hostels both named
"Study Sanjal Hostel" took `STU` and `STA`.

> **◐ Verify before continuing:** every hostel has a `referencePrefix` and exactly
> one open `FeeSchedule` seeded from `roomConfigurations`, confirmed by a read-only
> report. No user-visible change has shipped yet — if a screen changed, something
> in Block 1 went out of scope.
>
> **Read-only report, dev database, 2026-08-06:**
>
> | Check | Result |
> |---|---|
> | Hostels with a `referencePrefix` | 8 of 8 |
> | Prefixes unique platform-wide | yes |
> | Hostels with exactly one open `FeeSchedule` | **5 of 8** |
> | Hostels with more than one open schedule | 0 |
> | Screens changed in Block 1 | none |
>
> **The three hostels without a schedule are not a defect, but they are a
> decision.** Green View, City Light and Himalayan Stay each configure exactly one
> room type — the string `"Shared"` — which states no occupancy, so §7.3 reports
> it rather than guessing a rate. With no mappable room type there is nothing to
> seed, and their residents will fail billing with `BED_TYPE_NOT_PRICED`, loudly,
> which is the intended outcome of a loud failure over a silent wrong rate.
>
> What it means for Block 2 is the part worth stating plainly: **`runBillingCycle`
> (2.5) will fail outright for those hostels**, because target §6.1 step 2 fails
> the whole run when no schedule covers the period. That is correct behaviour, not
> something to work around in the billing code. Resolving it is a data fix — the
> owner picks a real room type, or the fee-schedule editor (3.2) lets them price
> `"Shared"` directly — and it needs to happen for those hostels before they can
> be billed. Do not soften the resolver to make this gate pass.

---

### Block 2 — Ledger refactor · ~8–10 days · the highest-risk block

**☑ 2.1 — `Invoice`, `PaymentEvent`, `InvoiceBalance`, `ReceiptCounter`**
All indexes from target §4.1, including the four load-bearing ones. Immutability
guard per ADR-2 on `PaymentEvent`.
*Tests:* each unique index rejects its duplicate (this is the fraud control, so it
is tested at the model layer, not just the service layer); the immutability hook
throws on a settled-event financial write.

*Landed 2026-08-06.* Five files: the four models plus `finance-fields.ts`, which
holds the integrality validators so ADR-1's rule is written once, and
`FinanceModelError` — shaped to what `handleRouteError` duck-types on, so a
model-layer guard surfaces as a real response rather than an unexplained 500.

**Building the indexes against a live MongoDB found a defect that reading the
schema could not.** Target §4.1 specifies the double-billing index as partial on
`status != VOID`; **MongoDB rejects `$ne` inside `partialFilterExpression`**, so
that index cannot be created at all — `syncIndexes` fails outright. It is now
`$in` over the non-VOID statuses, *derived from the status enum* rather than
written out, so adding a status cannot silently drop it from the uniqueness rule.
(`$in` in a partial filter needs MongoDB 5.0+; this deployment is 8.0.) A second
live-only defect: Mongoose 9 has dropped the `next`-callback style for
`pre('save')`, so the immutability hook silently threw `next is not a function`
on every insert until it was rewritten to throw directly.

The immutability rule keys on the status the document was **loaded** with, stashed
by a `post('init')` hook. Without that, "already settled" and "settling right now"
are indistinguishable — both end at `SETTLED` — and blocking the second would make
settlement impossible.

31 tests in `finance/ledger-models.test.ts` covering the index declarations and
both guards as pure functions. Enforcement itself was verified against a real
server in a scratch database, since asserting it in the suite would make every
run need MongoDB. All 13 behaviours passed:

| | |
|---|---|
| Duplicate `idempotencyKey` | rejected |
| Same `providerTxnId` twice in one hostel | rejected |
| Same `evidenceHash` twice in one hostel | rejected |
| Same `providerTxnId` in a *different* hostel | accepted |
| Two events with neither txn id nor hash | accepted (partial filters work) |
| Second invoice for one resident-period | rejected |
| Reissue after voiding | accepted |
| Two period-less one-off invoices | accepted |
| `amount` rewrite on a settled event, via `updateOne` | `SETTLED_EVENT_IMMUTABLE` |
| `amount` rewrite on a settled event, via `save()` | `SETTLED_EVENT_IMMUTABLE` |
| `reversedByEventId` on a settled event | accepted (the one permitted write) |
| `PENDING` → `SETTLED` transition | accepted |
| Fractional amount | rejected |

**☑ 2.2 — `payment-event.service.ts`** — `appendEvent`, `settleEvent`,
`reverseEvent`, `recomputeInvoiceBalance`, `deriveInvoiceStatus`. The only module
that writes money.

*Landed 2026-08-06.* 38 tests in `finance/payment-event.test.ts`. Four points
where the implementation had to make a call:

- **`appendEvent` distinguishes a replay from a fraud control.** All three are
  duplicate-key errors from the same `create`. A repeated `idempotencyKey` is a
  retry — it returns the existing event with `created: false`, so callers need no
  read-then-write race of their own. A repeated `providerTxnId` or `evidenceHash`
  is the *same money or the same screenshot claimed twice*, and must surface as
  `TXN_ID_ALREADY_USED` / `EVIDENCE_ALREADY_USED`.
- **`settleEvent` claims with a filter pinned to `status: "PENDING"`.** That one
  filter is simultaneously the double-approval guard and what satisfies ADR-2 —
  it cannot match a settled event, so this path structurally cannot rewrite one.
- **`reverseEvent` writes the mirror and never amends.** `reversal:{eventId}` as
  the key makes a double-click reverse once; the original keeps its amount and
  gains only `reversedByEventId`, the single write the guard permits.
- **`recomputeInvoiceBalance` rebuilds from scratch rather than incrementing.**
  An increment can drift; a recomputation cannot. `version` increments so a lost
  update is visible to 5.1.

**`deriveInvoiceStatus` precedence decided here: PAID → OVERDUE → PARTIAL → OPEN.**
Target §4.1 lists the statuses but not their precedence, and PARTIAL and OVERDUE
genuinely overlap. Overdue wins because a half-paid invoice past its due date is
*actionable*, and calling it PARTIAL hides it from the one list an owner chases.
`VOID` and `WRITTEN_OFF` are returned untouched — they are decisions, not
balances, and a recomputation must not resurrect an invoice somebody cancelled.

**☑ 2.3 — `ledger-read.service.ts`** (ADR-3, D3) — ship in `legacy` mode, migrate all
eight consumers to it, verify no behaviour change. This is a pure refactor commit
with no schema dependency; land it before 2.4.

*Landed 2026-08-06.* Six consumers migrated: `guardian.service`,
`move-checklist.service`, `platform-directory.service`,
`resident-dashboard.service`, `report.service` (eight query sites) and
`report-export.service` (two). `grep` for `models/Payment` outside the payments
module now returns **only the facade** — the other two of D3's eight are
`payment.service.ts` (deleted in 2.8) and `payment-reminders.service.ts` (rebuilt
in 5.2), both of which are being replaced rather than migrated.

**Consumers pass a `LedgerScope`, never a Mongo filter.** This is the decision
that makes the item worth doing: a raw filter hard-codes `Payment`'s column names
(`month`, `dueAmount`, `paidAmount`) into every caller, and none of those exist on
`Invoice`. With a scope, cutover is a change inside one file. `report.service`
carries a single `ledgerScopeFrom()` adapter converting its
`{ hostelId } | { hostelId: { $in } }` scoping — one adapter, not eight.

The facade needed more than §5.6's six functions to actually absorb every call
site: `countInvoicesByField`, `listRecentInvoices`, `invoicesByIds` and
`periodTotals` were added for the report screens and CSV exports. All are
genuinely ledger reads, and leaving any of them behind would have meant a
consumer still importing `PaymentModel` — which defeats the point.

*Acceptance — no behaviour change:* 784 tests pass, including
`tenant-isolation.test.ts` and `guardian-privacy.test.ts`, which mock
`PaymentModel` and **assert on the filters reaching it**. Those suites were not
touched and still pass, so the facade demonstrably issues the same queries the
call sites used to build by hand. 31 further tests in `ledger-read.test.ts` pin
each translated filter directly, since a wrong translation is the only way this
refactor can silently change behaviour.

`FINANCE_LEDGER_SOURCE` is read from day one but only `legacy` is implemented —
shipping a half-built `ledger` branch would make "no behaviour change"
unverifiable. `dual` and `ledger` land with 2.4's migration. *(Done — see 2.4.)*

**☑ 2.4 — Migration + verification scripts** (target §4.3, §7)
`migrate-finance-ledger.mjs --dry-run` prints per hostel:
`old sum(paidAmount) | new sum(settled events) | Δ`, and **aborts** if Δ ≠ 0.
`verify-finance-ledger.mjs` is read-only and re-runs the invariant any time.

*Landed 2026-08-07.* Both scripts, plus the `dual` and `ledger` branches of the
read facade that 2.3 deferred to here. 814 tests pass (was 784); typecheck and
lint clean across all three packages.

**The abort is per hostel, not at the end.** A hostel whose totals do not match
means the mapping is wrong, and the rows written after it would only be more
things to reason about later. Halting mid-run is safe because every write is
keyed — `legacyPaymentId` on the invoice (new field, unique partial index) and
`migration:{paymentId}` on the event — so re-running after a fix resumes rather
than duplicates. Verified: the second run reported `already migrated 6, invoices
0`.

**Ran on the dev database.** Six payments across four hostels → six invoices, one
opening-balance event (NPR 4,000), one approved proof archived. `Δ = 0` for every
hostel, and `verify-finance-ledger.mjs` exits 0 with all four checks clean.

**The facade keeps legacy vocabulary under every source.** `Invoice` says `OPEN`
and `BANK`; every consumer branches on `UNPAID` and `BANK_TRANSFER`, so the
translation happens at the facade boundary. Without it the two sources would
disagree on every read and `dual` would be noise instead of evidence. Consumers
move to the new words in Block 3, per screen. `PENDING_PROOF` is reconstructed by
a third `$lookup` for a pending claim, since it is a property of the events and
not of the invoice.

**A defect only running found: `dual` would have reported drift on every invoice
forever.** `Payment.status` is a stored column nothing ever swept, so it still
says `UNPAID` for invoices months overdue, while `Invoice.status` is derived on
every recompute and 2.2 deliberately ranks OVERDUE above PARTIAL. On dev data the
two disagree on **six of six** invoices — `UNPAID×5, PARTIAL×1` against
`OPEN×2, OVERDUE×4` — while agreeing to the rupee on every amount. So status is
out of the drift comparison and the amounts are in: `PAID` versus `UNPAID` is
exactly `paidAmount >= dueAmount`, which is still compared, and status *counts*
are compared by population so a missing invoice is still a finding. Four tests
pin this, including one that the same rows differing by a single rupee still
report.

Also verified against mongod 8 directly, because the unit tests mock the model
and nothing had yet proved the pipeline is legal MongoDB: every stage runs, and
the `ledger` branch returns `dueAmount 65,629 / paidAmount 4,000` — the same
totals as the legacy branch.

**Not done here, on purpose:** migrated invoices carry **no reference code**.
Codes are minted at issue (§5.2), and one invented now was never written on any
transfer a resident actually made, so it could only produce false matches. 2.5
issues codes for new invoices; any migrated invoice still open when Block 3 ships
needs one then. **`providerTxnId` is never invented** (§7.2), including from a
resident-typed `transactionCode` on a migrated claim — that value is unverified
and not unique, and putting it in the fraud index would let one resident's typo
block another's claim. It is preserved in `rawPayload`.

> **◐ Gate:** Δ = 0 holds on dev. `FINANCE_LEDGER_SOURCE` stays `legacy` until
> the migration has run in production; the 7 clean days in `dual` that 2.8
> requires cannot start before that.

**☑ 2.5 — `runBillingCycle`** (target §6.1) — one path, replacing all three
(current §5.1 A1/A2/A3). Reads never bill: `getMonthlyPaymentMatrix`'s
lazy-insert-on-GET is deleted, which is the fix for two residents being billed
differently depending on which screen an admin opened first.
*Tests:* skip reasons are returned per resident and surfaced, never swallowed;
re-running is a no-op; a missing `FeeSchedule` fails the whole run without partial
billing.

*Landed 2026-08-07.* `billing.service.ts`, `POST/GET
hostel-admin/finance/billing-runs`, and `cron/billing-cycle` (monthly on the 1st,
documented in [CRON.md](CRON.md)). The lazy insert is gone from the matrix — that
`GET` no longer writes. 839 tests pass (was 814); typecheck and lint clean.

**Three disagreements had to be resolved, not merged.** A1 prorated a mid-month
move-in and A2 did not → **prorate**, and prorate move-outs too, which no current
path does at all. A1 billed `PENDING` residents and A2 did not → **do not**; a
pending resident has not been admitted and an invoice for them enters their
dunning queue. A2 took a `dueDate` from the request body and A1 forced
end-of-month → **end of period**, overridable per run. `defaultAmount` is gone
entirely: it was how a misconfigured resident got billed a number nobody chose.

**Verified by running it, not by reading it.** Against the dev database: the
three "Shared" hostels fail with `FEE_SCHEDULE_MISSING` and the run continues —
exactly the §7.3 outcome, and one hostel's data problem does not stop the
platform. September issued one real invoice, `EDU-0001-F`, NPR 10,000,
`basis: SCHEDULE`, due 2026-09-30, and the immediate re-run issued nothing and
consumed no reference code.

**Invoices now carry a reference code, minted at issue** (§5.2). This was not
listed under 2.5, but it belongs to issuing and nowhere else: a code is generated
once and never changes, so an invoice issued without one can never honestly gain
one later, and 3.3 would have had to backfill codes onto invoices that were never
on any transfer. `ReceiptCounter` gained a `kind` (`RECEIPT` | `REFERENCE`) and
its unique key became `{hostelId, kind, period}` — one atomic `$inc` mechanism
rather than a second collection that is a second chance to get the race wrong.
A hostel with no `referencePrefix` **stops the run** rather than issuing invoices
no payment could ever be matched to.

**The cron run is not audited, deliberately.** `AuditLog.actorId` is required,
and attributing a scheduled run to a real person who did not perform it is worse
than the gap. Each invoice it issues is still attributable on its own. Scheduled
runs get their record from `ReconciliationRun` in 5.4; until then the cron
response *is* the record, which is why it returns `failedHostels` rather than a
count — the current dunning job's stats go nowhere, and a silently failing cron
is invisible (current §5.6).

**☑ 2.6 — `Receipt` restructure + PDF** (target §4.4)
One receipt per settled event. Per-hostel numbering from an atomic
`ReceiptCounter` `findOneAndUpdate($inc)` — replacing the string-sorted `findOne`
that breaks at 100,000 and races. Immutable; a wrong receipt is voided and reissued.
`receipt-pdf.ts` via `pdf-lib`, wired to the resident "Download Statement" button
that currently has no handler (current §7.12).

*Landed 2026-08-07.* `receipt.service.ts`, `receipt-pdf.ts`, both PDF routes, and
the statement route. 866 tests pass (was 839); typecheck and lint clean.
`pdf-lib` added to `apps/web` per §10.1 decision 5 — pure JS, no native build, no
Chromium in a serverless function.

**The receipt is now immutable, which is the actual restructure.** The old rule
was one receipt per `Payment`, amended in place each time more money arrived — so
a resident who paid in two instalments held a document that had silently changed
since they downloaded it, with no record of what it used to say. A wrong receipt
is voided (reason required) and reissued with a **fresh number**; both stay
readable and the void points at its replacement. Enforced at the model layer like
ADR-2's event guard, because service-layer enforcement is defeated by one
forgotten `updateOne` in a future feature.

**Numbering is per hostel and unbounded.** `RCP-{prefix}-{YYYY-MM}-{00001}`, from
one atomic `$inc`. The five-digit padding is readability only — nothing depends
on the width, which is what the string-sorted allocator silently did. Its
five-attempt retry loop is gone with it. A global sequence was also a leak: its
gaps tell any hostel the platform's monthly volume.

**A replacement deliberately does not carry `eventId`.** The unique partial index
permits one receipt per event and the voided receipt already holds it; a
replacement is a document *about* the same money, not a second claim to it.

**Two documents, not one.** The plan says wire the PDF to "Download Statement",
and a statement is not a receipt — it is the whole account including what is
still owed, which is what a landlord, bank or visa office actually asks for. So
`renderStatementPdf` joins `renderReceiptPdf`, and the statement reads through
the ledger facade so it says the same thing before and after cutover. Every value
is sanitised to WinAnsi: standard PDF fonts cannot encode Devanagari, and this
product is full of Devanagari names — unhandled, that turns "download my
statement" into a 500 for exactly the residents most likely to need one. A test
renders both with Devanagari input.

**The button now works.** It has existed since the page was built and had no
handler. Fetched rather than linked, so a failure lands in the page's message
line instead of navigating the resident to a JSON error body.

`Receipt` keeps `paymentId` and `month` as nullable legacy fields through the
expand phase (ADR-8), so the old approval path works until 2.8 deletes it.

**☑ 2.7 — Delete the unrestricted PATCH; add cash and reversals** (target §9)
`recordCashPayment` with named `collectedBy`, required `cashReceiptNumber`, and
maker-checker above a per-hostel threshold (default NPR 20,000).
`reversePaymentEvent` writes a DEBIT event, sets `reversedByEventId` on the original
(the one permitted write to a settled event, touching no financial field), voids the
receipt, and **notifies the resident** — target §9.3 is right that a silently
reversed payment is a support disaster.
*Tests:* the reversal invariant `sum(CREDIT) - sum(DEBIT) == balance`; a reversed
invoice returns to `OPEN`/`PARTIAL`; reversal without a reason is rejected.

*Landed 2026-08-08.* `cash-payment.service.ts`, the reversal completion in
`payment-event.service`, `finance-notify.ts`, and four routes. 894 tests pass
(was 866); typecheck and lint clean across all three packages. All five new
endpoints verified live against the dev server: they compile and gate correctly.

**Defect found in review and fixed, 2026-08-10 — reversals double-subtracted.**
`reverseEvent` both appended a settled DEBIT *and* demoted the original to
`status: "REVERSED"`. Since a balance is `sum({status: "SETTLED"})`, the CREDIT
left the sum while the DEBIT also subtracted: reversing 12,000 landed the balance
at **−12,000**, and `outstanding` reported **24,000** on a 12,000 invoice — the
figure `notifyPaymentReversed` emails to the resident. Invariant 1 was broken in
production while the suite stayed green.

Two things hid it, both worth remembering:

- **The fixture contradicted the service.** `payment-event.test.ts` hand-listed
  both events as settled, describing a world the service had just overwritten.
  The mock now *derives* the settled set from the recorded writes, so it cannot
  disagree with the code again.
- **The drift job was structurally blind.** It reads stored and computed balance
  through the same `status: "SETTLED"` filter, so both were wrong and agreed. A
  self-check cannot catch an error in the rule it is built on — worth weighing
  whenever 5.1's findings are treated as proof the ledger is sound.

Fix: `reversedByEventId` is the only write to the original, exactly as target
§9.3 says; the DEBIT is what cancels the money, and a reversed event is
identified by `reversedByEventId != null`, never by its status. Pinned by a
regression test that fails on all three symptoms when the demotion returns.
Error codes corrected in the same pass: reversal-without-reason now raises
`REVERSAL_REASON_REQUIRED` (was `AMOUNT_OUT_OF_BOUNDS`), missing event
`EVENT_NOT_FOUND` and missing invoice `INVOICE_NOT_FOUND` (both were
`FEE_SCHEDULE_MISSING`, which would have told an owner to configure a fee
schedule that was never the problem). 1115 tests pass; typecheck and lint clean.

**The PATCH answers `410`, it is not deleted outright.** Following §4.3's own
convention for one release: a client still calling it is told which endpoint
replaced it rather than getting a bare 404 that reads like a bug. Verified live.
The handler is deliberately unauthenticated — there is nothing behind it to
protect, and demanding a capability to be told an endpoint moved helps nobody.
`updatePaymentRecord` goes with `payment.service.ts` in 2.8.

**Cash is the method with no external record** — no gateway, no statement line,
no screenshot — so everything that makes it trustworthy had to be built:
`collectedBy` names who physically took the money (frequently not the person at
the keyboard, and recording only the latter names the wrong human when the count
is short); `cashReceiptNumber` is required and *is* the idempotency key, so
re-entering the same paper slip is a no-op by construction; and above the
hostel's `cashApprovalThreshold` the entry waits for a **different** person.
That last check is the only thing the threshold buys — without it the "second
approver" is the same person clicking twice.

**The threshold is per hostel** (`HostelPaymentProfile.cashApprovalThreshold`,
default NPR 20,000). Twenty thousand rupees is a routine month's rent in one
hostel and a red flag in another; a platform-wide number would be wrong for
everybody.

**Reversal is now complete, not just correct.** 2.2 already wrote the mirroring
DEBIT and never amended the original. What was missing is what target §9.3 calls
the support disaster: the receipt for the reversed money is now **voided** (no
replacement — the money went back), and the resident is **told**, in-app always
and by email when the switch allows. The in-app path is deliberately outside the
`sendPaymentEmails` gate — that early return is precisely the 0.6 bug, and
repeating it here would change a resident's balance and tell them nothing.

**`invoices/[id]/void` was built too**, though 2.7's text does not name it. The
`Invoice` model already calls voiding "the correction path once the unrestricted
PATCH is gone" (target §9.2), and without it the PATCH's replacement set has a
hole: an admin who billed the wrong resident has nothing to use. It **refuses
when money has settled** — cancelling a paid obligation orphans money that is
really in the hostel's account and destroys the only record of what it was for.
Reverse first.

> **Stopping here, as planned.** 2.8 is the point of no return and its gate is
> seven days of production in `dual` with a clean nightly drift report — none of
> which can start before Block 0's and 2.4's migrations have run in production.

**☑ 2.8 — Contract** — delete `Payment.ts`, `PaymentProof.ts`, `payment.service.ts`,
`payment.validation.ts`, the old routes, and the shared enum drift (D9). Port the
concurrency tests from `fee-management.test.ts` (current §5.3 — genuinely good, keep
every case) onto the new services **before** deleting the file.

*Landed 2026-08-08.* `Payment`, `PaymentProof`, `payment.service.ts` (1,368
lines), `payment.validation.ts`, `payment-reminders.service.ts` and nine routes
are gone. 841 tests pass, typecheck and lint clean across all three packages, and
`next build` succeeds. `grep -r "models/Payment\""` returns nothing.

> **☑ Gate waived, deliberately.** The seven days in `dual` protect production
> data during cutover. Nothing is deployed and no production database exists, so
> the gate guards nothing — waived on the owner's explicit instruction rather
> than quietly skipped. The dev database was migrated and verified in 2.4
> (Δ = 0 for every hostel), which is the evidence the gate was asking for at the
> scale that exists.

**The contract could not be a pure deletion, and pretending otherwise would have
shipped a broken portal.** `payment.service.ts` still backed four *working*
features whose replacements are Block 3 items, not this one: resident proof
submission, the owner review queue, the payments matrix, and per-resident fee
setting. Deleting first and building later would have left dead buttons on two
portals. So the replacement API landed first:

| Deleted | Replacement |
|---|---|
| `submitPaymentProof` | `claim.service.ts` → `POST resident/finance/invoices/[id]/claims` |
| `approve/rejectPaymentProof` | `review.service.ts` → `POST hostel-admin/finance/events/[id]/approve\|reject` |
| `listPayments`, `getMonthlyPaymentMatrix` | `invoice-list.service.ts` → `GET hostel-admin/finance/invoices` |
| `listResidentPayments` | `GET resident/finance/invoices` |
| `setResidentMonthlyFee` | `resident-fee.service.ts` (and `null` now means "use the schedule") |
| `runPaymentReminders` | `dunning.service.ts` |
| `generateMonthlyPayments` | `runBillingCycle` (2.5) |

**Every 0.2/0.3 guard was carried across intact.** Asset ownership, the
hostel-scope check, upload verification and one-screenshot-one-claim were
security fixes; a rewrite that quietly dropped them reopens both holes. They are
in `assertClaimAssetUsable`, with the same tests.

**§8.2 honoured, and three cases changed character in the move.** The lost-claim
and concurrent-approval tests existed to exercise a five-attempt compare-and-set
loop against a mutable `paidAmount`. There is no mutable balance any more, so
what survives is the property that made the loop unnecessary: settlement is
pinned to the event still being `PENDING`, and the balance is a sum. Receipt
sequencing moved to `receipt.test.ts`, billing to `billing.test.ts`.

**The facade kept the old vocabulary on purpose.** `LedgerInvoice` still says
`UNPAID` and `BANK_TRANSFER`; `Payment` is gone but the *screens* migrate in
Block 3, one at a time. Translating at the boundary is what made the model swap
survivable without a simultaneous rewrite of every consumer.
`FINANCE_LEDGER_SOURCE` is deleted with the second source — a flag that can only
take one value is a lie about what is configurable. **The full translation table
is §5.7**, written out while closing this item.

**Two defects at that boundary, both invisible to the compiler.** A route's
response type is a caller-side generic, so nothing checks that a service returns
what a screen reads. The matrix first returned `{ invoice, residentId }` where
the screen renders `{ payment, resident.fullName }`; and both new endpoints
returned the facade's `period` where five places on the resident's payments page
read `month` — every older consumer already renames it in its own serializer, so
the omission was invisible until the render code was read. `toPortalInvoice()`
now does the rename in one place and `invoice-list.test.ts` pins every field
name a screen depends on.

**D9 closed.** `PaymentStatus`, `PaymentMethod` and `ProofVerificationStatus`
were removed from `packages/shared` — the first missing `PENDING_PROOF`, the
second missing `OTHER`, the third saying `VERIFIED` where Mongoose said
`APPROVED`. Confirmed nothing imported them, which is exactly why they drifted.
Replaced by `InvoiceStatus`, `PaymentEventStatus`, `PaymentConfirmation`,
`PaymentProvider` and `PaymentEventSource`, matching the models.

**`payment-reminders`' `.limit(500)` is gone too** — it was not a safety valve
but a silent cap, and the 501st open invoice on the platform was never chased.
Now batched by id cursor. That is part of 5.2's brief, done early because
`Payment` was being deleted underneath it; the rest of 5.2 (the dunning rebuild's
own tests and the 900th-resident case) is still open.

---

### Block 3 — Tier 0 complete · ~7–8 days

> **Complete, 2026-08-08.** All five items landed. **The §5.7 vocabulary was
> not cleared** — see the note under §5.7 for why that turned out to be one
> cross-cutting pass rather than five per-screen ones.
>
> **Every screen touched here must also drop its old vocabulary.** §5.7 lists all
> of it: `UNPAID` for `OPEN`, `month` for `period`, `BANK_TRANSFER` for `BANK`,
> `payment`/`resident` row keys, and the `Payment` / `PaymentProof` *type names*
> in `resident-shared.tsx` and `hostel-admin-shared.tsx`. Delete each row from
> §5.7 as its screen moves over; the section should reach zero rows by the end of
> Block 3. The translation lives in `ledger-read.service.ts`
> (`legacyStatusFor`, `LEGACY_METHOD_BY_PROVIDER`) and
> `invoice-list.service.ts` (`toPortalInvoice`), and is pinned by
> `invoice-list.test.ts`.

| | Item | Screen | Target |
|---|---|---|---|
| ☑ | 3.1 | Payment profile setup | §11.8 |
| ☑ | 3.2 | Fee schedule editor (**replaces** Fee Plans, D2/§3.4) | §11.9 |
| ☑ | 3.3 | Resident pay screen — QR, reference code, fallbacks | §11.1 |
| ☑ | 3.4 | Claim form with instant duplicate rejection | §11.2, §11.3, §8 |
| ☑ | 3.5 | Owner review queue with checks and `Approve all` | §11.4 |

**3.1 landed 2026-08-08.** `payment-profile.service.ts` + validation, `GET·PATCH
hostel-admin/finance/payment-profile`, and the **Payment Setup** screen
(`hostel-admin-payment-profile-page.tsx`, registered as `payment-setup`, added to
the Fees & Payments nav group). 861 tests pass (was 850); typecheck and lint
clean.

**Read is `viewPayments`, write is `managePaymentProfile`.** That split is the
reason item 0.5 exists: the warden who approves proofs must not also be able to
change the account number the money is asked to go to. Nothing on this form
touches Tier 1 — merchant code and signing secret arrive through their own flow
in 6.6, because a secret must not travel through a general-purpose PATCH that
also writes display text.

**The QR is checked the way a payment proof is.** `PAYMENT_QR` is a financial
kind (item 0.1), so the asset carries a `hostelId`; the service refuses one whose
hostel is not this one, and one whose upload was never verified (0.3). Without
that check an owner could paste any asset id and publish another hostel's QR —
which is not a data leak so much as a redirection of money.

**A profile that is not usable says so, at the top of the screen.** `usable` is
computed on the way out rather than inferred by the caller, because the resident
pay screen (3.3) has to say "your hostel has not set this up yet" instead of
rendering a blank card. A display name alone does not count, and there is a test
for exactly that.

**An absent key is not a null.** The PATCH writes only the fields the form sent,
so a screen that renders one section cannot wipe the sections it does not show;
an explicit `null` still clears. The audit envelope (§5.3) records
`cashApprovalThreshold` as before/after — it is the one amount on the form, and
changing it changes who may release money without a second person.

*Verified:* 11 tests in `payment-profile.service.test.ts`; both methods answer
`401` unauthenticated from the dev server, exactly as the neighbouring finance
routes do. The screen itself was **not** opened in a browser — doing so needs a
password login, which is outside what may be automated here.

**3.2 landed 2026-08-08.** `GET·POST hostel-admin/finance/fee-schedules` and
`POST fee-schedules/[id]/close`, plus the **Fee Schedule** screen
(`hostel-admin-fee-schedule-page.tsx`). The service and its 37 tests already
existed from 1.3; this item is the API and the screen on top of them.

**The old Fee Plans page is deleted, per deviation §3.4** —
`hostel-admin-fee-plans-page.tsx` and `(hostel-admin)/hostel-admin/fee-plans/`
are gone, and the `fee-plans` screen key now renders the editor so bookmarked
links still resolve. That page derived "plans" from
`roomConfigurations[].monthlyRent`, so a hostel had two rate cards on two
screens; `monthlyRent` survives as the **public listing price** and the schedule
is the **billing price**, which are allowed to diverge and must not be synced.

**There is no PUT, and that is the design.** Saving opens a successor and closes
the current card the day before it starts (target §3.3). An edit would silently
rewrite the basis of invoices already issued — which is what the bulk fee-setter
this replaces did.

**A blank rate box is not zero.** The form omits blank bed types from `rates`
rather than sending `0`, so a bed type the hostel does not offer stays unpriced
and billing fails loudly with `BED_TYPE_NOT_PRICED`. Sending zero would price it
at nothing, which is invariant 8 ("no silent zero") inverted. The screen says so
above the fields, and states plainly when a hostel has no open card at all —
which is the standing situation for the three `"Shared"` hostels from 1.3's gate,
and this editor is how their owner resolves it.

*Verified:* all three routes answer `401` unauthenticated on the dev server and
`/hostel-admin/fee-plans` still redirects into the workspace; 861 tests pass,
typecheck and lint clean. Screen not opened in a browser, same reason as 3.1.

**3.3 landed 2026-08-08.** `pay-instructions.service.ts`, `GET
resident/finance/invoices/[id]/pay-instructions`, and the
`ResidentPayInvoicePanel` that the resident's payments page now opens from
**Pay Now** — a badge that had looked like a button since the page was built and
did nothing. 871 tests pass (was 861); typecheck and lint clean.

**The panel shows what is outstanding, not the invoice total.** A resident paying
the second half of a part-paid month who is shown the full amount pays the month
twice, and the excess then has nowhere to go until 5.3 builds credit balances.
Tested, along with the case where more was settled than billed — which clamps to
zero rather than showing a negative.

**The reference code is the largest thing on the panel**, monospaced, spaced, and
one tap to copy. That is the item's own note and it is not decoration: Block 4's
matching ladder, auto-settlement and the size of the owner's review queue all
depend on it reaching the bank's remark box. Migrated invoices have no code (2.4
declined to invent one), so those say to write a name and room number instead
rather than showing an empty box.

**`tier` is returned but nothing branches on it yet**, which is deliberate — the
shape is identical at Tier 0 and Tier 1 so Block 6 adds the intent fields without
changing this contract. `usable: false` is a first-class state: the panel says
the hostel has not set payment up and still offers the upload, so the claim
reaches the resident's record either way.

**3.4 landed 2026-08-08.** `evidence.ts` (dHash on `sharp`, no new dependency
per D6), `FileAsset.perceptualHash`, `PaymentEvent.reviewFlags`, and three new
guards on `claim.service`. 899 tests pass (was 871); typecheck and lint clean.

**Two hashes, and conflating them would have been the defect.** The content hash
answers "are these the same bytes?" — exact, and a match is proof, so it
**auto-rejects at submission** with the non-accusatory copy of target §8.2 and
never reaches the owner's queue (invariant 9). The perceptual hash answers "do
these look the same?" — a match is *evidence*, so it only writes
`SIMILAR_EVIDENCE` into `reviewFlags` and puts a note in front of a human. A
resident who re-crops or forwards the same transfer through a chat app produces
a near match innocently; auto-rejecting on it would refuse real payments.

**The content-hash check is new work, not the existing one.**
`assertClaimAssetUsable` already caught the same *asset* twice; what actually
happens is the resident picking the same file from their gallery again, which
arrives as a fresh asset id with identical bytes. Both checks are hostel-scoped —
comparing hashes across hostels would reveal that another hostel holds the same
image, which is a privacy leak dressed as a fraud control, and there is a test
pinning the filter.

**The threshold is 10 of 64 bits, deliberately loose.** The population is
screenshots of bank apps: large flat regions, small differing digits, so two
genuinely different transfers from one app already share most bits. Being
generous is safe precisely *because* a near match cannot reject anything. dHash
rather than aHash because it keys on gradients, so a re-encode or a brightness
change still lands on the same value — both cases have tests that render real
images through `sharp`.

**`AMOUNT_OUT_OF_BOUNDS` measures against what is outstanding, not the invoice
total.** Against the total, a resident who has already paid 9,000 of 10,000 could
claim the full 10,000 again and be inside the bound — which is the
double-payment case this check is for. Headroom is ×1.5, enough for someone
clearing a small arrear alongside the month.

**Every rejection asserts that nothing was queued**, not merely that an error
came back: 17 tests in `claim.test.ts`, each checking `appendEvent` was never
called and no admin was notified. Plus 11 in `evidence.test.ts`.

*Carried:* `verifyUploadedObject` now returns the bytes it already read, so the
perceptual hash costs no second storage round-trip. Both upload legs compute it;
a PDF or an undecodable file simply gets none, and the content hash still
applies.

**3.5 landed 2026-08-08.** `claimChecks` and `bulkApproveClaims` in
`review.service`, `POST hostel-admin/finance/events/bulk-approve`, the fixed
rejection list in `claim.validation`, and the review queue rebuilt on the
payments page. 913 tests pass (was 899); typecheck and lint clean.

**The checks are computed on the server, and that is the decision.** The badge a
reviewer reads and the gate `Approve all` applies are the same function — two
implementations of "looks fine" is exactly how a bulk sweep settles a row the
screen had marked amber. Five checks: evidence attached, amount equals what is
outstanding, invoice still open, invoice carries a reference code, and no
`SIMILAR_EVIDENCE` flag from 3.4.

**An amber check never blocks a single-row approval.** The owner can see the
screenshot and we cannot, so a part payment — legitimate and common — stays one
click away. What amber does is remove the row from the sweep, because a part
payment is a *decision* and a bulk action must not make decisions.

**`Approve all` re-derives green server-side** rather than trusting the ids it
was sent. A row can go amber between render and click — another approval lands,
the invoice closes — and every skipped row comes back with the check that
stopped it, so the owner sees what was left behind instead of a smaller count.
Approvals run one at a time so each keeps its own receipt, audit entry and
resident notification; if one fails the earlier ones stay settled, which is
ADR-4 rather than an oversight. The confirmation states the count **and the
total** first: someone about to settle eleven payments should be told how much
money that is beforehand.

**Rejection is a fixed list now, not `window.prompt()`** (current §5.2). Seven
reasons plus `OTHER`. Three things follow: the resident gets a sentence they can
act on rather than "wrong", the reasons become countable — which is what tells an
owner their instructions are unclear rather than their residents careless — and
nobody types an accusation into a permanent record.

**The queue is no longer sliced to six.** It was, and a sweep that swept more
than the owner could see would have been the first bug in it.

*Verified:* 14 tests in `review-checks.test.ts` covering every check and the
sweep's refusal of an amber row it was explicitly asked to approve; the route
answers `401` unauthenticated; `window.prompt` is gone from this screen.

Notes that matter more than the wireframes:

- **3.3** — the reference code gets the strongest visual treatment on the screen.
  Everything downstream depends on the resident actually typing it.
- **3.4** — `evidence.ts` computes both hashes on upload. Exact content-hash match →
  auto-reject with the specific, non-accusatory copy of target §8.2. Perceptual
  match near threshold → flag for review, **never** auto-reject. Hash comparison is
  scoped to the hostel — cross-hostel comparison is a privacy leak.
- **3.4** — a claim does **not** change invoice status (target §6.2 step 7). It is a
  badge. This is the fix for `PENDING_PROOF` conflating "someone said they paid"
  with a payment state.
- **3.5** — rejection uses a fixed reason list, not `window.prompt()` (current §5.2).
- **3.5** — `Approve all` sweeps only all-green rows and confirms with count and
  total first.
- Mockup colours are blue; this project's theme is green. Copy the layout, use the
  repo's role/brand tokens.

*Tests:* `claim.test.ts` — duplicate screenshot, reused txn ID, foreign asset, amount
out of bounds, and the happy path each produce exactly the right error code and
**never reach the owner queue** (target P7).

---

### Block 4 — Tier 0.5 · ~6–7 days · best value per unit of effort

> **Complete, 2026-08-09.** All five items landed. PDF statement parsing stays
> deferred to 4b as planned. The Reconcile screen has **not** been opened in a
> browser — same limitation as Block 3, the visual pass is still owed.

**☑ 4.1** `StatementImport` + eSewa CSV parser (`papaparse`, versioned, D6).
**☑ 4.2** Matching ladder tiers B–E (target §7) + `scoring.ts` with the
human-readable "why" string — "matches Suman Tamang — name similar, owes exactly
this amount".
**☑ 4.3** Reconciliation screen, three buckets (target §11.5). This is the screen
that sells the product: 41 residents, 3 decisions, ~90 seconds.
**☑ 4.4** Khalti and bank CSV parsers. PDF parsing deferred (4b).
**☑ 4.5** Upload nudge banner when `lastStatementUploadAt` exceeds `statementCadenceDays`.

Parser rules, non-negotiable: fail loudly on an unrecognised format rather than
partially parsing. A statement that reads 60 of 84 rows and says nothing is worse
than one that fails. Version every parser and store the version on the import so a
re-parse is auditable.

*Tests:* golden-file tests per parser with real exported CSVs (anonymised, committed
as fixtures); overlapping date ranges across two uploads produce **zero** duplicate
events; a truncated file fails rather than under-reads.

**4.1 landed 2026-08-09.** `packages/db/src/models/StatementImport.ts`, and
`modules/finance/statements/parsers/` — `types.ts` (row shape, column aliases,
amount and date readers), `csv.ts` (papaparse + preamble skipping), `esewa-csv.ts`
(`esewa-csv@1`), `registry.ts`. `papaparse@5.5` added per D6. `text/csv` added to
the platform's document MIME list so a statement goes through the one upload
pipeline rather than a bespoke one.

**`statement-import.service.ts` is deliberately *not* here — it lands with 4.2.**
Step 4 of target §6.4 runs the matching ladder on every credit row, so a service
written before the ladder exists would need a placeholder classifier, and the
placeholder is exactly the thing that survives into production. Parsers are pure
and independently testable, so nothing is blocked by the wait.

**The registry is keyed by the provider the owner chose, and detection is a
guard rather than a search.** If the file does not look like the chosen
provider's export, the upload is refused — it is never handed to whichever other
parser happens to match. An eSewa export read by the bank parser is the
confidently-wrong outcome this whole directory exists to prevent; it names the
format it *does* look like in the error instead.

**Preamble skipping is not cosmetic.** eSewa and bank exports open with title and
account-summary lines; papaparse given such a file takes the title row as the
header and returns a table of nonsense **with no error at all**. The header row
is located by a column the parser declares it needs, bounded to the first 25
lines — past that, a file with no recognisable header is the wrong file, not a
statement with a long preamble.

**A part-rupee amount fails the import.** ADR-1's guarantee that summing the
ledger is exact holds only while nothing writes a paisa, so `12,000.50` is
refused by row number rather than rounded. Same posture for a row carrying both a
debit and a credit: picking one would silently halve or double a day's takings.
`DD/MM/YYYY` is read day-first as a declared decision, not sniffed per row —
inferring it from whether the first field exceeds 12 reads `03/04` and `13/04`
differently *within the same file*, which is how a payment lands in the wrong
month.

*Verified:* 16 tests in `esewa-csv.test.ts` against a committed anonymised
fixture, nine of them asserting the parser **refuses** — truncated file,
unreadable amount, part-rupee amount, debit-and-credit row, missing date column,
no header, header with no rows, wrong provider. Typecheck clean.

**4.2 landed 2026-08-09.** `matching/scoring.ts`, `matching/ladder.service.ts`,
and `statements/statement-import.service.ts` — the pipeline of target §6.4 end to
end. Two pieces the plan scheduled for 5.1 came forward because §6.4 step 7 needs
them: `ReconciliationRun` (model) and `reconciliation/run-recorder.ts`
(`withRun`, §5.4). 5.1 now writes drift findings through an existing recorder
instead of building one.

**`classifyCredit` is pure — context in, tier out.** The B/C boundary is the
line money crosses without a human, so it is testable without a database, and
`loadMatchContext` is a separate function that does the three queries once per
import rather than per row.

**Tier B is narrower than "has a reference code".** It requires a valid code
(check character, so a mistyped one is a forgery rather than a typo), naming an
invoice of *this* hostel, for **no more than** that invoice owes, and exactly one
such code in the remark. Overpayment drops to C because the excess needs a credit
balance (target §9.4, item 5.3) and clamping it is the money-destroying `Math.min`
this project exists to delete. Two valid codes in one remark drops to C because
splitting across months is target §16.2, not something to guess at.

**A suggestion requires a signal that says *who*.** Amount and time corroborate;
they do not identify. In a hostel where thirty residents owe 8,000 on the same
day, "exact amount, paid near the due date" describes all thirty equally, so no
total of non-identity signals can produce a suggestion — that rule, not the
numeric floor, is what keeps the screen worth reading. Caught by a test: an exact
amount alone scored 34 against a floor of 30 and would have suggested a stranger.

**A reference code is evidence about a person, not a number to compare.** The
first version scored "a valid code naming some other invoice" as a flat bonus,
which added it to *every* candidate equally — including residents who had nothing
to do with it. It now resolves to the referenced invoice's identity: same invoice
scores 60 (HIGH on its own), same resident's other invoice 40, anyone else
nothing.

**Statement events carry `statementImportId` as a real field**, not a key inside
`rawPayload`: the reconciliation screen is one query by it, and a Mixed subpath
cannot be indexed usefully.

*Verified:* 39 tests across `scoring.test.ts` and `ladder.test.ts` (pure, per
§8.4), plus 10 in `statement-import.test.ts` covering the two pipeline
guarantees the plan names — an overlapping re-upload writes **zero** duplicate
events, and a file that fails at any row imports nothing and records `FAILED`
with the reason. 968 tests pass (was 913); typecheck and lint clean.

**4.3 landed 2026-08-09.** `statements/reconcile.service.ts`, five routes
(`statements` GET·POST, `statements/[id]`, `statements/[id]/approve-matched`,
`events/[id]/assign`, `events/[id]/ask-resident`), and the **Reconcile** screen
(`hostel-admin-reconcile-page.tsx`, registered as `reconcile`, added to the Fees
& Payments nav group above Payment Setup).

**The mockup's three boxes are three buckets, not four.** Tier C suggestions and
Tier D orphans share the third box: both are money without an owner, and the
only difference the owner cares about is whether a name is suggested underneath.
Splitting them would make the screen teach a distinction that changes nothing
about what the owner does.

**Tier E is recomputed on every read, not stored at import time.** A claim
submitted after the file was cut is not evidence of anything, and a frozen list
would keep accusing a resident whose payment has since been verified by other
means.

**`Approve all` re-derives the bucket server-side** — the route takes the import
id, never a list of event ids. Same rule item 3.5 set for the review queue: a
client that sends ids is a client that decides what "matched" means. A row that
somebody else settles mid-sweep is counted as skipped rather than failing the
other thirty-seven.

**`assign` writes `MANUAL_REVIEW`, never `STATEMENT_MATCH`.** The confirmation
field records how strongly something is believed, and a human picking a name off
a suggestion list is a different kind of certainty from a reference code that
verified. It also points the event at the invoice **before** settling, because
`settleEvent` recomputes the balance of whatever invoice the event points at —
there is a test asserting that order.

**`Ask resident` needs `viewPayments`, not `approvePayments`.** Asking a question
decides nothing and moves no money; requiring the settle capability would push
routine chasing onto whoever holds the money keys.

*Verified:* 11 tests in `reconcile.test.ts` (bucketing, cross-tenant 404, refusal
on a FAILED import, the assign ordering and its two refusals). All five routes
answer `401` unauthenticated on the dev server; `next build` emits every one.
989 tests pass (was 968); typecheck and lint clean. **The screen was not opened
in a browser** — that needs a password login, which is outside what may be
automated here, so the visual pass is still owed.

**4.4 landed 2026-08-09.** `parsers/khalti-csv.ts` (`khalti-csv@1`) and
`parsers/bank-csv.ts` (`bank-csv@1`), both registered. PDF stays deferred to 4b.

**Khalti carries direction in a word, not a column**, so an unrecognised `Type`
value **fails the import** rather than defaulting to CREDIT — a default there
turns every outgoing payment into somebody's rent.

**One bank parser, not one per bank.** NIC Asia, Nabil, Global IME and
Siddhartha share a shape: date, narration, separate withdrawal and deposit, and
a running balance. A bank that diverges enough to break earns its own
`bank-<name>@1`, because every alias added to this one is another chance to read
the wrong column confidently.

**Bank rows with no reference number get a *derived* id**, built from date,
amount, narration and running balance — so re-importing an overlapping range
recognises the same row again, which is the entire purpose of having a
transaction id. A random id would duplicate everything on every re-upload; date
and amount alone would collide two residents paying the same rent on the same
day. A per-file occurrence counter breaks the remaining ties.

**Detection had to be narrowed, and a test caught it.** `Credit`/`Debit` are
accepted spellings of the bank money columns for *parsing*, and a wallet export
has those too — so the bank parser initially claimed the eSewa fixture.
Detection now additionally requires a marker only a bank export carries
(`Narration`, `Particulars`, `Deposit`, `Withdrawal`, `Value Date`). Column
lookup can afford to be liberal; detection must discriminate.

**4.5 landed 2026-08-09.** `statements/statement-nudge.ts`, returned alongside
the dashboard report and rendered as a persistent banner linking to Reconcile.

**A hostel that has never uploaded is nudged too**, with different wording. It is
the population that most needs the prompt, and treating "no upload yet" as "not
overdue" would exempt them permanently — which is exactly how a feature that only
works when used stops being used. The cadence is per hostel; the banner is
suppressed for a multi-hostel admin, who would otherwise be nudged about
whichever hostel sorted first.

*Verified:* 17 tests across `khalti-bank-csv.test.ts` (both fixtures committed,
including the derived-id stability check and the two refusals per parser) and 6
in `statement-nudge.test.ts` (never-uploaded, inside cadence, on the cadence day,
the day after, per-hostel cadence, unusable cadence). 1012 tests pass (was 989);
typecheck, lint and `next build` clean.

---

### Block 5 — Reliability · ~4–5 days

> **Complete, 2026-08-09.** All three items landed. `ReconciliationRun` and
> `run-recorder.ts` arrived early, in 4.2.

**☑ 5.1** Ledger drift job + `ReconciliationRun` (target §10.1), including the
structural half-completion checks: settled events with no receipt, receipts with no
event, expired-but-unswept pending events, `PAID` invoices whose events sum short.
Drift is **reported, never silently corrected** — a drift means something wrote
where it shouldn't.
**☑ 5.2** Dunning rebuild (target §10.3) — cursor batching replacing the platform-wide
`.limit(500)` that silently stops reminding anyone past the 500th open invoice;
per-invoice stage tracking replacing exact-day equality; batched sends; and an
escalation ladder that **terminates** (reminder → overdue → weekly chase ×4 →
human task → stop).
**☑ 5.3** Credit balances (target §9.4) — an overpayment settles in full and the
excess becomes credit, applied as a negative line on the next invoice. This deletes
the `Math.min(paid + verified, dueAmount)` clamp that currently destroys money
silently.

*Tests:* a resident at position 900 in the open-invoice ordering **is** reminded;
one missed cron day does not permanently skip a resident; the chase ladder stops;
overpayment of 15,000 against 12,000 yields a 3,000 credit and a full settlement,
with the total conserved.

**5.1 landed 2026-08-09.** `reconciliation/ledger-drift.service.ts` and
`cron/ledger-drift`, documented in `docs/CRON.md`. `ReconciliationRun` and
`run-recorder.ts` already existed — built in 4.2 — so this item is the checks on
top of them.

**Six checks, and four of them exist because of ADR-4.** Balance drift and status
drift compare the projection against the events; `PAID_SHORTFALL`,
`RECEIPT_MISSING`, `RECEIPT_ORPHANED` and `EXPIRY_UNSWEPT` look for the
structural half-completions current §7.9 says are possible and undetectable
today. Forgoing MongoDB transactions is only defensible because a crash
mid-sequence leaves a *detectable* half-state — this is the thing that detects
it, and until now that argument had no implementation behind it.

**Reports, never corrects, with a test asserting no write.** The correcting
version is one line shorter and feels more helpful; it also erases the only
evidence that a code path bypassed `payment-event.service`. Findings are `WARN`;
`FAIL` is reserved for a job that threw, so "found problems" and "is broken" stay
distinguishable in the run history.

**An absent `InvoiceBalance` row is drift, not zero** — for an invoice that has
settled events. An invoice with neither is simply unpaid and says nothing. Both
cases have a test, because collapsing them is the natural mistake.

**The audit chain check is bounded to 500 entries per run.** The chain grows
without limit and re-walking all of it nightly would eventually dominate the job;
a tamper is caught the night it happens, and an attacker who waits out the window
has still broken every hash after it. A break is reported **once** — every entry
after it also fails to verify, and a thousand findings describing one edit buries
everything else.

**`EXPIRY_UNSWEPT` is written before its sweep exists.** Block 6 adds the sweep;
the state is already reachable, and the check costs one indexed query a night.

*Verified:* 15 tests in `ledger-drift.test.ts`, including a healthy ledger
producing zero findings, each of the six checks firing, an intact audit chain
passing and an edited one failing, and — the one that matters — nothing written
to `Invoice` when every check fires at once. Typecheck and lint clean.

**Debt:** `modules/finance/ledger-drift.ts` (the Block 2 `dual`-mode reporting
seam) is now dead — `reportLedgerDrift` and `setLedgerDriftSink` have no callers
— and should be deleted. It was left in place only because file deletion is
blocked in this environment.

**5.2 landed 2026-08-09.** `dunning.service.ts` rebuilt, `Invoice.dunning`
(`stage`, `chaseCount`, `lastNotifiedAt`) added, `docs/CRON.md` updated. The
`.limit(500)` half was already done in 2.8; this is the other three defects.

**The stage lives on the invoice, and that is the whole fix.** The old job asked
"is today exactly `paymentReminderDaysBefore` days before the due date" — so a
single missed cron run skipped that resident **permanently**, because the day it
would have fired never comes back, and nobody notices an email that was never
sent. The question is now "has this invoice been chased at this stage yet".
Every threshold is `>=`, never `===`: a run three days late still climbs the rung
it missed, and a second run the same day does nothing, so the job is idempotent
without a lock.

**The ladder terminates, in code rather than in a hostel's restraint.** Reminder
→ first overdue → second at day 3 → four weekly chases → escalate to the hostel's
admins → `STOPPED`, after which nothing is sent about that invoice again. Four
weeks of chasing that produced nothing is not evidence a fifth would work; it is
evidence that something the software cannot see is wrong, and the only useful
next step is a person. There is a property test that walks the ladder from
**every** starting rung and asserts it reaches `STOPPED` in bounded steps.

**Chases are weekly from the last notice, not from the due date.** Otherwise a
first run that happens a month late fires four chases in one morning, which reads
to the resident as the system malfunctioning.

**A failed send does not advance the stage.** It is left where it was and retried
next run — advancing on failure would silently skip a rung, which is the same
class of bug as the exact-day equality this rebuild removed.

**Sends are batched per page.** The old job awaited each email inside the loop, so
a hostel with three hundred overdue invoices ran three hundred round trips end to
end and hit the function timeout, at which point the tail of the list was never
contacted — the `.limit(500)` failure again, by a different route.

*Verified:* 16 tests in `dunning.test.ts`, including the three the plan names —
the invoice at **position 900** is reminded (1000 paged, `updateOne` called for
index 899), a late run still reminds, and the ladder stops and stays stopped —
plus escalation reaching the hostel's admins rather than the resident, and a
failed send leaving the stage untouched. 1043 tests pass (was 1012); typecheck
and lint clean.

**5.3 landed 2026-08-09.** `CreditBalance` model, `credit-balance.service.ts`,
wired into `settleEvent` (earn), `runBillingCycle` (spend) and the resident
payments screen (see). The `Math.min(paid + verified, dueAmount)` clamp itself
was already gone — deleted in Block 2 — so this is the place the excess should
have been going all along.

**Invoice lines are now signed.** Credit comes off as a **line with a negative
amount** (`basis: "CREDIT"`), not as a quietly smaller header total: a resident
who sees 9,000 where they expected 12,000 needs the document to say why.
`totalAmount` stays non-negative — an invoice that owes less than nothing is a
refund, and a refund is not an invoice.

**`amount` is recomputed from the entries, never incremented**, exactly as
`InvoiceBalance.settledAmount` is recomputed from the events (P3, ADR-3). An
increment drifts under a retry; a recomputation cannot, and 5.1 can therefore
check credit the same way it checks an invoice — `CREDIT_DRIFT` was added to the
drift job for that.

**Idempotency is a unique index, not a check.** Entry keys are derived from what
caused them (`overpay:{eventId}`, `apply:{invoiceId}`) and
`{residentId, entries.idempotencyKey}` is unique, so crediting the same
overpayment twice is a write the database refuses. Re-running a billing cycle
cannot discount the same invoice twice — the mirror image of double-billing, and
just as unwelcome.

**Credit is consumed *before* the invoice is discounted**, deliberately. The
reverse order would hand out a discount that nothing paid for if the process
died in between. This order's failure mode is credit spent on an invoice that
never received its line — recoverable, because the entry names the invoice, and
reported by the new `CREDIT_UNAPPLIED` drift check. A test pins the ordering.

*Verified:* 14 tests in `credit-balance.test.ts` including the case the plan
names — 15,000 against a 12,000 invoice settles in full and leaves 3,000, with
`invoiceTotal + credit === paid` asserted directly — plus replay protection on
both sides, a part-rupee excess refused rather than rounded, and the remainder
surviving to the following month. Two more in `payment-event.test.ts` (excess
credited, exact payment credits nothing) and three in `billing.test.ts` (negative
line, untouched when there is no credit, consume-before-discount ordering).
1062 tests pass (was 1043); typecheck, lint and `next build` clean.

**Not verified in a browser:** the resident credit banner, same login limitation
as Blocks 3 and 4.

---

### Block 6 — Tier 1 · ~8–10 days

**Reordered 2026-08-10, and the reason is the only one that matters here: eSewa
and Khalti have working sandboxes and Fonepay does not.** The original order put
Fonepay first, which meant the whole block waited on a merchant code an acquiring
bank issues by hand. eSewa publishes its test merchant outright and Khalti's is
self-service, so both can be built, tested and shipped now. Fonepay keeps its
place in the interface and its manual paths, and its adapter lands when the
credentials do.

**Build against the provider sandbox first.** Sandbox credentials live in env per
provider, and a hostel's gateway entry chooses `mode: LIVE | SANDBOX` for itself.
The per-hostel credential flow is built to the same interface, so switching from
"one sandbox merchant" to "each hostel's own merchant" is a change of *where the
secret comes from*, not of any calling code. This is why 6.0 exists before any
adapter even though nothing needed real secrets yet.

**☑ 6.0** `EncryptedSecret` + `secret-store.ts` (ADR-6, D5).
**☑ 6.1** Per-provider configuration: `gateways[]` on the payment profile, the
secret store keyed by provider, eligibility rules, and the resident pay screen
offering live checkouts above the manual methods.
**☐ 6.2** `PaymentIntent` + the settlement path every adapter shares: intent
creation, callback receiver, **independent re-verify against the provider's API**
before settling (target §6.5 step 7c — never trust the callback body alone).
**☐ 6.3** eSewa adapter (form POST v2, HMAC-SHA256, status API).
**☐ 6.4** Resident checkout screens — one dedicated flow per provider, plus the
owner's live feed (§11.7) over the existing Pusher channel (D8) with a poll
fallback.
**☐ 6.5** Khalti adapter (initiate → `payment_url` → lookup by `pidx`).
**☐ 6.6** Owner setup UI for §6.7 — the "I have merchant details" path of target
§11.8, plus the Fonepay merchant-vs-personal choice.
**☐ 6.7** Expiry sweep that re-queries the provider before expiring (so a payment
that succeeded while the callback was down is not expired away), gateway health
monitoring, and weekly settlement-report reconciliation (target §10.2).
**☐ 6.8** Fonepay dynamic QR adapter. **Blocked on merchant credentials** — see
below. Everything else ships without it.

**Critical:** the resident return/success URL settles nothing. It is guessable and
carries no authority; its only job is a "checking…" state.

*Tests:* replayed webhook is a no-op (guaranteed by the unique index, asserted
anyway); unsigned webhook rejected; webhook whose independent re-verify disagrees on
amount does **not** settle; return-URL hit settles nothing.

**6.0 landed 2026-08-09.** `EncryptedSecret` (model), `gateway/envelope-crypto.ts`,
`gateway/secret-store.ts`, `gateway/provider.types.ts`, and
`scripts/rotate-finance-master-key.mjs` (`web:rotate:finance-key`). Env vars are
documented in `docs/ENVIRONMENT.md`.

**6.1 landed 2026-08-10.** `gateways[]` on `HostelPaymentProfile` replaced the
single `gatewayProvider` column; `EncryptedSecret` gained a `provider` and its
unique index became `{hostelId, provider, purpose}`; `secret-store.ts` resolves
credentials per provider; `gateway-config.service.ts` is the owner-facing surface.

**One column became an array because a hostel takes eSewa *and* Khalti.** The
single `gatewayProvider` would have made the second provider a data migration.
Nothing had ever written it — no validation accepted it and no service set it —
so it was removed outright rather than carried as dead compatibility.

**No `gatewaySecretRef`, deviating from §6.7's table.** With N providers per
hostel a ref field becomes an array of refs that must stay in step with the array
of entries, and the day they disagree is the day a hostel signs with another
provider's key. The secret is found by `{hostelId, provider, purpose}` instead:
one source of truth, and nothing secret-shaped is reachable from a document the
resident pay screen reads on every request.

**The provider is folded into the encryption's associated data.** `scopeOf`
composes `{provider}:{purpose}`, so a Khalti ciphertext written into the eSewa row
fails to authenticate rather than being handed to the eSewa adapter as its signing
key — the same protection that already stopped a ciphertext moving between
hostels, extended to the axis that 6.1 introduced. `envelope-crypto.ts` needed no
change, so its 28 tests keep their meaning. **Any secret stored under 6.0 must be
re-entered**, since its AAD lacks the provider; only dev holds any.

**A personal wallet can never be a gateway.** Fonepay personal accounts credit at
most NPR 5,000 per day, so a hostel collecting 12,000 rents through one has
payments start failing partway through the month, with the resident seeing the
network's rejection rather than anything we could explain. `isGatewayEligible`
refuses it, `assertEnablable` explains why in words the owner can act on, and the
resident's pay screen carries the cap on any static QR backed by one. Enforced in
the model rather than the form, because the form is one caller and this is the
invariant.

**Eligibility is inside `enabledGateways`, not beside it.** A test caught the
alternative: an entry marked enabled but ineligible made `isPaymentProfileUsable`
return true while `methods` came back empty — a blank pay card, which is the exact
failure that function exists to prevent.

**Sandbox entries are hidden in production, not badged.** A warning relies on the
resident reading it before they pay, and money sent to a test merchant is not
recoverable by explaining it afterwards. Owners acceptance-test on staging.

*Verified:* 1166 tests pass (was 1113) — 23 new in `gateway-config.test.ts`, 20
rewritten in `secret-store.test.ts` including cross-provider ciphertext rejection
and the production sandbox rule, plus the array cases in `payment-profile.test.ts`
and the checkout ordering in `pay-instructions.test.ts`. Typecheck and lint clean.

**6.8 remains blocked on credentials, and no amount of searching changes
that.** Fonepay publishes no universal sandbox merchant: the merchant code and
signing secret are issued per merchant by the *acquiring bank*, not self-service
from Fonepay. Every public SDK and integration guide uses placeholders and says
the same. What is public is the dev portal (`dev-merchant-login.fonepay.com`),
the dev verification endpoint
(`dev-merchantapi.fonepay.com/convergentmerchantweb/api/merchant/merchantDetailsForThirdParty/txnVerification`),
and that the dev payer side accepts any Global IME account with any `98…`
number. **One integrator reports the dev environment settles against real
accounts and moves real money** — worth confirming with the bank before any test
payment is attempted.

**Envelope encryption, not direct encryption.** `personal-data-crypto.ts`
encrypts with the master key itself; that is fine for a feature that degrades
without its key, and wrong here. Each secret gets its own data key and only the
data key is wrapped, so rotation rewrites N wrapped 32-byte keys instead of
decrypting and re-encrypting N secrets. Rotation you can actually run beats
rotation you schedule and postpone.

**A ciphertext is bound to its row.** Both layers authenticate
`{format, hostelId, purpose}` as GCM associated data, so copying hostel A's
ciphertext into hostel B's document is an authentication failure rather than B
silently gaining the ability to sign as A. That is the attack a database write —
a bug, a bad migration, anyone with collection access — would otherwise carry
out for free. Tested from both directions.

**A short passphrase is rejected, not stretched.** The deliberate divergence from
`personal-data-crypto.ts`, which hashes any input up to 32 bytes rather than
fail. Silently accommodating a weak key is defensible for resident profiles and
indefensible for the key protecting every hostel's payment signing secret.

**Decryption failure is opaque, by one code path.** Wrong key, tampered
ciphertext, wrong hostel and unknown format all raise the identical error.
Distinguishing them hands an attacker with write access an oracle and tells a
legitimate operator nothing that `keyId` and `fingerprint` — both stored in the
clear for this purpose — do not already say. Pinned by a test asserting all
three failures produce one message.

**No code path returns a secret to a client.** `describeSecret` returns a
fingerprint and a date; there is no reveal endpoint and none can be added without
changing that signature. `matchesFingerprint` answers "is the key you hold the
key we hold" without either side transmitting one.

**Production never falls back to sandbox.** A hostel whose profile says the
gateway is enabled but whose signing key is missing raises
`GATEWAY_NOT_CONFIGURED`. The alternative — quietly using the test merchant — is
a live QR that sends a resident's money to the wrong account, which is the worst
outcome available anywhere in this module.

**`provider.types.ts` encodes three rules in types rather than in prose:**
`verify` is non-optional (target §6.5 step 7c — a provider that cannot be
independently asked "did this really happen, for this amount" cannot be
integrated); `parseWebhook` returns a *claim*, never a settlement, so the two can
never be conflated by accident; and the return URL has **no seam at all**, so no
provider can grow one.

**Known coupling:** the rotation script re-implements `keyIdFor` and the AAD
format in `.mjs`, because a script cannot import the TypeScript module. Both
sides carry a comment saying so. If the envelope format changes, both change.

*Verified:* 51 tests across `envelope-crypto.test.ts` (28, exhaustive per §8.4 —
key parsing, round trip, cross-hostel and cross-purpose rejection, four kinds of
tampering, the uniform error, rotation, fingerprints, constant-time comparison)
and `secret-store.test.ts` (23 — sandbox uniformity and flagging, production
decryption, the no-fallback rule, upsert-not-append, audit by fingerprint,
rotation counting an unreadable row without deleting it). The rotation script was
run `--dry-run` against the dev database: it connects, reports zero stale rows,
and its guard fires when `FINANCE_MASTER_KEY` is absent. 1113 tests pass (was
1062); typecheck, lint and `next build` clean.

#### 6.7 What we ask the hostel for

The merchant-details form is deliberately short. Everything else the integration
needs is derived or ours.

**Asked of the hostel owner** — all three come from their bank when the bank
enables Fonepay online/dynamic-QR acceptance on their merchant account:

| Field | Stored as | Why |
|---|---|---|
| Merchant / product code | plain, on `HostelPaymentProfile.gatewayMerchantCode` | identifies whose account is being credited; not a secret |
| Secret key (shared secret) | `EncryptedSecret`, referenced by `gatewaySecretRef` | signs our request and verifies their callback |
| Registered merchant name | plain, `displayName` | must match what the resident sees on the QR, or they abandon the payment |

**Prerequisites the hostel must already have** — state these on the upgrade screen
so nobody starts a form they cannot finish: a registered business (PAN/VAT), a bank
account in that business name, and Fonepay acceptance enabled by that bank. Target
§11.8's `Help me set this up` is a real support workflow for exactly this step.

**What we never ask for and never store:** bank login credentials, the owner's
personal banking password, card details, or any balance-read access. We hold a
merchant code and a signing secret — enough to request a payment and verify one,
and nothing else. Money settles into the hostel's own account without touching us
(target P1, §14.1).

**What the integration needs beyond those three:** a callback/webhook URL (ours,
registered with the provider), a merchant transaction reference per attempt (our
reference code, target §5), and the provider's verification endpoint. The exact
parameter names, signature algorithm, and field ordering differ per provider and
change between API versions — **read them off the current sandbox documentation
during 6.1 rather than from this plan.** eSewa and Khalti follow the same shape
(merchant/product code + secret, initiate → redirect → server-side lookup) and drop
into the same `provider.types.ts` interface, which is why 6.1 builds one provider
properly instead of three approximately.

---

### Block 7 — Deferred · not scheduled

Deposit lifecycle (target §16.3 — decide: build or delete `DepositRecord` and the
fake "Deposit Status: Tracked" card), move-out settlement gate, platform
subscription billing (target §14.2 — subscription, never a cut of volume).

---

## 7. Migration strategy

### 7.1 Expand → migrate → contract (ADR-8)

| Phase | State | Exit condition |
|---|---|---|
| Expand | New collections exist. `FINANCE_LEDGER_SOURCE=legacy`. Old paths still serve. | New models deployed, indexes built |
| Migrate | Run `migrate-finance-ledger.mjs --dry-run`, review, run for real. Flip to `dual`. | Δ = 0 per hostel; 7 clean days in `dual` |
| Contract | Flip to `ledger`. Old routes 410 for one release. Then delete. | Block 2.8 |

### 7.2 The invariant

For every hostel: `sum(legacy Payment.paidAmount) == sum(SETTLED CREDIT PaymentEvent.amount)`.
Any legacy `paidAmount` that is not a whole rupee is reported and rounded
explicitly in the migration output, never silently (ADR-1).
The migration **aborts** if the totals do not match. Per target §4.3 the migrated balance
becomes a single opening-balance `ADJUSTMENT` event with
`idempotencyKey: migration:{paymentId}` — honest about the fact that it was never
event-sourced. **Do not invent `providerTxnId` values during migration.**

Approved and rejected `PaymentProof` rows are archived, not migrated — the money is
already in the opening balance and migrating them would double-count. Only `PENDING`
proofs become `PENDING` events.

### 7.3 Fee schedule seeding (D2)

`seed-fee-schedules.mjs` builds each hostel's first `FeeSchedule` from
`roomConfigurations[].monthlyRent`, keyed by `normalizeBedType(roomType)`.
Unmappable room types are **reported, not guessed** — the owner resolves them in the
editor, and until then those residents fail billing with `BED_TYPE_NOT_PRICED`,
visibly. That is the correct outcome: a loud failure beats a silent wrong rate.

Residents with a `monthlyFee` that differs from their bed type's schedule rate keep
it as an **override**, with `feeOverrideReason: "migrated from per-resident fee"`.
Residents whose fee matches the schedule have `monthlyFee` set to null so the
schedule governs going forward.

### 7.4 Index builds

`PaymentEvent`'s unique partial indexes must be built **before** any ingestion path
is live, or a duplicate slips in and the index build then fails. Build order:
create collection → build indexes → verify `getIndexes()` → enable writes.

### 7.5 Capability migration (D7)

Runs in Block 0, before any new route exists, so no window has both the old flat
capability and the new routes.

---

## 8. Test strategy

### 8.1 Invariants that must never break

These get dedicated tests and are re-asserted by the nightly drift job. They are the
specification.

1. **Conservation** — `invoiceBalance == sum(SETTLED CREDIT) - sum(SETTLED DEBIT)`, always.
2. **Immutability** — no code path mutates a settled event's `amount`, `direction`, `invoiceId`, or `confirmation`.
2b. **Integrality** — every stored amount satisfies `Number.isInteger` (ADR-1). Asserted at the model layer and re-checked nightly.
3. **No money destroyed** — an overpayment produces credit; an unassignable payment goes to suspense. Nothing evaporates (target §9.4).
4. **Idempotency** — replaying any ingestion input produces zero additional events.
5. **Tenant isolation** — no finance read or write crosses `hostelId`, including evidence-hash comparison.
6. **Receipt uniqueness** — one receipt per settled event; per-hostel sequence has no gaps and no duplicates under concurrency.
7. **Reference-code safety** — nothing auto-settles on a code whose check character fails.
8. **No silent zero** — a resident who cannot be priced is reported, never billed 0.
9. **Auto-rejection is invisible to the owner** — duplicates never enter the review queue (target P7).
10. **Audit completeness** — every settled or reversed event has an audit entry carrying before/after amounts.

### 8.2 Port, don't discard

`fee-management.test.ts` (437 lines) is the best-tested part of the current system —
double-approve refusal, lost-claim no-double-credit, CAS retry under concurrent
approval, receipt sequence continuity. Every one of those cases has a direct
equivalent on the new services. Port them all before deleting the file.

`payment-matrix.test.ts` proration cases move to `fee-schedule.test.ts` and gain
move-out cases. `payment-reminders.test.ts` moves to `dunning.test.ts` and gains the
900th-resident case that the current `.limit(500)` fails.

### 8.3 Currently untested, must not stay so

Current §9 lists them: the PATCH override path (being deleted), file-access
authorization (0.1), proof-asset ownership (0.2), overpayment clamping (5.3), the
reminder cap (5.2), receipt mutation (2.6), the A1/A2 proration disagreement (2.5),
and every deposit path (Block 7).

### 8.4 Conventions

Vitest, `npm run web:test`. Mock-model style as in the existing finance tests. Parser
tests use committed anonymised fixtures. Pure modules (`money`, `reference-code`,
`bed-type`, proration, scoring) get exhaustive unit tests since they have no I/O and
no excuse.

---

## 9. Cutover, rollback, observability

**Cutover** is one env var, `FINANCE_LEDGER_SOURCE`, moving `legacy` → `dual` →
`ledger`. In `dual`, every read computes both and logs a finding on disagreement
without failing the request — so the first week of divergence is data, not an
incident.

**Rollback** per block:

| Block | Rollback |
|---|---|
| 0 | Revert; the backfills are additive and safe to leave |
| 1 | Revert; new collections are unread |
| 2 | `FINANCE_LEDGER_SOURCE=legacy`. **Only possible until 2.8 deletes the old models — that step is the point of no return.** |
| 3–5 | Feature-flag per screen; the ledger is unaffected |
| 6 | Set `gatewayEnabledAt = null` → the hostel falls back to Tier 0, which stays fully functional |

**Observability.** `ReconciliationRun` is the product's most valuable output
(target P5). A platform screen listing recent runs, their counters, and their
findings is a Block 5 deliverable, not a nice-to-have — the current dunning job's
stats "go nowhere, so a silently failing cron is invisible" (current §5.6) and
repeating that mistake would waste the whole reconciliation layer.

**New cron entries** (add to [`docs/CRON.md`](CRON.md), then register on cron-job.org):
`billing-cycle` monthly on the 1st; `ledger-drift` nightly; `gateway-expiry-sweep`
every 5 min (Block 6 — confirm the scheduler tier supports that cadence);
`gateway-settlement-recon` weekly. `payment-reminders` keeps its slot.

---

## 10. Open decisions and effort

### 10.1 Decided — nothing here blocks Block 1

| # | Decision | Outcome |
|---|---|---|
| 1 | §3.1 money representation | ☑ **Whole NPR rupees**, `Number`, integrality enforced (ADR-1). Minor-units proposal withdrawn. |
| 2 | §3.2 `bedType` additive, `roomType` keeps capacity | ☑ Accepted |
| 3 | §3.3 no `StatementRow` | ☑ Accepted |
| 4 | §3.4 fee editor replaces Fee Plans | ☑ **Replace.** The old page is deleted in 3.2. |
| 5 | Add `pdf-lib` + `papaparse` | ☑ Accepted — pure JS, no native build |
| 6 | Tier 1 credentials | ☑ **Sandbox first**, per-hostel merchant flow built to the same interface (Block 6 preamble, §6.7) |

### 10.2 Needed before Block 3 (target §16, product calls)

| # | Question | Recommendation |
|---|---|---|
| 6 | Partial payments allowed? (§16.1) | Allow, per-hostel toggle — instalments are common in this market |
| 7 | One payment covering two months (§16.2) | Oldest-invoice-first allocation, shown explicitly to both parties |
| 8 | Deposits: build or delete (§16.3) | **Delete** `DepositRecord` and the fake "Tracked" card in Block 2; rebuild properly in Block 7. A fake metric on screen is worse than either |
| 9 | Multi-hostel owners (§16.5) | One payment profile per hostel |

### 10.3 Effort

| Block | Days | Cumulative |
|---|---|---|
| 0 Security | 3–4 | 4 |
| 1 Foundations | 4–5 | 9 |
| 2 Ledger | 8–10 | 19 |
| 3 Tier 0 | 7–8 | 27 |
| 4 Tier 0.5 | 6–7 | 34 |
| 5 Reliability | 4–5 | 39 |
| 6 Tier 1 | 8–10 | 49 |

Single developer, excluding QA and the client's payment testing (deferred by
agreement until every phase is built). **Critical path is Block 0 → 1 → 2**;
Blocks 3, 4, 5 can interleave once Block 2's ship gate passes.

**If forced to ship in two weeks** (target §15): Block 0 entire, then 1.4
(`HostelPaymentProfile`), 1.5 (reference code), 3.3 (resident pay screen). Security
fixed, and residents finally know how to pay, with a code that makes everything
downstream possible. That is a coherent release on its own.

---

*Written 2026-08-06. Companion to `FINANCE_CURRENT_STATE.md` (what is) and
`finance_update.md` (what should be). Codebase deltas in §1 were verified by reading
the cited files on branch `main`; nothing in §1 is inferred from documentation.*
