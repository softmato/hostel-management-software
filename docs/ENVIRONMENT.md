# ENVIRONMENT.md — Environment Variables & Setup

**Package manager: npm** (npm workspaces + Turborepo). Not pnpm — `corepack`/pnpm
appear nowhere in this repo, and `package-lock.json` is the committed lockfile.

`.env.example` at the repo root is the authoritative variable list; this file
explains what each group is for. If the two ever disagree, `.env.example` wins.

---

## 1. Prerequisites

- Node.js 20 LTS
- npm 10+ (ships with Node 20 — no corepack step)
- MongoDB Atlas account (or local MongoDB 7.0+)
- Cloudflare account with an R2 bucket
- Resend account for transactional email
- Google Cloud project — only if you want the optional Google Maps fallback
  (requires billing enabled); OpenStreetMap is the free default

---

## 2. Environment Variables

Create `.env` **at the repo root** — not inside `apps/web`. `next.config.ts`
calls `loadEnvConfig(repoRoot)`, and the standalone scripts under
`apps/web/scripts/` load the same root file, so one file serves every workspace.
Never commit it; `.env.example` is the tracked template.

### App

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | no | `development` / `production` / `test` |
| `APP_URL` | **yes** | Absolute base URL. Used for every link inside an email and for `siteUrl()`. Falls back to `http://localhost:3000`. |
| `NEXT_PUBLIC_APP_URL` | **yes** | Same value, exposed to the browser bundle. |

### Database

| Variable | Required | Notes |
|---|---|---|
| `MONGODB_URI` | **yes** | Full connection string. **Not** `DATABASE_URL` — nothing reads that name. |

### Auth / JWT

| Variable | Required | Notes |
|---|---|---|
| `JWT_ACCESS_SECRET` | **yes** | Minimum 32 characters (enforced by `lib/env.ts`). |
| `JWT_REFRESH_SECRET` | **yes** | Minimum 32 characters, different from the access secret. |
| `ACCESS_TOKEN_TTL` | no | Default `15m`. |
| `REFRESH_TOKEN_TTL` | no | Default `30d`. |

Rotating either secret invalidates every live session.

### OTP (legacy signup flow)

`OTP_TTL_MINUTES`, `OTP_RESEND_COOLDOWN_SECONDS`, `OTP_RATE_LIMIT_WINDOW_MINUTES`,
`OTP_RATE_LIMIT_MAX`, `OTP_HASH_SECRET`. All optional — sane defaults ship in
code. `OTP_HASH_SECRET` falls back to `JWT_ACCESS_SECRET` when unset.

### Google sign-in

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | for Google login | Client ID for Google Identity Services in the browser. |
| `GOOGLE_CLIENT_ID` | for Google login | Same value, used server-side to verify the ID token audience. |

> **There is no `GOOGLE_CLIENT_SECRET` and no OAuth redirect URI.** This project
> uses the Google Identity Services **ID-token POST** flow, verified server-side —
> not a GET redirect + callback. Earlier drafts of this document specified
> `GOOGLE_CLIENT_SECRET` and `GOOGLE_OAUTH_REDIRECT_URI`; neither is read by any
> code path. See ARCHITECTURE.md §3.1.

### Google Maps (optional runtime fallback)

| Variable | Required | Notes |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | no | Server-only: Geocoding + Places. Never exposed to the client. |
| `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | no | Restrict by HTTP referrer. |

Leave both blank to run on OpenStreetMap/Leaflet + Nominatim + Overpass, which
is the default and costs nothing.

### Cloudflare R2

| Variable | Required | Notes |
|---|---|---|
| `R2_ENDPOINT` | **yes in production** | `https://<account-id>.r2.cloudflarestorage.com`. Note: the endpoint URL, not a bare `R2_ACCOUNT_ID`. |
| `R2_ACCESS_KEY_ID` | **yes in production** | |
| `R2_SECRET_ACCESS_KEY` | **yes in production** | |
| `R2_BUCKET_NAME` | **yes in production** | |
| `R2_PUBLIC_URL` | **yes in production** | Public base URL for public assets (hostel photos, activation QR images). |

All five must be set together — `lib/public-upload.ts` treats R2 as configured
only when endpoint, key, bucket **and** public URL are all present. Without
them it writes to `apps/web/public/uploads/` on local disk, which is fine for
development and **will not work on Vercel** (read-only filesystem). Uploads
degrade to `null` rather than throwing, so the QR email simply arrives without
an image. Provision R2 before production.

### Email (Resend)

| Variable | Required | Notes |
|---|---|---|
| `RESEND_API_KEY` | **yes in production** | Without it `sendEmail()` logs and no-ops instead of throwing. |
| `EMAIL_FROM` | one of these | Full `Name <address>` header. Wins if set. |
| `RESEND_FROM_NAME` + `RESEND_FROM_EMAIL` | one of these | Combined into `Name <address>` when `EMAIL_FROM` is absent. |

### Seed / bootstrap

`SEED_SUPERADMIN_EMAIL`, `SEED_SUPERADMIN_NAME`, `SEED_SUPERADMIN_PASSWORD` —
read only by `npm run db:seed`. SUPERADMIN accounts are created by that script
and by an existing superadmin in the portal; never by a public endpoint.

### Cron

| Variable | Required | Notes |
|---|---|---|
| `CRON_SECRET` | **yes in production** | Protects all six `/api/v1/cron/*` endpoints. A missing value makes them answer `500 CRON_NOT_CONFIGURED` — they never fall open. |

### Resident identity encryption

| Variable | Required | Notes |
|---|---|---|
| `PERSONAL_DATA_ENCRYPTION_KEY` | for resident profiles | 32 bytes, base64 or hex. Generate with `openssl rand -base64 32`. |

**Rotating this key makes every stored resident profile permanently
unreadable.** The resident-profile endpoints fail with a clear message when it
is absent, so the rest of the app still boots.

### Public hero search (optional)

`GEMINI_API_KEYS`, `GROQ_API_KEYS`, `OPENROUTER_API_KEYS`, `MISTRAL_API_KEYS`,
`CEREBRAS_API_KEYS` — each a **comma-separated** list, tried in order; a key
that reports a quota error is parked until the next UTC midnight.
`LLM_PROVIDER_ORDER` overrides the try order. `SEARCH_QUOTA_SECRET` signs the
per-visitor quota cookie (10 calls / 5 hours) and falls back to `CRON_SECRET`.

With none of these set, hero search stays keyword-only. It never errors — it
just stops handling freeform sentences.

### QuestionCall (optional)

`QUESTIONCALL_URL`, `QUESTIONCALL_SSO_SECRET`, `QUESTIONCALL_WEBHOOK_SECRET`.
With no SSO secret the study button opens a plain link instead of a signed
hand-off. With no webhook secret the conversion callback answers `503` rather
than trusting an unauthenticated caller.

### Cookies, limits, logging

`COOKIE_DOMAIN`, `COOKIE_SECURE`, `LOG_LEVEL`, `PUBLIC_FORM_RATE_LIMIT_MAX`
(default 10), `PUBLIC_FORM_RATE_LIMIT_WINDOW_SECONDS` (default 60),
`UPLOAD_MAX_IMAGE_BYTES` (default 5 MB), `UPLOAD_MAX_DOCUMENT_BYTES`
(default 10 MB), `ALLOWED_IMAGE_MIME_TYPES`, `ALLOWED_DOCUMENT_MIME_TYPES`.

Session cookies set `secure` from `NODE_ENV === "production"` directly, so
`COOKIE_SECURE` does not need to be set in production.

### Firebase (Phase 6 only)

`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` — leave
blank until mobile push is built. See the note in §9.

---

## 3. Secrets Handling

**Never commit:** `.env`, `google-services.json` / `GoogleService-Info.plist`,
anything holding a real key.

**Always commit:** `.env.example`.

**Server-only** (never exposed to a client bundle): `MONGODB_URI`,
`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `OTP_HASH_SECRET`,
`R2_SECRET_ACCESS_KEY`, `R2_ACCESS_KEY_ID`, `RESEND_API_KEY`, `CRON_SECRET`,
`PERSONAL_DATA_ENCRYPTION_KEY`, `GOOGLE_MAPS_API_KEY`, every `*_API_KEYS` list,
`QUESTIONCALL_*_SECRET`, `FIREBASE_PRIVATE_KEY`.

**Client-accessible** (must carry the `NEXT_PUBLIC_` prefix):
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`,
`NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`.

Only `NEXT_PUBLIC_*` variables may reach the browser. `next.config.ts` also
explicitly re-exports `NEXT_PUBLIC_GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_ID`
through its `env` block — the latter is a public client ID, not a secret.

---

## 4. Local Setup

```bash
# 1. Clone and install (npm workspaces — one install covers every workspace)
git clone <repo-url>
cd hostel-management-software
npm install

# 2. Environment
cp .env.example .env
# Fill in at minimum: MONGODB_URI, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET,
# APP_URL, NEXT_PUBLIC_APP_URL, SEED_SUPERADMIN_EMAIL, SEED_SUPERADMIN_PASSWORD

# 3. Seed the initial SUPERADMIN account
npm run db:seed

# 4. Run the web app
npm run web:dev            # http://localhost:3000
```

MongoDB: create the Atlas cluster (or run locally), whitelist your IP, put the
connection string in `MONGODB_URI`.

R2: create the bucket, generate API tokens, set the five `R2_*` vars, configure
CORS for your domain in the Cloudflare dashboard.

Resend: sign up, set `RESEND_API_KEY`, and verify your sending domain before
production.

Google sign-in: create an OAuth 2.0 **Web application** client ID and put the
same value in `NEXT_PUBLIC_GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_ID`. Add your
origin to *Authorized JavaScript origins*. There is no redirect URI to register
and no client secret to store.

---

## 5. Commands

Run from the repo root.

| Command | Purpose |
|---|---|
| `npm run web:dev` | Next dev server |
| `npm run web:build` | Production build |
| `npm run web:test` | Vitest suite |
| `npm run web:lint` | ESLint |
| `npm run web:format` | Prettier write |
| `npm --prefix apps/web run typecheck` | `tsc --noEmit` |
| `npm run db:seed` | Create/refresh the SUPERADMIN account |
| `npm run web:seed:demo` | Seed demo hostel data |
| `npm run web:recover:admin` | Recover a locked-out admin account |
| `npm run web:deploy:check` | Production build as a pre-deploy gate |
| `npm run dev` / `build` / `lint` / `test` / `typecheck` | Same across every workspace via Turborepo |
| `npm run mobile:start` | Expo dev server (`apps/mobile`) |
| `npm run mobile:typecheck` | Mobile `tsc --noEmit` |

Maintenance scripts: `npm run web:check:private-documents`,
`npm run web:backfill:resident-accounts`,
`npm run web:repair:archived-residents`, and
`npm --prefix apps/web run migrate:rooms-to-counts`.

One-shot legacy role migration:

```bash
node --experimental-transform-types packages/db/src/migrate-roles.ts
```

---

## 6. Production Deployment (Vercel)

### Prerequisites
- Vercel account
- MongoDB Atlas **production** cluster (separate from dev)
- R2 bucket for production (separate from dev)
- Resend sending domain verified
- Optional: Google Cloud project with billing enabled for Maps

### Steps

1. **Push to GitHub/GitLab.**

2. **Import the project in Vercel.** It is an npm-workspaces monorepo; set the
   Root Directory to `apps/web`. Framework preset is auto-detected as Next.js.
   `next.config.ts` transpiles `@hostel/db` and `@hostel/shared` from
   `packages/`, so both must be included in the build context.

3. **Set environment variables** in Project Settings → Environment Variables.
   Add everything from `.env.example` with production values. Scope secrets to
   Production; scope preview-safe values to Production + Preview. Remember
   `APP_URL` and `NEXT_PUBLIC_APP_URL` must be the real domain — every email
   link is built from them.

4. **Schedule the cron jobs on [cron-job.org](https://cron-job.org).**

   > **This project does not use Vercel Cron and has no `vercel.json`.** An
   > earlier draft of this document told you to create one with four
   > `/api/cron/*` paths. Those paths do not exist. The real endpoints are the
   > six below, and `docs/CRON.md` is the authoritative reference for what each
   > one does and why its schedule is what it is.

   Every job: method `POST`, no query parameters, and a header
   `x-cron-secret: <CRON_SECRET>` (cron-job.org → job → *Advanced* → *Headers*).
   A secret in a URL leaks into access logs, so the query-param form is not
   accepted.

   | Endpoint | Suggested schedule |
   |---|---|
   | `POST /api/v1/cron/purge-expired-otps` | daily — `0 3 * * *` |
   | `POST /api/v1/cron/payment-reminders` | daily — `0 2 * * *` |
   | `POST /api/v1/cron/complaint-sla` | daily — `0 4 * * *` |
   | `POST /api/v1/cron/attendance-maintenance` | daily — `0 5 * * *` |
   | `POST /api/v1/cron/refresh-nearby-places` | hourly — `0 * * * *` |
   | `POST /api/v1/cron/notification-dispatch` | every 15 min — `*/15 * * * *` |

5. **Deploy.** Vercel builds on push to `main`; PRs get preview deployments.

### Post-Deployment Checks

- [ ] Homepage loads and lists real published hostels
- [ ] A PUBLIC account can sign up and verify its email
- [ ] The seeded SUPERADMIN can log in
- [ ] Hostel registration submits and appears in the approval queue
- [ ] File uploads reach R2 (not the local-disk fallback)
- [ ] Emails deliver — check the Resend dashboard
- [ ] Each cron job returns 200 with the secret and 401 without it
- [ ] MongoDB connection stable — check Atlas metrics

---

## 7. Database Migrations (Mongoose)

Mongoose has no formal migration system. What this project does:

- New fields rely on schema defaults — existing documents pick them up on read.
- Breaking changes (renames, type changes) get a one-off script in
  `apps/web/scripts/` or `packages/db/src/`, run manually **before** deploying
  the code that depends on them. Existing examples:
  `migrate-roles.ts`, `migrate-rooms-to-counts.mjs`,
  `backfill-resident-accounts.mjs`, `repair-archived-residents.mjs`.
- Removing a field means stopping the code from writing it; old data stays until
  a cleanup script removes it.

Indexes are declared on the models themselves, so they are created by Mongoose
on first connection — there is no separate index migration step. Verify them in
Atlas after the first production deploy.

---

## 8. Monitoring & Logging

**Errors:** Sentry is not currently wired up. Adding it is a tracked task
(`TODO.md`, Track B8). Until then, Vercel's function logs are the only trace.

**Logging:** server code uses structured single-line JSON via `console.log` /
`console.warn` / `console.error`, captured by Vercel:

```json
{ "level": "warn", "action": "public_asset_store_failed", "message": "...", "prefix": "activation-qr" }
```

Never log a password (hashed or plain), a JWT, a Google ID token, or a full
user document — `userId` only. See RULES.md §13.

**Performance:** Vercel Analytics (free tier). MongoDB Atlas has built-in
monitoring — set alerts for slow queries, high CPU and connection limits.

---

## 9. Phase 6 (Mobile) Additional Setup

`apps/mobile` is an Expo app; `npm run mobile:start` runs it.

**Push notifications** are delivered through the **Expo push service**
(`https://exp.host/--/api/v2/push/send`), which accepts both Expo push tokens
and raw FCM tokens. That means the server needs **no Firebase Admin SDK and no
`FIREBASE_PRIVATE_KEY`** — the `FIREBASE_*` variables in `.env.example` are
reserved and currently unused. Device tokens are stored in the `DeviceToken`
collection via `POST /api/v1/mobile/device-token`.

For Android builds you still need `google-services.json` from a Firebase
project (gitignored, placed in `apps/mobile/`), because the Expo push service
delivers through FCM underneath.

**EAS Build:** `npm install -g eas-cli`, `eas login`, configure
`apps/mobile/eas.json`, then
`eas build --platform android --profile preview`.

**Store accounts:** Google Play Console (one-time $25) and Apple Developer
($99/yr) are client-payable and out of scope per PRD.md §5.

---

## 10. Troubleshooting

**Cannot connect to MongoDB** — check `MONGODB_URI`, confirm your IP is
whitelisted in Atlas, check Network Access settings.

**Google sign-in not working** — confirm `NEXT_PUBLIC_GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_ID` hold the *same* client ID, and that your origin is listed
under *Authorized JavaScript origins*. There is no redirect URI in this flow, so
a redirect-URI mismatch is never the cause.

**Emails not sending** — check `RESEND_API_KEY`, verify the sending domain,
check the Resend dashboard. With no key configured `sendEmail()` logs and
returns without throwing, so the feature that triggered it will look like it
succeeded.

**R2 uploads failing** — all five `R2_*` variables must be present or the code
silently uses the local-disk fallback. Check CORS in Cloudflare and that the
bucket name matches.

**Cron returns `500 CRON_NOT_CONFIGURED`** — `CRON_SECRET` is not set in the
deployed environment.

**Cron returns `401 UNAUTHORIZED`** — the `x-cron-secret` header value does not
match, or the job is using a query parameter instead of a header, or it is
pointed at the wrong domain. Confirm the method is `POST`.

**Map not loading** — with Google Maps, check the browser key's referrer
restriction; with OpenStreetMap, check that the Leaflet CSS is imported and look
at the browser console.

**Resident profile endpoints failing** — `PERSONAL_DATA_ENCRYPTION_KEY` is
missing or not a valid 32-byte base64/hex value.

---

## 11. Location Tracking Defaults

Platform-level defaults live in the `PlatformSetting` document keyed
`operations`; per-hostel values live on `HostelSettings.attendance`. They are
**not** environment variables — they are edited in the platform portal so they
can change without a deploy. See docs/CRON.md and ARCHITECTURE.md §8.4.

Shipped defaults: inside zone 50 m, nearby zone 200 m, tracking at 08:00 /
18:00 / 22:00, retention 600 days (platform maximum 1095), absence alert at 14
consecutive days.

---

_End of ENVIRONMENT.md_
