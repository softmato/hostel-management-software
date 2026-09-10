/**
 * End-to-end check of the team path against the running dev server.
 *
 * Seeds an invitation with a token we know (the real one only exists in an
 * email), accepts it, opens a session for the agent the way Google sign-in
 * would, registers a hostel collecting less than the plan price, and then
 * asserts the three things that path is supposed to guarantee:
 *
 *   1. the hostel is PUBLISHED immediately,
 *   2. the subscription is PAST_DUE with the shortfall outstanding,
 *   3. a receipt exists for what was actually collected.
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
const EMAIL = `agent.e2e.${Date.now()}@example.com`;
const TOKEN = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");

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

/* 1. Seed an invitation whose token we hold. */
const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const superadmin = await db.collection("users").findOne({ role: "SUPERADMIN" });

await db.collection("platformadmininvites").insertOne({
  createdAt: new Date(),
  email: EMAIL,
  expiresAt,
  invitedBy: superadmin._id,
  name: "E2E Agent",
  role: "PLATFORM_AGENT",
  status: "PENDING",
  tokenHash: createHash("sha256").update(TOKEN).digest("hex"),
  updatedAt: new Date(),
});

/* 2. Accept it. No password — Google is the way in. */
const accept = await api("/api/v1/platform-admin/accept-invitation", {
  body: JSON.stringify({ token: TOKEN }),
  method: "POST",
});

ok(
  "agent invitation accepted",
  accept.response.status === 200,
  JSON.stringify(accept.body?.message ?? accept.body),
);

const agent = await db.collection("users").findOne({ email: EMAIL });

ok("agent account created", Boolean(agent), agent?.email);
ok("agent holds the field-team role", agent?.role === "PLATFORM_AGENT", agent?.role);
ok(
  "account carries no password — Google signs it in",
  !agent?.passwordHash,
  agent?.authProvider,
);

/*
 * A session, minted the way the Google sign-in would. There is no password to
 * post, and driving a real Google consent screen from a script is not something
 * this check can or should do — what it is testing is what happens *after* the
 * sign-in, which is the agent's own portal.
 */
const now = new Date();
const agentSession = await db.collection("sessions").insertOne({
  createdAt: now,
  expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
  refreshTokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
  updatedAt: now,
  userId: agent._id,
});

const accessToken = await new SignJWT({
  hostelIds: [],
  role: agent.role,
  sessionId: String(agentSession.insertedId),
  tokenType: "access",
})
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(String(agent._id))
  .setIssuedAt()
  .setExpirationTime("12h")
  .sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET));

const cookie = `hostelhub_access_token=${accessToken}`;

/* 4. A plan to sell. */
const config = await api("/api/v1/public/site-config");
const plan = (config.body?.data?.config?.plans?.plans ?? []).find(
  (entry) => entry.monthly > 0,
);

ok("a priced plan exists in the catalogue", Boolean(plan), plan?.name);

if (!plan) {
  await mongoose.disconnect();
  process.exit(1);
}

/* 5. Register a hostel, collecting less than the price. */
const collected = Math.floor(plan.monthly / 2);
const hostelName = `E2E Field Hostel ${Date.now()}`;

const registration = await api(
  "/api/v1/team/hostels",
  {
    body: JSON.stringify({
      applicant: {
        email: `owner.e2e.${Date.now()}@example.com`,
        name: "E2E Owner",
        phone: "9800000000",
      },
      contact: { phone: "9800000000" },
      documents: [],
      facilities: ["Wi-Fi"],
      /*
       * The full-setup fields the form now collects. They are posted here
       * because every one of them has, at some point, been accepted by the API
       * and then silently dropped — `photos[].kind` most recently, which zod
       * stripped so every categorised upload landed as an interior. A field
       * that is not asserted after a round trip is a field nobody has checked.
       */
      food: { hasNonVeg: true, hasVeg: true, mealsPerDay: 3, notes: "Saturday special" },
      foodRoutine: {
        meals: [
          { dayOfWeek: "SUNDAY", items: ["Dal", "Bhat"], mealType: "DINNER" },
          { dayOfWeek: "MONDAY", items: ["Roti", "Tarkari"], mealType: "LUNCH" },
        ],
        timings: { DINNER: "7:30 pm", LUNCH: "1:00 pm" },
      },
      landmark: "Opposite the test gate",
      /*
       * The agent places a pin, because they are standing in the building.
       * MANUAL is the part that matters: it is what stops the nightly
       * nearby-places sweep re-geocoding the hostel back to the middle of
       * Baneshwor.
       */
      location: {
        area: "Baneshwor",
        city: "Kathmandu",
        lat: 27.6892,
        lng: 85.3435,
        locationSource: "MANUAL",
      },
      name: hostelName,
      payment: { amount: collected, method: "CASH" },
      photos: [
        { kind: "EXTERIOR", url: "https://cdn.example.com/e2e-front.jpg" },
        { kind: "INTERIOR", url: "https://cdn.example.com/e2e-lounge.jpg" },
        {
          kind: "ROOM",
          roomType: "Double Sharing",
          url: "https://cdn.example.com/e2e-room.jpg",
        },
      ],
      plan: { cycle: "monthly", planId: plan.id },
      pricing: { admissionFee: 2000, currency: "NPR", monthlyRentMax: 7000, monthlyRentMin: 7000 },
      roomConfigurations: [
        {
          bedsPerRoom: 2,
          mealInclusion: "Included",
          monthlyRent: 7000,
          rooms: 5,
          roomType: "Double Sharing",
          vacantBeds: 3,
        },
      ],
      roomTypes: ["Double Sharing"],
      rules: ["Gate closes at 10:00 PM", "No smoking indoors"],
      yearEstablished: "2019",
    }),
    method: "POST",
  },
  cookie,
);

ok(
  "team registration accepted",
  registration.response.status === 201,
  JSON.stringify(registration.body?.message ?? registration.body),
);

const hostelId = registration.body?.data?.hostel?.id;

if (!hostelId) {
  await mongoose.disconnect();
  process.exit(1);
}

/* 6. The three guarantees. */
const hostel = await db
  .collection("hostels")
  .findOne({ _id: new mongoose.Types.ObjectId(hostelId) });

ok("hostel published immediately", hostel.status === "PUBLISHED", hostel.status);
ok("hostel marked verified", hostel.verificationStatus === "VERIFIED", hostel.verificationStatus);
ok("landmark persisted", hostel.location?.landmark === "Opposite the test gate", hostel.location?.landmark);
ok("yearEstablished persisted", hostel.yearEstablished === "2019", hostel.yearEstablished);
/*
 * The pin, and that publishing left it alone.
 *
 * Registration now geocodes on the way out (`placeOnMap`), and the one thing
 * that must never happen there is a hand-placed pin being replaced by a
 * geocode of the locality — the hostel would slide off its own building on the
 * day it goes live.
 */
ok(
  "the agent's pin was stored",
  hostel.location?.lat === 27.6892 && hostel.location?.lng === 85.3435,
  `${hostel.location?.lat}, ${hostel.location?.lng}`,
);
ok(
  "publishing left the manual pin where the agent put it",
  hostel.location?.locationSource === "MANUAL",
  hostel.location?.locationSource,
);

/* The full-setup fields, read back off the stored hostel. */
const photoKinds = (hostel.photos ?? []).map((photo) => photo.kind).sort();

ok("all three photos stored", (hostel.photos ?? []).length === 3, String((hostel.photos ?? []).length));
ok(
  "photo kinds survived the round trip",
  photoKinds.join(",") === "EXTERIOR,INTERIOR,ROOM",
  photoKinds.join(","),
);
ok(
  "the room photo kept its room type",
  (hostel.photos ?? []).find((photo) => photo.kind === "ROOM")?.roomType ===
    "Double Sharing",
  (hostel.photos ?? []).find((photo) => photo.kind === "ROOM")?.roomType,
);
ok("rules stored", (hostel.rules ?? []).length === 2, String((hostel.rules ?? []).length));
ok("food stored", hostel.food?.mealsPerDay === 3, String(hostel.food?.mealsPerDay));
ok(
  "admission fee stored",
  hostel.pricing?.admissionFee === 2000,
  String(hostel.pricing?.admissionFee),
);

const routine = await db.collection("foodroutines").findOne({ hostelId: hostel._id });

ok("weekly routine written", Boolean(routine), routine ? "yes" : "no");
ok("routine kept both meals", (routine?.meals ?? []).length === 2, String((routine?.meals ?? []).length));
ok("routine kept the timings", routine?.timings?.DINNER === "7:30 pm", routine?.timings?.DINNER);

const subscription = await db
  .collection("hostelsubscriptions")
  .findOne({ hostelId: hostel._id });

ok("subscription is past due", subscription.status === "PAST_DUE", subscription.status);
ok("due date set", Boolean(subscription.dueBy), String(subscription.dueBy));
ok("source recorded as TEAM", subscription.source === "TEAM", subscription.source);

const invoice = await db
  .collection("subscriptioninvoices")
  .findOne({ subscriptionId: subscription._id });

ok("invoice raised", Boolean(invoice), invoice?.invoiceNumber);
ok("invoice is partial", invoice?.status === "PARTIAL", invoice?.status);
ok(
  "invoice amount is the plan price",
  invoice?.amount === plan.monthly,
  `${invoice?.amount} vs ${plan.monthly}`,
);

const payments = await db
  .collection("subscriptionpayments")
  .find({ subscriptionId: subscription._id })
  .toArray();

ok("one payment recorded", payments.length === 1, String(payments.length));
ok("payment settled", payments[0]?.status === "SETTLED", payments[0]?.status);
ok("payment amount matches what was collected", payments[0]?.amount === collected, `${payments[0]?.amount} vs ${collected}`);
ok("receipt issued", Boolean(payments[0]?.receiptNumber), payments[0]?.receiptNumber);
ok("cash attributed to the agent", Boolean(payments[0]?.collectedBy), String(payments[0]?.collectedBy));

/* 7. The agent's own desk reflects it. */
const desk = await api("/api/v1/team/hostels", {}, cookie);
const row = desk.body?.data?.registrations?.[0];

ok("desk lists the registration", row?.hostelName === hostelName, row?.hostelName);
ok(
  "desk shows the outstanding shortfall",
  row?.outstanding === plan.monthly - collected,
  `${row?.outstanding} vs ${plan.monthly - collected}`,
);
ok("desk shows cash collected", row?.cashCollected === collected, String(row?.cashCollected));

console.log(`\nHostel: ${hostelName}`);
console.log(`Plan ${plan.name} at ${plan.monthly}, collected ${collected}, owing ${plan.monthly - collected}`);

await mongoose.disconnect();
