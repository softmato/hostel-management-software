/**
 * End-to-end check of the public path against the running dev server.
 *
 * Walks the exact order the flow is specified in: submit, choose a plan while
 * still unverified, be refused an invoice until verification lands, then pay
 * and go live. Every assertion here is one of the rules that order exists to
 * enforce.
 */
import { createHash, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { SignJWT } from "jose";

import { loadRootEnv } from "../src/lib/load-root-env.ts";

loadRootEnv();

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run against a production environment.");
  process.exit(1);
}

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3001";
const stamp = Date.now();
const OWNER_EMAIL = `owner.public.${stamp}@example.com`;

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection;

function ok(label, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);

  if (!condition) {
    process.exitCode = 1;
  }
}

async function api(path, init = {}, cookie = "") {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
  });

  return { body: await response.json().catch(() => null), response };
}

/** A signed-in cookie for a user, without going near a password field. */
async function sessionFor(user) {
  const refreshRaw = randomUUID() + randomUUID();
  const now = new Date();
  const session = await db.collection("sessions").insertOne({
    createdAt: now,
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    refreshTokenHash: createHash("sha256").update(refreshRaw).digest("hex"),
    updatedAt: now,
    userId: user._id,
  });

  const token = await new SignJWT({
    hostelIds: (user.hostelIds ?? []).map(String),
    role: user.role,
    sessionId: String(session.insertedId),
    tokenType: "access",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user._id))
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET));

  return `hostelhub_access_token=${token}`;
}

/* An ordinary public account files the application. */
const ownerInsert = await db.collection("users").insertOne({
  authProvider: "LOCAL",
  createdAt: new Date(),
  email: OWNER_EMAIL,
  emailVerified: true,
  hostelIds: [],
  isDeleted: false,
  name: "Public E2E Owner",
  phone: `98${String(stamp).slice(-8)}`,
  role: "PUBLIC",
  status: "ACTIVE",
  updatedAt: new Date(),
});

const owner = await db.collection("users").findOne({ _id: ownerInsert.insertedId });
const ownerCookie = await sessionFor(owner);

const config = await api("/api/v1/public/site-config");
const plan = (config.body?.data?.config?.plans?.plans ?? []).find((p) => p.monthly > 0);

/* 1. Submit. */
const hostelName = `E2E Public Hostel ${stamp}`;
const registration = await api(
  "/api/v1/public/hostels/register",
  {
    body: JSON.stringify({
      applicant: { email: OWNER_EMAIL, name: "Public E2E Owner", phone: "9811111111" },
      contact: { email: OWNER_EMAIL, phone: "9811111111" },
      documents: [],
      facilities: ["Wi-Fi"],
      landmark: "Beside the public test stop",
      location: { area: "Kalanki", city: "Kathmandu" },
      name: hostelName,
      roomConfigurations: [
        {
          bedsPerRoom: 2,
          mealInclusion: "Included",
          monthlyRent: 6000,
          rooms: 4,
          roomType: "Double Sharing",
          vacantBeds: 2,
        },
      ],
      roomTypes: ["Double Sharing"],
      totalCapacity: 8,
      yearEstablished: "2020",
    }),
    method: "POST",
  },
  ownerCookie,
);

ok(
  "public registration accepted",
  registration.response.status === 201,
  JSON.stringify(registration.body?.message ?? registration.body),
);

const hostelId = registration.body?.data?.hostel?.id;

if (!hostelId) {
  await mongoose.disconnect();
  process.exit(1);
}

const objectId = new mongoose.Types.ObjectId(hostelId);
let hostel = await db.collection("hostels").findOne({ _id: objectId });

ok("hostel is queued, not published", hostel.status === "PENDING_APPROVAL", hostel.status);
ok("hostel unverified", hostel.verificationStatus === "PENDING", hostel.verificationStatus);
ok("totalCapacity persisted", hostel.capacitySummary?.totalBeds === 8, String(hostel.capacitySummary?.totalBeds));
ok("landmark persisted", hostel.location?.landmark === "Beside the public test stop", hostel.location?.landmark);

/* 2. Pay now is shut, and a plan has not been chosen. */
let state = (await api(`/api/v1/hostel-registration/${hostelId}/state`, {}, ownerCookie))
  .body?.data?.state;

ok("no plan chosen yet", state?.planChosen === false, String(state?.planChosen));
ok("Pay now is shut before verification", state?.canPayNow === false, String(state?.canPayNow));

/* 3. Choosing a plan while unverified is allowed — the whole point. */
const chosen = await api(
  `/api/v1/hostel-registration/${hostelId}/plan`,
  { body: JSON.stringify({ cycle: "monthly", planId: plan.id }), method: "POST" },
  ownerCookie,
);

ok(
  "plan can be chosen while unverified",
  chosen.response.status === 200,
  JSON.stringify(chosen.body?.message ?? chosen.body),
);
ok("Pay now still shut with a plan but no verification", chosen.body?.data?.state?.canPayNow === false, String(chosen.body?.data?.state?.canPayNow));

/* 4. An invoice must be refused until verification lands. */
const early = await api(
  `/api/v1/hostel-registration/${hostelId}/invoice`,
  { method: "POST" },
  ownerCookie,
);

ok("invoice refused before verification", early.response.status === 409, String(early.response.status));

const invoiceCountBefore = await db
  .collection("subscriptioninvoices")
  .countDocuments({ hostelId: objectId });

ok("no invoice was written", invoiceCountBefore === 0, String(invoiceCountBefore));

/* 5. A superadmin approves — which is verification, not publication. */
const superadmin = await db.collection("users").findOne({ role: "SUPERADMIN" });
const adminCookie = await sessionFor(superadmin);

const approval = await api(
  `/api/v1/platform/hostels/${hostelId}/approve`,
  { method: "PATCH" },
  adminCookie,
);

ok(
  "superadmin approval accepted",
  approval.response.status === 200,
  JSON.stringify(approval.body?.message ?? approval.body),
);

hostel = await db.collection("hostels").findOne({ _id: objectId });

ok("verification recorded", hostel.verificationStatus === "VERIFIED", hostel.verificationStatus);
ok(
  "approval does NOT publish — payment does",
  hostel.status === "APPROVED",
  hostel.status,
);

/* 6. Now Pay now opens. */
state = (await api(`/api/v1/hostel-registration/${hostelId}/state`, {}, ownerCookie))
  .body?.data?.state;

ok("Pay now opens once verified and chosen", state?.canPayNow === true, String(state?.canPayNow));

/* 7. Raise the invoice, twice, to prove it does not duplicate. */
await api(`/api/v1/hostel-registration/${hostelId}/invoice`, { method: "POST" }, ownerCookie);
await api(`/api/v1/hostel-registration/${hostelId}/invoice`, { method: "POST" }, ownerCookie);

const invoices = await db
  .collection("subscriptioninvoices")
  .find({ hostelId: objectId })
  .toArray();

ok("exactly one invoice after two Pay now clicks", invoices.length === 1, String(invoices.length));
ok("invoice is open", invoices[0]?.status === "OPEN", invoices[0]?.status);
ok("invoice priced from the live catalogue", invoices[0]?.amount === plan.monthly, `${invoices[0]?.amount} vs ${plan.monthly}`);

/* 8. Pay it in full. */
const opened = await api(
  `/api/v1/hostel-registration/${hostelId}/pay`,
  { body: JSON.stringify({ action: "open", amount: plan.monthly }), method: "POST" },
  ownerCookie,
);

ok("QR charge opened", opened.response.status === 200, JSON.stringify(opened.body?.message));
ok("charge is flagged as mocked", opened.body?.data?.mocked === true, String(opened.body?.data?.mocked));

const paymentId = opened.body?.data?.payment?.id;

/* A pending payment must not move anything. */
hostel = await db.collection("hostels").findOne({ _id: objectId });
ok("pending payment does not publish", hostel.status === "APPROVED", hostel.status);

const confirmed = await api(
  `/api/v1/hostel-registration/${hostelId}/pay`,
  { body: JSON.stringify({ action: "confirm", paymentId }), method: "POST" },
  ownerCookie,
);

ok("payment confirmed", confirmed.response.status === 200, JSON.stringify(confirmed.body?.message));

/* 9. The three things paying in full is supposed to do. */
hostel = await db.collection("hostels").findOne({ _id: objectId });
const subscription = await db.collection("hostelsubscriptions").findOne({ hostelId: objectId });
const payment = await db.collection("subscriptionpayments").findOne({ hostelId: objectId });
const invoice = await db.collection("subscriptioninvoices").findOne({ hostelId: objectId });

ok("hostel published on payment", hostel.status === "PUBLISHED", hostel.status);
ok("subscription active", subscription.status === "ACTIVE", subscription.status);
ok("period end set", Boolean(subscription.currentPeriodEnd), String(subscription.currentPeriodEnd));
ok("no due left", subscription.dueBy === null, String(subscription.dueBy));
ok("invoice paid", invoice.status === "PAID", invoice.status);
ok("receipt issued", Boolean(payment.receiptNumber), payment.receiptNumber);
ok("payment flagged as mocked money", payment.isMocked === true, String(payment.isMocked));

/* 10. A second hostel's payment cannot be settled through this one. */
const otherPayment = await db
  .collection("subscriptionpayments")
  .findOne({ hostelId: { $ne: objectId } });

if (otherPayment) {
  const crossed = await api(
    `/api/v1/hostel-registration/${hostelId}/pay`,
    {
      body: JSON.stringify({ action: "confirm", paymentId: String(otherPayment._id) }),
      method: "POST",
    },
    ownerCookie,
  );

  ok("another hostel's payment is refused", crossed.response.status === 404, String(crossed.response.status));
}

console.log(`\nHostel: ${hostelName} — ${hostel.status}, plan ${plan.name} at ${plan.monthly}`);

await mongoose.disconnect();
