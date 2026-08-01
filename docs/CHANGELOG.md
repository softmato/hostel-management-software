# CHANGELOG.md

Format follows [Keep a Changelog](https://keepachangelog.com/) — sections per release: `Added`, `Changed`, `Fixed`, `Removed`. Newest at the top. Update this alongside `MEMORY.md` whenever a phase or notable milestone completes.

---

## [Unreleased]

### Planned
- Phase 1: Turborepo monorepo scaffold, MongoDB connection, Mongoose models, unified auth system, hostel onboarding/approval
- Phase 2: Public discovery site, hostel profile pages, room/bed management
- Phase 3: Resident system, QR activation, payments, food menu, **Cook Portal**, **residentType tracking**
- Phase 4: Complaints, night safety, ratings, guardian dashboard, **Location Tracking & Auto-Attendance**, **Community Feature**
- Phase 5: Referrals, service providers, maintenance, **QuestionCall Integration**, **Advanced Notifications**, **Configuration System**, final polish
- Phase 6: React Native mobile app with QR scanning, push notifications, **background location service**, **cook mobile app**, **community mobile**

---

## [0.6.0] - 2026-08-01 — Phases 1-3 closed out

### Fixed
- **The login endpoint the app actually calls had no rate limit.** Two auth surfaces had been kept
  alive side by side: `/api/auth/*` (built to the docs, rate limited) and `/api/v1/auth/*` (what the
  web and mobile clients call, not rate limited). The PHASES.md §1.1 control existed but sat on the
  path nobody used. Everything is now under **`/api/v1/auth/*`**, with the 5-attempts-per-15-minutes
  limit on login and 10-per-15-minutes on Google sign-in, covered by a regression test that asserts
  the 6th attempt never reaches the credential check.
- **The password-reset page was a mockup.** `/reset-password` rendered static fields and a link
  styled as a submit button; it called no endpoint, so the flow could never complete even though the
  backend had worked all along. Rebuilt as a real two-step flow — request a link, then set the new
  password from the emailed token — with the server's own error text surfaced.
- **The public home page advertised hostels that did not exist.** Every card, rating and category
  count came from a hard-coded `MOCK_HOSTELS` array: invented names, invented review counts, and
  tiles claiming "125 hostels" on a platform with two. Clicking any card 404'd. The page now reads
  the same published set as the listing, **on the server**, with all counts derived and a real empty
  state per row.
- Three `resident.service` tests were failing against the duplicate-phone guard added with the
  intake rework; the mock now covers the pre-check, plus a new test for the guard itself.
- All remaining ESLint errors and warnings cleared (internal `<a>` → `next/link`, a `setState`-in-effect
  cascade, unused imports and state, a `next/image` alt-text false positive from a lucide icon named
  `Image`).

### Changed
- Session cookies are written and cleared through `applySessionCookies()` / `clearSessionCookies()`
  everywhere, replacing four hand-rolled copies that had already drifted on the refresh-cookie path.
- **`FoodMenu` → `FoodRoutine`.** A hostel's menu is one repeating weekly document rather than dated
  rows: the old shape forced every week to be re-entered, let "this week" and "next week" disagree,
  and stored the month-end special as that day's dinner, overwriting it.
- `docs/API.md` reconciled with the shipped API — the real response envelope and error-code casing,
  a new §1.5 recording the `/api/v1` prefix and the `superadmin`→`platform` / `staff`→`wardens`
  renames, corrected paths on every row that has an implementation, and explicit ⏳ **Not built** /
  ↔ **Superseded** flags on the rest. No Phase 1-3 row is unbuilt.
- `docs/DATABASE.md` reconciled likewise: `HostelStaff`→`HostelMember`, `PlatformConfig`→
  `PlatformSetting`, and the `Room`/`Bed` collections rewritten as `Hostel.roomConfigurations` with
  the reasoning for tracking room types instead of individual beds.

### Removed
- The duplicate `/api/auth/*` route tree.
- `/otp` and `auth-experience-page.tsx` — simulated auth screens that resolved with `setTimeout` and
  navigated to `/login` without verifying anything. Nothing linked to them.
- `MOCK_HOSTELS`; the file is now `public-home-content.ts` and holds site copy only.

---

## [0.5.2] - 2026-07-23 — Cook credential hand-off + dashboard visibility

### Added
- **Cook credentials visible in the dashboard.** The Food page's Cook Portal panel now shows the
  login address, when the password was last issued, and whether the emailed hand-off password is
  still unused — plus the password itself once, immediately after issuing or rotating.
  `GET /api/v1/hostel-admin/cook-portal` returns `cookEmail`, `credentialIssuedAt` and
  `initialPasswordPending`. Only the bcrypt hash is ever stored, so the current password is
  deliberately **not** retrievable once a cook has set their own; recovery is a rotation.
- **First-login password hand-off.** Cook accounts are created with `mustChangePassword: true`, so
  the first cook to sign in must choose a new password. Because the account is shared, that password
  becomes the kitchen's, and `changePassword()` already revokes every session — the other cooks sign
  in again with the new one. No new auth code was required.
- `HostelSettings.cookCredentialIssuedAt`.

### Changed
- Both cook emails now label the value "First-time password" and explain that the first cook to sign
  in sets the shared password.

### Fixed
- **Warden permission flags are now enforced.** They were previously stored and rendered in the UI
  but read by nothing at request time, so unchecking a capability changed the UI without changing
  what the warden could call. New `requireHostelCapability(request, key)` in `lib/api-auth.ts`
  narrows a warden's `principal.hostelIds` to the hostels granting that flag — since every service
  already scopes queries by `principal.hostelIds`, enforcement propagates without touching a single
  service. No grant → 403 `CAPABILITY_DENIED`. HOSTEL_ADMIN skips the check entirely.
  - Applied across 38 hostel-admin route files. Reads stay open to all staff
    (`GET /residents`, `GET /residents/[id]`, `GET /profile`); writes require the capability.
  - Permissions are read per request from `HostelMember` rather than embedded in the JWT, so a
    revoked capability applies immediately instead of at the next token refresh.
  - Not covered by the 11 keys and therefore still plain staff gates: inquiries, referrals, reports,
    service-providers, sos-alerts.
  - 6 new tests in `lib/warden-capability.test.ts`, including multi-hostel narrowing.

---

## [0.5.1] - 2026-07-23 — Cook credentials at approval + shared-credential hardening

### Added
- **Cook credentials issued at hostel approval.** `provisionCookAccount()` extracted from the portal
  toggle and called from `approvePlatformHostel`, so the shared kitchen login is created the moment a
  superadmin approves — its credentials ride along in the approval email under a "Cook portal access"
  section (PHASES.md §3.1). Provisioning failure is logged and swallowed: it can never block an
  approval.
- **Food-ready cooldown** (`operations.foodReadyCooldownMinutes`, default 120). A second announcement
  for the same meal inside the window is rejected with `FOOD_READY_COOLDOWN` (429). This bounds the
  one action a leaked cook password can abuse — spamming every resident's notifications.
- **Rotate Cook Password** action on the admin Food page, for when staff leave or a shared password
  is suspected to have spread. Re-running the enable path always mints a fresh password and
  invalidates the old one.
- `lib/cook-role-containment.test.ts` — pins the COOK blast radius: not hostel staff, not platform,
  cannot pass resident/guardian gates, has no portal landing path or allowed redirect prefixes. Any
  future change that widens COOK's reach fails here first.
- `modules/hostels/approval-cook-credentials.test.ts` — proves approval provisions the account, puts
  the credentials in the email with the shared-credential warning, and still approves if cook
  provisioning throws.

### Changed
- Registration form copy corrected. It previously promised "a Cook App login for **each** cook" and
  that warden credentials were generated at approval — neither was true. It now states one shared
  kitchen login (generated at approval, rotatable) and that warden logins are created by the hostel
  admin from their dashboard.
- Approval email's cook section spells out that the login is shared, should be rotated when staff
  leave, and cannot reach payments, complaints, or resident contact details.

### Known gap
- `cookCount` from the registration form is still only flattened into the free-text `ownerNote`
  ("Cooks: 3 · Floors: 4 · …") and read by nothing. Harmless while one shared login is the model,
  but it should become a structured `HostelSettings` field if per-cook accounts are ever revisited.

---

## [0.5.0] - 2026-07-23 — Phase 3: Resident system (gap completion)

### Added
- **QR activation delivery**: `qrcode` dependency; activation codes now render a QR PNG of the
  activation link, stored via `lib/public-upload.ts` (R2 when configured, `public/uploads/activation-qr/`
  otherwise) and embedded in a new `resident/qr-activation` email alongside the typed fallback code.
  `/resident-activation` prefills the code from `?code=`.
- **Operations platform settings** (`modules/platform-config/operations-config.ts`, `PlatformSetting`
  key `operations`): `qrActivationExpiryDays` (default 7, now drives code expiry),
  `paymentReminderDaysBefore`, `sendNoticeEmails`, `sendPaymentEmails`, `receiptNumberPrefix`. Reads
  never throw — a missing or malformed document falls back to the shipped defaults.
- **Payment proofs carry money**: `PaymentProof.amount` / `paymentMethod` / `referenceNote`.
  Verification adds the proof's amount to `Payment.paidAmount` and settles to `PAID` or `PARTIAL`
  instead of always closing the month in full.
- **Sequential receipts**: `RCP-YYYY-MM-#####`, allocated per month with duplicate-key retry against
  the unique `receiptNumber` index. One receipt per payment; re-verification updates its amount.
- **Fee management**: `Resident.monthlyFee`; `PATCH /api/v1/hostel-admin/residents/fees` (bulk or
  per-resident) and `POST /api/v1/hostel-admin/payments/generate` — an idempotent monthly fee run that
  skips residents already billed for the month and those with no fee to bill. "Monthly Fee Run" panel
  added to the admin payments page.
- **Payment reminder cron**: `POST /api/v1/cron/payment-reminders` +
  `modules/payments/payment-reminders.service.ts`. Reminds exactly `paymentReminderDaysBefore` days
  ahead, flips past-due records to `OVERDUE`, and chases on day 1, day 3, then weekly.
- **Six more email templates**: `payment/{payment-due-reminder,payment-overdue,proof-uploaded,
  payment-verified,payment-rejected}` and `resident/new-notice`, plus `hostel/cook-portal-enabled`.
- **Notice fan-out**: publishing a notice writes an in-app `Notification` for every active resident
  and emails them when `sendNoticeEmails` is on.
- **Resident type classification**: `Resident.residentType` (STUDENT / WORKING_PROFESSIONAL / OTHER,
  default STUDENT) through model, validation, list filter, API and the admin registration form.
- **Cook portal**: `HostelSettings` and `FoodReadyLog` models; `modules/food/cook.service.ts`;
  `GET/PATCH /api/v1/hostel-admin/cook-portal` (enable → generated COOK account with a rotated
  password, credentials emailed to the hostel admin; disable → account suspended) and
  `GET/POST /api/v1/cook/food-ready`, which logs the announcement and notifies every active resident.
  Toggle panel added to the admin food page. The cook's own mobile screens remain Phase 6.
- 23 new unit tests (reminders, fee runs, partial payments, receipt sequencing, cook portal,
  activation delivery, notice broadcast).

### Changed
- Notification side-effects across activation, payments, and notices are wrapped so a delivery
  failure can never fail the action that has already been persisted.
- `docs/CRON.md` documents the payment-reminder job and backfills the previously undocumented
  nearby-places refresh job.

---

## [0.4.0] - 2026-07-22 — Phase 2: Public discovery + hostel core (gap completion)

### Added
- **Warden Management** (HOSTEL_ADMIN only): `modules/wardens/` service + validation (11 capability flags
  on `HostelMember.permissions`), `GET/POST /api/v1/hostel-admin/wardens` + `PATCH/DELETE …/[id]`,
  `requireHostelAdminPrincipal` gate, `/hostel-admin/wardens` page + nav, and 4 service unit tests. Account
  create/upgrade reuses the §3.2 `registerOrUpgradeUserByEmail` flow (no duplicate users).
- **Public SEO**: dynamic `generateMetadata` on the hostel detail page (title/description/OpenGraph/
  canonical), static metadata on home/listing/compare, `app/sitemap.ts` (static routes + all published
  hostels) and `app/robots.ts`; `lib/site.ts` base-URL helper + `metadataBase`/title template in root layout.
- **TanStack Query + Zustand**: `QueryProvider` in root layout; hooks `useHostels`/`useCompareHostels`,
  `useRoomMap`/`useResidents`/`useHostelWardens`; stores `useHostelFiltersStore`, `useComparisonStore`
  (persisted comparison tray), `useUiStore` (mobile filter drawer). Wired into the listing, compare,
  residents, and wardens pages.
- **Maps integration** (ARCHITECTURE.md §4): `lib/maps/*` — provider detection (`getMapProvider` /
  `useMapProvider`), Nominatim geocoding with a coarse area/city fallback, Overpass nearby-places, haversine;
  `components/maps/*` — Leaflet default (SSR-safe dynamic import) + Google Maps Embed fallback + `HostelMap`
  switcher. `Hostel.nearbyPlaces`/`nearbyPlacesLastUpdated` added; profile address-save re-geocodes;
  `POST /api/v1/cron/refresh-nearby-places` batch refresh. Hostel detail page renders the live map + nearby
  places; listing gains a "Near my college" proximity filter (`lib/maps/nepal-colleges.ts`).

### Changed
- Public hostel serialization now includes `coordinates` + `nearbyPlaces`.
- Relocated in-progress owner application routes out of a Next.js dynamic-segment conflict:
  `api/v1/public/hostels/[id]/…` → `api/v1/public/hostel-applications/[id]/resubmit-documents` and
  `…/hostel-applications/my-applications` (kept `[slug]` for public hostel detail); callers updated.

---

## [0.3.2] - 2026-07-21 — Infra: R2, email, cron (patterns ported from QuestionCall)

### Added
- **Cron infrastructure** (external scheduler, cron-job.org): `lib/cron-auth.ts` `validateCronRequest()`
  (timing-safe, header-only `x-cron-secret` / `Authorization: Bearer`, env-only `CRON_SECRET`), a first
  job `POST /api/v1/cron/purge-expired-otps` (idempotent backup sweep alongside the OTP TTL index),
  `docs/CRON.md`, and 4 cron-auth unit tests.
- **R2 helpers**: `getPublicUrl()` (public-bucket URLs via `R2_PUBLIC_URL`) and `deleteFromR2()`.

### Changed
- **R2 optimization**: image variants now upload with `Cache-Control: public, max-age=31536000, immutable`
  (CDN/browser caching); S3 client sets explicit `maxAttempts: 3` retry. (The `sharp` WebP variant
  pipeline in `image-optimizer.ts` already existed.)
- **Email sender**: `From` header now resolves `EMAIL_FROM` → else `RESEND_FROM_NAME` + `RESEND_FROM_EMAIL`
  combined into `Name <email>` (backward compatible).
- **Env**: `.env`/`.env.local` now carry R2 + Resend creds **borrowed temporarily from the QuestionCall
  project** (git-ignored, banner-marked "REPLACE LATER"); `CRON_SECRET` added. `.env.example` documents
  `R2_PUBLIC_URL`, `RESEND_FROM_NAME`, and the cron-job.org secret (placeholders only).

### Notes
- Only R2 + Resend secrets were borrowed — no other QuestionCall credentials. Replace with dedicated
  accounts before production. Cron uses cron-job.org, not Vercel Cron.

---

## [0.3.1] - 2026-07-21 — Phase 1 code-side completion

### Added
- **Audit log viewer (read-only)** in the platform owner portal (PHASES.md §1.1): `audit.service.ts`
  `listPlatformAuditLogs()` (newest-first, capped, actor/hostel labels resolved) + `audit.validation.ts`,
  `GET /api/v1/platform/audit-logs` (SUPERADMIN-gated), `/platform/audit-logs` page + component + nav item.

### Changed
- **ARCHITECTURE §3.2 high-privilege upgrade safeguard**: raising a PUBLIC account to HOSTEL_ADMIN/
  SUPERADMIN now rotates to a fresh emailed temporary password with `mustChangePassword`, so the elevated
  role cannot be exercised with an un-verified pre-existing password. RESIDENT/WARDEN/GUARDIAN upgrades are
  unchanged (immediate, credentials preserved).
- **Production file naming** (no `phase*` filenames): `phase5-shared.tsx`→`portal-shared.tsx` (8 importers),
  `phase2-hostel-routes.test.ts`→`platform-hostel-routes.test.ts`, `phase5-routes.test.ts`→`growth-routes.test.ts`.

### Fixed
- Typecheck regression: `user.service.test.ts` mock was missing `mustChangePassword` (TS2339).
- **Production build is now green** (exit 0); the prior session's build verification is complete.

### Tested
- Suite 95/95 (added 3 audit-service tests + 1 §3.2 safeguard test). Typecheck + ESLint clean (0 errors).
- Verified Phase 1 model index coverage against DATABASE.md "Indexing Strategy Summary" — no gaps.

### Notes
- Remaining Phase 1 items are external infra (Cloudflare R2 bucket, live Resend delivery test, dev-DB role
  migration) or deliberately deferred (app-wide envelope migration, dedicated repositories layer). See
  `TODO.md` and MEMORY.md resume point.

---

## [0.3.0] - 2026-07-20 — Phase 1 alignment (in progress, ~90%)

### Added
- Monorepo workspace per FOLDER_STRUCTURE.md: root npm workspaces + `turbo.json`; real `packages/db` (61 models migrated from `apps/web`, `connection.ts`, `seed.ts` for SUPERADMIN, `migrate-roles.ts`) and `packages/shared` (canonical Role/enums, auth Zod schemas, Resend `sendEmail()`, 7 Phase 1 email templates).
- Docs-standard auth API at `/api/auth/*`: signup with email-verification link (+ `/verify-email` page), resend-verification, login (verified-email gate, `redirectPath`, `mustChangePassword`, rate limiting), google, refresh, logout, me, change-password, forgot/reset-password with session revocation.
- Account upgrade mechanism (ARCHITECTURE §3.2) `registerOrUpgradeUserByEmail()` with AuditLog entries + credential/upgrade emails; wired into hostel approval (PUBLIC owner → HOSTEL_ADMIN with temp credentials when needed).
- Phase 1 emails wired: submission-received, hostel-approved, hostel-rejected.
- `.env.example` at repo root; README rewritten with monorepo setup.

### Changed
- Roles aligned to DATABASE.md: `PLATFORM_OWNER→SUPERADMIN`, `HOSTEL_OWNER→HOSTEL_ADMIN`, `PUBLIC_USER→PUBLIC`, removed `SERVICE_PROVIDER` role, added `PLATFORM_MODERATOR`/`COOK`. User model gains `emailVerified`, `authProvider`, `googleId`, `mustChangePassword`, `tokenVersion`.
- Public hostel registration now creates the owner as `PUBLIC`; upgrade happens at approval time.

### Fixed
- 10 pre-existing test failures (stale mocks); suite now 91/91 green. Pre-existing type errors and the `portal-shell` lint error. Several `useSearchParams()`-without-Suspense prerender crashes (build verification still pending — see MEMORY.md resume point).

### Known deviations
- npm workspaces instead of pnpm; legacy `/api/v1/*` routes retained; response envelope `{ success, message, data|errorCode }`; `.ts` email templates; Google ID-token flow. Details in MEMORY.md.

---

## [0.2.0] - 2026-07-14 (Late)

### Added

**Major Features (Documentation Only - Implementation in Phases 3-6):**

- **Cook Portal** (Phase 3):
  - Dedicated mobile app for cooks with "Food Ready" button
  - Push notifications to all residents when meal is ready
  - Device fingerprint tracking for multiple cooks
  - Food timing analytics for admin dashboard
  - Cook credentials auto-generated during hostel registration

- **Community Feature** (Phase 4):
  - Resident social feed with PUBLIC/HOSTEL_ONLY visibility
  - Posts, comments, reactions (6 types: like, love, care, haha, sad, angry)
  - Anonymous posting option
  - Admin moderation tools, profanity filter, reporting system
  - Push notifications for engagement

- **Location Tracking & Auto-Attendance** (Phase 4):
  - Privacy-first: NEVER stores exact GPS coordinates, only zone status
  - Background service pings 3x daily (morning, evening, night - configurable)
  - Zones: INSIDE (0-50m), NEARBY (51-200m), OUTSIDE (201m+), UNKNOWN
  - Attendance dashboard with real-time view and patterns
  - Attendance alerts if resident absent X consecutive days (default: 14)
  - Auto-delete location data after 600 days (configurable)
  - Resident can request location history deletion

- **QuestionCall Integration** (Phase 5):
  - Study platform button for STUDENT residents only
  - Click tracking and conversion analytics
  - Superadmin dashboard with CSV export
  - Single sign-on with signed JWT

- **Advanced Notifications** (Phase 5):
  - Priority levels: INFO, NORMAL, URGENT
  - Categories: FOOD_READY, PAYMENT, ATTENDANCE, SOS, COMMUNITY, etc.
  - Target: all residents, specific residents, specific floor/room, platform-wide
  - Scheduled notifications with delivery stats
  - Read receipts (who read, who didn't)

- **Configuration System** (Phase 5):
  - Two-level hierarchy: Platform defaults + Hostel overrides
  - Hostel admin configurable: geofence radius, tracking times, data retention, cook portal, community
  - Superadmin can override any hostel setting
  - Platform enforces min/max limits

- **Privacy & Compliance**:
  - Consent logging for terms, privacy policy, location tracking
  - Account deletion with 60-day grace period
  - Data retention policies with auto-cleanup
  - GDPR-style user rights (access, erasure, portability)
  - **PRIVACY_POLICY.md** created with location tracking transparency

**Database Changes:**
- Added **COOK** role to User model
- Added **residentType** field to Resident (STUDENT/WORKING_PROFESSIONAL/OTHER)
- Added **facilityDetails** to Hostel (totalToilets, parkingCapacity, hasGarden, hasCCTV, etc.)
- **14 new models**: Notification, NotificationReceipt, FoodReadyLog, AttendanceLog, AttendanceAlert, CommunityPost, CommunityComment, CommunityReaction, QuestionCallClick, HostelSettings, PlatformConfig, ConsentLog, AccountDeletionRequest
- **5 new enums**: NotificationPriority, NotificationCategory, LocationZone, CommunityPostVisibility, ResidentType

**API Changes:**
- **60+ new endpoints** across Cook Portal, Community, Location Tracking, Notifications, QuestionCall, Configuration, Privacy
- Enhanced hostel profile PATCH with facilityDetails
- Enhanced resident registration POST with residentType

**Architecture Changes:**
- Push Notification Architecture (FCM + APNS)
- Location Tracking Architecture (privacy-first zone calculation)
- Community Feature Architecture (moderation system)
- Cook Portal Architecture (device fingerprint tracking)
- Configuration System Architecture (two-level hierarchy)
- Account Deletion Architecture (60-day grace period)

**Documentation Updates:**
- DATABASE.md: 14 new models, enhanced Resident and Hostel models
- API.md: 60+ new endpoints
- PHASES.md: Features integrated into Phases 3-6
- ARCHITECTURE.md: 7 new major sections
- RULES.md: 6 new rule sections
- PRIVACY_POLICY.md: Created (321 lines)
- MEMORY.md: New features documented
- CHANGELOG.md: This entry

---

## [0.1.0] - 2026-07-14

### Added
- Complete `docs/` documentation set (13 files):
  - `README.md` — documentation index + tech stack summary
  - `PRD.md` — full product requirements with personas, goals, auth model
  - `ARCHITECTURE.md` — system architecture with MongoDB, smart maps fallback, PlatformConfig pattern
  - `DATABASE.md` — complete Mongoose schemas for 30+ collections with TypeScript interfaces
  - `EMAIL_SYSTEM.md` — comprehensive email trigger specifications (30+ scenarios)
  - `API.md` — API endpoint contracts (to be created in next phase)
  - `PHASES.md` — 6-phase development roadmap (to be created)
  - `RULES.md` — AI coding rules & constraints (to be created)
  - `DESIGN.md` — UI/UX guidelines (to be created)
  - `FOLDER_STRUCTURE.md` — monorepo organization (to be created)
  - `CODING_STANDARDS.md` — code conventions (to be created)
  - `ENVIRONMENT.md` — env vars & setup (to be created)
  - `TESTING.md` — testing strategy (to be created)
  - `MEMORY.md` — running project state tracker
  - `CHANGELOG.md` — this file

### Tech Stack Finalized
- **Database:** MongoDB + Mongoose (instead of PostgreSQL + Prisma from v2 docs)
- **Backend:** Next.js 14+ App Router (full-stack)
- **UI:** shadcn/ui + Tailwind CSS + lucide-react
- **State:** TanStack Query + Zustand
- **Auth:** Custom JWT + Google OAuth with unified login + account upgrade mechanism
- **Email:** Resend with template system (30+ scenarios documented)
- **File Storage:** Cloudflare R2
- **Maps:** OpenStreetMap + Leaflet (default) with runtime fallback to Google Maps Platform
- **Mobile:** React Native + Expo (Phase 6)
- **Hosting:** Vercel

### Key Architecture Decisions
- **Multi-tenancy:** Application-layer isolation via `hostelId` filtering on all hostel-scoped queries
- **Account upgrade:** Existing PUBLIC accounts are upgraded in place (not duplicated) when admin-registered
- **Email verification:** Required for all PUBLIC signups
- **PlatformConfig:** Runtime-configurable values cached for performance
- **Smart maps fallback:** Auto-detect Google Maps availability at runtime, fall back to OSM if unavailable/unconfigured
- **Timeline:** 5 weeks for web (Phases 1-5) + 2-3 weeks for mobile (Phase 6) = ~7-8 weeks total

### No Code Changes Yet
This release is documentation-only. No application code has been written. Next step is Phase 1 implementation kickoff.

---

## Template for Phase Completions

Copy this for each phase completion:

```markdown
## [Phase X] - YYYY-MM-DD

### Added
- (list new features)

### Changed
- (list modifications)

### Fixed
- (list bug fixes)

### Tested
- (list test coverage added)

### Notes
- (any decisions, risks, or context for next phase)
```

---

_End of CHANGELOG.md_
