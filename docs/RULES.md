# RULES.md — AI Coding Rules & Constraints

These rules are binding for any AI coding assistant (or human) working on this repo. If a request conflicts with these rules, follow the rules and flag the conflict rather than silently picking one side.

---

## 1. Before You Start Any Task

1. **Read `docs/MEMORY.md` first** — it has the current state of the project, decisions already made, and what's in progress. Don't re-decide something already decided there.
2. **Check which Phase (PHASES.md) the requested work belongs to**. Don't build Phase 4 features while Phase 2 is incomplete unless explicitly told to jump ahead.
3. **After finishing meaningful work, update MEMORY.md** — completed work, new decisions, anything a future session needs to know. This is not optional; it's how context survives across sessions.

---

## 2. Approved Libraries (Use These, Don't Introduce Alternatives)

| Purpose | Use | Don't Use |
|---|---|---|
| Database | **MongoDB** | PostgreSQL, MySQL, etc. |
| ODM | **Mongoose** | Prisma (that's for SQL), TypeORM, raw MongoDB driver |
| Framework (web + API) | **Next.js 14+ App Router** | Pages Router, separate Express/NestJS backend, Remix |
| Language | **TypeScript**, `strict: true` | Plain JS anywhere in `apps/` or `packages/` |
| Styling | **Tailwind CSS** | CSS Modules, styled-components, plain CSS files (except `globals.css` tokens) |
| UI components | **shadcn/ui** | MUI, Ant Design, Chakra, Bootstrap |
| Icons | **lucide-react** | Font Awesome, Heroicons, mixed icon sets |
| Server state | **TanStack Query** | Manual `useEffect` fetch-and-setState, SWR |
| Client UI state | **Zustand** | Redux, MobX, Context-as-a-store for anything beyond trivial |
| HTTP client | **Axios** (one shared `apiClient`) | Fetch scattered ad hoc across components, multiple axios instances |
| Validation | **Zod** (shared schemas in `packages/shared`) | Yup, Joi, manual if-checks for request bodies |
| Forms | **react-hook-form** + **Zod** (zodResolver) | Formik, uncontrolled forms without validation |
| Auth | **Custom JWT + Google OAuth** (see ARCHITECTURE.md §3) | NextAuth/Clerk/Auth0 (the account-upgrade model is custom) |
| Passwords | **bcrypt** or **argon2** | Any reversible encryption, plaintext, ever |
| File storage | **Cloudflare R2** via `@aws-sdk/client-s3` | Storing files in app's filesystem/database, different S3 provider |
| Maps | **OpenStreetMap + Leaflet** (default) with runtime fallback to **Google Maps Platform** | Mapbox, HERE Maps, hardcoded provider choice |
| Email | **Resend** | Nodemailer without Resend, SendGrid, Mailgun (unless changed in ENVIRONMENT.md) |
| Dates | **date-fns** or **dayjs** | `moment.js` (deprecated), manual `Date` string parsing |
| Push (Phase 6 only) | **Firebase Cloud Messaging** | OneSignal, Pusher, custom WebSocket push |
| Mobile (Phase 6) | **React Native + Expo** | Flutter, native Swift/Kotlin, Ionic |

---

## 3. Multi-Tenancy — The Single Most Important Rule

Every collection that belongs to a hostel (`Room`, `Bed`, `Resident`, `Payment`, `Notice`, `Complaint`, `FoodMenu`, `MaintenanceRequest`, `Inquiry`, etc.) must be queried through a data-access function that takes `hostelId` as a **required** parameter derived from the authenticated session — never from a URL param, query string, or request body supplied by the client.

**WRONG:**
```typescript
// Client controls hostelId - SECURITY VULNERABILITY
const rooms = await RoomModel.find({ hostelId: req.body.hostelId });
```

**RIGHT:**
```typescript
// Session controls hostelId - SECURE
const session = await getSession(req);
const rooms = await RoomModel.find({ hostelId: session.hostelId });
```

**Enforcement:**
- All hostel-scoped queries live in a data-access layer that takes `hostelId` as
  a mandatory parameter. **As built** that layer is
  `apps/web/src/modules/<feature>/<feature>.service.ts` plus `lib/tenant.ts`,
  not `packages/db/src/repositories/` — the repositories directory was never
  created. Route handlers still never query Mongoose models directly; they call
  a service. Moving to a real `packages/db` repository layer is tracked in
  `TODO.md` Track B8.
- Service functions take the session-derived `hostelId` (or a principal
  carrying `hostelIds`) — never a client-supplied value
- Route handlers NEVER query Mongoose models directly — always call a service
- When a lookup fails the tenant check, return `404 not_found` — not `403 forbidden` — so you don't confirm to an attacker that the resource exists in another tenant

**Testing:**
- Every new hostel-scoped resource must have at least one test proving hostel A cannot read/write hostel B's data (see TESTING.md)

---

## 4. Authentication & Identity Rules

**Account Uniqueness:**
- One `User` document per email, ever. Never create a duplicate User with the same email.
- See ARCHITECTURE.md §3.2 for the exact "upgrade in place" logic when an admin registers someone who already has a public account.

**Superadmin Creation:**
- `SUPERADMIN` accounts are created ONLY via the seed/bootstrap script (ENVIRONMENT.md).
- Never via an API endpoint reachable in production.
- First superadmin created by seed script, subsequent ones created by existing superadmin via admin portal.

**Account Upgrade Security:**
- Upgrading an existing `PUBLIC` account into `HOSTEL_ADMIN` or `SUPERADMIN` requires an email-confirmation step before the role change takes effect (ARCHITECTURE.md §3.2).
- Upgrading into `RESIDENT`, `WARDEN`, or `GUARDIAN` can take effect immediately since the admin has vetted the person.

**Password Security:**
- Every admin-issued account gets `mustChangePassword = true` and is forced through a change-password screen on first login.
- Never log a password (hashed or plain), a JWT, or a Google ID token in application logs.
- Passwords hashed with **bcrypt, cost factor 12** (`lib/password.ts`). Never
  store or email a recoverable password — an issued temporary password exists
  only in the moment it is sent.

**Rate Limiting:**
- Rate-limit the auth endpoints under `/api/v1/auth/*` — there is one auth
  surface, not two. (A duplicate `/api/auth/*` tree existed until 2026-08-01;
  the live login was the copy *without* the rate limit, which is why the
  duplicate was deleted.)
- Lock out after 5 failed attempts within 15 minutes, per client, per endpoint
  namespace (`rateLimitAuthAttempts`).

---

## 5. Privacy Rules (From PRD.md §10 — Load-Bearing for Every Feature)

**Night/Attendance Status:**
- Always coarse-grained: `Inside Hostel / Outside Hostel / Not Verified / SOS`
- Never GPS coordinates, never timestamps visible to guardians, never "last seen at [address]"
- Residents see their own day-level history
- Guardians see summary only if resident enabled `accessPermissions.nightSafety`

**Guardian Access:**
- Field-level opt-in, controlled by resident (`Guardian.accessPermissions`)
- Enforced **server-side** by filtering response fields before sending — never rely on frontend to hide fields
- Guardian endpoints return ONLY permitted fields
- Test by toggling permissions and verifying field absence in API response

**Complaint Visibility:**
- Complaint content is NEVER visible to guardians unless resident explicitly enabled `complaintStatus` permission
- Even then, guardians see complaint titles + status only, not full details

**Service Providers:**
- Never receive resident personal data through any endpoint
- Only maintenance request operational details (category, description, room/bed if relevant)

**Documents:**
- Hostel verification documents (citizenship, ownership proof) never exposed via public or resident-facing endpoints
- Superadmin only

**Payment Proofs:**
- Private files served via R2 pre-signed URLs with short expiry (15 minutes)
- Guardians see receipt links only if `accessPermissions.receipts = true`
- Guardians never see raw proof images

---

## 6. API/Code Conventions

**Request Validation:**
- Every route handler validates its input with a Zod schema before touching the database. No exceptions.
- Zod schemas live in `packages/shared/src/schemas/` and are reused by both API route handlers and client-side forms (single source of truth).

**Response Envelope:**
- Every response uses the standard envelope from API.md §1.1:
  ```json
  { "success": true, "message": "...", "data": { } }
  { "success": false, "message": "...", "errorCode": "...", "details": { } }
  ```
- `errorCode` is a flat top-level field, not a nested `error` object. This was
  reconciled the code's way on 2026-08-01: the shipped envelope was already
  consistent across all route files, so API.md was corrected to describe it
  rather than migrating every route to match a document. Build responses with
  the `successResponse()` / `errorResponse()` helpers — never inline the shape.

**Pagination:**
- Every list endpoint is paginated (API.md §1.4) — never return an unbounded array.
- Accept `?page=1&pageSize=20`
- Return `{ success: true, data: { items: [], page: 1, pageSize: 20, total: 143 } }`

**Money Fields:**
- Always `Number` type in TypeScript (Mongoose stores as Number, sufficient precision for NPR amounts in this scale)
- Never `string` for calculations
- Display with proper formatting (e.g., "NPR 5,000")

**Error Handling:**
- Don't catch an error and silently swallow it — log it (server-side) and return a proper `error.code` to the client
- Use standard error codes from API.md §1.2

**Business Logic Location:**
- Don't put business logic in React components
- Put it in service/repository functions that a route handler (and, later, a test) can call directly
- Route handlers should be thin: validate → authorize → call service → return envelope

---

## 7. What the AI Assistant Should Never Do Unprompted

**Don't Change Core Architecture:**
- Never change the auth model (JWT vs third-party provider)
- Never change the database (MongoDB vs something else)
- Never change the monorepo structure
- Flag these as decisions, not just do them

**Don't Weaken Security:**
- Never remove or weaken the multi-tenancy filter on an existing query "to make a bug go away" — if a query is returning the wrong data, the fix is almost always in the filter logic, not in removing the filter
- Never expose server-only secrets (R2 keys, JWT secrets, Google Maps server key) to client-side code

**Don't Mark Phase Complete Prematurely:**
- Never mark a phase "done" in MEMORY.md without the phase's exit criteria (PHASES.md) actually being met
- All deliverables ☐ checked off + all acceptance tests ☐ passing = phase done

**Don't Build Out-of-Scope Features:**
- Never invent a payment gateway integration — v1 payments are manual-proof-upload only (ARCHITECTURE.md §6)
- If asked to "integrate eSewa," confirm this is intentionally moving beyond current scope before building it
- Never build SMS/WhatsApp delivery without explicit client request

**Don't Expose API Keys:**
- Never expose `GOOGLE_MAPS_API_KEY` (server key) to client-side code
- Only variables explicitly prefixed `NEXT_PUBLIC_` may reach client-side bundles
- Double-check this before every deploy (RULES.md §7)

---

## 8. Email System Rules (EMAIL_SYSTEM.md)

**All Triggers Must Be Implemented:**
- Every email scenario in EMAIL_SYSTEM.md must be implemented as features are built
- Don't defer email implementation to "later" — build email triggers alongside the feature

**Templates:**
- All templates live in `packages/shared/src/email/templates/<group>/`
- Each is a plain `.ts` function returning `{ subject, html }`, built on the
  shared `layout.ts`. **Not** React Email `.tsx` and not Handlebars — that was
  an early draft decision, reversed during the Phase 1 alignment so
  `packages/shared` stays framework-agnostic for the Phase 6 mobile app.
  Don't mix a second templating approach in.
- Test templates in development before deploying

**Guardian Emails:**
- Respect opt-in permissions — only send guardian emails if resident enabled the relevant `accessPermissions` flag
- SOS emails are an exception — always sent to guardian if linked (emergency access)

**Email Priority:**
- SOS emails are HIGHEST priority — must send immediately, never queued for batch processing
- Payment reminders, notices, complaint updates can be sent immediately or with short delay (< 1 min)

---

## 9. Definition of Done (Applies to Every Task)

A task is NOT done until:

1. ☐ It's covered by at least one automated test if it touches money, auth, or cross-tenant data access (TESTING.md)
2. ☐ Zod validation exists on every new/changed endpoint
3. ☐ Loading/empty/error states exist for any new list or detail UI (DESIGN.md §5)
4. ☐ `MEMORY.md` is updated with what was completed
5. ☐ If it's a new API endpoint, it's documented in API.md
6. ☐ If it's a new Mongoose model/field, it's documented in DATABASE.md
7. ☐ Email triggers (if applicable) are implemented per EMAIL_SYSTEM.md
8. ☐ Code compiles with no TypeScript errors
9. ☐ ESLint passes with no errors (warnings are tolerable if justified)
10. ☐ Multi-tenant isolation verified (if hostel-scoped)
11. ☐ Role-based access verified (if protected endpoint)

---

## 10. Git & Commits

**Commit Style:**
- **Conventional Commits**: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- Example: `feat(resident): add QR activation endpoint`

**Branch Naming:**
- `phase-<n>/<short-description>`, e.g. `phase-3/qr-activation`
- `fix/<short-description>`, e.g. `fix/payment-proof-upload`

**PR Requirements:**
- One logical change per PR
- PR description includes:
  - Which PHASES.md deliverable(s) it completes
  - Which acceptance tests it satisfies
  - What was updated in MEMORY.md/API.md/DATABASE.md
- No merging without tests passing (if CI is set up)

**What to Commit:**
- All code changes
- Updated `MEMORY.md` if meaningful work was done
- Updated `API.md` if endpoints were added/changed
- Updated `DATABASE.md` if models/fields were added/changed
- Updated `CHANGELOG.md` at end of phase

**What NOT to Commit:**
- `.env` files (only `.env.example` is tracked)
- `node_modules/`, `dist/`, `build/`, `.next/`
- IDE-specific files (`.vscode/`, `.idea/`) unless team-wide config
- Commented-out code, dead code, debug `console.log` statements

---

## 11. Code Review Checklist (Self-Review Before Asking for Human Review)

Before marking a PR ready for review, check:

- ☐ Does this introduce new hostel-scoped queries? If yes, are they filtered by session's `hostelId`?
- ☐ Does this add a new API endpoint? If yes, is it documented in API.md?
- ☐ Does this add/change a Mongoose model? If yes, is DATABASE.md updated?
- ☐ Does this implement a feature that triggers an email? If yes, is EMAIL_SYSTEM.md followed?
- ☐ Are all forms using Zod schemas from `packages/shared`?
- ☐ Do all list views have loading/empty/error states?
- ☐ Are there any TypeScript `any` types? If yes, are they justified with comments?
- ☐ Are environment variables properly prefixed? (`NEXT_PUBLIC_` for client, no prefix for server-only)
- ☐ Are private files (payment proofs, documents) served via signed URLs?
- ☐ Is `MEMORY.md` updated with what this PR accomplished?

---

## 12. Performance Considerations

**Database Queries:**
- Use MongoDB indexes defined in DATABASE.md — verify they exist after first deployment
- Never query all documents without pagination
- Use `.lean()` on Mongoose queries when you don't need Mongoose document methods (faster)

**Caching:**
- PlatformConfig is cached in memory on server, refreshed every 5 minutes (ARCHITECTURE.md §5)
- TanStack Query caches API responses client-side (configure `staleTime` appropriately)
- Hostel nearby places are cached in database, recomputed weekly or on address change

**File Uploads:**
- Pre-signed URLs minimize server involvement (client uploads directly to R2)
- Validate file size/type before issuing signed URL to prevent abuse

**API Response Size:**
- Paginate lists (default 20 items per page)
- Don't return nested relations more than 2 levels deep
- Guardian endpoints return only permitted fields (smaller responses)

---

## 13. Debugging & Logging

**What to Log:**
- Successful auth events (login, logout, role upgrade)
- Failed auth attempts (for rate limiting)
- Email send events (success/failure)
- SOS alerts (critical event)
- Payment verification events
- AuditLog entries for privilege changes

**What NOT to Log:**
- Passwords (plain or hashed)
- JWT tokens
- Payment proof file contents
- Full user documents (log userId only)
- Google OAuth tokens

**Log Format:**
- Use structured logging (JSON) for easy parsing
- Include: timestamp, level (info/warn/error), userId (if available), hostelId (if available), action, message
- Example: `{ "timestamp": "2026-08-15T10:30:00Z", "level": "info", "userId": "abc123", "hostelId": "def456", "action": "payment_verified", "message": "Payment proof verified for resident xyz" }`

---

## 14. Common Pitfalls to Avoid

**Multi-Tenancy Leaks:**
- Forgetting to filter by `hostelId` in repository functions
- Using client-supplied `hostelId` instead of session's `hostelId`
- Solution: Always use repository functions, never query Mongoose models directly in route handlers

**Account Duplication:**
- Creating a new User when one already exists with the same email
- Solution: Always check for existing User by email before creating, implement upgrade logic per ARCHITECTURE.md §3.2

**Guardian Privacy Violations:**
- Returning all fields to guardian instead of filtering by `accessPermissions`
- Solution: Filter response server-side before sending, test by toggling permissions

**Email Spam:**
- Sending emails in a loop without batching
- Solution: Collect recipients, deduplicate, send once per recipient

**Token Expiry Loops:**
- Access token expires → refresh fails → infinite redirect loop
- Solution: Implement proper refresh logic with fallback to login page after N failed attempts

**File Upload Without Validation:**
- Accepting any file type/size from client
- Solution: Validate content type and max size before issuing signed URL

---

_End of RULES.md_



---

## 12. Privacy & Location Tracking Rules

**Location Data:**
- NEVER store exact GPS coordinates in the database
- Server calculates zone (INSIDE/NEARBY/OUTSIDE) and IMMEDIATELY discards coordinates
- Only distance (in meters) and zone status are persisted in AttendanceLog
- Location tracking requires explicit consent during QR activation
- Consent must be logged in ConsentLog with timestamp, IP, user agent
- Users can request location history deletion at any time
- Auto-delete location data after configured retention period (default 600 days, max enforced by platform)

**Data Retention:**
- AttendanceLog: auto-delete after X days (configurable per hostel, platform enforces max)
- Aggregated analytics kept, raw logs deleted
- When resident moves out, location data deleted after retention period
- Account deletion requests trigger 60-day grace period, then full deletion

**Consent Requirements:**
- Terms of Use: required for all users
- Privacy Policy: required for all users
- Location Tracking: required for residents using mobile app
- If terms/privacy policy updated, users must re-consent on next login

---

## 13. Cook Portal Rules

**Access Control:**
- Cook role (`COOK`) has access ONLY to: food menu (read), food ready button, photo upload, resident list (names/photos only)
- Cook CANNOT access: payments, complaints, detailed resident info, room/bed management, settings
- Multiple cooks can share credentials (by design for simplicity)
- Device fingerprint tracked to identify which cook performed action

**Food Ready Notifications:**
- Cook can press "Food Ready" button once per meal per day
- Creates FoodReadyLog with timestamp
- Sends push notification to ALL active residents of that hostel
- Cannot spam: rate limit 1 per meal type per 2 hours

**Web Access:**
- If cook tries to login via web → show message: "Cook portal is mobile-only. Please download the app."
- Web features available to hostel admin (can do everything cook can do + more)

---

## 14. Community Feature Rules

**Moderation:**
- Resident can delete their own posts anytime
- Admin can hide (not delete) posts from their own hostel only
- Admin CANNOT moderate posts from other hostels
- Hidden posts remain in database (audit trail) but not visible publicly
- Profanity filter enabled by default (configurable per hostel)

**Visibility:**
- PUBLIC posts: visible to all residents across all hostels
- HOSTEL_ONLY posts: visible only to residents of same hostel (tenant isolation enforced)
- Anonymous posts: authorId stored but name not displayed (admin can see authorId if needed for abuse)

**Reporting:**
- Any resident can report post/comment with reason
- Reported content flagged in admin dashboard
- Admin must review and take action (hide, unhide, or dismiss report)

**Engagement:**
- Residents receive notifications when their post gets likes, comments, shares
- Notifications batched: "5 people liked your post" instead of 5 separate notifications
- Residents can turn off community notifications in settings

---

## 15. Configuration & Settings Rules

**Hierarchy:**
- Platform defaults set by superadmin (cannot be changed by hostel admin)
- Hostel admin can override within platform limits
- Superadmin can override any hostel setting

**Validation:**
- All hostel setting changes validated against platform min/max limits
- If hostel tries to set geofence radius > platform max → return 400 with error
- Settings changes logged in AuditLog

**Examples:**
- Platform sets max data retention = 600 days → hostel can set 30-600, but not 700
- Platform sets geofence radius range 20-500m → hostel can choose 50m, but not 10m or 600m

---

## 16. Notification Rules

**Priority Handling:**
- URGENT: SOS alerts, attendance alerts (14+ days absent), critical system issues
- NORMAL: Payment reminders, food ready, complaint updates
- INFO: General announcements, feature releases

**Delivery:**
- All notifications stored in Notification model — **one row per recipient**.
  That row *is* the receipt; there is deliberately no `NotificationReceipt`
  collection. Counting rows cannot drift the way a `deliveryStats` counter can,
  and it stays correct when someone opens a months-old notification.
  `NotificationCampaign` holds the authored broadcast; the per-recipient
  `Notification` rows hold delivery and read state.
- Push notifications sent if mobile app installed + device token exists
- Web notifications shown in notification center (bell icon)
- Email sent for URGENT priority only (not all notifications)

**Targeting:**
- Admin can target: all residents, specific residents (multi-select), specific floor/room
- Superadmin can target: all hostels, specific hostels
- Residents cannot send notifications (only receive)

---

## 17. QuestionCall Integration Rules

**Visibility:**
- QuestionCall button shown ONLY if residentType = STUDENT
- Not shown for WORKING_PROFESSIONAL or OTHER
- Button placement: resident dashboard, prominent but not intrusive

**Tracking:**
- Every click creates QuestionCallClick record
- Track: timestamp, device type, resident, hostel
- If QuestionCall pings back with conversion → update converted=true
- Superadmin can view analytics + export CSV

**Data Sharing:**
- Only share: email, name, hostelId (for analytics)
- Do NOT share: payment info, complaints, location data

---

_End of RULES.md_
