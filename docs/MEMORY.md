# MEMORY.md — Running Project Memory

This file is the project's working memory across coding sessions. Update it every time meaningful work happens — don't let it go stale. An AI assistant picking up this project should read this file first, before PHASES.md, before touching code.

---

## Completed Work

- **2026-07-14** — Full `docs/` set created: README, PRD, ARCHITECTURE, DATABASE (MongoDB+Mongoose), EMAIL_SYSTEM, FOLDER_STRUCTURE, PHASES, RULES, DESIGN, CODING_STANDARDS, ENVIRONMENT, TESTING, MEMORY, CHANGELOG. No code written yet.
- **2026-07-14 (Late)** — Documentation updated with 7 major new features: Cook Portal, Community Feature, Location Tracking/Auto-Attendance, QuestionCall Integration, Advanced Notifications, Configuration System, Privacy Policy. All features integrated into DATABASE.md, API.md, PHASES.md, ARCHITECTURE.md, RULES.md, PRIVACY_POLICY.md.
- **2026-07-20 — Phase 1 alignment session (IMPORTANT CONTEXT):** Contrary to the older note above, a large codebase ALREADY EXISTED in `apps/web` (built under the deleted `sprints.md` spec: 60+ models, 18 service modules, all portals, `/api/v1/*` routes, OTP-based auth). This session aligned it to `docs/`:
  1. **Monorepo scaffold** — root `package.json` with npm workspaces (`apps/web`, `packages/db`, `packages/shared`) + `turbo.json` + turbo devDependency. **Deviation:** npm workspaces instead of pnpm (pnpm not installed on the machine; corepack shim needs admin). `packages/database` and `packages/ui` are obsolete empty placeholders — delete manually (agent tooling blocked deletes).
  2. **packages/db** — all 61 Mongoose models moved from `apps/web/src/models` (git mv, history preserved), `connection.ts`, `seed.ts` (SUPERADMIN, run via `npm run db:seed`), `migrate-roles.ts` (one-shot legacy→canonical role migration; NOT yet run against the dev DB). `apps/web` imports via `@hostel/db/models/*`; `@/lib/db` is a thin re-export.
  3. **packages/shared** — canonical `Role` enum + `LEGACY_ROLE_MAP`, all DATABASE.md enums, auth Zod schemas, `sendEmail()` (Resend REST; logs + no-throw when unconfigured), 7 Phase 1 email templates (**deviation:** plain `.ts` HTML-string templates, not React Email `.tsx`).
  4. **Role alignment** — `PLATFORM_OWNER→SUPERADMIN`, `HOSTEL_OWNER→HOSTEL_ADMIN` (merged), `PUBLIC_USER→PUBLIC`, `SERVICE_PROVIDER` role removed (directory only), added `PLATFORM_MODERATOR` + `COOK`. Updated route-access, permissions, seed/demo scripts. **Existing dev-DB users still carry legacy role strings until `migrate-roles.ts` is run.**
  5. **User model** — added `emailVerified`, `authProvider`, `googleId`, `mustChangePassword`, `tokenVersion` per DATABASE.md (kept richer `status` enum + soft-delete fields).
  6. **Auth flows (ARCHITECTURE §3)** — new `/api/auth/*` routes: signup (email verification link, JWT purpose token, 24 h), verify-email (+ `/verify-email` page), resend-verification, login (EMAIL_NOT_VERIFIED gate, `redirectPath`, `mustChangePassword`, rate-limited 5/15 min), google (ID-token POST — **deviation** from docs' GET redirect flow; server-side verification per §3.1), refresh, logout, me, change-password, forgot-password, reset-password (tokenVersion-stale check, revokes all sessions). Legacy `/api/v1/auth/*` (incl. OTP flow) kept working — frontend still calls v1.
  7. **Account upgrade (§3.2)** — `registerOrUpgradeUserByEmail()` in `apps/web/src/modules/users/user.service.ts`: create-with-temp-password / upgrade-PUBLIC-in-place / same-role-idempotent / 409 EMAIL_ALREADY_HAS_ROLE; AuditLog entries; credentials-issued or account-upgraded emails. 6 unit tests. **Gap:** §3.2's email-confirmation step before HOSTEL_ADMIN/SUPERADMIN upgrades is NOT implemented (upgrade applies immediately on approval).
  8. **Hostel flow emails** — submission-received on public registration (owner now created as PUBLIC, upgraded at approval), hostel-approved (with temp credentials when owner never had a password), hostel-rejected with reason.
  9. **Tests/quality** — all 91 vitest tests pass (fixed 10 pre-existing failures: stale mocks in `auth.service.test.ts` + `phase2-hostel-routes.test.ts`), `tsc --noEmit` clean, ESLint 0 errors, `.env.example` + README rewritten.

---

## New Features Added (14 July 2026)

**1. Cook Portal (Phase 3):**
- Mobile-only portal for cooks, "Food Ready" notifications, device fingerprint tracking, food timing analytics

**2. Community Feature (Phase 4):**
- Resident social feed with PUBLIC/HOSTEL_ONLY visibility, reactions, comments, moderation, anonymous posting

**3. Location Tracking & Auto-Attendance (Phase 4):**
- Privacy-first (no GPS storage), zone-based tracking (INSIDE/NEARBY/OUTSIDE), 3x daily pings, attendance alerts, 600-day auto-deletion

**4. QuestionCall Integration (Phase 5):**
- Study platform button for STUDENT residents, click tracking, conversion analytics, superadmin dashboard

**5. Advanced Notifications (Phase 5):**
- Priority levels, categories, targeted delivery, scheduled notifications, delivery stats, read receipts

**6. Configuration System (Phase 5):**
- Two-level hierarchy (Platform → Hostel), admin-configurable tracking times/geofence/retention, superadmin overrides

**7. Privacy & Compliance:**
- Consent logging, 60-day grace period for account deletion, GDPR-style rights, PRIVACY_POLICY.md created

**Database Impact:**
- 14 new models added: Notification, NotificationReceipt, FoodReadyLog, AttendanceLog, AttendanceAlert, CommunityPost, CommunityComment, CommunityReaction, QuestionCallClick, HostelSettings, PlatformConfig, ConsentLog, AccountDeletionRequest, (plus Cook role in User)

---

## Current Progress

- **Phase:** Phase 3 — Resident System (all code-side deliverables done; remaining = manual/browser QA + external infra).
- **Status (2026-07-23):** build green, typecheck + lint clean, **131/131** unit tests pass. Like Phase 2, this was gap completion on an already-built surface. Delivered: QR image generation + activation email with config-driven expiry (`operations` platform setting), payment proofs that carry an amount/method/reference so a month can settle PARTIAL, sequential `RCP-YYYY-MM-#####` receipts, the 7 Phase 3 email templates, a payment reminder/overdue cron, notice fan-out (in-app + email), `Resident.residentType` + `monthlyFee` with an idempotent monthly fee run, and cook-portal setup with `/api/v1/cook/food-ready`. See CHANGELOG `[0.5.0]`.
- **Phase 3 remaining (not code):** §3.2 acceptance pass against a seeded DB, live Resend delivery test, an R2 bucket for QR images (local-disk fallback covers dev), and a cron-job.org entry for `/api/v1/cron/payment-reminders` with `CRON_SECRET` set. Cook *mobile* screens are Phase 6 by design; the server side they call is done.
- **Prior — Phase 2 (2026-07-22):** public discovery + hostel core.
- **Status (2026-07-22):** typecheck + lint clean, **103/103** unit tests pass. Session of 2026-07-22 filled the Phase 2 gaps on the already-built public/hostel-admin surface: Warden Management (service+API+UI+tests), public SEO (dynamic metadata + `sitemap.ts` + `robots.ts`), TanStack Query + Zustand foundation (wired into listing/compare/residents/wardens), and the full Maps integration (Leaflet + Google embed fallback, provider detection, Nominatim geocoding w/ coarse fallback, Overpass nearby-places caching, refresh cron, "Near my college" filter). Also relocated the in-progress owner-application routes out of a `[id]` vs `[slug]` Next.js route conflict. See CHANGELOG `[0.4.0]`.
- **Phase 2 remaining (not code):** §2.2 acceptance tests + 375px pass + Lighthouse ≥80 (browser QA), and infra — live R2, `CRON_SECRET` on deploy, optional `GOOGLE_MAPS_API_KEY`/`NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`. Public Overpass rate-limits bursts, so nearby-places fill in over cron runs.
- **Prior — Phase 1 (2026-07-21):** Production build GREEN, audit log viewer, §3.2 safeguard, `phase*` files renamed.

### Warden permissions — how enforcement works (built 2026-07-23)

The 11 `WARDEN_PERMISSION_KEYS` flags (`warden.validation.ts`) live on `HostelMember.permissions`
and **are enforced at request time** by `requireHostelCapability(request, key)` in `lib/api-auth.ts`.
(They were display-only until this date — anything written before then is stale.)

**The mechanism, which is the part to understand before changing anything:** the gate does not
merely allow/deny. For a WARDEN it **narrows `principal.hostelIds`** to only those hostels where the
flag is granted, then hands that principal to the service. Because every service already scopes its
queries by `principal.hostelIds`, the restriction propagates for free — no service needed changing,
and a multi-hostel warden is correctly limited per hostel. No grant anywhere → 403 `CAPABILITY_DENIED`.

- HOSTEL_ADMIN holds every capability implicitly and skips the lookup entirely.
- Permissions are read **per request from the DB**, not carried in the JWT, so revoking a capability
  takes effect immediately rather than at the next token refresh. That is a deliberate trade of one
  indexed lookup for correctness.
- **Reads stay open to all staff; writes are gated.** `GET /residents`, `GET /residents/[id]` and
  `GET /profile` use `requireHostelStaffPrincipal`; their POST/PATCH counterparts use a capability.
- **Uncovered by the 11 keys** (still plain staff gates, by design — no flag exists for them):
  inquiries, referrals, reports, service-providers, sos-alerts. Add a key first if these ever need
  to be restricted.
- Covered by `lib/warden-capability.test.ts`. WARDEN remains ~98% of HOSTEL_ADMIN *when every flag
  is granted*; Warden Management itself stays HOSTEL_ADMIN-only via `requireHostelAdminPrincipal`.

### Cook credentials — locked decisions (2026-07-23)

- **One shared cook login per hostel**, not one per cook. Client decision, for simplicity. The
  registration form collects `cookCount`, but it is deliberately **not** used to provision accounts —
  per-announcement attribution comes from `FoodReadyLog.deviceInfo` instead (PHASES.md §3.1).
  `cookCount` currently survives only as free text inside `ownerNote`; make it a structured
  `HostelSettings` field if this is ever revisited.
- **Issued at superadmin approval**, not on an admin toggle, and delivered in the approval email.
  `provisionCookAccount()` in `modules/food/cook.service.ts` is the single path — approval and the
  Food-page toggle/rotate all call it, and every call mints a fresh password.
- **Emailed password is a hand-off credential only.** The cook account is created with
  `mustChangePassword: true`, so the first cook to sign in must choose a new password; because the
  account is shared, that password becomes the kitchen's, and `changePassword()` revokes all
  sessions so the other cooks simply sign in again with it. No new code was needed for this — the
  existing `/api/auth/change-password` flow already skips the current-password check when
  `mustChangePassword` is set.
- **Only the bcrypt hash is stored — never plaintext.** So the dashboard shows the login address,
  `credentialIssuedAt`, and an `initialPasswordPending` status, plus the password *once* right after
  issuing. After a cook sets their own, nobody (including the admin) can read it back; recovery is
  "Rotate Cook Password", which mints a fresh hand-off password. Do not "improve" this by storing
  the plaintext.
- **The shared credential will leak** (kitchen turnover, written on a wall). Accepted, and bounded
  rather than prevented: COOK can reach exactly one endpoint (`/api/v1/cook/food-ready`), has no
  portal landing path, and cannot pass any staff/resident/guardian gate — locked by
  `lib/cook-role-containment.test.ts`. The only abusable action, announcement spam, is capped by
  `operations.foodReadyCooldownMinutes` (default 120). Recovery is "Rotate Cook Password" on the
  Food page. **Do not widen COOK's API surface without re-reading this.**
- **Wardens are NOT provisioned at approval — confirmed client decision, do not re-litigate.**
  Two reasons. Practical: the application form collects no warden identity (no name, no email), so
  there is nothing to create an account from. Security: unlike a cook, a warden can see residents,
  payments and complaints, so a shared or auto-generated warden login turns a leaked password into a
  real data-privacy incident rather than notification spam. Wardens stay admin-created via Phase 2
  Warden Management, where each gets their own real mailbox and the §3.2 upgrade path applies.
  Form copy was corrected to stop promising otherwise.

### 2026-07-23 session — Phase 3, what was done
1. **Operations config** — new `PlatformSetting` key `operations` (`modules/platform-config/operations-config.ts`): `qrActivationExpiryDays`, `paymentReminderDaysBefore`, `sendNoticeEmails`, `sendPaymentEmails`, `receiptNumberPrefix`. Deliberately kept separate from the public site-config sections so a website edit can never change activation/payment behaviour. Reads never throw — bad or missing document → shipped defaults.
2. **QR activation** — added `qrcode`; `generateActivationCode` now renders the activation link as a QR PNG, stores it via the new `lib/public-upload.ts` (R2 when `R2_PUBLIC_URL` is configured, else `public/uploads/activation-qr/`), and emails the resident. Expiry defaults from config instead of a client-supplied `expiresInHours`. `/resident-activation` prefills `?code=` (wrapped in Suspense).
3. **Payments** — `PaymentProof` gained `amount`/`paymentMethod`/`referenceNote`; approval now adds that amount to `paidAmount` and settles `PAID` **or** `PARTIAL`. Receipts moved to sequential `RCP-YYYY-MM-#####` with duplicate-key retry (the `receiptNumber` unique index is the arbiter); one receipt per payment, amount refreshed on re-verification. Emails on proof upload (to admins), verify, and reject.
4. **Fee management** — `Resident.monthlyFee`, bulk `PATCH …/residents/fees`, and `POST …/payments/generate` (idempotent: skips residents already billed for the month and those with no fee); "Monthly Fee Run" panel on the admin payments page.
5. **Cron** — `POST /api/v1/cron/payment-reminders`. Reminds on the *exact* day offset, not every day inside the window, and chases overdue on day 1/3/then weekly, so a stale record can't email someone every morning. Documented in `docs/CRON.md` (which also gained the previously undocumented nearby-places job).
6. **Notices** — publishing fans out in-app `Notification`s to active residents plus emails when `sendNoticeEmails` is on.
7. **Resident type** — `residentType` (STUDENT default) end to end, with an admin list filter.
8. **Cook portal** — `HostelSettings` + `FoodReadyLog` models, `modules/food/cook.service.ts`, `GET/PATCH /api/v1/hostel-admin/cook-portal` and `GET/POST /api/v1/cook/food-ready`. Cook logins are generated (`cook@<slug>.hostelhub.local`) with no real mailbox, so credentials are emailed to the hostel admin and rotate on every re-enable; disabling suspends the account.
9. **Robustness** — every notification side-effect is wrapped: a failed email or contact lookup can never fail an activation, verification, or notice publish that has already been persisted.
10. **Tests** — 23 new unit tests (5 files); suite is 131/131. Pre-existing tests updated for the new proof `amount` and the receipt format.

### 2026-07-21 session — what was done
1. **Build green** — re-ran `npm --prefix apps/web run build` after the prior `useSearchParams()`→Suspense fixes; exit 0, no further prerender errors.
2. **Typecheck fix** — `user.service.test.ts` mock was missing `mustChangePassword` (TS2339); added it. Suite + tsc now clean.
3. **Audit log viewer (read-only)** — PHASES.md §1.1 deliverable. New `apps/web/src/modules/audit/audit.service.ts` (`listPlatformAuditLogs`, actor/hostel labels resolved, capped, newest-first) + `audit.validation.ts`, `GET /api/v1/platform/audit-logs` (SUPERADMIN-gated), `/platform/audit-logs` page + `platform-audit-logs-page.tsx`, nav item, 3 service tests.
4. **§3.2 high-privilege upgrade safeguard** — `registerOrUpgradeUserByEmail` now rotates a PUBLIC→HOSTEL_ADMIN/SUPERADMIN upgrade to a fresh emailed temporary password + `mustChangePassword`, so the elevated role can't be exercised with an un-verified pre-existing password (mailbox-proof). Lower-trust roles (RESIDENT/WARDEN/GUARDIAN) keep credentials. `HIGH_PRIVILEGE_ROLES` set added; 1 new test.
5. **Index audit** — verified the Phase 1 model set (User, Hostel, Room, Bed, HostelDocument, HostelMember, Session, HostelApplication, HostelVerification, AuditLog) already satisfies DATABASE.md "Indexing Strategy Summary" (hostelId compound indexes, unique email/googleId, session TTL). No changes needed.
6. **Production naming** — renamed `phase5-shared.tsx`→`portal-shared.tsx` (8 importers updated), `phase2-hostel-routes.test.ts`→`platform-hostel-routes.test.ts`, `phase5-routes.test.ts`→`growth-routes.test.ts` (via `git mv`, history preserved; `describe()` labels updated). No `phase*`-named source files remain.

---

## RESUME POINT (next session starts here)

**Phases 1–3 are code-complete.** Next code work is **Phase 4 — Trust, Safety & Guardian** (PHASES.md §4): complaints, night safety status, SOS, guardian dashboard, move-in/out checklists, ratings. Note that a lot of that surface already exists from the earlier codebase, so expect the same gap-completion pattern rather than greenfield building — audit what is there before writing anything.

Phase 3 leftovers are all external: seeded-DB acceptance pass (§3.2), live Resend delivery, an R2 bucket so QR images get a public CDN URL instead of the local-disk fallback, and a cron-job.org entry for `/api/v1/cron/payment-reminders`.

The older Phase 1 infra list below is still open and still **external/infra or deliberately deferred** — full list in `TODO.md`:

1. **External infra (needs the user):**
   - Cloudflare R2 bucket + `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` in `.env` (upload helper + validation already coded).
   - Live `RESEND_API_KEY` + verified sender to test the 7 Phase 1 email templates end-to-end.
   - Role migration against the dev DB: `node --experimental-transform-types packages/db/src/migrate-roles.ts` (PLATFORM_OWNER→SUPERADMIN etc.), then `npm run db:seed`.
   - Manual acceptance-test pass (PHASES.md §1.2) against a running instance once the above are provisioned; unit coverage exists for auth/upgrade/§3.2.
2. **Deliberately deferred (not part of a clean Phase 1):**
   - App-wide response-envelope migration (`{ success, message, data|errorCode }` → docs' `{ success, data|error:{code,message} }`) — do in ONE pass later, not piecemeal.
   - Dedicated `packages/db/src/repositories/` layer — tenant scoping is functionally covered by `apps/web/src/modules/*` services + `lib/tenant.ts`.
   - Field-level alignment of all ~60 models + Phase 3–5 model creation — phase discipline defers future-phase work.
3. **Known deviations from docs (decided 2026-07-20, revisit deliberately, don't "fix" casually):**
   - npm workspaces + turbo instead of pnpm (pnpm needs admin install; switch later via `corepack enable`).
   - API stays under `/api/v1/*` for existing portals ("platform" naming instead of docs' "superadmin"); new docs-standard auth lives at `/api/auth/*`. Frontend still calls `/api/v1` via `browser-api.ts`.
   - Response envelope is `{ success, message, data | errorCode }` (existing app-wide) vs docs' `{ success, data | error:{code,message} }`. Migrate app-wide in one pass later, not piecemeal.
   - Email templates are `.ts` HTML-string functions, not React Email `.tsx`.
   - Google auth = Google Identity Services ID-token POST (server-verified), not GET redirect+callback (no GOOGLE_CLIENT_SECRET in env).
   - Hostel model keeps old shape (slug/location object, `PENDING_APPROVAL`/`PUBLISHED` statuses) vs DATABASE.md — reconcile in Phase 2 public-discovery work.
   - `packages/database` + `packages/ui` are dead placeholder dirs — delete manually.

---

## Pending Tasks (Immediate Next Steps)

- [ ] Re-confirm the real project end date with client — original brief said 5 weeks from 22 June 2026; as of 14 July 2026, ~3 weeks have elapsed. Get updated timeline agreement.
- [ ] **Provision infrastructure:**
  - [ ] MongoDB Atlas account + create database
  - [ ] Cloudflare R2 bucket for file storage
  - [ ] Resend account for transactional emails
  - [ ] Google Cloud project (optional for Maps fallback - billing-enabled if client wants Google Maps)
  - [ ] Vercel account for deployment
- [ ] **Phase 1 Kickoff:**
  - [ ] Scaffold Turborepo monorepo per FOLDER_STRUCTURE.md
  - [ ] Set up `apps/web` (Next.js 14 App Router)
  - [ ] Set up `packages/db` with Mongoose connection
  - [ ] Set up `packages/shared` for Zod schemas, types, email templates
  - [ ] Write Mongoose models per DATABASE.md
  - [ ] Create seed script (`packages/db/seed.ts`) that creates the initial SUPERADMIN account
  - [ ] Build unified auth system (ARCHITECTURE.md §3): email/password + Google OAuth + account upgrade logic
  - [ ] Implement email sending infrastructure (EMAIL_SYSTEM.md)
  - [ ] Create hostel registration form (public)
  - [ ] Create superadmin hostel approval portal

---

## Important Decisions (Locked - Don't Re-Litigate)

| Decision | Choice | Where Documented |
|---|---|---|
| Database | **MongoDB + Mongoose** | ARCHITECTURE.md §1, DATABASE.md |
| Backend architecture | **Next.js 14+ App Router** (full-stack, no separate backend) | ARCHITECTURE.md §1 |
| UI library | **shadcn/ui + Tailwind + lucide-react** | ARCHITECTURE.md §1, DESIGN.md |
| State management | **TanStack Query** (server) + **Zustand** (client) | ARCHITECTURE.md §1 |
| Auth | **Custom JWT + Google OAuth**, unified login gateway, admin-issued accounts with email-based account upgrade | ARCHITECTURE.md §3, PRD.md §8 |
| Email | **Resend** with template system (30+ scenarios documented) | EMAIL_SYSTEM.md |
| File storage | **Cloudflare R2** (S3-compatible) | ARCHITECTURE.md §1 |
| Maps | **OpenStreetMap + Leaflet** (default) with runtime fallback to **Google Maps Platform** if env configured | ARCHITECTURE.md §4 |
| Mobile timing | **Phase 6** (post web-launch, ~2-3 weeks after Phase 5) | PHASES.md, PRD.md §6 |
| Payments (v1) | **Manual proof upload + admin verification only**, no live gateway | ARCHITECTURE.md §6, PRD.md §5 |
| Monorepo | **Turborepo + pnpm workspaces** | FOLDER_STRUCTURE.md |
| Timeline | **5 weeks for web** (Phases 1-5) + **2-3 weeks for mobile** (Phase 6) = ~7-8 weeks total | PRD.md, PHASES.md |

---

## Tech Stack Summary (Quick Reference)

**Core:**
- MongoDB Atlas (database)
- Mongoose (ODM)
- Next.js 14+ App Router (full-stack framework)
- TypeScript (strict mode)
- Turborepo + pnpm (monorepo)

**Frontend:**
- React 18+
- shadcn/ui (components)
- Tailwind CSS (styling)
- lucide-react (icons)
- TanStack Query (server state)
- Zustand (client UI state)
- Axios (HTTP client)
- Zod (validation)
- react-hook-form (forms)

**Backend/API:**
- Next.js API Route Handlers
- Mongoose repositories (tenant-scoped queries)
- Custom JWT + Google OAuth 2.0
- Resend (email with templates)

**Infrastructure:**
- Vercel (hosting)
- Cloudflare R2 (file storage)
- OpenStreetMap + Leaflet (maps, default)
- Google Maps Platform (maps, optional runtime fallback)
- Firebase Cloud Messaging (Phase 6, mobile push)

**Mobile (Phase 6):**
- React Native + Expo
- Same REST API as web
- Expo SecureStore (token storage)
- FCM push notifications

---

## Bugs & Fixes

_(None yet — log here as they're found and fixed, with a one-line root cause, once code exists)_

---

## Context Needed for Future Chats

### Critical Architecture Patterns

**1. Account Upgrade Mechanism (ARCHITECTURE.md §3.2)**
This is the single most important piece of custom logic in this app. When a hostel admin registers a new resident/warden/guardian by email:
- System checks if that email already exists as a PUBLIC account
- If YES → upgrade the existing account in place (change role, link profile, keep existing credentials)
- If NO → create new account with temporary password, send credentials
- Never create duplicate User documents for the same email

**2. Multi-Tenancy Enforcement (ARCHITECTURE.md §2, RULES.md §3)**
Every hostel-scoped query MUST filter by `hostelId` from the session, never from client input:
```typescript
// WRONG - client controls hostelId
const rooms = await RoomModel.find({ hostelId: req.body.hostelId });

// RIGHT - session controls hostelId
const rooms = await RoomModel.find({ hostelId: session.hostelId });
```
Use repository functions in `packages/db/src/repositories/` to enforce this pattern.

**3. Privacy Rules (PRD.md §10, RULES.md §5)**
- Night status is COARSE (`Inside/Outside/Not Verified/SOS`) — never GPS coordinates or timestamps visible to guardians
- Guardian access is field-level opt-in, enforced server-side by filtering response fields before sending
- Complaint content is NEVER visible to guardians unless resident explicitly enables it

**4. PlatformConfig Pattern (ARCHITECTURE.md §5)**
- Singleton document in MongoDB (`_id: 'default'`)
- Loaded at server boot → cached in memory → background revalidation
- Client-side: cached via TanStack Query, served from cache immediately, background refetch
- Used for runtime-configurable values (SLA timers, fee reminders, feature flags, pricing)

**5. Email System (EMAIL_SYSTEM.md)**
- All 30+ email scenarios must be implemented as features are built
- Templates live in `packages/shared/email-templates/`
- Sent via Resend using `sendEmail()` helper
- Guardian emails respect opt-in permissions
- SOS emails are highest priority and cannot be disabled

**6. Maps Provider Fallback (ARCHITECTURE.md §4)**
- Default: OpenStreetMap + Leaflet (free, no API key)
- Fallback: Google Maps (if `GOOGLE_MAPS_API_KEY` env var set and valid)
- System auto-detects at runtime which provider to use
- Never expose server API key to client

---

## Open Questions / Risks

1. **Timeline Baseline:** Original 5-week window started 22 June 2026; as of 14 July, ~3 weeks have passed. Need to re-baseline the actual end date with the client so PHASES.md dates are realistic.

2. **Google Maps Billing:** If client wants Google Maps fallback (richer POI data), they need a billing-enabled Google Cloud project. This is client-payable (PRD.md §5). Confirm if they want this or if free OpenStreetMap-only is acceptable.

3. **Automated Payment Gateway:** eSewa/Khalti/connectIPS integration is explicitly deferred (ARCHITECTURE.md §6, PRD.md §5). v1 ships with manual proof upload only. Confirm client understands this limitation.

4. **Mobile App Scope:** Original brief may have implied mobile in the 5-week window. Docs now treat mobile as Phase 6 (post web-launch). Confirm client is aligned with this split.

---

## Performance & Optimization Notes

_(Log here as optimizations are identified during development)_

- MongoDB indexes are defined in DATABASE.md — ensure they're created during first migration
- PlatformConfig caching reduces DB queries for frequently-accessed config values
- TanStack Query caching reduces redundant API calls
- R2 file URLs are pre-signed with short expiry for private files (payment proofs, documents)

---

## Known Limitations (v1 Scope)

Per PRD.md §5, the following are explicitly OUT OF SCOPE for v1:
- Automated payment gateway integration
- SMS/WhatsApp/email provider costs (client-payable)
- Domain, hosting, Play Store fees (client-payable)
- Government certification/legal verification claims
- Long-term maintenance beyond agreed free-support window

---

_End of MEMORY.md — Update this file continuously as work progresses_
