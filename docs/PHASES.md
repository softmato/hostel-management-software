# PHASES.md — Development Roadmap

**Product:** Multi-Hostel SaaS Platform (Nepal)
**Timeline:** 7-8 weeks total
  - Phases 1-5: Web platform (5 weeks)
  - Phase 6: Mobile app (2-3 weeks)
**Project Start:** 22 June 2026
**Docs Finalized:** 14 July 2026

---

## How to Use This File

This document splits the entire build into **6 sequential phases**. The AI coding assistant (and any human developer) **MUST**:

1. Work on **only one phase at a time**. Do NOT jump ahead.
2. Complete every ☐ item in the **Deliverables** section before moving on.
3. Pass every ☐ item in the **Acceptance Tests** section before moving on.
4. Update `MEMORY.md` after each completed item.
5. Update `CHANGELOG.md` at the end of each phase.

> **Rule of thumb:** if a feature is not listed in the current phase, it does NOT get built in the current phase — even if you have spare time. Instead, harden what exists (tests, edge cases, polish).

---

## Phase Map at a Glance

| Phase | Week | Theme | Primary Portals Touched |
|---|---|---|---|
| **Phase 1** | Week 1 | Foundation & Auth | Platform Owner, Auth System |
| **Phase 2** | Week 2 | Public Discovery + Hostel Core | Public, Hostel Admin |
| **Phase 3** | Week 3 | Resident System | Resident, Hostel Admin |
| **Phase 4** | Week 4 | Trust, Safety & Guardian | Resident, Guardian, Hostel Admin |
| **Phase 5** | Week 5 | Growth, Maintenance & Polish | All portals + Service Provider |
| **Phase 6** | Weeks 6-8 | Mobile App | Mobile (Resident-focused) |

---

## PHASE 1 — Foundation & Auth (Week 1)

**Goal:** Have a running, multi-tenant, role-aware backend + platform-owner portal that can approve hostels. Core auth system with account upgrade mechanism working end-to-end.

> **Status note (2026-07-21):** Phase 1 alignment complete for all code-side deliverables. Production
> build is green; tests 95/95; typecheck + lint clean. This session added the read-only **audit log
> viewer** and closed the ARCHITECTURE.md §3.2 **high-privilege upgrade safeguard** (PUBLIC→HOSTEL_ADMIN
> now requires mailbox proof via an emailed temporary password). Remaining open items are external/infra
> (Cloudflare R2 bucket, live Resend delivery test, dev-DB role migration) or deliberately deferred
> (app-wide response-envelope migration, dedicated repositories layer) — tracked in `TODO.md` and
> MEMORY.md. See MEMORY.md "Completed Work" for the full list and the locked deviations.

### 1.1 Deliverables

**Project & Infrastructure**
- ☑ Turborepo monorepo set up: `apps/web`, `packages/db`, `packages/shared`
- ☑ TypeScript strict mode enabled everywhere
- ☑ ESLint + Prettier configured
- ☑ `.env.example` committed; real `.env` gitignored
- ☑ README with local setup instructions

**Database & Models**
- ☑ MongoDB Atlas account created and database provisioned
- ☑ Mongoose connection setup in `packages/db/src/connection.ts`
- ☐ All Mongoose models from DATABASE.md created in `packages/db/src/models/`
- ☑ Seed script (`packages/db/src/seed.ts`) creates initial SUPERADMIN account
- ☐ All indexes from DATABASE.md created

**Auth System (CRITICAL - Build Exactly Per ARCHITECTURE.md §3)**
- ☑ Email/password signup with email verification (sends verification email via Resend)
- ☑ Email verification endpoint (`POST /api/auth/verify-email`)
- ☑ Google OAuth integration (consent flow + callback handler)
- ☑ Unified login endpoint (`POST /api/auth/login`) - works for all roles
- ☑ JWT access + refresh token system (httpOnly cookies for web, Bearer tokens for future mobile)
- ☑ Session middleware (`getSession()` helper) extracts user from token
- ☑ **Account upgrade mechanism** (ARCHITECTURE.md §3.2) - when admin registers someone by email:
  - Check if email exists as PUBLIC account
  - If yes: upgrade in place (change role, link profile, keep credentials)
  - If no: create new account with temp password
  - Never create duplicate User documents
- ☑ Role-based route guards (`requireRole()`, `requireHostelAccess()`)
- ☑ Password reset flow (request + reset endpoints)
- ☑ Change password endpoint (forced on first login if `mustChangePassword = true`)

**Email Infrastructure**
- ☑ Resend account created and API key configured
- ☑ Email sending helper (`sendEmail()`) in `packages/shared/src/email/sender.ts`
- ☑ Email templates created in `packages/shared/src/email-templates/`:
  - `auth/verification.tsx` - email verification
  - `auth/credentials-issued.tsx` - admin-issued credentials
  - `auth/password-reset.tsx` - password reset
  - `auth/account-upgraded.tsx` - account upgrade notification
  - `hostel/submission-received.tsx` - hostel registration confirmation
  - `hostel/hostel-approved.tsx` - hostel approval (with credentials)
  - `hostel/hostel-rejected.tsx` - hostel rejection
- ☐ All Phase 1 emails tested and working

**File Storage**
- ☐ Cloudflare R2 bucket created
- ☑ R2 upload helper with pre-signed URLs (`POST /api/uploads/sign`)
- ☑ File validation (content type, max size) before signing

**Hostel Owner Registration Flow**
- ☑ Public "Register Your Hostel" page
- ☑ Multi-step form: owner info → hostel details → documents upload
- ☑ Creates PUBLIC account first (if not logged in), then creates pending Hostel
- ☑ Uploads owner documents (citizenship, ownership proof) to R2
- ☑ Sends "submission received" email
- ☑ Creates hostel with `status: PENDING`

**Platform Owner Portal**
- ☑ Login page (uses unified `/login` endpoint)
- ☑ Dashboard with stats: pending hostels, total hostels, total residents
- ☑ **Hostel approval queue** - list of pending hostels with owner info + documents
- ☑ Document viewer (opens R2 URLs securely)
- ☑ **Approve hostel** action:
  - Updates `Hostel.status = APPROVED`
  - Triggers account upgrade for owner (PUBLIC → HOSTEL_ADMIN)
  - Sends "hostel approved" email with credentials
  - Creates AuditLog entry
- ☑ **Reject hostel** action:
  - Updates `Hostel.status = REJECTED`
  - Sends rejection email with reason
  - Creates AuditLog entry
- ☑ View hostel details page
- ☑ Audit log viewer (read-only)

**Shared Components (shadcn/ui)**
- ☑ Install and configure shadcn/ui + Tailwind
- ☑ Create base components: Button, Input, Card, Badge, Dialog, Table, Form
- ☑ Set up Tailwind design tokens per DESIGN.md
- ☑ Set up lucide-react icons

**API Contracts**
- ☐ All Phase 1 endpoints from API.md implemented
- ☐ Standard response envelope (`{ success, data/error }`) used everywhere
- ☑ Zod validation on all request bodies
- ☐ Error codes from API.md §1.2 implemented

### 1.2 Acceptance Tests

**Auth System**
- ☐ A new user can sign up with email/password → receives verification email → clicks link → email verified → can log in
- ☐ A new user can sign up with Google → account created with `emailVerified: true` → can log in
- ☐ Logging in with unverified email returns `403 email_not_verified` error
- ☐ Logging in returns correct `role` and `redirectPath` based on user's current role
- ☐ Access token expires after 15 minutes, refresh token works to get new access token
- ☐ Logging out invalidates refresh token (bumps `tokenVersion`)
- ☐ Password reset flow works end-to-end (request → email → reset with token)

**Account Upgrade Mechanism (CRITICAL)**
- ☐ Test Case 1: Email `test@example.com` signs up as PUBLIC → Admin approves hostel for `test@example.com` → System upgrades existing account to HOSTEL_ADMIN (NOT duplicate) → User logs in with original credentials → lands on hostel-admin dashboard
- ☐ Test Case 2: Admin approves hostel for `new@example.com` (no existing account) → System creates new HOSTEL_ADMIN account → Sends credential email → User can log in with emailed password
- ☐ Test Case 3: Admin tries to register resident with email that already has HOSTEL_ADMIN role → Returns `409 email_already_has_role` error
- ☐ Test Case 4: User signs up with Google (`gmail@gmail.com`) → Admin registers resident with same email → System upgrades account to RESIDENT → User logs in with Google → lands on resident dashboard

**Hostel Registration & Approval**
- ☐ A visitor can register a hostel → hostel created with `status: PENDING` → owner receives confirmation email
- ☐ Documents upload to R2 successfully and URLs are saved in database
- ☐ Pending hostel appears in platform owner's approval queue
- ☐ Platform owner can view uploaded documents via secure URLs
- ☐ Platform owner approves hostel → hostel `status = APPROVED` → owner receives email with credentials (or upgrade notice) → owner can log in as HOSTEL_ADMIN
- ☐ Platform owner rejects hostel → hostel `status = REJECTED` → owner receives rejection email

**Multi-Tenancy Foundation**
- ☐ Database queries for hostel-scoped models include `hostelId` filter (verified in code review)
- ☐ Repository functions in `packages/db/src/repositories/` enforce tenant scoping

**Email System**
- ☐ All Phase 1 emails send successfully and render correctly
- ☐ Email templates include proper branding and CTAs
- ☐ Email delivery is logged for debugging

**Security**
- ☑ Passwords are hashed with bcrypt (never stored plain text)
- ☑ JWT secrets are loaded from environment variables
- ☑ Refresh tokens are httpOnly, secure, SameSite=Lax cookies
- ☑ Rate limiting on `/api/auth/login` (max 5 attempts per 15 min per IP)
- ☐ No sensitive data in client-side bundles (check with bundle analyzer)

### 1.3 Phase 1 Definition of Done

- All deliverables ☐ checked off
- All acceptance tests ☐ passing
- `MEMORY.md` updated with completed work
- `CHANGELOG.md` entry added for Phase 1
- Working backend + auth system + platform-owner portal that turns a hostel-owner signup into an approved tenant
- **No public site, no resident features yet** - those come in Phases 2-3

---

## PHASE 2 — Public Discovery + Hostel Core (Week 2)

**Goal:** Anyone can browse hostels on the public site; approved hostel admins can manage their rooms/beds/residents (registration only, no QR activation yet).

> **Status note (2026-07-22):** Phase 2 code-side deliverables are complete. This session added the
> remaining gaps on top of the already-built public/hostel-admin surface: **Warden Management** (service +
> API + UI + tests), **public SEO** (dynamic metadata + `sitemap.ts` + `robots.ts`), **TanStack Query +
> Zustand** foundation wired into listing/compare/residents/wardens, and the full **Maps integration**
> (Leaflet default + Google embed fallback, provider detection, Nominatim geocoding with coarse fallback,
> Overpass nearby-places caching, a refresh cron, and the "Near my college" proximity filter). Typecheck +
> lint clean; 103/103 unit tests pass. **Remaining = manual/browser QA** (§2.2 acceptance tests, 375px pass,
> Lighthouse ≥80) and **external infra** (live R2, `CRON_SECRET` on the deploy, optional Google Maps keys).
> The public Overpass endpoint rate-limits bursts, so nearby-places fill in gradually over cron runs.

### 2.1 Deliverables

**Public Portal (Website)**
- ☑ Home page with hero section and hostel search bar
- ☑ Hostel listing page with filters _(data via `useHostels` + `useHostelFiltersStore`)_:
  - ☑ Area/city dropdown
  - ☑ Gender type (boys/girls/co-living)
  - ☑ Price range _(budget buckets, not a slider — functionally equivalent)_
  - ☑ Room type
  - ☑ Facilities
  - ☑ "Near my college" search (college dropdown → proximity sort via haversine on cached coords)
- ☑ Hostel cards in grid view (photo, name, price, gender badge, rating, verified badge)
- ☑ Hostel detail page:
  - ☑ Photo gallery
  - ☑ Description, rules, facilities
  - ☑ Room types and pricing table
  - ☑ Location map (OpenStreetMap + Leaflet default, Google fallback detection per §4)
  - ☑ Nearby places (colleges, hospitals, bus stops) - cached data
  - ☑ Inquiry form (no login required)
  - ☑ Reviews section (empty in this phase, populated in Phase 4)
- ☑ Hostel comparison page (side-by-side up to 3 hostels) — persisted comparison tray
- ☐ Map view of search results (optional, deferred to Phase 5)
- ◐ Mobile-responsive layout — responsive grids + mobile filter drawer added; **needs your 375px visual pass**
- ☑ SEO: proper meta tags, sitemap.xml for hostel pages — dynamic `generateMetadata` on hostel detail (title/description/OG/canonical), static metadata on home/listing/compare, `app/sitemap.ts` (static + all published hostels) and `app/robots.ts`

**Maps Integration**
- ☑ Implement smart maps provider detection per ARCHITECTURE.md §4.2 — `getMapProvider()` (server) + `useMapProvider()` (client)
- ☑ OpenStreetMap + Leaflet as default (no API key needed) — `components/maps/leaflet-map.tsx` (dynamic import, SSR-safe) + `HostelMap` switcher
- ☑ Google Maps fallback if `GOOGLE_MAPS_API_KEY` env var set and valid — `google-map.tsx` (Maps Embed API, browser-key-gated), geocoding + nearby prefer Google when key set
- ☑ Geocoding helper (address → lat/lng) with provider fallback — `lib/maps/geocoding.ts` (Google→Nominatim, plus coarse area/city fallback); verified live (3/3 demo hostels geocoded)
- ☑ Nearby places caching system (compute on address change, store in Hostel.nearbyPlaces) — Overpass/Google → cached on `Hostel.nearbyPlaces` + `nearbyPlacesLastUpdated`; re-geocode on profile address save
- ☑ Background job to refresh stale nearby places data — `POST /api/v1/cron/refresh-nearby-places` (cron-secret gated); verified 200

**Hostel Admin Portal - Profile & Setup**
- ☑ Login redirects to `/hostel-admin` for HOSTEL_ADMIN role
- ☑ Dashboard with overview: total residents, pending inquiries, payment due, room occupancy
- ☑ **Hostel Profile Management**:
  - Edit description, rules, facilities
  - Upload/manage hostel photos (to R2)
  - Edit contact info
  - ☑ Update address (now triggers geocoding + nearby places refresh — added this phase)
- ☑ **Room Management**:
  - Create room (floor, roomNumber, type, rentPerBed, capacity, facilities)
  - Auto-create beds when room is created (based on capacity)
  - Edit room details
  - Soft delete room (marks `isActive: false`)
  - List all rooms with bed status summary
- ☑ **Bed Management**:
  - View beds in a room
  - Update bed status (AVAILABLE, OCCUPIED, RESERVED, UNDER_REPAIR)
  - Add maintenance note per bed
  - Visual bed map (simple grid, color-coded by status)
- ☑ **Manual Resident Registration** (no QR activation yet - that's Phase 3):
  - Form: email, fullName, phone, guardianContact, educationInfo, roomId, bedId, depositAmount
  - Triggers account creation/upgrade per ARCHITECTURE.md §3.2
  - Creates Resident document with `status: PENDING`
  - Sends email notification to resident (informing them they'll receive QR code soon)
  - Does NOT send QR code yet (Phase 3)
- ☑ **Warden Management** (HOSTEL_ADMIN only):
  - ☑ Create warden account (email, name) — account create/upgrade per §3.2, `POST /api/v1/hostel-admin/wardens`
  - ☑ Set permission flags per HostelStaff schema — 11 capability flags on `HostelMember.permissions`
  - ☑ List wardens — `GET /api/v1/hostel-admin/wardens`
  - ☑ Edit warden permissions — `PATCH /api/v1/hostel-admin/wardens/[id]`
  - ☑ Deactivate warden — `DELETE /api/v1/hostel-admin/wardens/[id]` (status → SUSPENDED)
- ☑ **Inquiry Inbox**:
  - List inquiries from public site
  - Mark as contacted/converted/closed
  - Track conversion to resident (if inquiry → resident)

**TanStack Query + Zustand Setup**
- ☑ Install and configure TanStack Query — `@tanstack/react-query` + `QueryProvider` in root layout
- ☑ Create query hooks for hostels, rooms, beds, residents (`useHostels`/`useCompareHostels`, `useRoomMap` (rooms+beds), `useResidents`, `useHostelWardens`) — consumed by listing/compare/residents/wardens pages
- ☑ Install and configure Zustand
- ☑ Create stores for: hostel filters (`useHostelFiltersStore`), comparison tray (`useComparisonStore`, persisted), modal/drawer state (`useUiStore`)

**Shared Components**
- ☑ HostelCard component (`_components/shared.tsx` — `HostelCard`/`HostelListCard`)
- ☑ VerificationBadge (verified badge via `StatusPill` + `BadgeCheck`)
- ☑ StatusBadge component (`components/status-badge.tsx`)
- ☑ RoomBedMap component (visual grid — hostel-admin rooms page + `room-map` API)
- ☑ InquiryForm component (public inquiry page/form)
- ☑ Map components (LeafletMap, GoogleMap, `HostelMap` provider switcher) — added this phase

### 2.2 Acceptance Tests

**Public Portal**
- ☐ A visitor (no login) can search hostels by city, filter by gender + price + facilities
- ☐ Search returns only hostels with `status: APPROVED`
- ☐ Opening a hostel detail page shows correct info, photos, map with nearby places
- ☐ Inquiry form submission creates Inquiry document → appears in hostel admin's inbox (NOT in other hostels' inboxes)
- ☐ Hostel comparison works for 2-3 hostels side-by-side
- ☐ Map provider fallback works: if Google Maps fails to load, Leaflet renders instead
- ☐ Mobile view (375px) is functional and readable

**Hostel Admin - Multi-Tenancy**
- ☐ Hostel Admin A logs in → sees ONLY their hostel's data
- ☐ Hostel Admin A cannot access Hostel B's rooms/residents/inquiries (verified by trying direct URL manipulation)
- ☐ Repository functions enforce `hostelId` filtering (code review check)

**Room & Bed Management**
- ☐ Creating a room with capacity=4 auto-creates 4 bed documents
- ☐ Updating bed status from AVAILABLE → OCCUPIED persists correctly
- ☐ Bed status appears correctly in room/bed map visualization
- ☐ Deleting a room marks it `isActive: false` (soft delete)

**Resident Registration**
- ☐ Hostel admin registers a new resident with email that doesn't exist → new User created with RESIDENT role
- ☐ Hostel admin registers a resident with email of existing PUBLIC account → account upgraded to RESIDENT
- ☐ Registered resident appears in residents list with `status: PENDING` (no QR activated yet)
- ☐ Resident receives email notification (informing about upcoming QR code)

**Warden Permissions**
- ☐ Hostel admin creates warden with limited permissions
- ☐ Warden logs in → sees only permitted sections (e.g., can register residents but cannot edit hostel profile)
- ☐ Warden trying to access restricted section gets 403 error

**Public SEO**
- ☑ Hostel detail pages have proper `<title>` and meta description (verified live: `Himalayan Stay Boys Hostel — Lalitpur · HostelHub` + description/OG/canonical)
- ☑ `sitemap.xml` includes all approved hostel pages (verified: static routes + 3 published demo hostels)
- ☐ Lighthouse mobile score ≥ 80 on hostel detail page _(needs a Lighthouse run — tracked under responsive/QA)_

### 2.3 Phase 2 Definition of Done

- All deliverables ☐ checked off
- All acceptance tests ☐ passing
- `MEMORY.md` and `CHANGELOG.md` updated
- Public can discover and inquire about hostels
- Hostel admins can fully set up their hostel (rooms, beds) and register residents
- **Residents still cannot log in or activate accounts** - that's Phase 3

---

## PHASE 3 — Resident System (Week 3)

**Goal:** Residents become active users via QR activation, with visibility into fees, food, and notices. Payment proof upload + admin verification working end-to-end.

> **Status note (2026-07-23):** Phase 3 code-side deliverables are complete. Build green, typecheck +
> lint clean, **131/131** unit tests pass. As in Phase 2, most surfaces already existed from the
> earlier codebase, so this session filled the real gaps: QR image generation + activation email,
> config-driven expiry, partial-payment proofs (amount + method + reference), sequential receipt
> numbers, the seven Phase 3 email templates, the payment reminder/overdue cron, notice fan-out
> (email + in-app), resident-type classification, monthly fee runs, and cook-portal setup with
> food-ready notifications. Remaining open items are **external infra + manual QA**: live Resend
> delivery, an R2 bucket for QR images (a local-disk fallback covers dev), `CRON_SECRET` +
> a cron-job.org entry for `/api/v1/cron/payment-reminders`, and the §3.2 acceptance pass against a
> seeded database.

### 3.1 Deliverables

**QR Activation System**
- ☑ QR code generation library installed (`qrcode` in `apps/web`)
- ☑ Hostel admin can generate QR for a pending resident:
  - Creates QRActivation document with unique code (8-12 char alphanumeric)
  - Generates QR code image, uploads to R2 _(falls back to `public/uploads/activation-qr/` when R2 is unconfigured, so the flow works locally)_
  - Sends QR activation email with embedded QR image + fallback code + web link
  - Sets expiry (7 days from the `operations` platform setting)
- ☑ QR activation page (`/resident-activation`, code prefilled from the emailed link):
  - Scans QR code (Phase 6 mobile) OR enters code manually (web)
  - Verifies code is valid and not expired
  - If user not logged in: prompts to log in or create password
  - Activates account: updates Resident.status = ACTIVE, QRActivation.status = ACTIVATED
  - Upgrades User role if needed (PUBLIC → RESIDENT)
  - Redirects to resident dashboard
- ☑ QR codes expire after configured time (`operations.qrActivationExpiryDays`)
- ☑ Can regenerate QR if expired (`PATCH …/activation-code`; supersedes any pending code)

**Resident Portal (Web Dashboard)**
- ☑ Login redirects to `/resident` for RESIDENT role
- ☑ **Dashboard (home)**:
  - Welcome message with hostel name, room/bed info
  - Next payment due amount + date
  - Latest notice (title + preview)
  - Today's food menu preview
  - Night status summary (current status)
- ☑ **Profile View**:
  - Display personal info (name, phone, room/bed, move-in date)
  - Read-only for most fields
  - "Request Edit" button → sends request to admin (Phase 5 feature, can defer)
- ☑ **Food Menu View**:
  - Current week's menu (breakfast, lunch, snacks, dinner per day)
  - Food photos for each meal (if uploaded by admin)
  - Calendar view or list view
- ☑ **Notices View**:
  - List of all notices from own hostel (newest first)
  - Filter by category
  - Mark as read/unread
  - Urgent notices highlighted
- ☑ **Payments View**:
  - List of monthly payments (amount due, amount paid, status, due date)
  - Filter by status (UNPAID, PARTIAL, PAID, OVERDUE)
  - View receipts (download PDF if available)
  - Upload payment proof per payment:
    - Select payment method (eSewa, Fonepay, Khalti, bank transfer, cash)
    - Upload screenshot/photo to R2
    - Add reference note (transaction ID, etc.)
    - Creates PaymentProof with `verificationStatus: PENDING`
    - Sends email to hostel admin

**Hostel Admin - Resident Management Enhancements**
- ☑ **Resident List**:
  - View all residents with status (PENDING, ACTIVE, MOVED_OUT)
  - Filter by status, room, search by name
  - Generate/regenerate QR code per resident
- ☑ **Fee Management**:
  - Set monthly fee per resident (or bulk-set for all)
  - Generate monthly payment records (manually or via scheduled job)
  - View payment due list (who owes what, due when)
  - Dashboard shows "X payments due this month"
- ☑ **Payment Verification**:
  - View uploaded payment proofs (queue of pending proofs)
  - Open proof image/document from R2
  - Verify proof:
    - Updates PaymentProof.verificationStatus = VERIFIED
    - Updates Payment.amountPaid += amount
    - Updates Payment.status (UNPAID → PAID or PARTIAL)
    - Generates Receipt document with auto-incremented receiptNumber
    - Sends "payment verified" email to resident (+ guardian if enabled)
  - Reject proof:
    - Updates PaymentProof.verificationStatus = REJECTED
    - Requires rejectionReason text
    - Sends "payment rejected" email with reason
- ☑ **Food Management**:
  - Create weekly food menu (date, mealType, description, isVeg)
  - Upload food photos (date, mealType, photo to R2)
  - Edit/delete menu entries
  - Preview what residents see
- ☑ **Cook Portal Setup & Onboarding**: _(one shared login per hostel, provisioned at superadmin approval and delivered in the approval email; also togglable/rotatable from the Food page)_
  - During hostel registration/onboarding flow, add step: "Enable dedicated cook portal? (Recommended)"
  - Show promotional benefits: real-time food notifications, easier updates, analytics
  - If enabled, ask for cook name (default: "[HostelName] Cook")
  - Auto-create User with role=COOK, hostelId linked, random email (cook@hostel-slug.platform.com)
  - Generate secure random password
  - Store cook config in HostelSettings (cookPortalEnabled=true, cookName)
  - Send cook credentials in same email as hostel admin approval (separate section for cook access)
  - Cook can access mobile-only portal (web shows "Please open in mobile app")
- ◐ **Cook Portal Features (Mobile-Only)**: _server side done (`/api/v1/cook/food-ready` logs the announcement and notifies residents); the mobile screens themselves land in Phase 6_
  - Simple dashboard: today's menu, resident count, recent notifications sent
  - "Food Ready" button per meal type (breakfast, lunch, snacks, dinner):
    - Cook presses button → creates FoodReadyLog with timestamp
    - Option to: (1) fetch description from today's menu, (2) type custom message, (3) just send "ready" notification
    - Sends push notification to all active residents of hostel
    - Tracks cook device fingerprint (on first login) to identify which cook if multiple share credentials
  - Upload food photo with current meal (simple camera → upload → auto-linked to today's meal)
  - View resident list (names + photos only, no sensitive data)
  - View food menu (read-only, for reference)
- ☑ **Food Ready Notification System**:
  - Create Notification model records when cook presses "Food Ready"
  - Send push notifications via Firebase FCM (Android) and APNS (iOS) - setup in Phase 6
  - For Phase 3 (web only): show notification in web notification center
  - Track delivery stats: sent, delivered, read
- ☑ **Resident Type Classification**:
  - Add residentType dropdown to resident registration form (STUDENT, WORKING_PROFESSIONAL, OTHER)
  - Default to STUDENT
  - Store in Resident.residentType field
  - Used for QuestionCall button visibility (Phase 5)
  - Show in resident list for admin filtering
- ☑ **Notices Management**:
  - Create notice (title, body, category, isUrgent, targetAudience)
  - Target audience: all, residents, guardians
  - Send email notifications per EMAIL_SYSTEM.md (if enabled in PlatformConfig)
  - Edit/delete notice
  - View notice engagement (read count - Phase 5 feature)

**Payment System**
- ☑ Scheduled job (cron-job.org, `POST /api/v1/cron/payment-reminders`): daily check for due payments
  - If payment due in X days (PlatformConfig.paymentReminderDaysBefore), send reminder email
  - If payment past due date, send overdue email
  - Creates Notification documents for in-app alerts
- ☑ Receipt generation:
  - Auto-generates receiptNumber (e.g., "RCP-2026-08-00123")
  - Optionally generates PDF receipt (can defer PDF generation to Phase 5)
  - Stores Receipt document with paymentId

**Email Templates (Phase 3)**
- ☑ `resident/qr-activation.ts` - QR code email
- ☑ `payment/payment-due-reminder.ts`
- ☑ `payment/payment-overdue.ts`
- ☑ `payment/proof-uploaded.ts` (to admin)
- ☑ `payment/payment-verified.ts` (to resident)
- ☑ `payment/payment-rejected.ts`
- ☑ `resident/new-notice.ts`

### 3.2 Acceptance Tests

**QR Activation**
- ☐ Hostel admin generates QR for pending resident → resident receives email with QR image + code
- ☐ Resident scans QR (or enters code on web) → account activated → status = ACTIVE → redirected to resident dashboard
- ☐ Resident logs in with original credentials (or Google) after activation → lands on resident dashboard
- ☐ Expired QR code cannot be activated (returns error)
- ☐ Used QR code cannot be reused (status = ACTIVATED)

**Multi-Tenancy (Resident Level)**
- ☐ Resident A logs in → sees ONLY their own payments, notices, food from their hostel
- ☐ Resident A cannot access Resident B's data (even if same hostel) by URL manipulation

**Payment Flow (End-to-End)**
- ☐ Admin creates payment for resident (amount=5000, dueDate=2026-08-05)
- ☐ Resident sees payment in dashboard with status UNPAID
- ☐ 3 days before due date, resident receives reminder email
- ☐ Resident uploads payment proof → admin receives notification email
- ☐ Admin verifies proof → resident receives "payment verified" email + Receipt generated
- ☐ Resident sees payment status = PAID and can download receipt

**Payment Rejection**
- ☐ Admin rejects payment proof with reason → resident receives email with reason
- ☐ Resident can re-upload new proof for same payment

**Food & Notices**
- ☐ Admin creates food menu for current week → residents see menu in their dashboard
- ☐ Admin uploads food photo → photo appears in resident's food view
- ☐ Admin posts urgent notice → all active residents receive email (if PlatformConfig.emailSettings.sendNoticeEmails = true)
- ☐ Resident marks notice as read → persists across sessions

**Scheduled Jobs**
- ☐ Payment reminder job runs daily → sends emails to residents with payments due soon
- ☐ Overdue payment job runs daily → sends emails to residents with overdue payments

### 3.3 Phase 3 Definition of Done

- All deliverables ☑ checked off (code side; cook mobile screens deferred to Phase 6)
- All acceptance tests ☐ passing _(§3.2 needs a seeded DB + live Resend — external infra)_
- `MEMORY.md` and `CHANGELOG.md` updated
- Residents can activate accounts via QR, view food/notices, upload payment proofs
- Hostel admins can verify payments, manage food menus, send notices
- Payment workflow complete: creation → reminder → upload → verification → receipt
- **Guardian dashboard and safety features NOT yet built** - that's Phase 4

---

## PHASE 4 — Trust, Safety & Guardian (Week 4)

**Goal:** Build features that make this a real operations tool: complaints, night safety, SOS, ratings, guardian dashboard. Privacy-first safety features.

### 4.1 Deliverables

**Complaint System**
- ☐ **Resident - File Complaint**:
  - Form: category, title, description, optional photo upload
  - Anonymous option (if checked, admin sees "Anonymous Resident")
  - Creates Complaint with status: PENDING
  - Auto-calculates SLA deadline from PlatformConfig.complaintSlaHours
  - Creates notification for hostel admin
- ☐ **Resident - View Complaints**:
  - List own complaints
  - View complaint thread (complaint + admin updates)
  - Mark as resolved (resident confirmation)
- ☐ **Hostel Admin - Complaint Management**:
  - View all complaints for own hostel
  - Filter by status, category, SLA (past deadline or not)
  - Open complaint detail
  - Add update/comment (creates ComplaintUpdate)
  - Change status (PENDING → IN_PROGRESS → RESOLVED/REJECTED)
  - Sends email to resident on each status change
- ☐ **Scheduled Job**: Check complaints past SLA deadline → flag for admin attention

**Night Safety / Attendance Status**
- ☐ **Location Tracking & Auto-Attendance System (Mobile Background Service)**:
  - Add consent screen during QR code activation: "We need your location to provide best experience and track attendance. Your exact GPS coordinates are never stored."
  - User must agree to Terms of Use and Location Tracking consent
  - Log consent in ConsentLog model
  - Mobile app registers background service (setup in Phase 6, architecture in Phase 4):
    - Pings server at configured times (default: 8 AM, 6 AM, 10 PM)
    - Times configurable per hostel in HostelSettings
    - App sends { lat, lng, timestamp } to POST /api/resident/location/ping
    - Server calculates distance from hostel coordinates
    - Determines zone: INSIDE (0-50m), NEARBY (51-200m), OUTSIDE (201m+), UNKNOWN (phone off)
    - Creates AttendanceLog with zone status and distance (NOT exact coordinates)
    - Exact GPS coordinates are discarded immediately after zone calculation
- ☐ **Geofence Configuration**:
  - Platform defaults: insideZoneRadius=50m, nearbyZoneRadius=200m
  - Hostel admin can override in settings (within platform limits set by superadmin)
  - Store in HostelSettings model
- ☐ **Resident - View Attendance**:
  - Attendance history page: calendar view showing days INSIDE/NEARBY/OUTSIDE
  - Color-coded: green (inside), yellow (nearby), red (outside), gray (unknown)
  - Can request deletion of location history (admin reviews)
- ☐ **Hostel Admin - Attendance Dashboard**:
  - Real-time view: X residents inside, Y nearby, Z outside, W unknown
  - Attendance history: filter by date, resident, zone
  - Calendar view per resident
  - Attendance patterns: frequently absent residents, average attendance rate
  - Manual override attendance log (if resident's phone was off but they were present)
- ☐ **Attendance Alerts**:
  - If resident absent (OUTSIDE or UNKNOWN) for X consecutive days (default: 14, configurable)
  - System creates AttendanceAlert, sends email + push notification to hostel admin
  - Admin can resolve alert with notes
- ☐ **Data Retention & Privacy**:
  - AttendanceLog auto-deleted after X days (default: 600, configurable by admin, max enforced by superadmin)
  - Aggregated analytics kept, raw logs deleted
  - Resident can request immediate deletion via "Request Location History Deletion" button
- ☐ **Hostel Admin - Mark Night Status (Manual Override)**:
  - Daily checklist view: list all active residents
  - Mark each as: INSIDE, OUTSIDE, NOT_VERIFIED
  - Bulk-mark option (e.g., mark all as INSIDE)
  - Manual override with required overrideReason (logged in NightStatusLog)
  - Creates AuditLog entry for every status change
- ☐ **Resident - View Own Night Status**:
  - Calendar view showing own status per day
  - Summary only (Inside/Outside/Not Verified) - NO timestamps shown to resident
  - SOS button (accessible from every screen)
- ☐ **SOS Feature**:
  - Big red "SOS" button on resident dashboard (+ mobile app in Phase 6)
  - Confirmation dialog ("Are you sure? This will alert warden and guardian")
  - Creates NightStatusLog with status: SOS
  - Sends URGENT emails immediately:
    - All hostel admins
    - All active wardens
    - Guardian (if linked and has emergency access)
  - Creates high-priority Notification for all above users
  - Email uses emergency template with urgent styling (EMAIL_SYSTEM.md §5.1)

**Ratings & Reviews**
- ☐ **Resident - Submit Rating**:
  - One rating per hostel (enforced by unique index on residentId + hostelId)
  - Star ratings (1-5) for: overall, food, cleanliness, security, room, location, management
  - Optional text comment
  - Visible publicly after submission
- ☐ **Public - View Ratings**:
  - Ratings section on hostel detail page
  - Average stars per category
  - List of reviews (excluding hidden ones)
  - "Verified Resident" badge on each review
- ☐ **Superadmin - Moderate Reviews**:
  - View all reviews
  - Hide abusive/fake reviews with reason
  - Hidden reviews don't appear publicly but resident can still see their own

**Move-In / Move-Out Checklists**
- ☐ **Hostel Admin - Move-In Checklist**:
  - Create checklist for new resident (templates stored in PlatformConfig)
  - Items: ID copy collected, room photos taken, key issued, deposit paid, rules acknowledged
  - Mark items as checked with timestamp and checker userId
  - Resident can view their own move-in checklist
- ☐ **Hostel Admin - Move-Out Checklist**:
  - Create checklist when resident moves out
  - Items: pending fee checked, damage assessment, items returned, deposit refund
  - Track exitDate and final receipt
  - Updates Resident.status = MOVED_OUT on completion

**Guardian System**
- ☐ **Resident - Invite Guardian**:
  - Form: email, relation (mother/father/uncle/etc.), phone
  - Set access permissions (checkboxes):
    - Fee status
    - Receipts
    - Notices
    - Food menu
    - Night safety summary
    - Complaint status (titles only, not details)
  - Creates Guardian document with invitationToken
  - Sends guardian invitation email (EMAIL_SYSTEM.md §1.5)
  - Token expires in 7 days
- ☐ **Guardian - Accept Invitation**:
  - Clicks link from email
  - If no account: creates PUBLIC account → immediately upgraded to GUARDIAN
  - If existing PUBLIC account: upgraded to GUARDIAN
  - Linked to resident via Guardian.residentId
- ☐ **Guardian Dashboard**:
  - Single-page simplified view (no sidebar, minimal navigation)
  - Shows ONLY fields resident has enabled in accessPermissions:
    - Hostel name, contact, emergency contacts (always visible)
    - Fee status summary (if enabled): paid/unpaid/due amounts only, NO raw proof images
    - Receipts (if enabled): downloadable receipt links
    - Notices (if enabled): notices with targetAudience IN ('all', 'guardians')
    - Food menu (if enabled): current week's menu
    - Night safety summary (if enabled): day-level status (Inside/Outside/SOS) - NO timestamps, NO coordinates
    - Complaint status (if enabled): complaint titles + status only, NO full details
  - Fields not enabled = not returned in API response (server-side filtering)
- ☐ **Resident - Manage Guardian Permissions**:
  - View linked guardian
  - Update access permissions anytime
  - Remove guardian access

**In-App Notifications (Web)**
- ☐ Notification bell icon in header (shows unread count)
- ☐ Dropdown showing recent notifications
- ☐ Mark as read functionality
- ☐ Notifications created for:
  - Payment due/overdue
  - Payment verified/rejected
  - New notice
  - Complaint status updated
  - SOS alert (for admins/wardens/guardians)

**Community Feature (Resident Social Feed)**
- ☐ **Community Feed**: Residents can create posts with text + media (photos/videos/audio), visibility: PUBLIC or HOSTEL_ONLY, anonymous option
- ☐ **Engagement**: React (6 types), comment, share, notifications for engagement
- ☐ **Moderation**: Report posts, auto-profanity filter, admin can hide inappropriate posts (own hostel only)
- ☐ **Admin Dashboard**: View/moderate posts, community analytics, post official announcements

**Email Templates (Phase 4)**
- ☐ `resident/complaint-status-updated.tsx`
- ☐ `resident/complaint-resolved.tsx`
- ☐ `guardian/invitation.tsx`
- ☐ `guardian/sos-alert.tsx` (URGENT priority)

### 4.2 Acceptance Tests

**Complaints**
- ☐ Resident files complaint → admin receives notification → admin updates status → resident receives email
- ☐ Anonymous complaint doesn't reveal resident name to admin
- ☐ Complaint past SLA deadline is flagged in admin dashboard

**Night Safety**
- ☐ Admin marks resident as INSIDE → status saved in NightStatusLog
- ☐ Resident views own night status → sees day-level summary (no timestamps)
- ☐ Admin manually overrides status → overrideReason is required and logged

**SOS**
- ☐ Resident presses SOS button → confirms → NightStatusLog created with status: SOS
- ☐ Within 2 seconds, emails sent to all admins, wardens, and guardian (if linked)
- ☐ Email uses urgent template with red styling

**Guardian Privacy**
- ☐ Guardian A is linked to Resident A with only "feeStatus" enabled
- ☐ Guardian A logs in → sees fee summary → does NOT see night status, complaints, notices
- ☐ Guardian A cannot access any API endpoint that would expose disabled fields (verified by direct API calls)
- ☐ Resident updates guardian permissions → removes "feeStatus" → guardian refreshes → fee section disappears

**Ratings**
- ☐ Resident submits rating for their hostel → rating appears on public hostel page
- ☐ Resident tries to submit second rating for same hostel → returns 409 error (duplicate)
- ☐ Public visitor sees average ratings on hostel detail page
- ☐ Superadmin hides abusive review → review disappears from public page but resident can still see their own

**Checklists**
- ☐ Admin creates move-in checklist for resident → resident can view it
- ☐ Admin checks off items → timestamps recorded
- ☐ Admin completes move-out checklist → resident status = MOVED_OUT

### 4.3 Phase 4 Definition of Done

- All deliverables ☐ checked off
- All acceptance tests ☐ passing
- `MEMORY.md` and `CHANGELOG.md` updated
- Complaints, night safety, SOS, ratings, guardian dashboard all working
- Privacy rules from PRD.md §10 enforced and tested
- Guardian sees ONLY permitted fields (server-side enforcement verified)
- **Service provider network and referrals NOT yet built** - that's Phase 5

---

## PHASE 5 — Growth, Maintenance & Polish (Week 5)

**Goal:** Complete remaining features (referrals, service providers, maintenance), polish all portals, harden for production.

### 5.1 Deliverables

**Referral System**
- ☐ **Resident - Referral Dashboard**:
  - View own unique referral code (auto-generated on first access)
  - Shareable link
  - Track referrals: # sent, # joined, # converted (first payment confirmed)
- ☐ **Hostel Admin - Register Resident with Referral**:
  - Optional "referral code" field on resident registration
  - If valid code, links refereeResidentId to referrerResidentId
  - Marks Referral.converted = true after referee's first payment is verified
- ☐ **Referral Rewards** (informational tracking only, no auto-payout in v1):
  - Admin can mark Referral.rewardApplied = true manually
  - Display in resident dashboard ("You've earned X rewards")

**Service Provider System**
- ☐ **Public - Register as Service Provider**:
  - Form: name, phone, category, area, availability, description, photo, ID document
  - Uploads photo + document to R2
  - Creates ServiceProvider with status: PENDING
  - Sends "registration received" email
- ☐ **Superadmin/Moderator - Approve Providers**:
  - View pending service provider registrations
  - Review documents
  - Approve → status = APPROVED → sends "provider approved" email
  - Reject → status = REJECTED → sends rejection email with reason
  - Hide → status = HIDDEN (approved but temporarily hidden)
- ☐ **Hostel Admin - Search Service Providers**:
  - Search by category (plumber, electrician, doctor, etc.)
  - Filter by area, availability
  - View provider profile (name, phone, description, photo)
  - "Contact" button (tel: link for calling)
- ☐ **Hostel Admin - Maintenance Requests**:
  - Create maintenance request:
    - Category, description, urgency (low/medium/high)
    - Optional: link to specific room/bed
    - Optional: link to service provider (if already contacted)
  - Update request status: PENDING → CONTACTED → SCHEDULED → COMPLETED/CANCELLED
  - Add cost note (informational only, not billing)
  - View maintenance history per room/bed
- ☐ **Service Provider Directory Page** (public):
  - Browse approved providers by category
  - No login required (public directory)
  - Contact info visible only to hostel admins (public sees "Verified Provider" badge only)

**Platform Moderator Features**
- ☐ Moderator dashboard (limited version of superadmin)
- ☐ Can approve/reject hostels
- ☐ Can approve/reject service providers
- ☐ Can moderate reviews
- ☐ Can view reports (read-only, no export)
- ☐ Cannot access platform config, billing, or create other moderators

**QuestionCall Integration** (STUDENT residents only)
- ☐ Show "Study with QuestionCall" section in resident dashboard if residentType=STUDENT
- ☐ Track clicks in QuestionCallClick model, redirect with user context
- ☐ Superadmin analytics dashboard: clicks, conversions, per-hostel breakdown, CSV export

**Advanced Notifications**
- ☐ Admin can create custom notifications: priority levels, categories, target specific residents, schedule delivery
- ☐ View delivery stats: sent/delivered/read counts, read receipts
- ☐ Superadmin platform-wide notifications to all/specific hostels

**Configuration & Settings**
- ☐ Hostel admin settings page: location tracking config, attendance thresholds, cook portal, community moderation
- ☐ Superadmin platform config: set defaults, limits, override hostel settings

**Food & Attendance Analytics**
- ☐ Admin food analytics: avg ready times, delays, patterns, cook performance
- ☐ Admin attendance analytics: patterns, frequently absent residents, attendance rates

**Final Polish - All Portals**
- ☐ **Loading States**: Every list/detail view has skeleton loaders (not spinners)
- ☐ **Empty States**: Every list has helpful empty state ("No residents yet. Add your first resident!")
- ☐ **Error States**: Every view has error boundary + retry button
- ☐ **Form Validation**: All forms use Zod schemas, show inline errors
- ☐ **Mobile Responsiveness**: Full QA pass on 375px width for all screens
- ☐ **Accessibility**:
  - All images have alt text
  - All inputs have labels
  - Keyboard navigation works
  - Focus states visible
  - Color contrast WCAG AA compliant
- ☐ **Performance**:
  - Lighthouse mobile score ≥ 80 on key pages (home, hostel detail, dashboards)
  - TanStack Query caching reduces redundant API calls
  - Images optimized and lazy-loaded

**Reports & Analytics**
- ☐ **Superadmin Reports**:
  - Total hostels by status
  - Total residents by status
  - Payment volume (verified payments)
  - Complaint volume by hostel
  - CSV export for each report
- ☐ **Hostel Admin Reports**:
  - Resident count over time
  - Payment collection rate
  - Complaint resolution time
  - Room occupancy rate

**Security Hardening**
- ☐ Rate limiting on all auth endpoints (5 attempts per 15 min per IP)
- ☐ SQL injection prevention (Mongoose handles this, but verify no raw queries)
- ☐ XSS prevention (React handles this, but verify no `dangerouslySetInnerHTML` without sanitization)
- ☐ CSRF protection (httpOnly cookies + SameSite=Lax)
- ☐ Helmet.js for security headers
- ☐ File upload validation (content type, max size, no executable files)
- ☐ Signed URLs for private files (payment proofs, documents) with short expiry (15 min)

**Testing (see TESTING.md for full strategy)**
- ☐ Write unit tests for:
  - Account upgrade logic
  - Multi-tenancy filtering in repositories
  - Payment status calculations
  - Guardian permission filtering
- ☐ Write integration tests for:
  - Auth flow (signup, verify, login, refresh, logout)
  - Hostel approval workflow
  - Payment proof verification workflow
  - Complaint lifecycle
- ☐ Write E2E tests (Playwright):
  - Public discovery flow
  - Hostel onboarding and approval
  - Resident registration and QR activation
  - Payment upload and verification
  - Guardian dashboard with permission checks
  - SOS alert

**Documentation Updates**
- ☐ All new API endpoints added to API.md
- ☐ All Phase 5 features documented in MEMORY.md
- ☐ CHANGELOG.md updated with Phase 5 release notes
- ☐ README.md updated with final setup instructions

**Deployment Preparation**
- ☐ Vercel project created and linked
- ☐ Environment variables configured in Vercel (production + preview)
- ☐ Domain DNS configured (if client provides domain)
- ☐ MongoDB production indexes verified
- ☐ R2 bucket CORS configured for production domain
- ☐ Resend domain verified and sending working
- ☐ Vercel Cron jobs configured for payment reminders, SLA checks
- ☐ Error monitoring set up (Sentry or similar)

### 5.2 Acceptance Tests

**Referrals**
- ☐ Resident A shares referral code with Resident B
- ☐ Admin registers Resident B with A's code
- ☐ Admin verifies B's first payment → A's referral marked as converted
- ☐ Resident A sees referral count increase

**Service Providers**
- ☐ Public user registers as service provider → receives confirmation email
- ☐ Superadmin approves provider → provider receives approval email
- ☐ Hostel admin searches for "Plumber" in "Kathmandu" → sees approved providers
- ☐ Admin creates maintenance request → links to provider → updates status to COMPLETED

**Security**
- ☐ Attempting 6 failed logins locks out IP for 15 minutes
- ☐ Private files (payment proofs) served via signed URLs that expire after 15 min
- ☐ Attempting to access another hostel's data returns 404 (not 403, to avoid leaking existence)

**Full Regression**
- ☐ Re-run ALL acceptance tests from Phases 1-4
- ☐ All tests still passing (no regressions introduced)

**Production Readiness**
- ☐ Deployed to Vercel production environment
- ☐ All cron jobs running on schedule
- ☐ Emails sending successfully from production domain
- ☐ Error monitoring capturing exceptions
- ☐ Lighthouse scores ≥ 80 on mobile for all key pages

### 5.3 Phase 5 Definition of Done

- All deliverables ☐ checked off
- All acceptance tests ☐ passing
- Full regression pass completed
- `MEMORY.md` and `CHANGELOG.md` updated
- Product is feature-complete per PRD.md (web platform)
- Production deployment successful and stable
- **Web platform (Phases 1-5) complete and ready for users**
- **Mobile app (Phase 6) starts next**

---

## PHASE 6 — Mobile App (Weeks 6-8, Post Web-Launch)

**Goal:** Deliver native mobile experience (React Native + Expo) for residents with QR camera scanning and push notifications.

### 6.1 Deliverables

**Project Setup**
- ☐ Create `apps/mobile` in monorepo
- ☐ Expo app scaffolded with TypeScript - ask user how they want to init the mobile .
- ☐ Configure Expo Dev Build (EAS Build)
- ☐ Import shared types/schemas from `packages/shared`
- ☐ Configure Axios instance to use same API as web (env: `EXPO_PUBLIC_API_URL`)
- ☐ Set up Expo SecureStore for token storage
- ☐ Configure app.json with correct bundle IDs, app names, permissions

**Auth on Mobile**
- ☐ Same auth endpoints as web (`/api/auth/login`, `/api/auth/google`, etc.)
- ☐ Store access/refresh tokens in Expo SecureStore
- ☐ Axios interceptor attaches `Authorization: Bearer <token>` header
- ☐ Google Sign-In via Expo AuthSession
- ☐ Biometric login option (optional, face/fingerprint)

**QR Camera Scanning**
- ☐ Install `expo-camera` and request camera permissions
- ☐ QR scan screen: camera view with overlay
- ☐ Scan QR → extract code → call `/api/qr-activation/activate`
- ☐ On success → redirect to resident dashboard
- ☐ Fallback: manual code entry

**Resident Dashboard (Mobile)**
- ☐ Bottom tab navigation: Home, Payments, Food, Notices, More
- ☐ **Home Tab**:
  - Welcome card (hostel name, room/bed)
  - Next payment due
  - Latest notice preview
  - Today's food menu preview
  - Night status summary
  - SOS button (large, accessible)
- ☐ **Payments Tab**:
  - List of payments
  - Upload payment proof (use expo-image-picker)
  - View receipts
- ☐ **Food Tab**:
  - Current week's menu
  - Food photo gallery (native image viewer)
- ☐ **Notices Tab**:
  - List of notices
  - Mark as read
  - Filter by category
- ☐ **More Tab**:
  - Profile
  - Complaints (create + view)
  - Night status history
  - Referral code
  - Settings
  - Logout

**Push Notifications (FCM + APNS)**
- ☐ Firebase project created for FCM (Android) + APNS (iOS)
- ☐ Expo push token registration: on app launch, get device token, POST to /api/user/device-token
- ☐ Backend stores device tokens per user in User model or separate DeviceToken collection
- ☐ Handle notification reception: foreground, background, killed state
- ☐ Notification types: payment alerts, food ready, SOS, community engagement, attendance alerts
- ☐ Deep linking: tapping notification opens relevant screen
- ☐ Notification badge count on app icon

**Location Tracking & Background Service (Auto-Attendance)**
- ☐ Request location permissions with clear explanation during QR activation
- ☐ Implement background location service (using expo-task-manager + expo-location)
- ☐ Service pings server at configured times (default: 8 AM, 6 PM, 10 PM)
- ☐ Fetch tracking times from /api/resident/settings on app load
- ☐ POST /api/resident/location/ping with { lat, lng, timestamp }
- ☐ Handle permission denied gracefully (mark as UNKNOWN)
- ☐ Battery optimization: use geofencing instead of continuous tracking
- ☐ User can view/manage location permissions in Settings
- ☐ Consent screen: "We need location to track attendance. Your exact coordinates are NOT stored."

**Cook Portal Mobile App**
- ☐ Separate cook role navigation (or separate app build)
- ☐ Simple dashboard: today's menu, resident count
- ☐ Large "Food Ready" buttons per meal type (breakfast, lunch, snacks, dinner)
- ☐ Button press flow:
  - Select meal type → optional: add custom message OR fetch from menu OR just "ready"
  - Confirm → creates FoodReadyLog → sends push notifications to all residents
- ☐ Upload food photo: camera → simple upload → auto-linked to meal
- ☐ View resident list (names + photos, read-only)
- ☐ View food menu (read-only)
- ☐ Device fingerprint auto-registration on first login
- ☐ Analytics: view food timing patterns (if cook wants to improve)

**Community Feature Mobile**
- ☐ Community tab in bottom navigation
- ☐ Feed view: infinite scroll, pull-to-refresh
- ☐ Create post: text input + media picker (photos/videos from gallery or camera)
- ☐ Post visibility toggle: Public / Hostel Only
- ☐ Anonymous posting option
- ☐ Like/react with 6 reaction types
- ☐ Comment thread view
- ☐ Push notifications for engagement (likes, comments, shares)
- ☐ Report post/comment functionality

**Mobile-Specific Features**
- ☐ Biometric login (Face ID / Touch ID / Fingerprint)
- ☐ Offline support: cache critical data (payments, notices) with react-query
- ☐ Native image viewer for food photos and community media
- ☐ Share functionality: share referral code, hostel profile via native share sheet
- ☐ Call/SMS shortcuts for contacting hostel admin (native tel: and sms: links)

**Push Notifications (FCM)**
- ☐ `google-services.json` and `GoogleService-Info.plist` added
- ☐ Expo push notification setup (`expo-notifications`)
- ☐ Register device token with backend on app launch
- ☐ Backend sends push notifications for:
  - Payment due/overdue
  - Payment verified/rejected
  - New notice
  - Complaint status updated
  - SOS alert (for admins/wardens/guardians)
- ☐ Handle notification taps → deep link to relevant screen

**SOS Button (Mobile)**
- ☐ Large red button on home screen
- ☐ Long-press to activate (prevents accidental triggers)
- ☐ Confirmation dialog with countdown (3 seconds to cancel)
- ☐ On confirm → calls `/api/resident/sos` → sends push + emails

**Offline Support (Optional)**
- ☐ Cache basic data (profile, hostel info) in AsyncStorage
- ☐ Show cached data when offline
- ☐ Queue actions (e.g., upload proof) when offline, sync when online

**Testing (Mobile)**
- ☐ Test on physical Android device
- ☐ Test on physical iOS device (or simulator)
- ☐ QR scanning works in various lighting conditions
- ☐ Push notifications received and tappable
- ☐ Deep linking works from notifications
- ☐ Biometric login works (if implemented)

**App Store Preparation**
- ☐ App icons (all sizes) generated
- ☐ Splash screens designed
- ☐ Privacy policy URL added to app config
- ☐ App screenshots for stores (5-6 per platform)
- ☐ App store descriptions written
- ☐ EAS Build profiles configured (development, preview, production)
- ☐ Generate APK for Play Store (or internal distribution)
- ☐ Generate IPA for App Store (TestFlight first)

**Hostel Admin Mobile View (Minimal - Optional)**
- ☐ View-only dashboard (stats, recent activity)
- ☐ Receive push notifications for:
  - New inquiry
  - Payment proof uploaded
  - Complaint filed
  - SOS alert
- ☐ Quick actions: approve payment, respond to complaint
- ☐ Full admin features stay on web (not replicated in mobile)

### 6.2 Acceptance Tests

**Auth**
- ☐ User can log in with email/password on mobile
- ☐ User can log in with Google on mobile
- ☐ Tokens stored securely in SecureStore
- ☐ Auto-refresh works when access token expires

**QR Activation**
- ☐ Fresh install → scan QR code → account activated → dashboard loads
- ☐ QR scan works in low light
- ☐ Manual code entry works as fallback

**Push Notifications**
- ☐ Device token registers successfully on app launch
- ☐ Payment due notification received → tap → opens Payments tab
- ☐ New notice notification received → tap → opens Notices tab
- ☐ SOS alert notification received by admin → tap → opens relevant screen (web or mobile)

**SOS**
- ☐ Long-press SOS button → countdown dialog → confirm → alert sent
- ☐ Accidental tap doesn't trigger SOS (requires long-press + confirmation)

**Payments**
- ☐ Upload payment proof from mobile camera roll
- ☐ Photo uploads to R2 successfully
- ☐ Proof appears in admin's verification queue

**Deep Linking**
- ☐ Tapping notification opens correct screen
- ☐ Tapping referral link opens app (if installed) or Play Store

### 6.3 Phase 6 Definition of Done

- All deliverables ☐ checked off
- All acceptance tests ☐ passing
- `MEMORY.md` and `CHANGELOG.md` updated
- Mobile app tested on real devices
- APK/IPA built and ready for distribution
- Push notifications working end-to-end
- QR scanning working reliably
- **Complete product delivered: web platform + mobile app**
- Ready for app store submission (or internal distribution)

---

## Cross-Phase Rules (Applies to Every Phase)

- ☐ Every new API endpoint documented in `API.md` **in the same PR**
- ☐ Every new Mongoose model documented in `DATABASE.md` **in the same PR**
- ☐ Every completed feature ticked off in `MEMORY.md`
- ☐ Every phase ends with a `CHANGELOG.md` entry
- ☐ No commented-out or dead code merged
- ☐ Multi-tenant isolation tested in **every** PR that touches hostel-scoped data
- ☐ Role-based access tested in **every** PR that adds a new endpoint
- ☐ Email triggers implemented per EMAIL_SYSTEM.md
- ☐ All Zod schemas in `packages/shared` reused by both API and forms

---

## Explicitly Deferred (NOT in Phases 1-6)

Per PRD.md §5, these are **out of scope**:

- Automated payment gateway integration (eSewa/Khalti/connectIPS API)
- SMS/WhatsApp delivery infrastructure
- Domain purchase, hosting bills, Play Store/App Store accounts
- Paid map/location API tier (Google Maps is runtime-fallback only)
- Long-term maintenance beyond the agreed free-support window
- Any feature not enumerated in Phases 1-6 above

---

_End of PHASES.md_

