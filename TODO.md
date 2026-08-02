# TODO.md — Remediation Plan (opened 2026-08-02)

Source: full `docs/` conformance audit run 2026-08-02. Every item below is a gap
between what a file in `docs/` requires and what the code actually does, or a
doc that describes something the code no longer does.

Baseline at audit time: `typecheck` clean, `lint` clean, `build` green,
**338/338** tests passing across 50 files. Nothing here is a broken build.

**Working rule:** one item at a time, top to bottom. Tick it here the moment it
lands, with a one-line note of what was done. Do not batch-tick.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Track A — Docs & config hygiene

Low risk, high confusion-cost if left. The deploy runbook is currently wrong.

- [x] **A1. ENVIRONMENT.md rewritten end to end.** Was: pnpm, `DATABASE_URL`,
  `GOOGLE_CLIENT_SECRET` + redirect URI, and a `vercel.json` with four
  `/api/cron/*` paths that do not exist. Now: npm, `MONGODB_URI`, the
  ID-token flow with no secret, and the six real `/api/v1/cron/*` jobs on
  cron-job.org with their schedules and the `x-cron-secret` header. Also
  documented every variable actually read by the code that the old file
  omitted — `PERSONAL_DATA_ENCRYPTION_KEY`, the OTP group, the LLM key lists,
  `SEARCH_QUOTA_SECRET`, `QUESTIONCALL_*`, upload limits — plus the R2
  local-disk fallback that silently breaks on Vercel, and a note that push uses
  the Expo service so no `FIREBASE_PRIVATE_KEY` is needed.
- [x] **A2. npm everywhere.** ARCHITECTURE.md §1 tooling row, FOLDER_STRUCTURE.md
  header + tree (`pnpm-workspace.yaml` → `package-lock.json`), TESTING.md §4
  commands (rewritten to the real `npm run web:test` etc.) and §10.1 CI YAML
  (`pnpm/action-setup` → `actions/setup-node` with npm cache). Remaining `pnpm`
  hits in docs/ are deliberate negations or historical CHANGELOG entries.
  TESTING.md §3 also now marks which tools actually exist vs which are the
  target — the table used to read as a description of reality.
- [x] **A3. RULES.md drift fixed.** §6 envelope corrected to the shipped
  `{ success, message, data }` / `{ success, message, errorCode, details }`
  with a note on why it was reconciled the code's way. §8 templates corrected
  to `.ts` functions under `packages/shared/src/email/templates/` and *why*
  (keeps `packages/shared` framework-agnostic for mobile). §16 corrected: one
  `Notification` row per recipient **is** the receipt, no `NotificationReceipt`
  collection. §4 bcrypt cost 10 → 12, and the rate-limit rule now names
  `/api/v1/auth/*` as the single auth surface. §3 enforcement now names the
  data-access layer that actually exists (`modules/*` + `lib/tenant.ts`) and
  points at B8 for the repository move, instead of describing a directory that
  was never created.
- [x] **A4. DATABASE.md drift fixed.** Header now reads "end of Phase 5" with
  the real **72** models. The `Decimal128 (never Number)` convention —
  which contradicted RULES.md §6 and every shipped model — resolved in favour
  of `Number`, with the reasoning recorded. The "not built" list is now a table
  giving each model a status and a reason: `NotificationReceipt` superseded and
  never to be built, `AccountDeletionRequest` in flight under B5,
  `Subscription` needing a client scope decision.
- [x] **A5. Redirect tables corrected** in ARCHITECTURE.md §3.1 and PRD.md §8.5:
  `/platform/dashboard` for both platform roles (one portal, separated by route
  rule rather than URL prefix), `/hostel-admin/dashboard` plus the tenant
  `/{slug}/admin` form, `/resident/dashboard`, `/guardian/dashboard`, and
  `COOK → /` with the reason. Both tables now point at `roleLandingPath` in
  `lib/route-access.ts` as the single source of truth.
- [x] **A6. DESIGN.md reconciled.** Found a bigger drift than the font count:
  §2's colour tokens were the **stock blue shadcn HSL palette** while the
  shipped theme is green oklch (`--primary: oklch(0.508 0.118 165.612)`,
  `--brand-teal: #0a8a4b`) in Tailwind v4 `:root` + `@theme inline` form, with
  four per-portal role tokens the doc never mentioned. Replaced, with the
  "copy a mockup's layout, never its colours" rule stated. Typography now
  documents the deliberate Geist body / Poppins heading / Geist Mono trio
  instead of "one font, don't mix". §9 dark mode moved from "optional for v1"
  to "built" — `.dark` overrides every token — which is also the real argument
  for the hardcoded-colour cleanup. The 88 hex literals stay under B17.
- [x] **A7. docs/MEMORY.md corrected.** The `packages/database` + `packages/ui`
  "delete manually" instructions removed (both verified gone). The pnpm
  "deviation to revisit later" downgraded to a settled decision in three places
  and the tech-stack table. RESUME POINT rewritten: it claimed `apps/mobile`
  was a stub, which was wrong, and it now points at `TODO.md` as the tracker.
- [x] **A8. MOBILE_STATUS.md rewritten from the filesystem.** Both prior claims
  were wrong in opposite directions. Verified: **17 screens (~2,200 lines), a
  32-function typed API client, secure token store, React Navigation stack, and
  working QR camera activation via `expo-camera`** — `npm run mobile:typecheck`
  clean. The file's own "Phase 1/2/3" numbering is retired in favour of
  PHASES.md §6, and it now lists the real remaining gaps: `expo-notifications`
  not installed, no server-side push delivery, no `expo-location`/
  `expo-task-manager`, no guardian or cook screens, no global SOS button, and
  Google sign-in still a placeholder.

---

## Track B — Website: missing code

### B0. Auth screens — remove the demo shortcuts *(explicitly requested)* ✅
- [x] Stripped the "OR PREVIEW AS DEMO" panel from
  `apps/web/src/app/(auth)/login/login-form.tsx` — four buttons that filled in
  real account emails and the password `admin`. Removed the panel, the
  `DEMO_ACCOUNTS`/`DemoRole` declarations, the `selectedDemo` state,
  `handleDemoSelect`, the reset-on-type handlers and the now-unused
  `Building2`/`Users`/`UserRound` icon imports.
- [x] Audited `signup-form.tsx`, `reset-password-form.tsx`, `auth-shell.tsx` —
  no prefilled credentials, demo hints or seeded values found.
- [x] No `DEMO_ACCOUNTS` / `DemoRole` / "preview as demo" references remain.
  *(Kept `DemoDataBadge` — that is the opposite thing: it flags seeded test
  records inside real portals so staff know which rows aren't real.)*
- Verified: typecheck clean, lint clean.

### B1. Pagination — specified everywhere, implemented nowhere
`API.md` §1.4 and `RULES.md` §6 require `?page=1&pageSize=20` →
`{ items, page, pageSize, total }`. `pageSize` appeared **zero times** in the
codebase. Lists were capped by bare `.limit(100)` (residents, payments,
complaints) — a hostel with 101 residents could not reach #101 and was never told.
- [x] Shared helper `lib/pagination.ts` — `paginationQuerySchema` (spread into a
  list endpoint's Zod schema), `paginationRange()` (skip/limit, clamps to
  `MAX_PAGE_SIZE` 100 rather than erroring), `paginationMeta()`
  (`page`/`pageSize`/`total`/`totalPages`/`hasMore`). Defaults live in exactly
  one place — the schema fields are `.optional()`, not `.default()` — so a
  service called directly from a test or a cron behaves like one called through
  a route. **11 unit tests** in `lib/pagination.test.ts`.
- [x] **Envelope decision:** API.md §1.4 specified renaming every list array to
  `items`. That is a breaking change across ~184 route files *and* the mobile
  client for no behavioural gain, so the collection keeps its descriptive key
  (`residents`, `payments`, `complaints`) and gains a sibling `pagination`
  block. API.md still needs correcting to match — see the open item below.
- [x] Applied to the three 100-capped admin lists: residents, payments,
  complaints (admin + resident).
- [x] **Bug found while doing it:** `listAdminComplaints` returned
  `summary: complaintSummary(complaints)` computed from the returned array.
  Once paginated that array is one page, so the admin header would have read
  "20 complaints" forever. Replaced with `complaintSummaryForFilter()`, a
  `$group` aggregate over the same filter as the list query, plus a separate
  overdue count. The old in-memory reduce is deleted. Test now asserts an
  11-row summary alongside a 2-row page, so the two can't silently re-couple.
- [x] **All remaining user-facing lists paginated** — inquiries, notices (admin
  + resident), wardens, reviews (public + platform moderation), sos-alerts,
  night-status, listing-flags, referrals, service-providers (platform + admin
  picker), platform hostels, notifications bell, community feed / comments /
  moderation queue, notification campaigns, attendance alerts. Deliberately
  **not** touched: the internal batch bounds in `complaint-sla` (500),
  `payment-reminders` (500), `questioncall` (5000) and attendance maintenance —
  those are job batch sizes, not pages.
- [x] **Three more page-scoped-aggregate bugs found and fixed** by doing this:
  - **Public hostel ratings.** `listPublicHostelReviews` derived the average,
    the seven per-category means and the star distribution from the returned
    array. Paginated naively, a hostel's public rating would have changed as a
    visitor clicked through pages. Now a second narrow projection over every
    visible review feeds the summary while the page feeds the list.
  - **Night status roster.** The status filter was applied *after* `.limit(200)`,
    so `?status=OUTSIDE_HOSTEL` only ever searched the first 200 residents by
    name and reported a total to match. Now the roster is built, filtered, then
    sliced — and the summary counts the filtered roster, not the page.
  - **Referral dashboard.** `byStatus`, `converted` and the three reward totals
    all came from the page. Now `$group` aggregates over the hostel scope, so
    the breakdown no longer collapses to one bucket when an admin filters.
  - Community moderation `summary` and the notification bell's unread badge got
    the same treatment.
- [x] **API.md §1.4 rewritten** to document the shipped envelope, with the
  reason the generic `items` key was rejected (a response can carry more than
  one collection — payments returns `payments` *and* `proofs`, complaints
  returns `complaints` *and* a `summary`), the 20/100 defaults, and an explicit
  rule that any aggregate returned beside a page must be computed over the whole
  filter. That rule is what the four bugs above all violated.
- [x] **UI paging** — `usePagedPortalResource` + `withPage` in
  `lib/portal-pagination.ts`, rendered with the **existing** `ListPager`
  component (found it in `portal-dashboard-ui.tsx` after drafting a second
  pager — deleted mine). Wired into residents and wardens. The residents "Total
  Residents" badge now reads the server total instead of the page length.
- [ ] **Remaining screens still owe a `ListPager`.** They are held at the old
  behaviour by an explicit `FULL_PAGE` (`pageSize=100`) on their endpoint
  constants, so nothing regressed to a silent 20 rows. **`grep FULL_PAGE`** to
  find them; the goal is that every use disappears.
- [ ] Push the residents list's search/status/type filters into the query
  instead of filtering the fetched page client-side (same for the other list
  screens that filter locally).

### B2. Three "nobody gets notified" gaps ✅
New module `modules/hostels/hostel-notify.ts`. Both functions swallow their own
errors — they run after the row is already written, so a mail failure must never
turn a submitted inquiry or registration into a failed request.
- [x] **Public inquiry submitted** (EMAIL_SYSTEM §2.4) — now emails every hostel
  admin *and* writes an in-app `Notification`. New template
  `hostel/inquiry-received.ts` carrying name, phone, email, preferred visit date
  and message, with a link to the inbox.
- [x] **Hostel submitted for approval** (EMAIL_SYSTEM §7.1) — now emails and
  notifies SUPERADMIN **and** PLATFORM_MODERATOR (approving hostels is
  explicitly a moderator power per PRD §7). New template
  `platform/new-hostel-pending.ts`.
- [x] **Service provider registered / approved / rejected** (EMAIL_SYSTEM
  §6.1–6.3) — three new templates under `email/templates/service-provider/`.
  **Root cause found:** these were unbuildable, not merely unbuilt — the
  `ServiceProvider` model and the public registration form collected **no email
  address at all**. Added an optional `email` field to the model, the Zod
  schema, the registration form (clearly marked optional, with copy explaining
  what it is used for) and the serializer; documented in DATABASE.md. Providers
  without one keep working and are simply never emailed. `HIDDEN` deliberately
  sends nothing — hiding is a moderation action, not a decision the provider is
  owed mail about.
- Verified: typecheck clean, lint clean, 349/349 tests.

### B3. Community engagement notifications
- [ ] Reactions notify nobody; only comments do (ARCHITECTURE §9.4, RULES §14,
  EMAIL_SYSTEM §8.1). Add reaction notifications, batched
  ("5 people reacted to your post") rather than one per reaction.

### B4. Multi-tenancy
- [ ] **Cross-tenant miss returns 403, docs require 404.** `RULES.md` §3 and
  `PHASES.md` §5.2 both say return `404` so existence is not confirmed.
  `lib/tenant.ts` and `lib/api-auth.ts` return `403 TENANT_ACCESS_DENIED`.
- [ ] **No isolation test suite.** TESTING.md §6.1 marks this "⭐ HIGHEST
  PRIORITY" with a mandatory template (§7.1); RULES.md §3 requires one per
  hostel-scoped resource; PRD.md §11 makes it a v1 success criterion. What
  exists is a single unit test of the guard helper. Write real per-service
  tests: hostel A principal, hostel B data, assert nothing leaks.

### B5. Account deletion & data retention — entire feature absent
Specified in ARCHITECTURE §13, DATABASE §AccountDeletionRequest,
PRIVACY_POLICY §7.3/§8, EMAIL_SYSTEM §9.1–9.3. Nothing exists.
- [ ] `AccountDeletionRequest` model.
- [ ] Request / cancel endpoints + resident-facing UI.
- [ ] Immediate effects on request: account disabled, sessions invalidated,
  device tokens removed.
- [ ] Purge cron at 60 days with the documented delete-vs-anonymise split.
- [ ] Emails 9.1 (requested) and 9.2 (cancelled).

### B6. Privacy commitments the site makes but the code does not keep
- [ ] **`/privacy` page is wrong.** It promises deletion "within 30 days"
  (docs say 60), "delete your personal information at any time through your
  account settings" (no such feature), "cookie preferences … from your account
  settings page" (no such page), and "request a copy of all data" (no export).
  It also never mentions location/attendance collection at all, which
  docs/PRIVACY_POLICY.md §3 marks "⚠️ READ CAREFULLY". Rewrite to match what is
  actually built + disclose location tracking.
- [ ] **Data export / "Download My Data"** (PRIVACY_POLICY §7.1, §7.4) — build it.
- [ ] **Location history deletion email** (EMAIL_SYSTEM §9.3) — the delete works,
  the confirmation does not exist.
- [ ] **Re-consent after policy update** (RULES §12) — `ConsentLog` only covers
  location consent today; no policy version, no re-consent gate on login.

### B7. Smaller conformance items
- [ ] **Cook web-login message** (RULES §13) — no "Cook portal is mobile-only"
  copy anywhere; `COOK` lands on `/`.
- [ ] **`validateServerEnv()` is defined and never called** — a missing
  `JWT_ACCESS_SECRET` in production surfaces as a runtime error at first login
  instead of at boot.
- [ ] **PlatformConfig in-memory cache** (ARCHITECTURE §5.2, RULES §12) —
  spec says cache with a 5-minute TTL; `getOperationsConfig()` hits Mongo on
  every call.
- [ ] **High-privilege upgrade confirmation** (PRD §8.3, ARCHITECTURE §3.2,
  RULES §4) — docs require a click-to-confirm email *before* the role changes;
  code flips the role immediately and rotates to an emailed temp password.
  Either build the gate or get the substitute signed off and amend the docs.

### B8. Deferred — decide explicitly, don't let them rot
- [ ] **Shared Zod schemas** (RULES §6, CODING_STANDARDS §3) — only
  `auth.schema.ts` is shared; 27 `*.validation.ts` files live inside
  `apps/web/src/modules/`. Moving them is the single biggest refactor here and
  matters most for the mobile app, which will want the same schemas.
- [ ] **Repository layer** `packages/db/src/repositories/` (RULES §3,
  ARCHITECTURE §2, CODING_STANDARDS §5) — absent; services in
  `apps/web/src/modules/` do the tenant scoping instead.
- [ ] **Axios shared `apiClient`** (RULES §2, ARCHITECTURE §1) — axios is not
  installed; a fetch wrapper (`browser-api.ts`) is used. Not in MEMORY.md's
  deviation list. Amend the docs or adopt axios.
- [ ] **2FA for administrative accounts** (PRIVACY_POLICY §5.1).
- [ ] **Subscription tracking + expiry alerts** (DATABASE, ARCHITECTURE §10,
  EMAIL_SYSTEM §7.2, PRD §9.2) — deliberately outside the pilot, still listed
  as a platform-owner feature in the PRD.
- [ ] **B17. Hardcoded colours** — 88 hex literals to move onto tokens.
- [ ] **Test tooling** — Playwright (8 mandatory E2E flows in TESTING.md §8),
  React Testing Library (zero component tests), Supertest,
  mongodb-memory-server, and `.github/workflows/` CI (TESTING.md §10).

---

## Track C — Mobile enablement

Reference implementation studied: `D:\Jiwan-Mijhar` — Expo Push service
(`web/lib/push/expo-push.ts`), central fan-out (`web/lib/notifications/notify-user.ts`),
per-device `PushSubscription`. Our `DeviceToken` model already matches that
shape and `/api/v1/mobile/device-token` exists.

- [ ] **C1. Push delivery.** Every "sends push" line in Phases 3–5 currently
  means "wrote an in-app `Notification`". Add an Expo push sender and fan out
  from the existing notification service. No Firebase Admin SDK needed — Expo's
  push endpoint accepts both Expo and raw FCM tokens.
- [ ] **C2. Token lifecycle.** Register/refresh/revoke, prune on
  `DeviceNotRegistered`, one row per device.
- [ ] **C3. Notification categories + Android channels** — FOOD_READY, PAYMENT,
  ATTENDANCE, SOS, COMMUNITY, ANNOUNCEMENT (ARCHITECTURE §7.3).
- [ ] **C4. MOBILE_API.md** — every endpoint with method, path, auth, request
  params/body, response shape, and error codes, so the mobile developer never
  has to read a route handler. This is the deliverable that makes Phase 6 fast.
- [ ] **C5.** Reconcile what `apps/mobile` actually contains against PHASES.md
  §6 before any new mobile work starts.

---

## Notes

- Payment testing stays deferred to after every phase is built — client
  decision (2026-08-01). Unticked payment items are not forgotten.
- 260 `☐` remain in PHASES.md; 113 are Phase 6 and most of the rest are
  acceptance tests needing a seeded DB, live Resend, or a browser — not missing
  code. The genuinely code-side ones are captured above.
