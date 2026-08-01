# API.md — Endpoints & Contracts

All endpoints are Next.js Route Handlers under `apps/web/app/api/**`. This same API is what the Phase 6 mobile app will consume — keep it transport-agnostic (no assumptions about cookies-only auth; support Bearer tokens too, see §1.3).

## 1. Conventions

### 1.1 Response envelope

Success:
```json
{ "success": true, "message": "Request successful", "data": { } }
```

Error:
```json
{ "success": false, "message": "Human-readable message", "errorCode": "INVALID_CREDENTIALS", "details": {} }
```

`message` is always present and always safe to show a user. `details` appears only
when there is something structured to add — for a validation failure it carries
Zod's `fieldErrors` plus an `issues` array of `{ path, message }` with the full
dotted path to each rejected input.

Always use this envelope. Never return a bare array or bare object at the top
level. In practice that means every route handler returns `successResponse()` or
`errorResponse()` from `lib/api-response.ts` and wraps its body in
`try { … } catch (error) { return handleRouteError(error) }`. The one deliberate
exception is `GET /api/v1/files/[assetId]/url`, which 302-redirects to the file
itself; its *error* paths still use the envelope.

Service-layer code throws an `Error` subclass carrying `errorCode` and `status`
(for example `ResidentServiceError`); `handleRouteError()` converts it into the
envelope, so services never construct HTTP responses.

### 1.2 Standard error codes

Codes are `SCREAMING_SNAKE_CASE`. These are the cross-cutting ones every portal
can return:

| Code | HTTP status | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Zod validation failed; field errors in `details` |
| `INVALID_CREDENTIALS` | 401 | Login failed |
| `UNAUTHENTICATED` | 401 | Missing/expired token |
| `UNAUTHORIZED` | 401 | Token present but not valid for this caller |
| `EMAIL_NOT_VERIFIED` | 403 | Email verification required before access |
| `FORBIDDEN` | 403 | Authenticated but role/permission doesn't allow this action |
| `CAPABILITY_DENIED` | 403 | Staff member lacks the required `HostelMember.permissions` flag |
| `TENANT_ACCESS_DENIED` | 403 | Principal is not scoped to the requested hostel |
| `HOSTEL_SCOPE_REQUIRED` | 400 | Endpoint needs a hostel scope the principal does not carry |
| `NOT_FOUND` | 404 | Resource doesn't exist or isn't in the caller's tenant scope (never leak existence across tenants — return 404, not 403, for cross-tenant reads) |
| `INVALID_OBJECT_ID` | 400 | Path or query id is not a valid ObjectId |
| `EMAIL_ALREADY_HAS_ROLE` | 409 | Account-upgrade conflict — see ARCHITECTURE.md §3.2 |
| `RATE_LIMITED` | 429 | Too many attempts |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected |

Beyond these, each module returns its own specific codes so a client can branch
without string-matching a message — `RESIDENT_NOT_FOUND`, `RESIDENT_PHONE_TAKEN`,
`ROOM_TYPE_FULL`, `PAYMENT_NOT_FOUND`, `FILE_TOO_LARGE`, `LAST_SUPERADMIN`, and so
on. A specific code is always preferred over a generic one.

### 1.3 Auth header/cookie convention

- **Web:** httpOnly cookies (`access_token`, `refresh_token`), set by the server, never touched by client JS. The refresh cookie is scoped to `path=/api`; both cookies are written by `applySessionCookies()` and cleared by `clearSessionCookies()` in `lib/session-cookies.ts` — route handlers never set them by hand
- **Mobile (Phase 6):** `Authorization: Bearer <access_token>` header, refreshed via the same `/api/v1/auth/refresh` endpoint using a token stored in Expo SecureStore
- Every protected route handler resolves the current user via a shared `getSession(request)` helper — never trust a client-supplied `userId`/`hostelId`/`role` in the request body for authorization decisions

### 1.4 Pagination

List endpoints accept `?page=1&pageSize=20` and return:
```json
{ 
  "success": true, 
  "data": { 
    "items": [...], 
    "page": 1, 
    "pageSize": 20, 
    "total": 143 
  } 
}
```

### 1.5 Path conventions and build status

Every route lives under **`/api/v1/`**. There is no unversioned surface: the
`/api/auth/*` routes an earlier phase added as a parallel implementation were
folded back into `/api/v1/auth/*`, so there is exactly one login, one refresh and
one logout.

Two names differ from earlier drafts of this document, and the shipped name is
the one in the tables below:

| Earlier draft | Shipped |
|---|---|
| `/api/superadmin/…` | `/api/v1/platform/…` |
| `/api/hostel-admin/staff` | `/api/v1/hostel-admin/wardens` |

Dynamic segments are written the way Next.js declares them — `[id]`, `[slug]`,
`[paymentId]` — because that is also the folder name on disk.

Rows are flagged where reality differs from the original plan:

- ⏳ **Not built** — specified, not yet implemented. Everything so flagged belongs
  to **Phase 4** (complaints/attendance/guardian/community) or **Phase 5**
  (moderator, QuestionCall, subscriptions, notification management, hostel
  settings). Phases 1–3 have no ⏳ rows.
- ↔ **Superseded** — deliberately not built because the design changed; the note
  says what replaced it.

---

## 2. Auth

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/api/v1/auth/signup` | none | `{ email, password }` | Creates `PUBLIC` account with `emailVerified: false`, sends verification email |
| POST | `/api/v1/auth/verify-email` | none | `{ token }` | Verifies email, sets `emailVerified: true` |
| POST | `/api/v1/auth/resend-verification` | none | `{ email }` | Resends verification email |
| POST | `/api/v1/auth/login` | none | `{ email, password }` | Unified login — see ARCHITECTURE.md §3.1. Returns `{ role, redirectPath, mustChangePassword }` |
| GET | `/api/auth/google` | none | — | ↔ **Superseded.** ID-token POST to `/api/v1/auth/google` instead of a GET redirect (ARCHITECTURE.md §3.1 — no client secret in env). |
| GET | `/api/auth/google/callback` | none | `?code=` | ↔ **Superseded.** No callback leg: Google Identity Services returns the ID token to the browser, which posts it to `/api/v1/auth/google`. |
| POST | `/api/v1/auth/refresh` | refresh token (cookie or header) | — | Rotates and reissues tokens |
| POST | `/api/v1/auth/logout` | access token | — | Clears cookies, bumps `tokenVersion` |
| GET | `/api/v1/auth/me` | access token | — | Returns `{ id, email, role, hostelId?, mustChangePassword, emailVerified, userResidentId }`. `userResidentId` is `null` until the user saves a resident profile — see §18 |
| POST | `/api/v1/auth/change-password` | access token | `{ currentPassword?, newPassword }` | `currentPassword` optional only when `mustChangePassword = true` |
| POST | `/api/v1/auth/forgot-password` | none | `{ email }` | Sends password reset email |
| POST | `/api/v1/auth/reset-password` | none | `{ token, newPassword }` | Resets password with token from email |

---

## 3. Public Portal

| Method | Path | Auth | Query Params | Notes |
|---|---|---|---|---|
| GET | `/api/v1/public/hostels` | none | `area?, minPrice?, maxPrice?, roomType?, genderType?, food?, facilities[]?, collegeId?, sortBy?, page?, pageSize?` | Search/filter hostels. Returns only `status: APPROVED` hostels |
| GET | `/api/v1/public/hostels/[slug]` | none | — | Full profile: photos, facilities, rooms summary, food, rules, ratings (excluding hidden), verification badge |
| GET | `/api/public/hostels/:id/nearby` | none | — | ↔ **Superseded.** Nearby places are cached on the hostel and returned inside `GET /api/v1/public/hostels/[slug]`. |
| GET | `/api/v1/public/hostels/compare` | none | `ids=a,b,c` | Max 3 ids. Side-by-side comparison |
| POST | `/api/v1/public/hostels/[slug]/inquiries` | none or `PUBLIC` | `{ hostelId, name, phone, email?, message? }` | Submit inquiry. Response also carries `shouldCollectProfile` — see §18 |
| POST | `/api/v1/public/hostels/[slug]/views` | none or any role | — | Records a page view for the hostel's listing stats and returns the resident-profile prompt decision. See §18.3 |
| POST | `/api/v1/public/service-providers/register` | none | `{ name, phone, category, area, availability?, description?, photoUrl?, documentUrl? }` | Register as service provider (always `status: PENDING`) |
| GET | `/api/public/colleges` | none | `?search=` | ↔ **Superseded.** The college list is a small fixed reference set bundled at `lib/maps/nepal-colleges.ts`; shipping it as data avoids a request on every listing page load. |

---

## 4. Superadmin (Platform Owner)

All routes require `role = SUPERADMIN`.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| GET | `/api/v1/platform/reports/dashboard` | — | Totals: hostels (by status), residents, inquiries, payments (verified), open complaints |
| GET | `/api/v1/platform/hostels` | `?status=, page=, pageSize=` | List with filter by `HostelStatus` |
| PATCH | `/api/v1/platform/hostels/[id]/approve` | — | Sets `status = APPROVED`, triggers `HOSTEL_ADMIN` account creation/upgrade (ARCHITECTURE.md §3.2), sends credential email (EMAIL_SYSTEM.md) |
| PATCH | `/api/v1/platform/hostels/[id]/reject` | `{ reason }` | Sets `status = REJECTED`, sends rejection email |
| PATCH | `/api/superadmin/hostels/:id/suspend` | `{ reason }` | ⏳ **Not built.** Sets `status = SUSPENDED` |
| GET | `/api/v1/platform/hostels/[id]` | — | Verification documents |
| PATCH | `/api/superadmin/documents/:id/review` | `{ status: VERIFIED|REJECTED, rejectionReason? }` | ⏳ **Not built.** Review a hostel document |
| GET | `/api/v1/platform/listing-flags` | — | Flagged duplicate/ghost listings (same address, phone, photos, documents) |
| GET | `/api/superadmin/subscriptions` | `?status=, page=` | ⏳ **Not built.** Hostel subscriptions |
| POST | `/api/superadmin/subscriptions` | `{ hostelId, plan, amount, periodStart, periodEnd, proofUrl? }` | ⏳ **Not built.** Record manual payment from hostel |
| PATCH | `/api/superadmin/subscriptions/:id/verify` | — | ⏳ **Not built.** Verify subscription payment proof |
| GET | `/api/v1/platform/reports/dashboard` | `?type=hostels|payments|inquiries|complaints` | Platform-wide reports, CSV export |
| POST | `/api/superadmin/announcements` | `{ title, body }` | ⏳ **Not built.** Broadcast to all hostels/users |
| PATCH | `/api/v1/platform/reviews/[id]/hide` | `{ reason }` | Moderate abusive reviews |
| GET | `/api/v1/platform/service-providers` | `?status=, category=, page=` | List service providers |
| PATCH | `/api/v1/platform/service-providers/[id]/approve` | `{ status: APPROVED|REJECTED|HIDDEN, rejectionReason? }` | Approve/reject/hide provider |
| GET | `/api/v1/platform/site-config` | — | Get PlatformConfig singleton |
| PUT | `/api/v1/platform/site-config` | `{ ...partial config updates }` | Update platform config (see ARCHITECTURE.md §5) |
| POST | `/api/v1/platform/admins` | `{ email, name }` | Create PLATFORM_MODERATOR account |

---

## 5. Platform Moderator

`PLATFORM_MODERATOR` has a subset of superadmin permissions (no config/billing access).

| Method | Path | Notes |
|---|---|---|---|
| GET | `/api/moderator/hostels` | ⏳ **Not built.** Same as superadmin but read-only on sensitive fields |
| PATCH | `/api/moderator/hostels/:id/approve` | ⏳ **Not built.** Can approve hostels |
| PATCH | `/api/moderator/hostels/:id/reject` | ⏳ **Not built.** Can reject hostels |
| GET | `/api/moderator/service-providers` | ⏳ **Not built.** Can review service providers |
| PATCH | `/api/moderator/service-providers/:id` | ⏳ **Not built.** Can approve/reject providers |
| PATCH | `/api/moderator/reviews/:id/hide` | ⏳ **Not built.** Can moderate reviews |
| GET | `/api/moderator/reports` | ⏳ **Not built.** Can view reports (no CSV export of financial data) |

---

## 6. Hostel Admin / Warden

All routes require `role IN (HOSTEL_ADMIN, WARDEN)` **and** the resolved `hostelId` from the session (never from the URL/body) — see ARCHITECTURE.md §2. Warden-permission flags (`HostelStaff.permissions`) further restrict a subset of these for `WARDEN` sessions; enforce both checks.

| Method | Path | Body/Query | Permission Check (Warden) | Notes |
|---|---|---|---|---|
| GET | `/api/v1/hostel-admin/profile` | — | — | Returns hostel profile |
| PATCH | `/api/v1/hostel-admin/profile` | `{ name?, description?, address?, contactPhone?, rules?, facilities[]?, facilityDetails?: { totalToilets?, parkingCapacity?: { bikes?, cars? }, hasGarden?, hasCCTV?, hasGenerator?, hasElevator?, hasWaterPurifier?, notes? }, photos[]? }` | `editHostelProfile` | Update hostel profile with enhanced facility tracking |
| GET | `/api/v1/hostel-admin/wardens` | — | — | List wardens (HOSTEL_ADMIN only, wardens cannot see this) |
| POST | `/api/v1/hostel-admin/wardens` | `{ email, name, permissions }` | HOSTEL_ADMIN only | Create WARDEN account |
| PATCH | `/api/v1/hostel-admin/wardens/[id]` | `{ permissions }` | HOSTEL_ADMIN only | Update warden permissions |
| GET | `/api/hostel-admin/rooms` | — | — | ↔ **Superseded.** Rooms are room-type configurations on the hostel — see `GET /api/v1/hostel-admin/room-types` and DATABASE.md §Rooms & Beds. |
| POST | `/api/hostel-admin/rooms` | `{ floor, roomNumber, type, rentPerBed, capacity, facilities[], photos[]? }` | `manageRooms` | ↔ **Superseded.** Rooms are room-type configurations on the hostel — see `GET /api/v1/hostel-admin/room-types` and DATABASE.md §Rooms & Beds. |
| PATCH | `/api/hostel-admin/rooms/:id` | `{ ...updates }` | `manageRooms` | ↔ **Superseded.** Room types are edited through the hostel profile (`PATCH /api/v1/hostel-admin/profile`). |
| DELETE | `/api/hostel-admin/rooms/:id` | — | `manageRooms` | ↔ **Superseded.** Room types are edited through the hostel profile (`PATCH /api/v1/hostel-admin/profile`). |
| GET | `/api/hostel-admin/rooms/:roomId/beds` | — | — | ↔ **Superseded.** There are no bed records; vacancy is a counter per room type. |
| POST | `/api/hostel-admin/rooms/:roomId/beds` | `{ bedLabel }` | `manageRooms` | ↔ **Superseded.** There are no bed records; vacancy is a counter per room type. |
| PATCH | `/api/hostel-admin/beds/:id` | `{ status, maintenanceNote? }` | — | ↔ **Superseded.** There are no bed records; vacancy is a counter per room type. |
| GET | `/api/v1/hostel-admin/residents` | `?status=, page=` | — | List residents |
| GET | `/api/v1/hostel-admin/resident-lookup` | `?residentId=, hostelId?` | `registerResidents` | Prefill a registration from a person's portable resident ID / QR. Rate limited, audited, and notifies the owner — see §18.2 |
| POST | `/api/v1/hostel-admin/residents` | `{ email, fullName, phone, guardianContact?, educationInfo?, residentType: STUDENT|WORKING_PROFESSIONAL|OTHER, roomId?, bedId?, depositAmount? }` | `registerResidents` | Register resident, triggers account creation/upgrade, sends QR activation email |
| PATCH | `/api/v1/hostel-admin/residents/[id]` | `{ ...updates }` | `registerResidents` | Update resident info |
| POST | `/api/v1/hostel-admin/residents/[id]/activation-code` | — | — | (Re)generate QR activation code |
| GET | `/api/v1/hostel-admin/payments` | `?status=, month=, residentId=, page=` | — | List payments |
| POST | `/api/v1/hostel-admin/payments` | `{ residentId?, month, amountDue, dueDate }` or bulk: `{ month, amountDue, dueDate }` | — | Create payment(s). If no residentId, creates for all active residents |
| GET | `/api/hostel-admin/payments/:id/proofs` | — | — | ↔ **Superseded.** `GET /api/v1/hostel-admin/payments` returns `{ payments, proofs }` together, so the queue needs one request rather than one per payment. |
| PATCH | `/api/v1/hostel-admin/payment-proofs/[id]/approve` | `{ status: VERIFIED|REJECTED, rejectionReason? }` | `verifyPayments` | Verify/reject proof, generates Receipt on verify, sends email |
| GET | `/api/v1/hostel-admin/food/routine` | `?hostelId=` | `manageFood` | The hostel's weekly routine (meals keyed by day of week, shared timings, month end special) |
| PUT | `/api/v1/hostel-admin/food/routine` | `{ hostelId?, timings, meals: [{ dayOfWeek, mealType, items, note? }], monthEndSpecial?: { items, note? } }` | `manageFood` | Replaces the routine in one upsert. A cleared cell is absent from `meals`; empty `monthEndSpecial.items` clears the treat |
| POST | `/api/v1/hostel-admin/food/photos` | `{ date, mealType, photoUrl }` | `manageFood` | Upload food photo |
| GET | `/api/v1/hostel-admin/notices` | `?page=` | — | List notices |
| POST | `/api/v1/hostel-admin/notices` | `{ title, content, category, isUrgent, targetAudience: ALL\|RESIDENTS\|GUARDIANS }` | `manageNotices` | Create notice and fan out. A `GUARDIANS` notice is **not** sent to residents; guardians read it from their dashboard |
| GET | `/api/v1/hostel-admin/complaints` | `?status=, category=, sla=overdue\|on_track, page=` | `viewComplaints` | List complaints. `sla=overdue` returns still-open complaints past `slaDueAt`. Anonymous complaints never carry the resident's identity into this response |
| PATCH | `/api/v1/hostel-admin/complaints/[id]/status` | `{ status?, response? }` | `updateComplaints` | Update complaint, add ComplaintUpdate, emails the resident (`complaint-resolved` on RESOLVED, `complaint-status-updated` otherwise) |
| POST | `/api/v1/hostel-admin/complaints/[id]/reply` | `{ message }` | `updateComplaints` | Adds a thread reply. Notifies the resident in-app only — a reply is not a status change, so it does not earn an email |
| GET | `/api/v1/hostel-admin/night-status` | `?date=, residentId=` | `viewNightStatus` | View night status logs |
| POST | `/api/v1/hostel-admin/night-status` | `{ residentId, date, status, source: 'manual', overrideReason }` | `updateNightStatus` | Manual night status entry/override |
| POST | `/api/v1/hostel-admin/residents/[id]/move-in` | `{ items[], depositAmount }` | `registerResidents` | Create move-in checklist |
| POST | `/api/v1/hostel-admin/residents/[id]/move-out` | `{ items[], exitDate, depositRefund? }` | `registerResidents` | Create move-out checklist |
| GET | `/api/v1/hostel-admin/service-providers` | `?category=, area=, availability=` | — | Search approved providers |
| GET | `/api/v1/hostel-admin/maintenance/requests` | `?status=, page=` | `manageMaintenance` | List maintenance requests |
| POST | `/api/v1/hostel-admin/maintenance/requests` | `{ category, description, urgency, roomId?, bedId?, providerId? }` | `manageMaintenance` | Create maintenance request |
| PATCH | `/api/v1/hostel-admin/maintenance/requests/[id]/status` | `{ status?, providerId?, costNote? }` | `manageMaintenance` | Update maintenance request |
| GET | `/api/v1/hostel-admin/inquiries` | `?status=, page=` | — | Inquiries for this hostel |
| PATCH | `/api/v1/hostel-admin/inquiries/[id]/status` | `{ status, followedUpAt? }` | — | Mark inquiry as contacted/converted/closed |

---

## 7. Resident

All routes require `role = RESIDENT`; every query is scoped to `resident.id` derived from the session, never a client-supplied id.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| GET | `/api/v1/resident/dashboard` | — | Summary: fee status, latest notices, food today, night status |
| GET | `/api/v1/resident/profile` | — | Own resident profile |
| GET | `/api/v1/resident/payments` | `?page=` | Own payment history |
| POST | `/api/v1/resident/payments/[paymentId]/proof` | `{ fileUrl, method, referenceNote? }` | Upload PaymentProof, sends email to admin (EMAIL_SYSTEM.md §3.3) |
| GET | `/api/v1/resident/notices` | `?page=` | Notices for own hostel |
| GET | `/api/v1/resident/complaints` | `?page=` | Own complaints |
| POST | `/api/v1/resident/complaints` | `{ category, title, description, photoUrl?, isAnonymous }` | Create complaint |
| GET | `/api/v1/resident/night-status` | `?startDate=, endDate=` | Own night status history/summary |
| POST | `/api/v1/resident/sos` | — | Triggers SOS alert, creates NightStatusLog with `status: SOS`, sends urgent emails (EMAIL_SYSTEM.md §5.1) |
| POST | `/api/v1/resident/reviews` | `{ overallRating, foodRating?, cleanlinessRating?, safetyRating?, roomRating?, locationRating?, managementRating?, comment? }` | Only `overallRating` is required. One per hostel, enforced at DB level; re-submitting updates. Visible publicly after submit |
| GET | `/api/v1/resident/referral` | — | Own referral code/link |
| GET | `/api/v1/resident/guardians` | — | Linked guardians and exactly what each can see |
| POST | `/api/v1/resident/guardians` | `{ email, firstName, lastName, phone, relation, permissions }` | Invites a guardian by email; 7-day single-use token (EMAIL_SYSTEM.md §1.5). Every permission defaults to `false` |
| PATCH | `/api/v1/resident/guardians/[id]` | `{ canViewPayments?, canViewReceipts?, canViewNotices?, canViewFood?, canViewSafety?, canViewComplaintStatus? }` | Resident retunes access at any time; takes effect on the guardian's next request |
| DELETE | `/api/v1/resident/guardians/[id]` | — | Revokes the guardian entirely |
| GET | `/api/v1/resident/move-checklist` | — | Own move-in / move-out checklist, read-only |
| GET | `/api/v1/resident/community` | `?scope=hostel\|mine` | Own hostel's feed, announcements pinned first |
| POST | `/api/v1/resident/community` | `{ body, visibility, isAnonymous, mediaAssetIds[] }` | Create a post; body is profanity-masked on write |
| DELETE | `/api/v1/resident/community/[postId]` | — | Soft-deletes own post |
| GET/POST | `/api/v1/resident/community/[postId]/comments` | `{ body, isAnonymous }` | List / add comments; adding notifies the post author |
| POST | `/api/v1/resident/community/[postId]/reactions` | `{ type }` | Toggle — the same type twice removes it |
| POST | `/api/v1/resident/community/[postId]/report` | `{ reason }` | Flags for hostel-admin review; one report per user per post |
| GET | `/api/v1/resident/attendance` | — | Own zone history (last 60 days) + current consent state |
| DELETE | `/api/v1/resident/attendance` | — | Erases own location history immediately (PRIVACY_POLICY.md) |
| POST | `/api/v1/resident/consent` | `{ consentType, granted, policyVersion?, source? }` | Grants or withdraws a consent; appends a ConsentLog row, never updates one |
| POST | `/api/v1/resident/location/ping` | `{ lat, lng, accuracyMeters?, recordedAt? }` | Computes a zone and **discards the coordinates**. Requires consent (`403 LOCATION_CONSENT_REQUIRED`) and `attendance.enabled` (`409 ATTENDANCE_DISABLED`) |
| GET | `/api/v1/resident/food` | — | Own hostel's weekly routine plus food photos |
| GET | `/api/v1/resident/me` | — | Basic hostel info (name, address, contact, rules) |

---

## 8. Guardian

All routes require `role = GUARDIAN`, scoped to the single linked `residentId`.

**Default-deny.** Permissions live on `GuardianPermission`, one document per `GuardianAccess`, every
flag defaulting to `false`. A missing permission document means *nothing shared* — never everything.
Each dashboard section is gated at the **query**, not the response mapping, so a field the resident
did not enable is never read out of the database at all. Locked by `guardian-privacy.test.ts`.

A guardian always sees the hostel name and contact, and the resident's name, room type and status.
They never see the resident's email, phone or deposit, whatever else is enabled.

| Method | Path | Notes |
|---|---|---|---|
| GET | `/api/v1/guardian/dashboard` | Returns only permitted fields: hostel info, emergency contact, fee summary (if enabled), notices (if enabled), night status summary (if enabled), complaint titles (if enabled). Full complaint details NEVER returned. |
| GET | `/api/v1/guardian/payments` | `canViewPayments`: paid/unpaid/due summary. `canViewReceipts`: receipt number, amount, month, issue **date**. Never raw proof images. |
| GET | `/api/v1/guardian/notices` | `canViewNotices`: notices with `targetAudience IN ('ALL','GUARDIANS')`. |
| GET | `/api/v1/guardian/food` | `canViewFood`: today's meals off the weekly routine. |
| GET | `/api/v1/guardian/safety-summary` | `canViewSafety`: `{ asOf: 'YYYY-MM-DD', status }` — a **date**, never a timestamp, never coordinates. `canViewComplaintStatus`: complaint titles + status only. |
| POST | `/api/v1/guardian/accept-invitation` | Public. `{ token, name? }` — accepts an emailed invitation, creating or upgrading the account through `registerOrUpgradeUserByEmail` (so an email already holding another role is refused `409`). Token is single-use and expires after 7 days. |

---

## 9. Cook Portal

All routes require `role = COOK`, scoped to `cook.hostelId`.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| GET | `/api/cook/dashboard` | — | ⏳ **Phase 6.** Today's food menu, recent food ready logs, resident count |
| POST | `/api/v1/cook/food-ready` | `{ mealType, customMessage?, fetchFromMenu }` | Marks food as ready, creates FoodReadyLog, sends push notification to all residents of hostel. If `fetchFromMenu=true`, auto-fetches the items from the routine's entry for today's weekday |
| POST | `/api/cook/food-photos` | `{ mealType, photoUrl }` | ⏳ **Phase 6.** Upload food photo for today's meal |
| GET | `/api/cook/food-menu` | `?date=` | ⏳ **Phase 6.** View food menu for planning |
| GET | `/api/cook/residents` | — | ⏳ **Phase 6.** List of residents (names + photos only, no sensitive data) |
| GET | `/api/cook/analytics` | `?startDate=, endDate=` | ⏳ **Phase 6.** Food timing analytics: avg ready time, delays, patterns |

---

## 10. Community Feature

Shipped 2026-08-01. Feed routes live under the resident tree (`/api/v1/resident/community/*`, listed
in section 7); moderation lives under the hostel-admin tree. There is no top-level `/api/community`.

**Anonymity is a serialization rule, not missing data.** `authorId` is stored on every post and
comment. The resident feed renders anonymous authors as "Anonymous Resident"; the hostel-admin
moderation view shows the real name, because an admin handling abuse has to know who wrote it.
`community-anonymity.test.ts` locks both directions.

### 10.1 Community Admin (Hostel Admin / Warden)

Requires `role IN (HOSTEL_ADMIN, WARDEN)`, scoped to own hostel.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| GET | `/api/v1/hostel-admin/community` | `?status=VISIBLE\|HIDDEN` | All posts in own hostel, most-reported first. Author names are unmasked here. Returns `{ posts, summary: { total, reported, hidden } }` |
| POST | `/api/v1/hostel-admin/community` | `{ body }` | Official announcement, pinned above the resident feed |
| PATCH | `/api/v1/hostel-admin/community/[postId]/hide` | `{ reason }` | Hides the post and marks its open reports `ACTIONED`. Writes an AuditLog entry |
| DELETE | `/api/v1/hostel-admin/community/[postId]/hide` | `{ reason }` | Restores the post and marks its open reports `DISMISSED` |

⏳ Not built, deferred to the Phase 5 reports work: community analytics (most active residents, post
frequency, sentiment). Comment-level moderation endpoints — the model supports hiding a comment, but
nothing calls it yet; posts are the moderation unit today.

---

## 11. Location Tracking & Auto-Attendance

Server architecture shipped 2026-08-01. The **mobile background service that calls the ping endpoint
is Phase 6** — the endpoint, zone maths, alerts and retention all exist and are tested now.

**The privacy invariant.** `POST /api/v1/resident/location/ping` accepts coordinates, computes the
distance from the hostel pin, derives a zone, and discards them. Nothing writes latitude or longitude
to any collection. A hostel with no map pin yields `UNKNOWN` rather than a guess.

### 11.1 Resident (see section 7 for the full rows)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/resident/location/ping` | Consent-gated and hostel-enable-gated. One reading per resident per day; a later ping corrects the day rather than appending |
| GET | `/api/v1/resident/attendance` | Own zone history, last 60 days, plus current consent state |
| DELETE | `/api/v1/resident/attendance` | Immediate erasure of own history — not a request queue |
| POST | `/api/v1/resident/consent` | Grant or withdraw `LOCATION_TRACKING`; the latest row wins, so withdrawal bites on the next ping |

### 11.2 Admin Attendance Dashboard

Gated by the existing `viewNightStatus` / `updateNightStatus` warden capabilities — attendance is
night status arrived at automatically, so it deliberately does not introduce a new permission key.
Settings are `HOSTEL_ADMIN`-only.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| GET | `/api/v1/hostel-admin/attendance` | `?from=, to=, residentId=, zone=` | Today's live split (`{ INSIDE, NEARBY, OUTSIDE, UNKNOWN, total }`) plus filtered history. Residents with no reading today count as `UNKNOWN` rather than disappearing |
| PATCH | `/api/v1/hostel-admin/attendance/[residentId]/override` | `{ day, zone, reason }` | `reason` is **required**; writes an AuditLog entry and marks the row `MANUAL_OVERRIDE` |
| GET | `/api/v1/hostel-admin/attendance/alerts` | — | Absence alerts, open first |
| PATCH | `/api/v1/hostel-admin/attendance/alerts/[id]/resolve` | `{ note? }` | Closes an open alert |
| GET/PATCH | `/api/v1/hostel-admin/attendance/settings` | `{ enabled?, insideZoneRadiusMeters?, nearbyZoneRadiusMeters?, absenceAlertDays?, retentionDays?, pingTimes? }` | HOSTEL_ADMIN only. Rejects a nearby radius not larger than the inside radius (`422 INVALID_GEOFENCE`). Platform ceilings apply |

⏳ Not built: `attendance/patterns` (frequently-absent residents, average attendance rate) and the
admin-side per-resident calendar — both folded into the Phase 5 reports work. The data behind them
is already served by `GET /api/v1/hostel-admin/attendance`.

---

## 12. Notifications & Push Messaging

### 12.1 User Notifications

All authenticated roles.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| GET | `/api/v1/notifications` | `?page=, isRead=, category=` | Paginated, own `userId` only |
| GET | `/api/notifications/:id` | — | ⏳ **Not built.** Get single notification detail |
| PATCH | `/api/v1/notifications/[id]/read` | — | Mark as read |
| PATCH | `/api/notifications/:id/dismiss` | — | ⏳ **Not built.** Dismiss notification |
| PATCH | `/api/notifications/read-all` | — | ⏳ **Not built.** Mark all as read |
| GET | `/api/notifications/unread-count` | — | ⏳ **Not built.** Count of unread notifications (for badge) |
### 12.2 Admin Notification Creation

Requires `role IN (HOSTEL_ADMIN, WARDEN, SUPERADMIN)`.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| POST | `/api/hostel-admin/notifications` | `{ title, body, priority, category, targetAudience, targetResidentIds[]?, scheduledFor? }` | ⏳ **Not built.** Create notification for own hostel. Can target all residents or specific residents (e.g., specific floor). Can schedule for future. |
| GET | `/api/hostel-admin/notifications` | `?page=, status=sent\|scheduled` | ⏳ **Not built.** List sent/scheduled notifications |
| GET | `/api/hostel-admin/notifications/:id/stats` | — | ⏳ **Not built.** Delivery stats: sent, delivered, read counts |
| DELETE | `/api/hostel-admin/notifications/:id` | — | ⏳ **Not built.** Cancel scheduled notification (before it's sent) |
### 12.3 Superadmin Platform-Wide Notifications

Requires `role = SUPERADMIN`.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| POST | `/api/superadmin/notifications` | `{ title, body, priority, category, targetAudience, targetHostelIds[]?, scheduledFor? }` | ⏳ **Not built.** Send notification to all hostels or specific hostels |
| GET | `/api/superadmin/notifications` | `?page=` | ⏳ **Not built.** List all platform notifications |

---

## 13. QuestionCall Integration & Analytics

### 13.1 Resident QuestionCall Access

Requires `role = RESIDENT` AND `residentType = STUDENT`.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| POST | `/api/resident/questioncall/click` | `{ deviceType? }` | ⏳ **Not built.** Tracks click event, returns redirect URL with user context. Creates QuestionCallClick record. |
| GET | `/api/resident/questioncall/status` | — | ⏳ **Not built.** Check if user has converted (signed up on QuestionCall) |
### 13.2 Superadmin QuestionCall Analytics

Requires `role = SUPERADMIN`.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| GET | `/api/superadmin/questioncall/analytics` | `?startDate=, endDate=, hostelId?` | ⏳ **Not built.** Total clicks, conversions, click-through rate, per hostel breakdown |
| GET | `/api/superadmin/questioncall/export` | `?startDate=, endDate=, format=csv\|json` | ⏳ **Not built.** Export QuestionCall usage data |

---

## 14. Configuration & Settings

### 14.1 Hostel Settings (Hostel Admin)

Requires `role = HOSTEL_ADMIN`.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| GET | `/api/hostel-admin/settings` | — | ⏳ **Not built.** Get all settings for own hostel (location tracking, cook portal, community, etc.) |
| PATCH | `/api/hostel-admin/settings` | `{ ...partial settings }` | ⏳ **Not built.** Update hostel settings. Validates against platform constraints (e.g., can't set geofence > platform max) |
| GET | `/api/hostel-admin/settings/defaults` | — | ⏳ **Not built.** Get platform default settings |
### 14.2 Platform Configuration (Superadmin)

Requires `role = SUPERADMIN`.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| GET | `/api/v1/platform/site-config` | `?category=` | List all platform config entries |
| PATCH | `/api/superadmin/platform-config/:key` | `{ value }` | ⏳ **Not built.** Update specific platform config |
| GET | `/api/superadmin/hostels/:id/settings` | — | ⏳ **Not built.** View specific hostel's settings (to check overrides) |
| PATCH | `/api/superadmin/hostels/:id/settings/override` | `{ ...settings }` | ⏳ **Not built.** Superadmin can override any hostel setting |

---

## 15. Consent & Privacy

### 15.1 User Consent

All authenticated roles.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| POST | `/api/user/consent` | `{ consentType, consentVersion, consented }` | ⏳ **Not built.** Record consent (terms, privacy policy, location tracking). Called during QR activation and settings changes. |
| GET | `/api/user/consent/history` | — | ⏳ **Not built.** View own consent history |
| GET | `/api/user/consent/current` | — | ⏳ **Not built.** Get current consent status for all types |
### 15.2 Account Deletion

Requires any authenticated role.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| POST | `/api/user/delete-account` | `{ reason }` | ⏳ **Not built.** Request account deletion. Account disabled for 60 days, then permanently deleted. |
| POST | `/api/user/cancel-deletion` | — | ⏳ **Not built.** Cancel pending deletion request (if within 60-day window). Reactivates account. |
| GET | `/api/user/deletion-status` | — | ⏳ **Not built.** Check if account has pending deletion request |

---

## 16. Cook Account Setup (Internal)

These are called during hostel registration flow, not directly by cook.

| Method | Path | Body/Query | Notes | Permission |
|---|---|---|---|---|
| POST | `/api/v1/hostel-admin/cook-portal` | `{ cookName }` | Creates cook account for hostel, generates credentials, stores in HostelSettings. Called during hostel onboarding. | `HOSTEL_ADMIN` |
| PATCH | `/api/v1/hostel-admin/cook-portal` | `{ cookName?, enabled? }` | Update cook account details | `HOSTEL_ADMIN` |
| POST | `/api/cook/device/register` | `{ fingerprint, deviceName? }` | Cook registers device fingerprint on first login to track which cook did what | ⏳ **Phase 6.** `COOK` |

---

## 17. Notifications (all authenticated roles)

**Note:** Section 9 above is now renumbered. This section consolidates notification endpoints already covered in section 12.

---

## 10. File Uploads

All uploads (hostel photos, food photos, payment proofs, hostel documents, service-provider photos/docs) go through a signed-URL pattern against Cloudflare R2:

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/v1/files/presign` | `{ fileName, contentType, purpose }` | Returns pre-signed PUT URL scoped to purpose-specific key prefix (e.g., `payment-proofs/{hostelId}/{residentId}/...`). Validate `contentType` and max file size before issuing. |
**Flow:**
1. Client calls `/api/uploads/sign` with file metadata
2. Server validates, generates R2 pre-signed URL, returns to client
3. Client uploads directly to R2 using the signed URL
4. Client calls relevant endpoint (e.g., `POST /api/resident/payments/:id/proof`) with the resulting R2 object URL

---

## 11. QR Activation (Public/Resident)

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/api/v1/resident/activation-status` | none or PUBLIC | `{ code }` | Verifies QR code, returns resident info if valid |
| POST | `/api/v1/resident/activate` | none or PUBLIC | `{ code, password? }` | Activates resident account. If user not logged in, creates session. If logged in as PUBLIC, upgrades account to RESIDENT. Sets `QRActivation.status = ACTIVATED`. |

---

## 12. Platform Config (Public - Limited Fields)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/v1/public/site-config` | none | Returns public-safe subset of PlatformConfig (features, pricing plans, etc.). Excludes internal settings. Used by client for caching. |

---

## 13. Cron Jobs (Internal, Auth-Protected by Shared Secret)

Scheduled by **cron-job.org**, not Vercel Cron, with the secret in an `x-cron-secret` (or
`Authorization: Bearer`) header — never a query parameter. Full setup and schedules in
[CRON.md](./CRON.md).

| Method | Path | Trigger | Action |
|---|---|---|---|
| POST | `/api/v1/cron/payment-reminders` | Daily | Finds payments due in X days (`operations` setting), creates Notification, sends emails (EMAIL_SYSTEM.md §3.1) |
| POST | `/api/v1/cron/complaint-sla` | Daily | Flags still-open complaints past `slaDueAt`, alerts hostel admins. Idempotent via `slaBreachedAt` — each breach is alerted exactly once |
| POST | `/api/v1/cron/attendance-maintenance` | Daily | Raises/closes absence alerts and purges `AttendanceLog` rows past each hostel's `retentionDays` |
| POST | `/api/v1/cron/purge-expired-otps` | Daily | Backup sweep for expired `OtpChallenge` documents (the TTL index is primary) |
| POST | `/api/v1/cron/refresh-nearby-places` | Hourly | Recomputes cached nearby places for hostels with address changes or stale cache |
| POST | `/api/cron/subscription-expiry` | — | ⏳ **Not built.** Finds subscriptions expiring soon, sends emails to superadmin + hostel admin |

---

## 14. Duplicate/Ghost Listing Detection (Internal Logic)

Runs on hostel create/update and as a background job. Flags get written to a review queue accessible at `GET /api/superadmin/duplicates`:

| Signal | Risk | Detection Method |
|---|---|---|
| Same address, different hostel name | High | Fuzzy match on normalized address string |
| Same phone, different hostel name | High | Exact match on `contactPhone` |
| Same photos reused on another listing | High | Image hash/perceptual hash comparison |
| Same owner document reused | Medium | File hash comparison on `HostelDocument.fileUrl` |
| Similar hostel name in same area | Low | Levenshtein distance on name + area match |

This is detection/flagging only — never auto-rejects, only surfaces for manual superadmin review.

---

## 18. Resident Identity (Portable Profile + QR)

> **Paths in this section are as-built** (`/api/v1/...`). Earlier sections of this
> document use the shorter `/api/...` design-time form; the implementation is
> versioned. See PHASES.md §5A.

A person fills their personal details in **once** and receives a portable
`userResidentId` of the form `HH-XXXX-XXXX` plus a QR code. Any hostel they later
approach registers them by scanning that code — or typing the ID — instead of
handing them another form.

**Storage:** the whole profile is a single AES-256-GCM blob in
`UserResidentProfile.encryptedData` (see DATABASE.md). No personal field is
indexed or queryable. The server needs `PERSONAL_DATA_ENCRYPTION_KEY` (32 bytes,
base64 or hex); without it these endpoints fail loudly rather than storing
plaintext.

### 18.1 Own identity (any authenticated role)

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| GET | `/api/v1/users/resident-identity` | — | Returns `{ identity, profile }`. `identity` carries `residentId`, `hasProfile`, `shareUrl`, `shareCount`, `lastSharedAt`, `sharingEnabled`, `accountEmail`, `accountName`. `profile` is the decrypted payload plus a derived `age`, or `null` |
| PUT | `/api/v1/users/resident-identity` | `{ profile, sharingEnabled }` | Upsert. **Mints `User.userResidentId` on first save** (retries on collision). Writes an `AuditLog` entry. Returns the same shape as GET |
| PATCH | `/api/v1/users/resident-identity` | `{ sharingEnabled }` | Turn sharing on/off without deleting the profile. `404 RESIDENT_PROFILE_MISSING` if none saved |
| GET | `/api/v1/users/resident-identity/qr` | — | `{ qrDataUrl, residentId, shareUrl }`. `qrDataUrl` is a PNG data URL; it is `null` if QR rendering is unavailable, and the typed ID remains the fallback. `404 RESIDENT_PROFILE_MISSING` before the first save |

**`profile` body fields.** Required: `fullName`, `gender`, `primaryPhone`,
`primaryEmail`, `guardianName`, `guardianRelation`, `guardianPhone`. Optional:
`dateOfBirth` (`YYYY-MM-DD`), `bloodGroup`, `alternatePhone`, `backupEmail`,
`permanentAddress`, `city`, `province`, `occupation`, `institution`,
`courseOrDesignation`, `guardianEmail`, `secondGuardian{Name,Relation,Phone,Email}`,
`emergencyContact{Name,Relation,Phone}`, `dietaryPreference`, `budgetRange`,
`medicalNotes`, `interests[]` (max 12, de-duplicated),
`governmentIdType`, `governmentIdNumber`.

At most **two** emails are held: the account email plus one backup.
`backupEmail` must differ from `primaryEmail` (`422 VALIDATION_ERROR`).

### 18.2 Staff lookup (Hostel Admin / Warden)

| Method | Path | Query | Permission Check (Warden) | Notes |
|---|---|---|---|---|
| GET | `/api/v1/hostel-admin/resident-lookup` | `residentId`, `hostelId?` | `registerResidents` | Returns `{ prefill, residentId, sharedAt }` |

`residentId` accepts `HH-4K7M-9XQ2`, `hh4k7m9xq2`, or the full scanned share URL
(query strings are stripped before parsing).

`prefill` is shaped for the registration form, not a raw profile dump:

- `prefill.resident` → `{ firstName, lastName, phone, email, residentType }` for `POST /api/hostel-admin/residents`
- `prefill.guardians[]` → `{ firstName, lastName, phone, email?, relation, isPrimary }` for `POST /api/hostel-admin/residents/:id/guardians`
- `prefill.emergencyContact` → `{ name, phone, relation, isPrimary }`; falls back to the primary guardian when the user left it blank
- `prefill.details` → read-only extras the registration form has no field for (blood group, derived `age`, government ID, allergies, dietary preference, institution, address)

**Guards on every call:**

- Capability-gated on `registerResidents`, exactly like creating a resident
- Rate limited to **20/min** per client — the ID is short enough to be guessable otherwise
- Increments `shareCount` and stamps `lastSharedAt` / `lastSharedWithHostelId`
- Writes an `AuditLog` entry (`RESIDENT_PROFILE_SHARED`)
- Sends the **owner** an in-app `Notification` — a hostel reading someone's guardian numbers and blood group is never silent

| Error code | Status | Meaning |
|---|---|---|
| `RESIDENT_ID_INVALID` | 422 | Not an ID — did not parse to `HH-XXXX-XXXX` |
| `RESIDENT_PROFILE_NOT_FOUND` | 404 | No account holds that ID |
| `RESIDENT_PROFILE_INCOMPLETE` | 404 | Account exists but the profile was never completed |
| `RESIDENT_PROFILE_SHARING_DISABLED` | 403 | Owner turned sharing off |

### 18.3 View tracking + when we ask for the profile

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/v1/public/hostels/[slug]/views` | none or any role | Records the visit and returns the prompt decision in the same round trip |
Response `data`:

```json
{
  "counted": true,
  "hostelId": "…",
  "viewCount": 42,
  "prompt": { "shouldCollectProfile": true, "reason": "BROWSING", "views": 3, "viewedHostels": 2 }
}
```

- Sets an httpOnly `hh_visitor` cookie (opaque per-browser id, 1 year, not personal data)
- **De-duplicated**: a repeat visit from the same visitor to the same hostel inside 30 minutes returns `counted: false` and does not inflate the count
- Increments `Hostel.publicViewCount` and writes a `HostelPageView` row
- `shouldCollectProfile` becomes `true` at **3 total de-duplicated views** (`PROFILE_PROMPT_VIEW_THRESHOLD`) — total visits, not distinct hostels, so a small catalogue still reaches the threshold
- Always `false` once the user has a completed profile

The other trigger is `POST /api/v1/public/hostels/:slug/inquiries`, whose response
now carries `shouldCollectProfile` — someone who just enquired is about to be
asked for these exact fields by the hostel anyway.

The client snoozes a dismissed prompt for 7 days (`localStorage`), and never
prompts on a first visit.

### 18.4 Public share page

`GET /resident-id/{ID}` — not an API route; this is where a plain phone camera
lands after scanning the QR. It renders the ID in large type for reading out or
copying and **discloses no personal data**. Marked `noindex, nofollow`.

---

_End of API.md_
