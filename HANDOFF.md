# HANDOFF.md — resume point for the remediation work

**Written:** 2026-08-02, end of session.
**Read order for a new session:** this file → `TODO.md` → `docs/MEMORY.md`.

`TODO.md` is the live tracker and the source of truth for *what is left*. This
file is the context you need before touching any of it.

---

## 1. State right now

Verified green at the moment of writing — re-run these first, they should stay green:

```bash
npm --prefix apps/web run typecheck && npm run web:lint && npm run web:test && npm run web:build
```

- typecheck clean · lint clean (0 errors, 0 warnings) · **401/401 tests, 56 files** · production build exit 0
- `npm run mobile:typecheck` also clean

**Nothing is committed.** `git log` still shows `4a2a5cf "added upto phase 4"`
and there are **373 uncommitted paths** — all of Phase 5 *plus* everything from
this session. If a commit is wanted, that is the first decision to make, and it
should probably be split (Phase 5 work vs. this remediation pass) rather than
one giant commit. Nothing has been pushed.

---

## 2. What this session did

A full `docs/` conformance audit (all 17 files) found the gaps, `TODO.md` was
opened as the tracker with 46 items, and these were completed:

| Item | Result |
|---|---|
| **Track A (8/8)** | Every doc reconciled with the code. ENVIRONMENT.md rewritten (it was wrong in every section that mattered for deploy). pnpm purged everywhere — **npm is the package manager, settled, do not re-litigate**. RULES/DATABASE/DESIGN/PRD/ARCHITECTURE/MEMORY corrected. MOBILE_STATUS.md rewritten from the filesystem. |
| **B0** | The login page's "PREVIEW AS DEMO" panel — which filled in real account emails and the password `admin` — is gone, with all its state and dead imports. |
| **B1** | Pagination built and applied to every user-facing list (19 endpoints). Four page-scoped-aggregate bugs found and fixed on the way. API.md §1.4 rewritten. |
| **B2** | Three "nobody gets notified" gaps closed: public inquiry, hostel-pending-approval, service-provider status. |

---

## 3. Decisions locked this session — do not re-open

1. **npm, not pnpm.** Settled and propagated through every doc. `package-lock.json` is the lockfile.

2. **Pagination envelope.** The collection keeps its descriptive key
   (`residents`, `payments`) and carries a sibling `pagination` block. API.md
   §1.4 originally specified a generic `items` key; that was rejected and the
   doc corrected, because a response legitimately carries more than one
   collection — payments returns `payments` **and** `proofs`, complaints
   returns `complaints` **and** a `summary`. The user approved correcting the
   doc.

3. **`FULL_PAGE` is a deliberate, temporary marker — not a hack to delete.**
   List endpoints now default to 20 rows. Screens that have not been given a
   `ListPager` yet would therefore show 20 rows with no way to reach the rest —
   worse than the 100 they showed before. Their endpoint constants carry an
   explicit `pageSize=100` via `FULL_PAGE` in `lib/hostel-admin-endpoints.ts`.
   **`grep FULL_PAGE` lists exactly which screens still owe a pager.** The goal
   is that every use disappears; removing the constant before the pagers exist
   would reintroduce the regression.

4. **Use the existing `ListPager`** in `app/_components/portal-dashboard-ui.tsx`.
   A second pager component was drafted this session and deleted on finding it.
   Do not add a third.

5. **`ServiceProvider.email` is optional and stays optional.** Many local
   tradespeople have no mailbox and the directory is reachable by phone. It was
   added only so EMAIL_SYSTEM §6.1–6.3 were implementable at all — before it,
   the model and the public form collected no address, which is why those three
   emails had never been built.

6. **Money is `Number`, not `Decimal128`.** DATABASE.md said the opposite and
   contradicted both RULES.md §6 and every shipped model. Resolved to `Number`.

---

## 4. The rule that keeps producing bugs

**Any aggregate returned alongside a paginated list must be computed over the
whole filter, not the returned page.** Now written into API.md §1.4.

Paginating found four existing violations. Expect more in code not yet touched:

- **Public hostel ratings** — average, seven category means and the star
  distribution were derived from the returned array. A hostel's public rating
  would have changed as a visitor clicked through pages.
- **Night status roster** — the status filter ran *after* `.limit(200)`, so
  `?status=OUTSIDE_HOSTEL` only searched the first 200 residents alphabetically.
  Pre-existing, not introduced by pagination.
- **Referral dashboard** — `byStatus`, `converted` and three reward totals came
  from the page, so the breakdown collapsed to one bucket when filtered.
- **Complaints header** — would have read "20 complaints" forever.

When you paginate anything else, check what else the function returns.

---

## 5. Gotchas that will cost you time

**Test mocks.** Adding `.skip()` + `countDocuments()` to a service breaks its
unit test with `TypeError: … .skip is not a function`. The fix in every case:

- add `skip: vi.fn().mockReturnThis()` to the file's `queryResult`/`chain` helper
- add `countDocuments: vi.fn().mockResolvedValue(0)` to the mocked model
- if the service also aggregates, add `aggregate: vi.fn()`
- if a test asserts on a summary, drive the counts with
  `mockResolvedValueOnce` **in call order** — pagination total first, then the
  summary counts

**Writing files.** `python -c`/heredoc writes to
`apps/web/src/app/_components/*` intermittently fail with
`OSError: [Errno 22] Invalid argument` even though reads succeed. Use the Edit
tool for files under `_components/`.

**Deletes are blocked** by the agent tooling in this repo (long-standing).

---

## 6. Resume here — `TODO.md` Track B6 onward

**B3, B4 and B5 are done** (2026-08-02, second session). Verified green:
typecheck, lint, **401/401 tests across 56 files**, production build exit 0.
`TODO.md` carries the detail; the three things worth knowing before touching
adjacent code:

- **B3** added `createOrUpdateBatchedNotification()` to
  `notification.service.ts`. Any repeated notification about the same thing can
  now collapse into one row via a `data.dedupeKey`. Only *unread* rows are
  reused, so a read notification is never silently mutated.

- **B4** changed every cross-tenant miss from `403 TENANT_ACCESS_DENIED` to
  `404 NOT_FOUND` — **the error code went too**, since a distinct code confirms
  existence just as surely as a 403 status. There is now no
  `TENANT_ACCESS_DENIED` anywhere. The isolation suite is
  `apps/web/src/modules/tenant-isolation.test.ts`; it asserts the *filter handed
  to Mongo*, not just an empty result. **Extend it whenever you add a
  hostel-scoped resource** — TESTING §6.1 now says so too.

- **B5** shipped account deletion as **four pathways, not one** — a client
  decision that overrode the docs (ARCHITECTURE §13.0 has the table). A hostel
  owner's request is *routed to the SUPERADMIN* and their account is untouched
  until approved; a guardian's "delete" demotes them to PUBLIC; an active
  resident is refused. Two doc instructions turned out to be unimplementable as
  written (nulling `Payment.residentId` collides with a unique index; `authorId`
  was `required`) — both amended in place with the reasoning.

- **B6 — privacy commitments.** The live `/privacy` page promises things that
  don't exist (delete from settings, 30-day deletion, cookie preferences, data
  export) and **never discloses location/attendance collection at all**, which
  PRIVACY_POLICY §3 marks "⚠️ READ CAREFULLY". Rewrite it, build the export,
  add the location-deletion confirmation email (EMAIL_SYSTEM §9.3 — the only
  part of the §9 email group B5 left behind), add re-consent on policy change.

  **Start from `/account/privacy`**, which B5 created. It already hosts the
  deletion panel and is reachable by any signed-in account regardless of role —
  the export and the cookie/consent controls belong on that same page, which is
  also where PRIVACY_POLICY §7.1/§7.4 say they live.

- **B7 — small items.** Cook web-login message · `validateServerEnv()` is
  defined and never called · PlatformConfig 5-min cache · the high-privilege
  upgrade confirmation gate.

- **Track C — mobile.** Expo push delivery (**Expo push service, not Firebase
  Admin SDK** — reference implementation studied at
  `D:\Jiwan-Mijhar\web\lib\push\expo-push.ts`; our `DeviceToken` model already
  fits and `/api/v1/mobile/device-token` exists), token lifecycle, notification
  categories, then **`docs/MOBILE_API.md`** — every endpoint with method, path,
  auth, params, response shape and error codes. That last one is the deliverable
  the user asked for by name.

**`apps/mobile` is NOT a stub.** 17 screens, ~2,200 lines, a 32-function typed
API client, working QR camera activation, typecheck clean. `docs/MEMORY.md` used
to claim otherwise; `MOBILE_STATUS.md` is now authoritative.

---

## 7. Deliberately deferred (TODO.md B8)

Shared Zod schemas out of `apps/web/src/modules/*` into `packages/shared` ·
`packages/db/src/repositories/` layer · axios vs the current fetch wrapper ·
2FA for admins · Subscription model · 88 hardcoded hex colours ·
Playwright + React Testing Library + Supertest + CI workflow.

Each needs a decision, not just implementation time. Several are listed in docs
as requirements, so they cannot simply be ignored — either build them or amend
the doc and record why.
