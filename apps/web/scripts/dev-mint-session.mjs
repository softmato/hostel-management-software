/**
 * Mints a browser session for a local account, for UI verification only.
 *
 * There is no way to look at an authenticated screen without being
 * authenticated, and typing a password into a browser is both slower and a
 * worse habit than issuing a token — so this does what the login route does,
 * minus the password check, against whatever database `MONGODB_URI` points at.
 *
 * Refuses to run against `NODE_ENV=production`, because a script that hands out
 * a session for any address on the system is a back door wherever real accounts
 * live. It is a development tool and the guard is what keeps it one.
 *
 *   node apps/web/scripts/dev-mint-session.mjs owner@example.com
 *   node apps/web/scripts/dev-mint-session.mjs --role HOSTEL_ADMIN
 *
 * Prints the two cookie assignments to paste into the browser.
 */
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { SignJWT } from "jose";

import { loadRootEnv } from "../src/lib/load-root-env.ts";

loadRootEnv();

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to mint a session against a production environment.");
  process.exit(1);
}

const args = process.argv.slice(2);
const roleFlag = args.indexOf("--role");
const wantedRole = roleFlag >= 0 ? args[roleFlag + 1] : null;
const wantedEmail = args.find((arg) => arg.includes("@")) ?? null;

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error("MONGODB_URI is not set.");
  process.exit(1);
}

await mongoose.connect(uri);

const users = mongoose.connection.collection("users");
const sessions = mongoose.connection.collection("sessions");

const query = wantedEmail
  ? { email: wantedEmail.toLowerCase() }
  : wantedRole
    ? { isDeleted: { $ne: true }, role: wantedRole }
    : { isDeleted: { $ne: true } };

const user = await users.findOne(query);

if (!user) {
  console.error(`No user matched ${JSON.stringify(query)}.`);
  await mongoose.disconnect();
  process.exit(1);
}

const now = new Date();
const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
const session = await sessions.insertOne({
  createdAt: now,
  expiresAt,
  refreshTokenHash: null,
  revokedAt: null,
  temporaryCredentialId: null,
  updatedAt: now,
  userId: user._id,
});

const sessionId = String(session.insertedId);
const secret = (name) => new TextEncoder().encode(process.env[name]);

const claims = {
  hostelIds: (user.hostelIds ?? []).map(String),
  role: user.role,
  sessionId,
};

const accessToken = await new SignJWT({ ...claims, tokenType: "access" })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(String(user._id))
  .setIssuedAt()
  .setExpirationTime("12h")
  .sign(secret("JWT_ACCESS_SECRET"));

const refreshToken = await new SignJWT({ ...claims, tokenType: "refresh" })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(String(user._id))
  .setIssuedAt()
  .setExpirationTime("30d")
  .sign(secret("JWT_REFRESH_SECRET"));

// The session row stores the hash of the token actually handed out, as login
// does — hashing anything else leaves a session that can never refresh.
await sessions.updateOne(
  { _id: session.insertedId },
  { $set: { refreshTokenHash: createHash("sha256").update(refreshToken).digest("hex") } },
);

console.log(`\nUser:  ${user.name ?? "(unnamed)"} <${user.email ?? "no email"}>`);
console.log(`Role:  ${user.role}`);
console.log(`Id:    ${String(user._id)}\n`);
console.log("Paste into the browser console on the target origin:\n");
console.log(
  `document.cookie='hostelhub_access_token=${accessToken};path=/';document.cookie='hostelhub_refresh=${refreshToken};path=/';location.reload()`,
);

await mongoose.disconnect();
