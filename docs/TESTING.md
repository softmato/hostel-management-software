# TESTING.md — Testing Strategy & Quality Assurance

## Table of Contents

1. [Goals & Philosophy](#1-goals--philosophy)
2. [Test Pyramid](#2-test-pyramid)
3. [Tooling & Frameworks](#3-tooling--frameworks)
4. [Commands](#4-commands)
5. [Coverage Expectations](#5-coverage-expectations)
6. [What Must Be Tested (Non-Negotiable)](#6-what-must-be-tested-non-negotiable)
7. [Mandatory Test Templates](#7-mandatory-test-templates)
8. [Critical E2E Flows](#8-critical-e2e-flows)
9. [Test Data & Seeding](#9-test-data--seeding)
10. [CI/CD Integration](#10-cicd-integration)
11. [Manual QA Checklist](#11-manual-qa-checklist)

---

## 1. Goals & Philosophy

- **Every new feature ships with tests** — no feature is "done" without corresponding test coverage.
- **Multi-tenant isolation** and **role-based access** are tested on every endpoint — data leaks are the highest-severity bugs.
- **Critical flows** (auth, resident activation, payment proof verification, SOS, guardian access) have end-to-end tests.
- **Coverage is a guide, not a gate** — reviewers judge test quality and completeness, not just percentage numbers.
- **Tests prove the rules in RULES.md** — every rule should have at least one test demonstrating it works.
- **Privacy-sensitive logic** (guardian permissions, anonymous complaints, night-status coordinates) must be verified at the API level, not just UI.



## 2. Test Pyramid

```
        e2e   (few, critical flows only)
      ────────
      integration (controllers + DB + routes)
   ───────────────────────
   unit (services, utils, hooks, components)
```

**Philosophy:**
- **Unit tests** — fast, focused, many. Test business logic, data transformations, utility functions, and isolated components.
- **Integration tests** — moderate speed. Test API routes with real database (test instance), multi-tenant queries, role gates, and account-upgrade flows.
- **E2E tests** — slow, expensive. Test complete user journeys through the UI. Run fewer of these, but cover all critical paths.

---

## 3. Tooling & Frameworks

There is **no separate backend workspace** — this is a Next.js monolith, so
"backend" below means the service and route-handler code inside `apps/web`.

| Layer | Framework / Tool | Status |
|-------|------------------|--------|
| Service + route unit tests | **Vitest** | ✅ In use — 50 files, 338 tests |
| Route-handler integration | **Supertest** against real API routes | ❌ Not installed. Route tests today drive the handler function directly with mocked models. |
| Component tests | **Vitest** + **React Testing Library** | ❌ Not installed — zero `.test.tsx` files |
| E2E (web) | **Playwright** | ❌ Not installed — §8 flows unwritten |
| Mobile E2E (Phase 6) | **Detox** (optional) | ❌ Not started |
| Test database | **mongodb-memory-server** | ❌ Not installed — Mongoose models are mocked with `vi.mock()` |
| Mocking | **`vi.mock()`** | ✅ In use |

**Key principles:**
- Use a **real database** for integration tests, not mocks — tenant isolation
  bugs only appear with real queries. *(Aspirational today: the suite mocks
  models, which is exactly why the isolation coverage in §6.1 is thin.)*
- **Mock external services** (Resend email, Cloudflare R2, Google Maps) to avoid
  flaky tests and API costs.
- **Playwright** runs against a real deployment (local or preview) — no mocking
  at E2E level.

> The ❌ rows are tracked in `TODO.md` under Track B8. Do not read this table as
> a description of what exists; read it as the target with today's state
> marked.

---

## 4. Commands

The package manager is **npm**. Run everything from the repo root.

### What exists today

```bash
npm run web:test
```

```bash
npm --prefix apps/web run test:watch
```

```bash
npm --prefix apps/web run test -- attendance-zone
```

```bash
npm run test
```

(`npm run test` fans out across every workspace via Turborepo.)

Alongside the suite, the checks that gate a change:

```bash
npm --prefix apps/web run typecheck
```

```bash
npm run web:lint
```

```bash
npm run web:build
```

### Not yet wired up

Coverage reporting, `test:integration` / `test:unit` splits, and the Playwright
commands (`e2e`, `e2e:headed`) referenced elsewhere in this document do not
exist as scripts yet. See `TODO.md` Track B8.

---

## 5. Coverage Expectations

| Area | Target Coverage | Priority |
|------|----------------|----------|
| Services (backend business logic) | **≥ 80% lines** | 🔴 High |
| Controllers (backend routes) | **≥ 70%** via integration tests | 🔴 High |
| Repository/data access layer | **≥ 80%** | 🔴 High (tenant isolation!) |
| Shared UI components | **≥ 70%** | 🟡 Medium |
| Pages/screens | **≥ 50%** | 🟢 Low (covered by E2E) |
| Utility functions | **≥ 90%** | 🔴 High |
| E2E critical flows | **100% pass rate** | 🔴 High |

**Important notes:**
- Coverage is a **signal, not a target** — 100% coverage of meaningless assertions is worse than 60% coverage of critical paths.
- **Multi-tenant isolation** and **account-upgrade logic** are the highest-risk areas — these should be close to 100% covered.
- **Privacy-sensitive views** (guardian dashboard, anonymous complaints) must have explicit tests proving restricted data is absent.
- Reviewers judge test **quality and completeness**, not just percentage.

---


## 6. What Must Be Tested (Non-Negotiable)

These categories are **mandatory** and tied to RULES.md §8 Definition of Done. No PR can be merged without tests covering these areas where applicable.

### 6.1 Multi-Tenant Isolation ⭐ HIGHEST PRIORITY

For every hostel-scoped resource (`Room`, `Bed`, `Resident`, `Payment`, `Notice`, `Complaint`, `FoodMenu`, `MaintenanceRequest`, `Inquiry`, `RatingReview`):

**Required tests:**
- Seed two hostels (A and B), each with their own admin/warden/residents.
- Assert hostel A's admin/warden session gets **`404 not_found`** (NOT `403`, NOT data) when requesting any of hostel B's records by ID, even with a valid ID.
- Assert list endpoints for hostel A **never include hostel B's rows**, under any filter/sort/pagination combination.
- Assert residents of hostel A cannot view/modify residents of hostel B.

**Why this matters:**
- Multi-tenant data leaks are **catastrophic** — one hostel seeing another's financial records, complaints, or resident data is a complete system failure.
- Build this test suite in **Phase 1** and extend it every phase as new resources are added.

### 6.2 Auth & Account-Upgrade Logic ⭐ CRITICAL

This is the **trickiest logic** in the app (see ARCHITECTURE.md §3.2). Test thoroughly:

**Required scenarios:**
1. **Public signup (email/password)** → login → correct role assigned → correct redirect.
2. **Public signup via Google OAuth** → login again via Google → same account (no duplicate).
3. **Admin creates RESIDENT with new email** → new account created → credential email sent (assert email service called) → `mustChangePassword = true`.
4. **Admin creates RESIDENT with existing PUBLIC account email** → account upgraded in place (same `User._id`) → no duplicate → existing password/Google link preserved → `AuditLog` entry written.
5. **Admin attempts to create RESIDENT with email that already has non-PUBLIC role** → `409 email_already_has_role` → no mutation.
6. **Superadmin approves hostel whose owner has existing PUBLIC account** → upgrade to `HOSTEL_ADMIN` requires email confirmation step → role does NOT change until confirmation completes.
7. **Login rate-limiting** → N failed attempts within window → further attempts blocked.
8. **Expired/rotated refresh tokens** → rejected on use.
9. **Reusing a refresh token after rotation** → rejected (token theft detection).

### 6.3 Role-Based Access Control (Every Endpoint)

**Required test pattern:**
```typescript
it.each([
  ['resident',   403],
  ['guardian',   403],
  ['warden',     200], // if warden is allowed
  ['admin',      200],
])('role %s → %i', async (role, expectedStatus) => {
  const user = await seedUser({ role });
  const res = await request(app)
    .get('/api/v1/hostel/rooms')
    .set('Authorization', bearer(user));
  expect(res.status).toBe(expectedStatus);
});
```

**Apply to every protected endpoint** — no exceptions.

### 6.4 Payments

**Required tests:**
- Creating a payment period → resident can upload proof.
- Uploading proof → `Payment.status` updates correctly.
- Admin verifies proof → `Payment.status = PAID` → `Receipt` record created.
- Admin rejects proof → `Payment.status` unchanged → `rejectionReason` required.
- Resident cannot view/upload proof for another resident's payment (ownership + tenant check).
- Money fields never lose precision — test with non-round Decimal amounts (e.g., `1234.56`).

### 6.5 Privacy-Sensitive Views

**Required tests:**
1. **Guardian dashboard** → only includes fields where `resident.guardianAccessPermissions[field] = true`.
   - Test by toggling permissions OFF → assert field is **absent from API response**, not just hidden in UI.
2. **Night-status endpoints** → never return raw GPS coordinates, regardless of role.
3. **Complaint marked anonymous** → never exposes resident identity to hostel admin/warden view (not in list, not in detail).

### 6.6 Business-Rule Constraints

**Required tests:**
1. **Bed assignment** → a bed cannot be assigned to two active residents at once (test DB unique constraint + application logic).
2. **Rating uniqueness** → a resident cannot submit a second `RatingReview` for the same hostel (test unique constraint).
3. **QR activation** → code cannot be reused after `status = ACTIVATED` → code expires per `expiresAt` → expired codes rejected.
4. **Complaint photo upload** → fails if file size exceeds limit → fails if file type not allowed.
5. **Maintenance request** → only assigned warden or admin can update status.

### 6.7 Audit Logging

**Required tests:**
- Every sensitive mutation (role change, payment verification, complaint resolution, resident edit) writes an `AuditLog` entry.
- Audit log includes `performedBy`, `action`, `targetResource`, `timestamp`, `changes`.

---


## 7. Mandatory Test Templates

Copy these patterns for every relevant endpoint/feature.

### 7.1 Multi-Tenant Isolation Test Template

```typescript
describe('GET /api/v1/hostel/rooms/:id - tenant isolation', () => {
  it('rejects access to another hostel's room', async () => {
    // Arrange: Create two hostels
    const hostelA = await seedHostel({ name: 'Hostel A' });
    const hostelB = await seedHostel({ name: 'Hostel B' });
    const adminA = await seedHostelAdmin({ hostelId: hostelA._id });
    const roomB = await seedRoom({ hostelId: hostelB._id });

    // Act: Admin A tries to access Room B
    const res = await request(app)
      .get(`/api/v1/hostel/rooms/${roomB._id}`)
      .set('Authorization', bearer(adminA));

    // Assert: 404, never leak existence
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('not_found');
  });

  it('list endpoint never includes other hostel's rooms', async () => {
    const hostelA = await seedHostel({ name: 'Hostel A' });
    const hostelB = await seedHostel({ name: 'Hostel B' });
    await seedRoom({ hostelId: hostelA._id, number: 'A101' });
    await seedRoom({ hostelId: hostelB._id, number: 'B101' });
    const adminA = await seedHostelAdmin({ hostelId: hostelA._id });

    const res = await request(app)
      .get('/api/v1/hostel/rooms')
      .set('Authorization', bearer(adminA));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].number).toBe('A101');
  });
});
```

### 7.2 Role Gate Test Template

```typescript
describe('GET /api/v1/hostel/rooms - role access', () => {
  it.each([
    ['RESIDENT',   403, 'residents cannot list rooms'],
    ['GUARDIAN',   403, 'guardians cannot list rooms'],
    ['WARDEN',     200, 'wardens can list rooms'],
    ['HOSTEL_ADMIN', 200, 'admins can list rooms'],
  ])('role %s → %i (%s)', async (role, expectedStatus, _description) => {
    const hostel = await seedHostel();
    const user = await seedUser({ hostelId: hostel._id, role });

    const res = await request(app)
      .get('/api/v1/hostel/rooms')
      .set('Authorization', bearer(user));

    expect(res.status).toBe(expectedStatus);
  });
});
```

### 7.3 Privacy/Guardian Permissions Test Template

```typescript
describe('GET /api/v1/guardian/linked-resident - privacy', () => {
  it('guardian only sees fields they have permission for', async () => {
    const resident = await seedResident({
      guardianAccessPermissions: {
        academicInfo: true,
        paymentStatus: false,
        complaints: false,
        medicalInfo: true,
      },
    });
    const guardian = await seedGuardian({ linkedResidentId: resident._id });

    const res = await request(app)
      .get('/api/v1/guardian/linked-resident')
      .set('Authorization', bearer(guardian));

    expect(res.status).toBe(200);
    expect(res.body.data.academicInfo).toBeDefined();
    expect(res.body.data.medicalInfo).toBeDefined();
    expect(res.body.data.paymentStatus).toBeUndefined();
    expect(res.body.data.complaints).toBeUndefined();
  });
});
```

### 7.4 Account-Upgrade Test Template

```typescript
describe('POST /api/v1/hostel/residents - account upgrade', () => {
  it('upgrades existing PUBLIC account to RESIDENT', async () => {
    // Arrange: Create a public user first
    const existingUser = await seedUser({
      email: 'john@example.com',
      role: 'PUBLIC',
      passwordHash: await hashPassword('existing-password'),
    });

    const admin = await seedHostelAdmin();

    // Act: Admin creates resident with same email
    const res = await request(app)
      .post('/api/v1/hostel/residents')
      .set('Authorization', bearer(admin))
      .send({
        email: 'john@example.com',
        name: 'John Doe',
        bedId: testBed._id,
      });

    // Assert
    expect(res.status).toBe(201);
    const updatedUser = await User.findById(existingUser._id);
    expect(updatedUser.role).toBe('RESIDENT');
    expect(updatedUser.email).toBe('john@example.com');
    
    // Assert: No duplicate account created
    const userCount = await User.countDocuments({ email: 'john@example.com' });
    expect(userCount).toBe(1);

    // Assert: Audit log entry exists
    const auditLog = await AuditLog.findOne({
      action: 'ACCOUNT_UPGRADED',
      targetUserId: existingUser._id,
    });
    expect(auditLog).toBeDefined();
  });

  it('rejects creating resident when email already has non-PUBLIC role', async () => {
    await seedUser({ email: 'admin@example.com', role: 'HOSTEL_ADMIN' });
    const admin = await seedHostelAdmin();

    const res = await request(app)
      .post('/api/v1/hostel/residents')
      .set('Authorization', bearer(admin))
      .send({
        email: 'admin@example.com',
        name: 'Test',
        bedId: testBed._id,
      });

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('email_already_has_role');
  });
});
```

### 7.5 Payment Precision Test Template

```typescript
describe('Payment calculations - decimal precision', () => {
  it('preserves precision for non-round amounts', async () => {
    const resident = await seedResident();
    const payment = await Payment.create({
      residentId: resident._id,
      amount: new Decimal('1234.56'), // Mongoose Decimal128
      dueDate: new Date('2024-01-31'),
    });

    const retrieved = await Payment.findById(payment._id);
    expect(retrieved.amount.toString()).toBe('1234.56');
  });
});
```

---


## 8. Critical E2E Flows

These flows must be tested end-to-end with **Playwright** before marking a phase complete. Each flow should have its own spec file.

### 8.1 Public Visitor Journey
**File:** `e2e/public-visitor.spec.ts`

**Flow:**
1. Visit homepage → see hero with search
2. Search by location (Kathmandu) → see results
3. Apply filters (price range, facilities) → results update
4. Click hostel card → open profile page
5. View map, nearby places, facilities
6. Compare with another hostel → side-by-side comparison
7. Submit inquiry form → success message → inquiry appears in hostel admin's inbox

**Assertions:**
- Results filtered correctly
- Map displays pins at correct locations
- Inquiry appears only in the target hostel's admin panel, not other hostels

---

### 8.2 Hostel Onboarding
**File:** `e2e/hostel-onboarding.spec.ts`

**Flow:**
1. New user signs up as hostel owner → submits hostel details + documents
2. Platform owner logs in → sees pending approval
3. Platform owner approves hostel
4. Hostel owner receives email → confirms account
5. Hostel owner logs in → sees admin dashboard
6. Hostel appears on public search results

**Assertions:**
- Hostel does NOT appear publicly before approval
- Owner account role upgraded correctly after confirmation
- Approval audit log entry exists

---

### 8.3 Resident Lifecycle
**File:** `e2e/resident-lifecycle.spec.ts`

**Flow:**
1. Admin creates resident → QR code generated
2. Resident scans QR → activates account → sets password
3. Resident logs in → sees dashboard
4. Resident uploads payment proof
5. Admin verifies payment → marks as paid
6. Resident sees receipt + notification

**Assertions:**
- QR code expires after activation
- Resident only sees own hostel's data
- Payment status updates correctly
- Notification appears in resident's dashboard

---

### 8.4 Complaint Lifecycle
**File:** `e2e/complaint-lifecycle.spec.ts`

**Flow:**
1. Resident submits complaint with photo (anonymous)
2. Warden sees complaint in dashboard (identity hidden)
3. Warden updates status → adds resolution note
4. Resident sees status update + notification
5. Resident confirms resolution

**Assertions:**
- Anonymous complaint hides resident identity from warden
- Photo uploads and displays correctly
- Status transitions tracked in timeline
- Guardian does NOT see complaint (privacy)

---

### 8.5 Guardian Flow
**File:** `e2e/guardian-access.spec.ts`

**Flow:**
1. Resident invites guardian → specifies permissions (academicInfo: ✓, complaints: ✗, payments: ✗)
2. Guardian receives email → activates account
3. Guardian logs in → sees dashboard
4. Guardian views resident's academic info (allowed)
5. Guardian tries to view complaints → not visible
6. Resident updates permissions → guardian access changes immediately

**Assertions:**
- Guardian only sees explicitly permitted fields
- Restricted fields are absent from API response (not just hidden in UI)
- Permission changes take effect without re-login

---

### 8.6 SOS Flow
**File:** `e2e/sos-emergency.spec.ts`

**Flow:**
1. Resident triggers SOS button
2. Warden receives in-app alert
3. Admin receives in-app alert
4. Platform owner receives in-app alert
5. All alerts show resident name + current night-status location (if available)

**Assertions:**
- Alert appears within 3 seconds
- GPS coordinates NOT exposed in alert (privacy)
- Alert includes timestamp + resident context

---

### 8.7 Service Provider & Maintenance
**File:** `e2e/maintenance-flow.spec.ts`

**Flow:**
1. Public user signs up as service provider (plumber, Kathmandu)
2. Platform owner approves provider
3. Warden creates maintenance request → searches providers by category + location
4. Warden contacts provider (phone/email shown)
5. Warden marks request as complete

**Assertions:**
- Providers only appear after approval
- Search filters by category + location correctly
- Other hostels cannot see this hostel's maintenance requests (tenant isolation)

---

### 8.8 Unified Login & Account-Upgrade E2E
**File:** `e2e/auth-account-upgrade.spec.ts`

**Flow:**
1. User signs up via Google OAuth as PUBLIC
2. User logs in via Google → dashboard shows PUBLIC role
3. Admin creates resident using that same Google email
4. User logs in again via Google → now sees RESIDENT dashboard (account upgraded)
5. User's password login still works (if they had set one)

**Assertions:**
- No duplicate accounts created
- Role upgrade happens seamlessly
- User can log in via both Google and password (if applicable)

---

## 9. Test Data & Seeding

### 9.1 Seed Scripts

**Development seed:** `packages/db/seed.ts`
- Minimal data for local development
- 1 platform owner, 1 hostel, 1 admin, 2 residents

**Test seed:** `packages/db/seed.test.ts`
- Comprehensive fixture set for testing
- 2 hostels (A and B) — for tenant isolation tests
- 1 platform owner
- 1 admin + 1 warden per hostel
- 3 residents per hostel + 1 guardian each
- 1 approved service provider (plumber, Kathmandu)
- Sample payments, complaints, notices

### 9.2 Test Database Isolation

```typescript
// In test setup (e.g., jest.setup.ts)
beforeAll(async () => {
  await connectToTestDB(); // Use TEST_MONGODB_URI
});

beforeEach(async () => {
  await clearTestDB(); // Drop all collections between tests
  await seedTestData(); // Seed standard fixtures
});

afterAll(async () => {
  await disconnectDB();
});
```

**Environment variables:**
```bash
TEST_MONGODB_URI=mongodb://localhost:27017/multi-hostel-test
NODE_ENV=test
```

### 9.3 Test Helpers

```typescript
// tests/helpers/auth.ts
export function bearer(user: User) {
  const token = generateJWT(user);
  return `Bearer ${token}`;
}

// tests/helpers/seed.ts
export async function seedHostel(overrides = {}) {
  return Hostel.create({
    name: 'Test Hostel',
    location: { type: 'Point', coordinates: [85.324, 27.717] },
    status: 'ACTIVE',
    ...overrides,
  });
}

export async function seedResident(overrides = {}) {
  const user = await User.create({
    email: `resident-${Date.now()}@example.com`,
    role: 'RESIDENT',
    ...overrides,
  });
  return user;
}
```

---


## 10. CI/CD Integration

> **Status: `.github/workflows/` does not exist.** Nothing below runs today, so
> §10.2's branch protection rules are unenforceable. Tracked in `TODO.md`
> Track B8. The YAML below is the intended workflow, corrected to npm.

**On every PR/push to a feature branch:**
```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run web:lint

      - name: Typecheck
        run: npm --prefix apps/web run typecheck

      - name: Unit tests
        run: npm run web:test
        env:
          NODE_ENV: test

      - name: Build
        run: npm run web:build
```

**On merge to main (once Playwright exists):**
```yaml
# .github/workflows/e2e.yml
name: E2E Tests
on:
  push:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright
        run: npx playwright install --with-deps

      - name: Build app
        run: npm run web:build

      - name: Run E2E tests
        run: npm --prefix apps/web run e2e
        env:
          E2E_BASE_URL: http://localhost:3000
          TEST_MONGODB_URI: ${{ secrets.TEST_MONGODB_URI }}

      - name: Upload Playwright report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
```

### 10.2 Merge Rules

**Branch protection rules (main branch):**
- ✅ Require status checks to pass:
  - `test` (lint + typecheck + unit + integration)
- ✅ Require 1 approval from code owner
- ✅ Require branches to be up to date before merging
- ❌ Do NOT require E2E to pass on every PR (too slow) — run nightly or on-demand

**Before marking a phase complete in MEMORY.md:**
- ✅ All unit + integration tests passing
- ✅ All E2E flows for that phase passing
- ✅ Manual QA checklist completed (see §11)

---

## 11. Manual QA Checklist

Run this checklist before marking any phase as "complete" in MEMORY.md.

### 11.1 Before Every Phase Sign-Off

**UI/UX (from DESIGN.md §5):**
- [ ] Every new screen handles **loading state** (spinner or skeleton)
- [ ] Every new screen handles **empty state** (helpful empty message + CTA)
- [ ] Every new screen handles **error state** (user-friendly error + retry/dismiss)
- [ ] Forms show **validation errors** inline
- [ ] Success/error **toasts** appear for mutations

**Responsive (from DESIGN.md §7):**
- [ ] Resize to **375px width** → nothing breaks, text readable, buttons tappable
- [ ] Resize to **1920px width** → content not awkwardly stretched
- [ ] Test on **mobile Chrome + Safari** (real device or BrowserStack)

**Accessibility:**
- [ ] All interactive elements are **keyboard accessible** (Tab, Enter, Esc work)
- [ ] Forms have proper **labels and ARIA attributes**
- [ ] Color contrast meets **WCAG AA** standards
- [ ] Focus indicators are visible

**Multi-Tenant Isolation (smoke test):**
- [ ] Log in as admin of Hostel A → view a resident list → IDs start with hostel A's prefix
- [ ] Copy a resident ID from Hostel B → try to access it via URL → **404**
- [ ] Check browser network tab → no API responses include data from other hostels

---

### 11.2 Phase-Specific Checklists

#### Phase 1 Checklist
- [ ] Public visitor can search hostels by location
- [ ] Public visitor can view hostel profile (all tabs load)
- [ ] Public visitor can submit inquiry → appears in admin inbox
- [ ] Platform owner can approve new hostel → owner receives email
- [ ] Hostel admin can log in after approval
- [ ] Unified login works: Google OAuth + email/password both work for same account

#### Phase 2 Checklist
- [ ] Admin can create rooms + beds
- [ ] Admin can register resident → resident receives QR code email
- [ ] Resident scans QR → activates account → logs in
- [ ] Resident sees only own hostel's dashboard
- [ ] Guardian can view only permitted fields (test by toggling permissions off)
- [ ] Warden can update night-status → GPS coordinates NOT visible to resident

#### Phase 3 Checklist
- [ ] Admin creates payment period → all residents see it
- [ ] Resident uploads payment proof → admin sees it in pending list
- [ ] Admin verifies proof → resident sees receipt + notification
- [ ] Admin rejects proof → resident sees rejection reason
- [ ] Resident cannot view another resident's payment details

#### Phase 4 Checklist
- [ ] Resident submits complaint (anonymous) → warden sees it without identity
- [ ] Warden updates complaint status → resident sees timeline update
- [ ] Resident uploads photo with complaint → displays correctly
- [ ] Food menu published → all residents see it
- [ ] Notice published → all residents receive notification

#### Phase 5 Checklist
- [ ] Resident triggers SOS → warden receives alert within 3 seconds
- [ ] Admin searches for service provider by category + location → correct results
- [ ] Warden creates maintenance request → contacts provider → marks complete
- [ ] Resident submits rating/review → appears on public hostel profile
- [ ] Reports generate correctly with correct data for date range

---

### 11.3 Auth Edge Cases (critical — test thoroughly)

- [ ] **Existing public user via password** → admin creates resident with same email → user logs in → sees resident dashboard (account upgraded)
- [ ] **Existing public user via Google** → admin creates resident with same email → user logs in via Google → sees resident dashboard
- [ ] **Freshly admin-created account** → user receives email with credentials → logs in → forced to change password
- [ ] **Admin-created account with email that already existed as public** → no duplicate account → existing password still works → audit log entry exists
- [ ] **Refresh token rotation** → use refresh token → get new token → old token rejected on reuse
- [ ] **Login rate-limiting** → 5 failed login attempts → account locked for 15 minutes

---

### 11.4 Privacy Verification (audit before production)

- [ ] **Guardian dashboard** → disable all permissions → API response contains NO restricted fields (not just UI hiding)
- [ ] **Anonymous complaint** → check MongoDB directly → `createdBy` field exists but not exposed in admin API response
- [ ] **Night-status** → check network tab → GPS coordinates never sent to resident/guardian
- [ ] **Cross-tenant API calls** → try accessing another hostel's resource by ID → 404 (not 403, not data)
- [ ] **Audit logs** → sensitive actions (payment verified, role changed) have entries with `performedBy`, `action`, `timestamp`

---

## 12. Common Pitfalls & Debugging Tips

### 12.1 Flaky Tests
**Symptom:** Test passes sometimes, fails other times.

**Causes:**
- Async operations without proper `await`
- Race conditions in parallel test execution
- Shared state between tests (missing `beforeEach` cleanup)
- External services not properly mocked

**Fixes:**
- Use `await` on all async operations
- Run tests with `--runInBand` (serial) to isolate concurrency issues
- Ensure `beforeEach` clears database
- Mock all external HTTP calls (email, storage, maps)

### 12.2 Tenant Isolation Bugs
**Symptom:** Test for tenant A accidentally returns data from tenant B.

**Causes:**
- Missing `hostelId` filter in query
- Copy-paste error in seed data (both records have same `hostelId`)

**Debugging:**
```typescript
// Add this to your test
const allRooms = await Room.find();
console.log('All rooms in DB:', allRooms.map(r => ({ id: r._id, hostelId: r.hostelId })));
```

### 12.3 E2E Tests Timing Out
**Symptom:** Playwright test hangs or times out.

**Causes:**
- Waiting for element that never appears
- Network request never completes
- Modal/dialog not properly dismissed

**Fixes:**
- Use explicit waits: `await page.waitForSelector('.resident-list', { timeout: 5000 })`
- Check network tab in headed mode: `npm --prefix apps/web run e2e:headed`
- Add debug screenshots: `await page.screenshot({ path: 'debug.png' })`

---

## 13. Resources & Further Reading

- **Testing Library Best Practices:** https://testing-library.com/docs/guiding-principles
- **Playwright Documentation:** https://playwright.dev/
- **Jest Mocking Guide:** https://jestjs.io/docs/mock-functions
- **MongoDB Memory Server (for tests):** https://github.com/nodkz/mongodb-memory-server

---

_End of TESTING.md_
