# PRD.md — Product Requirements Document

**Product:** Multi-Hostel SaaS Platform
**Version:** 1.0
**Doc status:** Locked for Phase 1–6 build. Mobile app is Phase 6 (see PHASES.md).
**Original project start date (per source brief):** 22 June 2026
**Docs finalized:** 14 July 2026
**Timeline:** 5 weeks for web platform (Phases 1-5) + 2-3 weeks for mobile app (Phase 6) = ~7-8 weeks total

---

## 1. Problem Statement

Students in Nepal looking for hostels rely on word-of-mouth, unverified Facebook posts, and walk-ins. There's no trustworthy, centralized way to compare hostels on price, food, safety, and facilities. Hostel owners run everything (residents, fees, food, complaints, maintenance) on paper, WhatsApp, or spreadsheets, with no shared system across rooms/beds/residents/payments.

## 2. Product Vision

A multi-tenant SaaS platform that is simultaneously:
- A **public discovery site** (like a trustworthy classifieds/marketplace) for students and guardians.
- An **operations system** for hostel owners/wardens to run day-to-day hostel life.
- A **platform control panel** for the platform owner to approve, verify, and monitor every hostel on the system.
- A **private resident app experience** once a student has actually joined a hostel (web dashboard + native mobile app).
- A **local services directory** connecting hostels to plumbers, electricians, doctors, cleaners, etc.

This is not a listing site with a contact form bolted on — it is the operating system a hostel runs on, with the public site as its front door.

## 3. Target Users / Personas

| Persona | Who | Primary need |
|---|---|---|
| Prospective student | 17–25, searching for a hostel near college | Find trustworthy, affordable, well-located hostel fast |
| Guardian/parent | Parent of the student | Reassurance: fees paid, food okay, child safe at night |
| Hostel owner | Runs 1 (sometimes 2–3) hostels | Replace paper/WhatsApp chaos with one dashboard |
| Warden/staff | Works under the owner, on-site daily | Fast day-to-day operations: check-ins, food, notices, complaints |
| **Cook** | Works in hostel kitchen | **Simple mobile app to notify residents when food is ready** |
| Resident/student | Already living in a hostel | See their own fees, food, notices, raise complaints |
| Platform owner (you) | Runs the SaaS business | Approve hostels, catch fraud/duplicates, see platform health, bill hostels |
| Platform moderator | Assists platform owner | Limited subset of superadmin permissions for day-to-day operations |
| Service provider | Local plumber/electrician/doctor/etc. | Pick up part-time repair/maintenance jobs from nearby hostels via the app and get paid per job |

## 4. Goals

1. Let a student go from "searching" to "compared 3 hostels and contacted one" in minutes.
2. Let a hostel owner fully digitize resident, room, fee, food, and complaint management without needing separate tools.
3. Give the platform owner control over quality (verification, anti-fraud, subscriptions) without manual spreadsheet tracking.
4. Give guardians peace of mind without turning the product into a surveillance tool for students.
5. Ship a real, production-grade multi-tenant system — not a demo — that a small dev team (with an AI coding assistant) can build in a tight timeframe without architectural rework later.

## 5. Non-Goals (out of scope by default)

Per the source brief, unless separately agreed, this project does **not** include:
- Domain purchase, hosting/server bills, SMS/WhatsApp/email provider costs
- Payment gateway merchant charges (automated eSewa/Khalti/connectIPS integration is a *later* phase, not v1)
- Play Store / App Store account fees
- Paid map/location API costs (Google Maps is runtime-detected fallback; default is free OpenStreetMap)
- Service provider labor cost, repair materials, doctor/clinic fees
- Legal compliance certification or government verification claims
- Long-term maintenance after the agreed free-support window
- Anything not explicitly listed in this document

## 6. Products Delivered

| Product | Purpose | Phase |
|---|---|---|
| Website (public + all portals) | Discovery, all dashboards, all admin panels | Phases 1–5 |
| Backend/API | Auth, multi-tenant logic, payments, notifications, uploads, reports | Phases 1–5 |
| Database | All entities (see DATABASE.md) | Phase 1 |
| File storage | Hostel photos, food photos, documents, payment proofs | Phase 1 |
| Mobile app (React Native/Expo) | Resident-facing app, QR scan, push notifications | Phase 6 (post web-launch) |

## 7. Portals & Roles

See ARCHITECTURE.md §3 for the technical auth model. Functionally:

| Portal | Roles | Access |
|---|---|---|
| Public Portal | Anonymous + `PUBLIC` role | Browse, search, compare, inquire, apply to become a service provider |
| Platform Owner Portal | `SUPERADMIN` | Full platform control |
| Platform Moderator Portal | `PLATFORM_MODERATOR` | Limited subset: hostel approval, review moderation, service provider approval, reports (no financial/billing access, no API key management, no platform config changes) |
| Hostel Owner/Warden Portal | `HOSTEL_ADMIN`, `WARDEN` | Manage one hostel (warden = restricted subset of admin permissions) |
| **Cook Portal** | **`COOK`** | **Mobile-only: Food ready notifications, photo uploads, view resident names** |
| Resident Portal | `RESIDENT` | Own hostel dashboard only (web + mobile app) |
| Guardian Dashboard | `GUARDIAN` | Read-only, limited, opt-in visibility into one resident |
| **Service Provider App** | **`SERVICE_PROVIDER`** | **Mobile-only, no web dashboard: browse/accept nearby maintenance-job broadcasts, digital ID card (§8.6)** |

Before approval, an applicant is just a `PUBLIC` account with a `ServiceProvider` record pending review — the row above only applies once `SUPERADMIN`/`PLATFORM_MODERATOR` approves them (§8.6). `ServiceProvider` itself is a directory listing, not an account; a public visitor can still browse the read-only `/service-providers` directory with no login, same as today.

A single account can hold **one** role at a time. Role transitions (e.g., PUBLIC → RESIDENT) happen via the account-upgrade mechanism (see §8).

## 8. Authentication & Account Model (finalized)

This is an explicit product decision, not an implementation detail — documented here because it shapes the whole UX:

### 8.1 Unified Login Gateway

- **One login page** (`/login`) for everyone — public visitors, residents, guardians, wardens, hostel admins, platform moderators, and the superadmin all use the *same* screen and the *same* two sign-in methods:
  1. **Email + password**
  2. **"Continue with Google"**

- **Email verification required:** When a user signs up with email/password as `PUBLIC`, they must verify their email address before full access is granted. A verification email is sent immediately upon signup with a time-limited verification link.

### 8.2 Role-Based Account Creation

- **Public accounts are self-serve.** Anyone can create a `PUBLIC` account via email/password signup or Google sign-in, with no approval needed. This is the account tier used for browsing, saving searches, and submitting inquiries.

- **Every other role is admin-issued, never self-registered:**
  - `SUPERADMIN` — created via a one-time bootstrap/seed script (see ENVIRONMENT.md), not via any UI form.
  - `PLATFORM_MODERATOR` — created by the superadmin via the admin portal.
  - `HOSTEL_ADMIN` — created by the superadmin when a hostel is approved.
  - `WARDEN` — created by a hostel admin.
  - `RESIDENT` — created by a hostel admin/warden as part of the manual resident-registration flow.
  - `GUARDIAN` — created when a resident sends an invitation link to their guardian's email.

- When any of these accounts is created, the system generates a temporary password (except for guardian invitations which prompt password creation) and **emails the login credentials** (email + temporary password) to that person. First login forces a password change.

### 8.3 Account Upgrade Mechanism (Critical)

**Same-email account upgrade:** if someone already has a `PUBLIC` account (created via Google or email/password) and is later registered by a hostel admin as a Resident/Warden/Guardian using the *same email address*, the system **upgrades that existing account in place** — it does not create a duplicate user. Their role field changes, their profile is linked, and their next login (by password or by the same Google account) takes them straight to their new role's dashboard.

**How it works:**
1. Hostel admin registers a new resident with email `student@example.com`
2. System checks if `student@example.com` already exists:
   - **If NO existing user:** Create new User with `RESIDENT` role, generate temporary password, send credential email
   - **If existing user with `PUBLIC` role:** Upgrade the existing User's role to `RESIDENT`, keep existing password/Google link intact, send "account upgraded" notification email
   - **If existing user with non-`PUBLIC` role:** Return `409 email_already_has_role` error — one email cannot hold two non-public roles simultaneously

3. When the student logs in next (via password OR Google with same email), the backend detects `role = RESIDENT` and redirects to resident dashboard automatically

**Google Login Auto-Link:**
- Scenario: Admin creates resident account for `john@gmail.com` (who has never visited the site)
- Later, John clicks "Continue with Google" using `john@gmail.com`
- System matches email, finds the admin-created `RESIDENT` account, logs him in as RESIDENT
- No duplicate account created, seamless experience

**Security Safeguard (required):**
Upgrading a `PUBLIC` account into `HOSTEL_ADMIN` or `SUPERADMIN` (high-privilege roles) must not happen silently. For these two roles specifically, send a confirmation email and require the recipient to click a confirmation link before the upgrade takes effect. `RESIDENT`, `WARDEN`, `GUARDIAN`, and `SERVICE_PROVIDER` upgrades can proceed immediately since they're lower-privilege and a human (the registering admin, or the SUPERADMIN/PLATFORM_MODERATOR reviewing the provider application) has already vetted the person.

### 8.4 Hostel Owner Registration Flow

1. Visitor clicks "Register Your Hostel" on public site
2. If not logged in, prompted to sign up as `PUBLIC` first (email verification required)
3. Once logged in as `PUBLIC`, fills hostel registration form (hostel details, owner info, documents upload)
4. Form submission creates a `Hostel` record with `status: PENDING` linked to their PUBLIC account
5. Superadmin reviews and approves the hostel
6. On approval, system upgrades the owner's `PUBLIC` account to `HOSTEL_ADMIN` (with email confirmation step), generates credentials, and emails them
7. Owner can now log in as `HOSTEL_ADMIN` and access hostel management portal

### 8.5 Smart Login Redirect

After successful login, backend returns `{ role, redirectPath }`:
- `PUBLIC` → `/` (public homepage)
- `SUPERADMIN` → `/platform/dashboard`
- `PLATFORM_MODERATOR` → `/platform/dashboard` (same portal as the superadmin,
  with config, fee plans and platform settings withheld by route rule)
- `HOSTEL_ADMIN` → `/hostel-admin/dashboard` (also `/{hostel-slug}/admin/...`)
- `WARDEN` → `/hostel-admin/dashboard` (same portal, capability-gated features)
- `RESIDENT` → `/resident/dashboard` (web) or the resident app (mobile)
- `GUARDIAN` → `/guardian/dashboard`
- `COOK` → `/` (no portal — mobile-only, single endpoint)
- `SERVICE_PROVIDER` → `/` with an "Open the HostelHub app" notice (no web dashboard at all — see §8.6)

See ARCHITECTURE.md §3.1 for why moderator and superadmin share one `/platform`
portal instead of having separate `/superadmin` and `/moderator` trees.

Frontend never decides the redirect path — always trusts the backend's response based on the user's current role.

### 8.6 Service Provider Registration Flow

Structurally the same self-apply-then-get-upgraded shape as §8.4 (Hostel Owner), with one difference: the applicant authenticates with Google *before* the form, so the account and the application share a verified email from the start rather than needing a later match.

1. Provider opens the app (or the public site) and taps "Register as a service provider." First screen is **"Continue with Google"** — not optional, not one of two choices: registration only proceeds once the person is signed in with a verified Google account. This creates (or reuses) their `PUBLIC` account.
2. Once signed in, they fill the provider form (name, category, phone, area, city, availability, experience, description, photo, documents). **Email is pre-filled from the Google account and not editable** — it is the account's own verified address, not a freestanding form field (today's `serviceProviderRegisterSchema.email` is optional and free-text; under this flow it becomes required and derived from the session, matching how §8.4's hostel-registration form is filled by an already-authenticated `PUBLIC` account).
3. Submission creates a `ServiceProvider` record with `status: PENDING_APPROVAL`, **linked to the submitter's `userId`** (today's `ServiceProvider` model has no such link — see DATABASE.md). A "registration received" email goes out (EMAIL_SYSTEM.md §6.1, unchanged).
4. `SUPERADMIN`/`PLATFORM_MODERATOR` reviews the application and documents, same queue as today.
5. **On approval:** the linked `PUBLIC` account is upgraded to `SERVICE_PROVIDER` in place (§8.3's pattern, not Cook's synthetic-shared-account pattern — the provider has a real personal mailbox because it came from Google). A temporary password is generated and emailed alongside the approval notice (EMAIL_SYSTEM.md §6.2), and `mustChangePassword` is set so the first login forces a password of their own choosing.
   - **On rejection:** the account stays `PUBLIC`; no credentials are issued. The rejection email (§6.3) states the reason and invites resubmission.
6. Provider opens the app and logs in with **email + the emailed password** — not Google again. Google was the registration-time identity gate; the password is the app's standing login, exactly like every other admin-issued role in §8.2. First login forces them to set their own password.
7. Signed in, the app *is* their job board: open maintenance requests from hostels in their category/area appear as a feed; first to accept claims the job (§9.6); no web dashboard exists for this role (§8.5).

## 9. Feature Scope Summary

All feature detail lives in the original source brief and is broken into buildable units in PHASES.md. High-level modules:

### 9.1 Public Hostel Discovery
- Listing page with search/filter (area, price range, room type, gender, food, facilities, college-nearby)
- Hostel profile page (photos, facilities, rules, food menu, location map, ratings, verification badge)
- Map view with nearby points of interest (colleges, hospitals, bus stops)
- Hostel comparison (2–3 side by side)
- Inquiry form (no login required)
- Verification badges (platform-verified, not government-verified)
- Ratings & reviews (verified residents only)

### 9.2 Platform Owner / Moderator
- Dashboard (total hostels, residents, payments, inquiries, complaints)
- Hostel approval workflow (pending queue, document verification, approve/reject)
- Owner/document verification
- Duplicate/ghost-listing detection (same address, phone, photos, documents)
- Subscription/billing tracking (manual record-keeping, no auto-gateway in v1)
- Review moderation (hide abusive reviews)
- Platform-wide reports (hostels, payments, inquiries, complaints - CSV export)
- Announcements (broadcast to all hostels/users)
- Service provider approval workflow
- Abuse control (suspend hostels, ban users)

### 9.3 Hostel Admin / Warden
- Hostel profile management (description, photos, amenities, contact, rules, pricing)
- Room + bed digital map (create rooms, assign beds, track status)
- Resident management (register, QR activation, profile, move-in/move-out)
- Warden account creation (permission-gated features per warden)
- QR code generation for resident activation
- Payment management (set monthly fees, view due list, verify payment proofs, generate receipts)
- Food transparency (weekly menu, daily food photos)
- Notices (create, mark urgent, target audience: residents/guardians)
- Complaint system (view, update status, add comments, resolve)
- Night safety status (mark residents as inside/outside/not-verified, manual override with reason)
- Maintenance & service provider network (search providers, create maintenance requests, track status)
- Inquiry inbox (view inquiries from public site, mark as contacted/converted)

### 9.4 Resident
- Private dashboard (hostel info, room/bed, next due date, latest notice, today's food)
- Profile (read-only personal info, request edit)
- Food menu view (current week's menu + food photos)
- Notices feed (read, mark read/unread)
- Payment records (monthly fees, due amount, payment history, receipts)
- Payment proof upload (choose method: eSewa/Fonepay/Khalti/bank/cash, upload screenshot, add reference note)
- Complaint system (file complaint with category, description, optional photo, anonymous option)
- Night status (view own history, no live tracking)
- SOS button (emergency alert to warden/owner/guardian)
- Ratings & reviews (one per hostel, verified residents only)
- Referral system (unique referral code, track referrals)
- Guardian invitation (send invitation link to guardian's email, control access permissions)

### 9.5 Guardian
- Limited dashboard (linked resident's hostel info, contact, emergency contacts)
- Fee status (paid/unpaid/due summary, receipts if permitted)
- Notices (guardian-tagged notices only)
- Night status summary (day-level status only: Inside/Outside/Not Verified/SOS - no timestamps, no location)
- Complaint status (only if resident explicitly enables sharing)
- Food menu view (if permitted)
- **NO ACCESS TO:** Raw payment proofs, complaint details unless shared, resident's private data, other residents' data

### 9.6 Service Provider Directory & Job Marketplace (app, Phase 6 — see §8.6)
- Registration gated behind Google sign-in; form (category, name, phone, area, availability, profile, ID upload) with email locked to the Google account
- Status workflow unchanged (pending → approved/rejected by platform moderator/superadmin), but approval now also upgrades the account and issues app credentials
- Public read-only directory (`/service-providers`) is unchanged: counts and approved listings, no login, no phone numbers
- Hostel admin still creates maintenance requests and can still hand-pick a provider to contact directly (today's flow, unchanged) — **or** broadcast the request to every approved, matching provider in the category/area; the first to accept claims it and every other provider's feed drops it
- Provider app: job feed (open broadcasts matching their category/area), accept/claim, active-job detail (hostel contact + address revealed only after claiming), mark complete
- Digital service-provider ID card, same canvas-rendering approach as the resident ID card (`resident-id-card.ts`) with a distinct visual skin, downloadable, QR-scannable by hostel staff to confirm identity + approval status on arrival
- No web dashboard for this role — mobile app only

## 10. Privacy Principles (non-negotiable product rules)

- This is **not** a surveillance product. Night status is `Inside Hostel / Outside Hostel / Not Verified / SOS` — never a live location trail, never GPS coordinates, never "last seen at [time/place]".
- Guardians get a **summary**, never raw movement history or exact timestamps.
- Complaint visibility to guardians is **opt-in by the resident**, not default.
- Residents never see other residents' private data.
- Service providers never receive resident personal data — only maintenance-request details relevant to the job.
- Broadcasting a job to multiple providers (§9.6) must not multiply that exposure: the hostel's exact address/contact stays hidden in the feed and is revealed only to whichever provider actually claims the job — the rest see it disappear, not the details behind it.
- Payment proofs, ID documents, and complaint content are private — served via signed URLs with short expiry.
- No PII (names, emails, phones) in server logs.
- Full data-access matrix is in the source brief §16 — treat it as the authoritative privacy spec. Any new feature must be checked against that table before shipping.

## 11. Success Criteria (v1 / end of Phase 5)

- A public visitor can search, filter, compare, and submit an inquiry with zero login required.
- A hostel owner can fully onboard a hostel (profile, rooms, beds) and register a resident end-to-end, including QR activation, in under the time it currently takes them on paper.
- A resident can see their fee status, upload payment proof, view food menu, raise a complaint, and see their own night-status summary.
- A guardian, if enabled by the resident, sees the limited dashboard with no ability to see live location or complaint details unless explicitly shared.
- The platform owner can approve/reject a hostel, flag a duplicate listing, and see platform-wide numbers.
- Multi-tenant isolation is provably correct: a hostel admin cannot, under any input, read another hostel's residents, payments, or documents (this must be covered by automated tests — see TESTING.md).
- All 30+ email scenarios are implemented and tested (see EMAIL_SYSTEM.md).
- Mobile app (Phase 6) delivers the same resident features in a native experience with QR scanning and push notifications.

## 12. Open Questions / Risks to revisit with the client

- Timeline confirmation: Original brief scoped 5 weeks from 22 June 2026. As of 14 July 2026, ~3 weeks have elapsed. Confirm the real end date with the client so PHASES.md dates are realistic, not aspirational.
- Google Maps Platform costs: If client wants to enable Google Maps fallback, a billing-enabled Google Cloud project is required. This is client-payable per §5 above. Ensure API key and billing are set up before enabling the fallback, or stick with free OpenStreetMap-only.
- Automated payment gateway integration (eSewa/Khalti/connectIPS) is intentionally deferred — v1 ships with manual proof-of-payment upload + admin verification only.

## 13. Feature Comparison: Web vs Mobile

| Feature | Web (Phases 1-5) | Mobile App (Phase 6) |
|---|---|---|
| Public discovery | ✅ Full | ❌ Not needed (web handles discovery) |
| Hostel admin portal | ✅ Full | ⚠️ Limited (view-only dashboard, notifications) |
| Resident experience | ✅ Full web dashboard | ✅ Full native app with better UX |
| QR code scanning | ⚠️ Manual code entry | ✅ Camera scan |
| Push notifications | ❌ In-app notification bell only | ✅ FCM push notifications |
| Food photos | ✅ Gallery view | ✅ Native photo viewer |
| SOS button | ✅ Web button | ✅ Native, accessible from anywhere |
| Guardian dashboard | ✅ Full | ⚠️ View-only (no mobile needed initially) |

## 14. Key Terminology

| Term | Definition |
|---|---|
| Hostel | A tenant in the multi-tenant system. Each hostel is isolated from others. |
| Hostel Owner | The person who owns/runs the hostel. Has `HOSTEL_ADMIN` role after approval. |
| Warden | Staff member working for a hostel. Has `WARDEN` role with permission-gated access. |
| Resident | Student living in a hostel. Has `RESIDENT` role after QR activation. |
| Guardian | Parent/guardian of a resident. Has `GUARDIAN` role with limited, opt-in visibility. |
| Platform Owner | The person running the SaaS platform. Has `SUPERADMIN` role. |
| Platform Moderator | Assistant to platform owner. Has `PLATFORM_MODERATOR` role with limited permissions. |
| Public User | Anyone with a `PUBLIC` account. Can browse, search, inquire, but no hostel-specific access. |
| QR Activation | One-time process where a resident scans/enters a QR code to activate their account and gain access to their hostel's resident portal. |
| Account Upgrade | Process where an existing `PUBLIC` account is converted to a higher-privilege role (RESIDENT, WARDEN, etc.) when admin-registered, without creating a duplicate account. |
| Multi-tenant | Each hostel is a separate tenant. Data is isolated at the application layer via `hostelId` filtering. |
| PlatformConfig | Singleton MongoDB document containing runtime-configurable values (fees, limits, feature flags, etc.) loaded at server boot and cached for fast access. |

---

_End of PRD.md_
