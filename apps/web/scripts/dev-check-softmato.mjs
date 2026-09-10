/**
 * Drives one whole subscription payment against a live Softmato deployment.
 *
 *     node --experimental-transform-types --import ./scripts/register-ts-hook.mjs \
 *       scripts/dev-check-softmato.mjs
 *
 * Or, from the repo root: `npm --prefix apps/web run check:softmato`.
 *
 * ## What it proves, in order
 *
 *  1. the credential authenticates and carries the four scopes we need;
 *  2. an invoice can be raised, with our plan copy on it;
 *  3. the same `external_ref` returns the *same* invoice rather than a second
 *     one — the property the whole no-double-billing design rests on;
 *  4. a checkout session opens against it, and the `return_url` we send is
 *     accepted by the registered-domain allowlist;
 *  5. the invoice reads back with our presentation echoed;
 *  6. a webhook signed with the wrong secret is **rejected** by our own
 *     endpoint, and one signed correctly is accepted and settles the payment.
 *
 * Point 6 is the one worth having. A verifier that has never been shown a bad
 * signature is a verifier nobody has tested — every test of it so far could
 * have passed with the comparison deleted.
 *
 * ## It writes real rows and refuses to run against production
 *
 * Every deployment this can reach is one where a Sandbox credential takes real
 * money — Sandbox is a label on the identifier, not an isolation boundary. So
 * this refuses `NODE_ENV=production`, and it refuses a `SOFTMATO_BASE_URL`
 * that is not a local one, because the only difference between a rehearsal and
 * a charge is the deployment being pointed at.
 */
import { createHmac } from "node:crypto";

import mongoose from "mongoose";
import { SoftmatoClient } from "@softmato/sdk";

import { loadRootEnv } from "../src/lib/load-root-env.ts";

loadRootEnv();

const APP = process.env.APP_URL ?? "http://hostelhub.localhost:3000";
const BASE = process.env.SOFTMATO_BASE_URL;
const SECRET = process.env.SOFTMATO_SECRET;
const WEBHOOK_SECRET = process.env.SOFTMATO_WEBHOOK_SECRET;

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run against a production build.");
  process.exit(1);
}

if (!BASE || !SECRET || !WEBHOOK_SECRET) {
  console.error(
    "SOFTMATO_BASE_URL, SOFTMATO_SECRET and SOFTMATO_WEBHOOK_SECRET must all be set.",
  );
  process.exit(1);
}

if (!/^https?:\/\/(localhost|127\.0\.0\.1|[^/]*\.localhost)(:|\/|$)/.test(BASE)) {
  console.error(
    `SOFTMATO_BASE_URL is ${BASE}, which is not a local deployment.\n` +
      "A Sandbox credential pointed anywhere else takes real money through the real gateways.",
  );
  process.exit(1);
}

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const softmato = new SoftmatoClient({
  baseUrl: BASE,
  onWarning: (warning) => console.log(`  warn  ${warning.message}`),
  secret: SECRET,
});

/* 1–3. The invoice. ------------------------------------------------------ */

const stamp = Date.now();
const invoiceNumber = `SUB-CHK${stamp}`;

console.log("\nRAISING AN INVOICE");

const presentation = {
  billing_period: "12 months",
  features: [
    "Up to 100 residents",
    "2 warden accounts",
    "3 cook accounts",
    "Platinum hostel badge in the public directory",
  ],
  highlights: ["Ranked above unbadged listings"],
  plan_name: "Pro — Annual",
  tagline: "A full house, or two floors of one.",
};

const invoice = await softmato.createInvoice({
  customer: {
    email: "owner@example.com",
    external_ref: `hh-hostel:check-${stamp}`,
    name: "Sunrise Hostel",
  },
  external_ref: `hh-sub:${invoiceNumber}`,
  lines: [
    { description: "Pro — Annual", quantity: 1, unit_price_minor: 5_000_00 },
  ],
  presentation,
});

/*
 * `invoice_id` IS the number: the live API sends `INV-2083/84-000014` in that
 * field and no `invoice_no` at all, despite the SDK type declaring both. The
 * fallback is what the integration uses, so it is what is checked here.
 */
const invoiceNo = invoice.invoice_no ?? invoice.invoice_id;

check("invoice raised", Boolean(invoiceNo), JSON.stringify(invoice));
console.log(`        ${invoiceNo}`);

const again = await softmato.createInvoice({
  customer: {
    email: "owner@example.com",
    external_ref: `hh-hostel:check-${stamp}`,
    name: "Sunrise Hostel",
  },
  external_ref: `hh-sub:${invoiceNumber}`,
  lines: [
    { description: "Pro — Annual", quantity: 1, unit_price_minor: 5_000_00 },
  ],
  presentation,
});

check(
  "a repeated external_ref returns the same invoice, not a second one",
  (again.invoice_no ?? again.invoice_id) === invoiceNo,
  `${again.invoice_no ?? again.invoice_id} vs ${invoiceNo}`,
);

/* 4. The checkout. ------------------------------------------------------- */

console.log("\nOPENING A CHECKOUT");

const returnUrl = `${APP}/register-hostel/return?invoice=${encodeURIComponent(invoiceNumber)}`;

const session = await softmato.createCheckout({
  invoice_id: invoice.invoice_id,
  return_url: returnUrl,
});

check("checkout session opened", Boolean(session.checkout_url));
check(
  "the return_url passed the registered-domain allowlist",
  Boolean(session.session_id),
  returnUrl,
);
console.log(`        ${session.checkout_url}`);
console.log(`        providers: ${session.allowed_providers.join(", ") || "(none)"}`);
console.log(`        expires:   ${session.expires_at}`);

/* 5. Reading it back. ---------------------------------------------------- */

console.log("\nREADING THE INVOICE BACK");

const detail = await softmato.getInvoice(invoiceNo);

check("invoice reads back", detail.invoice_id === invoice.invoice_id);
check(
  "our plan copy is echoed on it",
  detail.presentation?.plan_name === "Pro — Annual",
  JSON.stringify(detail.presentation),
);
check(
  "the features we sent survived",
  detail.presentation?.features?.length === 4,
  JSON.stringify(detail.presentation?.features),
);
check("it is unpaid until somebody pays it", detail.status !== "paid", detail.status);

const file = await softmato.downloadDocument({ invoice: invoiceNo }, "pdf");

check("the document downloads", file.bytes.length > 0, `${file.bytes.length} bytes`);
console.log(
  `        ${file.contentType}${file.pdfFallbackReason ? ` — fallback: ${file.pdfFallbackReason}` : ""}`,
);

/* 6. Our own webhook endpoint. ------------------------------------------- */

console.log("\nOUR WEBHOOK ENDPOINT");

const endpoint = `${APP}/api/v1/webhooks/softmato`;

async function deliver(body, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  const response = await fetch(endpoint, {
    body,
    headers: {
      "content-type": "application/json",
      "x-softmato-signature": signature,
      "x-softmato-timestamp": String(timestamp),
    },
    method: "POST",
  });

  return { status: response.status, text: await response.text() };
}

const payload = JSON.stringify({
  amount: 5_000_00,
  currency: "NPR",
  event: "payment.success",
  invoice_id: invoiceNo,
  occurred_at: new Date().toISOString(),
  status: "SUCCEEDED",
  transaction_id: `TXN-CHK-${stamp}`,
});

const unsigned = await fetch(endpoint, {
  body: payload,
  headers: { "content-type": "application/json" },
  method: "POST",
});

check(
  "an unsigned delivery is refused",
  unsigned.status === 400,
  `status ${unsigned.status}`,
);

const forged = await deliver(payload, "not-the-webhook-secret");

check(
  "a delivery signed with the wrong secret is refused",
  forged.status === 400,
  `status ${forged.status} ${forged.text}`,
);

const stale = await deliver(
  payload,
  WEBHOOK_SECRET,
  Math.floor(Date.now() / 1000) - 3_600,
);

check(
  "a replayed delivery from an hour ago is refused",
  stale.status === 400,
  `status ${stale.status} ${stale.text}`,
);

const genuine = await deliver(payload, WEBHOOK_SECRET);

/*
 * A 2xx here means the signature verified and the handler ran. This invoice
 * number belongs to no local row, so the handler answers `ignored` — which is
 * the correct outcome and is still a 2xx, because retrying it would not help.
 */
check(
  "a genuine delivery verifies",
  genuine.status === 200,
  `status ${genuine.status} ${genuine.text}`,
);
console.log(`        ${genuine.text}`);

/* 7. A delivery that actually settles something. ------------------------- */

/**
 * Phase 6 proved the signature gate. This proves what happens once a delivery
 * gets through it: the payment settles, exactly once, and the subscription
 * moves.
 *
 * It writes a minimal hostel, subscription and invoice straight into Mongo
 * rather than driving the registration form -- the form has its own end-to-end
 * script next door, and what is under test here is the seam between a verified
 * webhook and our own rows. Everything it writes, it deletes.
 */
console.log("");
console.log("SETTLING FROM A WEBHOOK");

await mongoose.connect(process.env.MONGODB_URI);

/*
 * Raw collections rather than the Mongoose models. The models are CommonJS and
 * do not import cleanly into this ESM script, and there is nothing to gain
 * from them here: what is under test runs inside the Next server, which uses
 * the models properly. This end only needs to plant fixtures and read them
 * back, so every default the schema would apply is written out explicitly.
 */
const db = mongoose.connection.db;
const now = new Date();
const oid = () => new mongoose.Types.ObjectId();

const hostelId = oid();
const subscriptionId = oid();
const localInvoiceId = oid();

await db.collection("hostels").insertOne({
  _id: hostelId,
  contact: { email: "owner.softmato." + stamp + "@example.com", phone: "9800000000" },
  createdAt: now,
  isDeleted: false,
  name: "Softmato Check " + stamp,
  slug: "softmato-check-" + stamp,
  status: "PENDING",
  updatedAt: now,
  verificationStatus: "VERIFIED",
});

await db.collection("hostelsubscriptions").insertOne({
  _id: subscriptionId,
  createdAt: now,
  currency: "NPR",
  cycle: "annual",
  cycleMonths: 12,
  cycleTotal: 5000,
  hostelId,
  monthlyRate: 5000,
  planId: "pro",
  planName: "Pro",
  source: "PUBLIC",
  status: "AWAITING_PAYMENT",
  updatedAt: now,
});

await db.collection("subscriptioninvoices").insertOne({
  _id: localInvoiceId,
  amount: 5000,
  billedTo: { hostelName: "Softmato Check " + stamp, name: "Softmato Check" },
  createdAt: now,
  currency: "NPR",
  cycle: "annual",
  cycleMonths: 12,
  hostelId,
  invoiceNumber,
  issuedAt: now,
  planId: "pro",
  planName: "Pro",
  softmatoInvoiceId: invoice.invoice_id,
  softmatoInvoiceNo: invoiceNo,
  source: "PUBLIC",
  status: "OPEN",
  subscriptionId,
  updatedAt: now,
});

const paymentsFor = () =>
  db.collection("subscriptionpayments").find({ invoiceId: localInvoiceId }).toArray();

const settling = await deliver(payload, WEBHOOK_SECRET);

check(
  "the delivery is accepted",
  settling.status === 200,
  "status " + settling.status + " " + settling.text,
);
check(
  "it settled a payment rather than being ignored",
  settling.text.includes("settled"),
  settling.text,
);

const payments = await paymentsFor();

check("one payment row exists", payments.length === 1, payments.length + " rows");
check("it is settled", payments[0]?.status === "SETTLED", payments[0]?.status);
check(
  "the amount converted from paisa to whole rupees",
  payments[0]?.amount === 5000,
  String(payments[0]?.amount),
);
check(
  "the transaction number was stamped on it",
  payments[0]?.softmatoTransactionNo === "TXN-CHK-" + stamp,
  payments[0]?.softmatoTransactionNo,
);
check(
  "our own receipt number was allocated",
  typeof payments[0]?.receiptNumber === "string",
  payments[0]?.receiptNumber,
);

const afterInvoice = await db
  .collection("subscriptioninvoices")
  .findOne({ _id: localInvoiceId });

check("the invoice reads paid", afterInvoice?.status === "PAID", afterInvoice?.status);

const afterSubscription = await db
  .collection("hostelsubscriptions")
  .findOne({ _id: subscriptionId });

check(
  "the subscription activated",
  afterSubscription?.status === "ACTIVE",
  afterSubscription?.status,
);

const afterHostel = await db.collection("hostels").findOne({ _id: hostelId });

check(
  "the hostel published once it had paid in full",
  afterHostel?.status === "PUBLISHED",
  afterHostel?.status,
);

/*
 * The same delivery again, byte for byte. Not a hypothetical: retries continue
 * until a 2xx, and a dropped response is indistinguishable from a dropped
 * request.
 */
const replay = await deliver(payload, WEBHOOK_SECRET);

check("a repeated delivery is accepted", replay.status === 200, replay.text);

const afterReplay = await paymentsFor();

check(
  "the repeat issued no second payment",
  afterReplay.length === 1,
  afterReplay.length + " rows",
);
check(
  "and no second receipt number",
  afterReplay[0]?.receiptNumber === payments[0]?.receiptNumber,
  afterReplay[0]?.receiptNumber + " vs " + payments[0]?.receiptNumber,
);

await db.collection("subscriptionpayments").deleteMany({ invoiceId: localInvoiceId });
await db.collection("subscriptioninvoices").deleteOne({ _id: localInvoiceId });
await db.collection("hostelsubscriptions").deleteOne({ _id: subscriptionId });
await db.collection("hostels").deleteOne({ _id: hostelId });

await mongoose.disconnect();

console.log(`\n${passed} passed, ${failed} failed\n`);

process.exit(failed === 0 ? 0 : 1);
