# API.md — Endpoints & Contracts

All endpoints are Next.js Route Handlers under `apps/web/app/api/**`. This same API is what the Phase 6 mobile app will consume — keep it transport-agnostic (no assumptions about cookies-only auth; support Bearer tokens too, see §1.3).

## 1. Conventions

### 1.1 Response envelope

Success:
```json
{ "success": true, "data": { } }
```

Error:
```json
{ "success": false, "error": { "code": "invalid_credentials", "message": "Human-readable message", "details": {} } }
```

Always use this envelope. Never return a bare array or bare object at the top level.

### 1.2 Standard error codes

| Code | HTTP status | Meaning |
|---|---|---|
| `validation_error` | 400 | Zod validation failed; include field errors in `error.details` |
| `invalid_credentials` | 401 | Login failed |
| `email_not_verified` | 403 | Email verification required before access |
| `unauthorized` | 401 | Missing/expired token |
| `forbidden` | 403 | Authenticated but role/permission doesn't allow this action |
| `not_found` | 404 | Resource doesn't exist or isn't in the caller's tenant scope (never leak existence across tenants — return 404, not 403, for cross-tenant reads) |
| `conflict` | 409 | e.g. duplicate email, bed already occupied |
| `email_already_has_role` | 409 | Account-upgrade conflict — see ARCHITECTURE.md §3.2 |
| `rate_limited` | 429 | Too many attempts |
| `server_error` | 500 | Unexpected |

### 1.3 Auth header/cookie convention

- **Web:** httpOnly cookies (`access_token`, `refresh_token`), set by the server, never touched by client JS
- **Mobile (Phase 6):** `Authorization: Bearer <access_token>` header, refreshed via the same `/api/auth/refresh` endpoint using a token stored in Expo SecureStore
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

---

## 2. Auth

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/api/auth/signup` | none | `{ email, password }` | Creates `PUBLIC` account with `emailVerified: false`, sends verification email |
| POST | `/api/auth/verify-email` | none | `{ token }` | Verifies email, sets `emailVerified: true` |
| POST | `/api/auth/resend-verification` | none | `{ email }` | Resends verification email |
| POST | `/api/auth/login` | none | `{ email, password }` | Unified login — see ARCHITECTURE.md §3.1. Returns `{ role, redirectPath, mustChangePassword }` |
| GET | `/api/auth/google` | none | — | Redirects to Google consent screen |
| GET | `/api/auth/google/callback` | none | `?code=` | Handles Google response, creates/finds User, sets cookies, returns redirect instructions |
| POST | `/api/auth/refresh` | refresh token (cookie or header) | — | Rotates and reissues tokens |
| POST | `/api/auth/logout` | access token | — | Clears cookies, bumps `tokenVersion` |
| GET | `/api/auth/me` | access token | — | Returns `{ id, email, role, hostelId?, mustChangePassword, emailVerified, userResidentId }`. `userResidentId` is `null` until the user saves a resident profile — see §18 |
| POST | `/api/auth/change-password` | access token | `{ currentPassword?, newPassword }` | `currentPassword` optional only when `mustChangePassword = true` |
| POST | `/api/auth/forgot-password` | none | `{ email }` | Sends password reset email |
| POST | `/api/auth/reset-password` | none | `{ token, newPassword }` | Resets password with token from email |

---

## 3. Public Portal

| Method | Path | Auth | Query Params | Notes |
|---|---|---|---|---|
| GET | `/api/public/hostels` | none | `area?, minPrice?, maxPrice?, roomType?, genderType?, food?, facilities[]?, collegeId?, sortBy?, page?, pageSize?` | Search/filter hostels. Returns only `status: APPROVED` hostels |
| GET | `/api/public/hostels/:id` | none | — | Full profile: photos, facilities, rooms summary, food, rules, ratings (excluding hidden), verification badge |
| GET | `/api/public/hostels/:id/nearby` | none | — | Cached "nearby spots" (colleges, hospitals, etc.) — see ARCHITECTURE.md §4 |
| GET | `/api/public/hostels/compare` | none | `ids=a,b,c` | Max 3 ids. Side-by-side comparison |
| POST | `/api/public/inquiries` | none or `PUBLIC` | `{ hostelId, name, phone, email?, message? }` | Submit inquiry. Response also carries `shouldCollectProfile` — see §18 |
| POST | `/api/v1/public/hostels/:slug/views` | none or any role | — | Records a page view for the hostel's listing stats and returns the resident-profile prompt decision. See §18.3 |
| POST | `/api/public/service-providers` | none | `{ name, phone, category, area, availability?, description?, photoUrl?, documentUrl? }` | Register as service provider (always `status: PENDING`) |
| GET | `/api/public/colleges` | none | `?search=` | For "nearby to my college" search — seeded/admin-managed reference list |

---

## 4. Superadmin (Platform Owner)

All routes require `role = SUPERADMIN`.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| GET | `/api/superadmin/dashboard` | — | Totals: hostels (by status), residents, inquiries, payments (verified), open complaints |
| GET | `/api/superadmin/hostels` | `?status=, page=, pageSize=` | List with filter by `HostelStatus` |
| PATCH | `/api/superadmin/hostels/:id/approve` | — | Sets `status = APPROVED`, triggers `HOSTEL_ADMIN` account creation/upgrade (ARCHITECTURE.md §3.2), sends credential email (EMAIL_SYSTEM.md) |
| PATCH | `/api/superadmin/hostels/:id/reject` | `{ reason }` | Sets `status = REJECTED`, sends rejection email |
| PATCH | `/api/superadmin/hostels/:id/suspend` | `{ reason }` | Sets `status = SUSPENDED` |
| GET | `/api/superadmin/hostels/:id/documents` | — | Verification documents |
| PATCH | `/api/superadmin/documents/:id/review` | `{ status: VERIFIED|REJECTED, rejectionReason? }` | Review a hostel document |
| GET | `/api/superadmin/duplicates` | — | Flagged duplicate/ghost listings (same address, phone, photos, documents) |
| GET | `/api/superadmin/subscriptions` | `?status=, page=` | Hostel subscriptions |
| POST | `/api/superadmin/subscriptions` | `{ hostelId, plan, amount, periodStart, periodEnd, proofUrl? }` | Record manual payment from hostel |
| PATCH | `/api/superadmin/subscriptions/:id/verify` | — | Verify subscription payment proof |
| GET | `/api/superadmin/reports` | `?type=hostels|payments|inquiries|complaints` | Platform-wide reports, CSV export |
| POST | `/api/superadmin/announcements` | `{ title, body }` | Broadcast to all hostels/users |
| PATCH | `/api/superadmin/reviews/:id/hide` | `{ reason }` | Moderate abusive reviews |
| GET | `/api/superadmin/service-providers` | `?status=, category=, page=` | List service providers |
| PATCH | `/api/superadmin/service-providers/:id` | `{ status: APPROVED|REJECTED|HIDDEN, rejectionReason? }` | Approve/reject/hide provider |
| GET | `/api/superadmin/platform-config` | — | Get PlatformConfig singleton |
| PUT | `/api/superadmin/platform-config` | `{ ...partial config updates }` | Update platform config (see ARCHITECTURE.md §5) |
| POST | `/api/superadmin/moderators` | `{ email, name }` | Create PLATFORM_MODERATOR account |

---

## 5. Platform Moderator

`PLATFORM_MODERATOR` has a subset of superadmin permissions (no config/billing access).

| Method | Path | Notes |
|---|---|---|---|
| GET | `/api/moderator/hostels` | Same as superadmin but read-only on sensitive fields |
| PATCH | `/api/moderator/hostels/:id/approve` | Can approve hostels |
| PATCH | `/api/moderator/hostels/:id/reject` | Can reject hostels |
| GET | `/api/moderator/service-providers` | Can review service providers |
| PATCH | `/api/moderator/service-providers/:id` | Can approve/reject providers |
| PATCH | `/api/moderator/reviews/:id/hide` | Can moderate reviews |
| GET | `/api/moderator/reports` | Can view reports (no CSV export of financial data) |

---

## 6. Hostel Admin / Warden

All routes require `role IN (HOSTEL_ADMIN, WARDEN)` **and** the resolved `hostelId` from the session (never from the URL/body) — see ARCHITECTURE.md §2. Warden-permission flags (`HostelStaff.permissions`) further restrict a subset of these for `WARDEN` sessions; enforce both checks.

| Method | Path | Body/Query | Permission Check (Warden) | Notes |
|---|---|---|---|---|
| GET | `/api/hostel-admin/profile` | — | — | Returns hostel profile |
| PATCH | `/api/hostel-admin/profile` | `{ name?, description?, address?, contactPhone?, rules?, facilities[]?, facilityDetails?: { totalToilets?, parkingCapacity?: { bikes?, cars? }, hasGarden?, hasCCTV?, hasGenerator?, hasElevator?, hasWaterPurifier?, notes? }, photos[]? }` | `editHostelProfile` | Update hostel profile with enhanced facility tracking |
| GET | `/api/hostel-admin/staff` | — | — | List wardens (HOSTEL_ADMIN only, wardens cannot see this) |
| POST | `/api/hostel-admin/staff` | `{ email, name, permissions }` | HOSTEL_ADMIN only | Create WARDEN account |
| PATCH | `/api/hostel-admin/staff/:id/permissions` | `{ permissions }` | HOSTEL_ADMIN only | Update warden permissions |
| GET | `/api/hostel-admin/rooms` | — | — | List rooms |
| POST | `/api/hostel-admin/rooms` | `{ floor, roomNumber, type, rentPerBed, capacity, facilities[], photos[]? }` | `manageRooms` | Create room |
| PATCH | `/api/hostel-admin/rooms/:id` | `{ ...updates }` | `manageRooms` | Update room |
| DELETE | `/api/hostel-admin/rooms/:id` | — | `manageRooms` | Soft delete room |
| GET | `/api/hostel-admin/rooms/:roomId/beds` | — | — | List beds in room |
| POST | `/api/hostel-admin/rooms/:roomId/beds` | `{ bedLabel }` | `manageRooms` | Create bed |
| PATCH | `/api/hostel-admin/beds/:id` | `{ status, maintenanceNote? }` | — | Update bed status |
| GET | `/api/hostel-admin/residents` | `?status=, page=` | — | List residents |
| GET | `/api/v1/hostel-admin/resident-lookup` | `?residentId=, hostelId?` | `registerResidents` | Prefill a registration from a person's portable resident ID / QR. Rate limited, audited, and notifies the owner — see §18.2 |
| POST | `/api/hostel-admin/residents` | `{ email, fullName, phone, guardianContact?, educationInfo?, residentType: STUDENT|WORKING_PROFESSIONAL|OTHER, roomId?, bedId?, depositAmount? }` | `registerResidents` | Register resident, triggers account creation/upgrade, sends QR activation email |
| PATCH | `/api/hostel-admin/residents/:id` | `{ ...updates }` | `registerResidents` | Update resident info |
| POST | `/api/hostel-admin/residents/:id/qr` | — | — | (Re)generate QR activation code |
| GET | `/api/hostel-admin/payments` | `?status=, month=, residentId=, page=` | — | List payments |
| POST | `/api/hostel-admin/payments` | `{ residentId?, month, amountDue, dueDate }` or bulk: `{ month, amountDue, dueDate }` | — | Create payment(s). If no residentId, creates for all active residents |
| GET | `/api/hostel-admin/payments/:id/proofs` | — | — | List proofs for a payment |
| PATCH | `/api/hostel-admin/payments/:id/proofs/:proofId/verify` | `{ status: VERIFIED|REJECTED, rejectionReason? }` | `verifyPayments` | Verify/reject proof, generates Receipt on verify, sends email |
| GET | `/api/hostel-admin/food-menu` | `?date=, mealType=` | — | List food menus |
| POST | `/api/hostel-admin/food-menu` | `{ date, mealType, description, isVeg }` | `manageFood` | Create food menu entry |
| POST | `/api/hostel-admin/food-photos` | `{ date, mealType, photoUrl }` | `manageFood` | Upload food photo |
| GET | `/api/hostel-admin/notices` | `?page=` | — | List notices |
| POST | `/api/hostel-admin/notices` | `{ title, body, category, isUrgent, targetAudience }` | `manageNotices` | Create notice, sends emails per EMAIL_SYSTEM.md |
| GET | `/api/hostel-admin/complaints` | `?status=, page=` | `viewComplaints` | List complaints |
| PATCH | `/api/hostel-admin/complaints/:id` | `{ status?, message }` | `updateComplaints` | Update complaint, add ComplaintUpdate, sends email |
| GET | `/api/hostel-admin/night-status` | `?date=, residentId=` | `viewNightStatus` | View night status logs |
| POST | `/api/hostel-admin/night-status` | `{ residentId, date, status, source: 'manual', overrideReason }` | `updateNightStatus` | Manual night status entry/override |
| POST | `/api/hostel-admin/residents/:id/move-in` | `{ items[], depositAmount }` | `registerResidents` | Create move-in checklist |
| POST | `/api/hostel-admin/residents/:id/move-out` | `{ items[], exitDate, depositRefund? }` | `registerResidents` | Create move-out checklist |
| GET | `/api/hostel-admin/service-providers/search` | `?category=, area=, availability=` | — | Search approved providers |
| GET | `/api/hostel-admin/maintenance-requests` | `?status=, page=` | `manageMaintenance` | List maintenance requests |
| POST | `/api/hostel-admin/maintenance-requests` | `{ category, description, urgency, roomId?, bedId?, providerId? }` | `manageMaintenance` | Create maintenance request |
| PATCH | `/api/hostel-admin/maintenance-requests/:id` | `{ status?, providerId?, costNote? }` | `manageMaintenance` | Update maintenance request |
| GET | `/api/hostel-admin/inquiries` | `?status=, page=` | — | Inquiries for this hostel |
| PATCH | `/api/hostel-admin/inquiries/:id` | `{ status, followedUpAt? }` | — | Mark inquiry as contacted/converted/closed |

---

## 7. Resident

All routes require `role = RESIDENT`; every query is scoped to `resident.id` derived from the session, never a client-supplied id.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| GET | `/api/resident/dashboard` | — | Summary: fee status, latest notices, food today, night status |
| GET | `/api/resident/profile` | — | Own resident profile |
| GET | `/api/resident/payments` | `?page=` | Own payment history |
| POST | `/api/resident/payments/:id/proof` | `{ fileUrl, method, referenceNote? }` | Upload PaymentProof, sends email to admin (EMAIL_SYSTEM.md §3.3) |
| GET | `/api/resident/notices` | `?page=` | Notices for own hostel |
| GET | `/api/resident/complaints` | `?page=` | Own complaints |
| POST | `/api/resident/complaints` | `{ category, title, description, photoUrl?, isAnonymous }` | Create complaint |
| GET | `/api/resident/night-status` | `?startDate=, endDate=` | Own night status history/summary |
| POST | `/api/resident/sos` | — | Triggers SOS alert, creates NightStatusLog with `status: SOS`, sends urgent emails (EMAIL_SYSTEM.md §5.1) |
| POST | `/api/resident/ratings` | `{ overall, food, cleanliness, security, room, location, management, comment? }` | One per hostel, enforced at DB level. Visible publicly after submit |
| GET | `/api/resident/referral` | — | Own referral code/link |
| POST | `/api/resident/guardian-invite` | `{ email, relation, phone, accessPermissions }` | Creates Guardian with invitation token, sends email (EMAIL_SYSTEM.md §1.5) |
| PATCH | `/api/resident/guardian/:id/permissions` | `{ accessPermissions }` | Resident controls what guardian can see |
| GET | `/api/resident/food-menu` | `?date=` | Food menu for own hostel |
| GET | `/api/resident/hostel` | — | Basic hostel info (name, address, contact, rules) |

---

## 8. Guardian

All routes require `role = GUARDIAN`, scoped to the single linked `residentId`. Returns only fields the resident has enabled in `Guardian.accessPermissions` — enforce field-level filtering server-side.

| Method | Path | Notes |
|---|---|---|---|
| GET | `/api/guardian/dashboard` | Returns only permitted fields: hostel info, emergency contact, fee summary (if enabled), notices (if enabled), night status summary (if enabled), complaint titles (if enabled). Full complaint details NEVER returned. |
| GET | `/api/guardian/payments-summary` | If `accessPermissions.feeStatus = true`: returns paid/unpaid/due summary. If `accessPermissions.receipts = true`: includes receipt links. Never returns raw proof images. |
| GET | `/api/guardian/notices` | If `accessPermissions.notices = true`: returns notices with `targetAudience IN ('all', 'guardians')`. |
| GET | `/api/guardian/night-status-summary` | If `accessPermissions.nightSafety = true`: returns day-level status summary (Inside/Outside/Not Verified/SOS) — never timestamps, never coordinates. |

---

## 9. Cook Portal

All routes require `role = COOK`, scoped to `cook.hostelId`.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| GET | `/api/cook/dashboard` | — | Today's food menu, recent food ready logs, resident count |
| POST | `/api/cook/food-ready` | `{ mealType, customMessage?, fetchFromMenu }` | Marks food as ready, creates FoodReadyLog, sends push notification to all residents of hostel. If `fetchFromMenu=true`, auto-fetches description from today's FoodMenu |
| POST | `/api/cook/food-photos` | `{ mealType, photoUrl }` | Upload food photo for today's meal |
| GET | `/api/cook/food-menu` | `?date=` | View food menu for planning |
| GET | `/api/cook/residents` | — | List of residents (names + photos only, no sensitive data) |
| GET | `/api/cook/analytics` | `?startDate=, endDate=` | Food timing analytics: avg ready time, delays, patterns |

---

## 10. Community Feature

### 10.1 Community Posts

All routes require `role = RESIDENT`.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| GET | `/api/community/posts` | `?visibility=PUBLIC\|HOSTEL_ONLY, hostelId?, page=, pageSize=` | List posts. If `visibility=PUBLIC`, returns all public posts across hostels. If `visibility=HOSTEL_ONLY`, returns own hostel posts only. |
| POST | `/api/community/posts` | `{ content, mediaUrls[]?, visibility, isAnonymous }` | Create post. Resident can choose PUBLIC (all residents see) or HOSTEL_ONLY |
| GET | `/api/community/posts/:id` | — | Get single post with comments |
| DELETE | `/api/community/posts/:id` | — | Delete own post (anytime) |
| POST | `/api/community/posts/:id/report` | `{ reason }` | Report inappropriate post |
| POST | `/api/community/posts/:id/react` | `{ reactionType }` | Add/change reaction (like, love, care, haha, sad, angry) |
| DELETE | `/api/community/posts/:id/react` | — | Remove own reaction |

### 10.2 Community Comments

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| GET | `/api/community/posts/:postId/comments` | `?page=` | List comments for a post |
| POST | `/api/community/posts/:postId/comments` | `{ content, isAnonymous }` | Add comment to post, sends notification to post author |
| DELETE | `/api/community/comments/:id` | — | Delete own comment |
| POST | `/api/community/comments/:id/react` | `{ reactionType }` | React to comment (like, love, haha) |
| POST | `/api/community/comments/:id/report` | `{ reason }` | Report inappropriate comment |

### 10.3 Community Admin (Hostel Admin/Warden)

Requires `role IN (HOSTEL_ADMIN, WARDEN)`.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| GET | `/api/hostel-admin/community/posts` | `?reported=true, hidden=true, page=` | View all posts in own hostel, filter by reported/hidden |
| PATCH | `/api/hostel-admin/community/posts/:id/hide` | `{ reason? }` | Hide inappropriate post (only for own hostel's posts) |
| PATCH | `/api/hostel-admin/community/posts/:id/unhide` | — | Unhide post |
| DELETE | `/api/hostel-admin/community/posts/:id` | — | Delete post from own hostel |
| GET | `/api/hostel-admin/community/analytics` | — | Most active residents, post frequency, sentiment analysis |

---

## 11. Location Tracking & Auto-Attendance

### 11.1 Resident Location (Mobile Only)

Requires `role = RESIDENT`. These endpoints are called automatically by mobile background service.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| POST | `/api/resident/location/ping` | `{ lat, lng, timestamp }` | Mobile app pings at configured times. Server calculates zone (INSIDE/NEARBY/OUTSIDE), creates AttendanceLog. Never stores exact coordinates, only zone status. |
| GET | `/api/resident/attendance` | `?startDate=, endDate=` | Own attendance history (zone status per check time) |
| GET | `/api/resident/attendance/summary` | `?month=YYYY-MM` | Calendar view: days present/absent |
| POST | `/api/resident/location/request-deletion` | — | Request deletion of location history (admin reviews) |

### 11.2 Admin Attendance Dashboard

Requires `role IN (HOSTEL_ADMIN, WARDEN)`.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| GET | `/api/hostel-admin/attendance/realtime` | — | Current attendance: how many residents INSIDE/NEARBY/OUTSIDE/UNKNOWN right now |
| GET | `/api/hostel-admin/attendance/history` | `?date=, residentId?, page=` | Attendance logs for date or resident |
| GET | `/api/hostel-admin/attendance/calendar` | `?month=YYYY-MM, residentId?` | Calendar view for specific resident or all |
| GET | `/api/hostel-admin/attendance/alerts` | `?resolved=false, page=` | Alerts for residents absent X consecutive days |
| PATCH | `/api/hostel-admin/attendance/alerts/:id/resolve` | `{ notes? }` | Mark alert as resolved |
| PATCH | `/api/hostel-admin/attendance/:id/override` | `{ zone, reason }` | Manually correct attendance log (e.g., resident was present but phone was off) |
| GET | `/api/hostel-admin/attendance/patterns` | `?residentId=` | Patterns: frequently absent residents, avg attendance rate |

---

## 12. Notifications & Push Messaging

### 12.1 User Notifications

All authenticated roles.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| GET | `/api/notifications` | `?page=, isRead=, category=` | Paginated, own `userId` only |
| GET | `/api/notifications/:id` | — | Get single notification detail |
| PATCH | `/api/notifications/:id/read` | — | Mark as read |
| PATCH | `/api/notifications/:id/dismiss` | — | Dismiss notification |
| PATCH | `/api/notifications/read-all` | — | Mark all as read |
| GET | `/api/notifications/unread-count` | — | Count of unread notifications (for badge) |

### 12.2 Admin Notification Creation

Requires `role IN (HOSTEL_ADMIN, WARDEN, SUPERADMIN)`.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| POST | `/api/hostel-admin/notifications` | `{ title, body, priority, category, targetAudience, targetResidentIds[]?, scheduledFor? }` | Create notification for own hostel. Can target all residents or specific residents (e.g., specific floor). Can schedule for future. |
| GET | `/api/hostel-admin/notifications` | `?page=, status=sent\|scheduled` | List sent/scheduled notifications |
| GET | `/api/hostel-admin/notifications/:id/stats` | — | Delivery stats: sent, delivered, read counts |
| DELETE | `/api/hostel-admin/notifications/:id` | — | Cancel scheduled notification (before it's sent) |

### 12.3 Superadmin Platform-Wide Notifications

Requires `role = SUPERADMIN`.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| POST | `/api/superadmin/notifications` | `{ title, body, priority, category, targetAudience, targetHostelIds[]?, scheduledFor? }` | Send notification to all hostels or specific hostels |
| GET | `/api/superadmin/notifications` | `?page=` | List all platform notifications |

---

## 13. QuestionCall Integration & Analytics

### 13.1 Resident QuestionCall Access

Requires `role = RESIDENT` AND `residentType = STUDENT`.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| POST | `/api/resident/questioncall/click` | `{ deviceType? }` | Tracks click event, returns redirect URL with user context. Creates QuestionCallClick record. |
| GET | `/api/resident/questioncall/status` | — | Check if user has converted (signed up on QuestionCall) |

### 13.2 Superadmin QuestionCall Analytics

Requires `role = SUPERADMIN`.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| GET | `/api/superadmin/questioncall/analytics` | `?startDate=, endDate=, hostelId?` | Total clicks, conversions, click-through rate, per hostel breakdown |
| GET | `/api/superadmin/questioncall/export` | `?startDate=, endDate=, format=csv\|json` | Export QuestionCall usage data |

---

## 14. Configuration & Settings

### 14.1 Hostel Settings (Hostel Admin)

Requires `role = HOSTEL_ADMIN`.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| GET | `/api/hostel-admin/settings` | — | Get all settings for own hostel (location tracking, cook portal, community, etc.) |
| PATCH | `/api/hostel-admin/settings` | `{ ...partial settings }` | Update hostel settings. Validates against platform constraints (e.g., can't set geofence > platform max) |
| GET | `/api/hostel-admin/settings/defaults` | — | Get platform default settings |

### 14.2 Platform Configuration (Superadmin)

Requires `role = SUPERADMIN`.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| GET | `/api/superadmin/platform-config` | `?category=` | List all platform config entries |
| PATCH | `/api/superadmin/platform-config/:key` | `{ value }` | Update specific platform config |
| GET | `/api/superadmin/hostels/:id/settings` | — | View specific hostel's settings (to check overrides) |
| PATCH | `/api/superadmin/hostels/:id/settings/override` | `{ ...settings }` | Superadmin can override any hostel setting |

---

## 15. Consent & Privacy

### 15.1 User Consent

All authenticated roles.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| POST | `/api/user/consent` | `{ consentType, consentVersion, consented }` | Record consent (terms, privacy policy, location tracking). Called during QR activation and settings changes. |
| GET | `/api/user/consent/history` | — | View own consent history |
| GET | `/api/user/consent/current` | — | Get current consent status for all types |

### 15.2 Account Deletion

Requires any authenticated role.

| Method | Path | Body/Query | Notes |
|---|---|---|---|
| POST | `/api/user/delete-account` | `{ reason }` | Request account deletion. Account disabled for 60 days, then permanently deleted. |
| POST | `/api/user/cancel-deletion` | — | Cancel pending deletion request (if within 60-day window). Reactivates account. |
| GET | `/api/user/deletion-status` | — | Check if account has pending deletion request |

---

## 16. Cook Account Setup (Internal)

These are called during hostel registration flow, not directly by cook.

| Method | Path | Body/Query | Notes | Permission |
|---|---|---|---|---|
| POST | `/api/hostel-admin/cook/create` | `{ cookName }` | Creates cook account for hostel, generates credentials, stores in HostelSettings. Called during hostel onboarding. | `HOSTEL_ADMIN` |
| PATCH | `/api/hostel-admin/cook/update` | `{ cookName?, enabled? }` | Update cook account details | `HOSTEL_ADMIN` |
| POST | `/api/cook/device/register` | `{ fingerprint, deviceName? }` | Cook registers device fingerprint on first login to track which cook did what | `COOK` |

---

## 17. Notifications (all authenticated roles)

**Note:** Section 9 above is now renumbered. This section consolidates notification endpoints already covered in section 12.

---

## 10. File Uploads

All uploads (hostel photos, food photos, payment proofs, hostel documents, service-provider photos/docs) go through a signed-URL pattern against Cloudflare R2:

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/uploads/sign` | `{ fileName, contentType, purpose }` | Returns pre-signed PUT URL scoped to purpose-specific key prefix (e.g., `payment-proofs/{hostelId}/{residentId}/...`). Validate `contentType` and max file size before issuing. |

**Flow:**
1. Client calls `/api/uploads/sign` with file metadata
2. Server validates, generates R2 pre-signed URL, returns to client
3. Client uploads directly to R2 using the signed URL
4. Client calls relevant endpoint (e.g., `POST /api/resident/payments/:id/proof`) with the resulting R2 object URL

---

## 11. QR Activation (Public/Resident)

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/api/qr-activation/verify` | none or PUBLIC | `{ code }` | Verifies QR code, returns resident info if valid |
| POST | `/api/qr-activation/activate` | none or PUBLIC | `{ code, password? }` | Activates resident account. If user not logged in, creates session. If logged in as PUBLIC, upgrades account to RESIDENT. Sets `QRActivation.status = ACTIVATED`. |

---

## 12. Platform Config (Public - Limited Fields)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/platform/config` | none | Returns public-safe subset of PlatformConfig (features, pricing plans, etc.). Excludes internal settings. Used by client for caching. |

---

## 13. Cron Jobs (Internal, Auth-Protected by Shared Secret)

These are hit by Vercel Cron with a shared secret header (`X-Cron-Secret`).

| Method | Path | Trigger | Action |
|---|---|---|---|
| POST | `/api/cron/payment-reminders` | Daily at 9 AM | Finds payments due in X days (PlatformConfig), creates Notification, sends emails (EMAIL_SYSTEM.md §3.1) |
| POST | `/api/cron/subscription-expiry` | Daily at 9 AM | Finds subscriptions expiring soon, sends emails to superadmin + hostel admin |
| POST | `/api/cron/complaint-sla-check` | Hourly | Flags complaints past SLA deadline (PlatformConfig), creates notifications |
| POST | `/api/cron/nearby-places-refresh` | Weekly | Recomputes cached nearby places for hostels with address changes or stale cache |

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
| POST | `/api/v1/public/hostels/:slug/views` | none or any role | Records the visit and returns the prompt decision in the same round trip |

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
