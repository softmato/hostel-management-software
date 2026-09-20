# Subscription invoices & receipts, issued by us — build tracker

Softmato is the parent company and the issuer of record for plan billing. It is
down. Until it is back, **HostelHub renders the invoice and the receipt itself**,
in the parent company's house layout, and emails them to the owner exactly where
Softmato's own mail used to land.

This file is the work order. **Tick an item only after the code is written and
verified — never batch.**

---

## The rule the whole thing turns on

Softmato is the issuer when it can be reached. When it cannot, we issue, and the
two series can never collide:

| | issued by | number | who prints it |
|---|---|---|---|
| Softmato up | Softmato | `INV-2083/84-000012` | their ledger |
| Softmato down | us | `HH-INV-2083/84-000012` | this repo |

`HH-` is not decoration. Softmato's sequence is theirs and keeps moving while we
cannot see it; minting `INV-2083/84-000012` here would eventually issue two
different documents carrying one number, in the one place where that is not
survivable. A distinct prefix in the same shape reads as the same family of
document to a hostel owner and as a different series to an accountant, which is
exactly what it is.

Everything else on the page is identical, because the layout is the parent
company's and it does not change with who ran the renderer.

## Where the document comes from on read

There is no stored PDF. Every field on both documents is already snapshotted on
the row that issues it — `SubscriptionInvoice` copies the plan, the amount and
`billedTo` at issue, and `SubscriptionPayment` copies the method and the
gateway's own reference — so the render is a pure function of rows that never
change, and re-running it a year later produces the same page. A blob in R2
would be a second copy of an immutable thing, able to go stale.

---

## Phase 1 — The issuer, and the numbers

- [x] 1.1 `issuer` site-config section: legal name, PAN, address, phone, email,
      the product line, and the VAT footnote. Defaults are the real Softmato
      details, because a plausible placeholder on a tax document is worse than
      an obvious one.
- [x] 1.2 `bsFiscalYear()` in the shared BS calendar — `2083/84`, Shrawan to Asar
- [x] 1.3 `PlatformDocumentSequence` — a **global**, per-fiscal-year, per-kind
      counter. Deliberately not `ReceiptCounter`, whose whole design is
      per-hostel so that no hostel can read the platform's volume off its own
      numbers. A statutory series is the opposite requirement: one gapless run.
- [x] 1.4 `localInvoiceNo` / `localTransactionNo` + `localIssuedAt` on the two
      models. Never written into the `softmato*` fields — those carry a unique
      index the webhook matches on, and a locally minted number in there would
      make a genuine webhook miss.

## Phase 2 — The renderer

- [x] 2.1 `documents/theme.ts` — the page grammar: the two type families, the
      label colour, the rules, the figure style.
- [x] 2.2 `documents/layout.ts` — a small cursor-and-column kit over `pdf-lib`
- [x] 2.3 `documents/amount-in-words.ts` — `One Hundred Fifty Rupees Only`
- [x] 2.4 `documents/invoice-document.ts` — the invoice layout
- [x] 2.5 `documents/receipt-document.ts` — the receipt layout
- [x] 2.6 Tests for the numbering, the fiscal year, and the words

## Phase 3 — Issue and email

- [x] 3.1 `documents/issue.ts` — mint the number once, render on demand
- [x] 3.2 The gateway falls back to us when Softmato cannot be reached, and
      `documentBytesFor()` resolves either source behind one call
- [x] 3.3 The invoice email carries the invoice; the receipt email carries the
      receipt. Both as real attachments, not a link that needs a login.

## Phase 4 — Serving the bytes

- [x] 4.1 Hostel-admin download route serves a locally issued document
- [x] 4.2 Platform download route — any hostel, for the superadmin

## Phase 5 — Superadmin tracking

- [x] 5.1 `platform-subscriptions.service.ts` — every plan invoice and every plan
      payment across the platform, with the totals
- [x] 5.2 `GET /api/v1/platform/subscriptions`
- [x] 5.3 `/platform/subscriptions` page, under Finance in `PLATFORM_NAV`

## Phase 6 — The hostel's own billing screen (web)

- [x] 6.1 Plan card: status, what it cost, when the period ends, **days left**
- [x] 6.2 The current invoice and the current receipt, first and downloadable
- [x] 6.3 Everything before them, listed

## Phase 7 — The app

- [x] 7.1 `admin-manage-api.ts` billing read
- [x] 7.2 `app/manage/billing.tsx` — plan, days left, current paperwork, history
- [x] 7.3 Reached from **More**, and from the due card
- [x] 7.4 Download through `downloadToDevice`, like every other file in the app

---

## Verified

**Unit** — `apps/web` 2568 passed across 177 files, including 27 new cases in
`modules/billing/documents/documents.test.ts` and 2 added to
`subscription-rules.test.ts` covering the fallback path: the `HH-` prefix, that
a local number never lands in `softmatoInvoiceNo`, and that a second raise does
not burn a second number. `apps/mobile` 1393 passed across 85 files. Both apps
typecheck clean.

**The documents themselves** — rendered from fixture rows, converted to PNG and
read side by side with the parent company's own pages. `fixtures/` holds
`subscription-invoice.pdf`, `subscription-invoice-partial.pdf`,
`subscription-receipt.pdf` and `subscription-receipt-partial.pdf`; the tests
rewrite them on every run, so they cannot drift from the renderer.

The first render finished two thirds down the page with the footer pinned to the
bottom margin, which reads as a missing page on a tax document. The vertical
rhythm in `theme.ts` was opened up until both documents fill A4 the way the
originals do.

## Still Softmato's when Softmato is back

Nothing here has to be undone. `documents/deliver.ts` prefers their document
whenever they raised one, so the day the API answers again, new invoices carry
`INV-…` and old ones keep saying `HH-INV-…` — which is what was true when they
were issued. The superadmin ledger's **issued by** column goes quiet on its own.
