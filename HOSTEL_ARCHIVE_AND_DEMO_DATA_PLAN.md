# Archive a hostel — plan

Work this file **item by item**: build one checkbox, verify it, flip `[ ]` to `[x]`,
then move on. Do not batch.

---

## 0. What is actually true today

Read this before writing anything — most of the mechanism already exists and is
simply never written to.

| Thing | State |
| --- | --- |
| `Hostel.isDeleted` / `deletedAt` / `deletedBy` | Fields exist (`packages/db/src/models/Hostel.ts:174-177`). ~40 service files already filter `isDeleted` on read. **Nothing anywhere sets it to `true`.** |
| Superadmin hostel actions | `approve`, `reject`, `request-documents`, `publish`, `unpublish`, `run-duplicate-check`. No delete, no archive. |
| 60-day grace + purge precedent | `AccountDeletionRequest` → `runAccountDeletionPurge()` (`modules/users/account-purge.service.ts`) → `POST /api/v1/cron/account-purge`, `x-cron-secret`, `docs/CRON.md:219`, scheduled `0 3 * * *`. Copy this shape. |
| Portal lockout on archive | Free — `modules/billing/subscription-access.ts:33` already refuses a hostel with `isDeleted: true`. |
| Where the dummy data came from | Not a seed. `packages/db/src/seed.ts` creates the SUPERADMIN and nothing else. Every dummy hostel and payment is a real row somebody typed in. |
| Models carrying `hostelId` | 80. That is the cascade surface for the purge — see §B2. |

### Why there is no demo-data toggle in this plan

The superadmin dashboard's payment numbers come from `getPlatformPaymentsOverview()`
(`modules/reports/report.service.ts:390`), which reads `Invoice` and `PaymentEvent` —
**both hostel-scoped**. The same is true of the Team tab's `HostelSubscription` and
`SubscriptionPayment` aggregates. Archive and purge the dummy hostels and every one of
those numbers cleans itself. Nothing extra to build.

Fake team members are the one thing not under a hostel, and removing them already
ships: `DELETE /api/v1/platform/team/members/[id]?mode=delete`.

Standing rules this work must not break:

- Money is **paisa integers**; convert once, at draw time.
- The `AuditLog` row outlives what it describes — the purge writes one last.
- Private-bucket R2 objects must never be left orphaned, and never get a public URL.

---

## A. Archive a hostel

The public site goes clean the moment A2 lands, because every public read already
filters `isDeleted`.

- [x] **A1 — schema.** Add to `Hostel`: `purgeScheduledAt: Date` and
      `archiveReason: { type: String, trim: true }`. Index
      `{ isDeleted: 1, purgeScheduledAt: 1 }` — that is the only query the cron runs.
      No new collection: `isDeleted`/`deletedAt`/`deletedBy` already carry the rest,
      and a join would buy nothing.
- [x] **A2 — `archivePlatformHostel(id, { reason }, principal)`** in
      `modules/hostels/hostel.service.ts`, next to `unpublishPlatformHostel`. Sets
      `isDeleted: true`, `deletedAt: now`, `deletedBy: principal.userId`,
      `purgeScheduledAt: now + 60d`, `archiveReason`. Writes `AuditLog`
      `HOSTEL_ARCHIVED` with the reason. Refuses a hostel that is already archived.
      Validation in `hostel.validation.ts` mirroring `hostelUnpublishSchema` — the
      reason is required, same as unpublish.
- [x] **A3 — `restorePlatformHostel(id, principal)`.** Clears all five fields, writes
      `HOSTEL_RESTORED`. Refuses once `purgeScheduledAt` is past (the row may already
      be half-erased). Restoring must re-check slug and `referencePrefix` uniqueness —
      both are unique platform-wide and a new hostel may have taken them meanwhile.
- [x] **A4 — routes.** `PATCH /api/v1/platform/hostels/[id]/archive` and
      `.../restore`, both `requireSuperadminPrincipal` (not `requirePlatformPrincipal` —
      a moderator moderates listings, it does not erase a tenant). Copy the shape of
      `[id]/unpublish/route.ts`.
- [x] **A5 — sessions.** Archiving must log out that hostel's staff, not just refuse
      their next read: delete `Session` rows for its `HostelMember` users and its owner.
      Residents and guardians of an archived hostel lose their portal the same way.
      *Shipped as revoke, not delete* — the `Session` row is a record of a login and
      survives with `revokedAt` set. A user who still belongs to a live hostel is
      left signed in; their access to the archived one is already dead.
- [x] **A6 — superadmin UI.** New `"archive"` `ActionKey` in
      `platform-hostels-page.tsx` (reason prompt, exactly like `unpublish`), styled
      `destructive`, behind the existing confirm. Add an **Archived** filter to the
      queue showing `deletedAt`, the reason, days left before purge, and **Restore**.
      An archived hostel must not appear in the default queue or in
      `platform-dashboard-page.tsx`.
      Two things fell out of this that were not in the item:
      `getPlatformHostel` now takes `includeArchived` (the review screen has to be
      able to open an archived hostel to read why), and
      `getPlatformPaymentsOverview` is scoped to live hostels — otherwise an
      archived hostel's invoices keep summing into `totalDue`/`totalPaid` for the
      whole 60 days.
      **Also on `platform-listings-page.tsx`** — that is the screen the platform
      owner actually reaches for when looking at the listing inventory, and it is
      where the dummy rows are visible. Archive is a per-row action at every
      status there; the Archived tab carries Restore and Erase now per row.
- [ ] **A7 — verify (yours, in the browser).** Archive a throwaway hostel: its slug 404s on the public site,
      it is gone from `/hostels` search and the map, its admin cannot log in, and
      Restore puts all of it back.

---

## B. The purge

- [x] **B1 — cascade registry.** New `modules/hostels/hostel-purge.service.ts` with an
      explicit list of every model to erase for a `hostelId`, and the reasoning for
      anything retained — same delete-vs-retain split `account-purge.service.ts`
      documents. R2 objects for the hostel's `FileAsset` rows are deleted from both
      buckets **before** the rows, or the bytes are orphaned with no pointer left.
- [x] **B2 — a test that cannot drift.** 80 models carry `hostelId` today and more will.
      Test: read `packages/db/src/models/*.ts`, collect every model declaring `hostelId`,
      assert each is either in the registry or in an explicit `RETAINED` list with a
      reason. A new model with `hostelId` fails the suite until somebody decides which
      it is. Same spirit as the location-tracking privacy test.
- [x] **B3 — `runHostelArchivePurge(now)`.** Sweeps
      `{ isDeleted: true, purgeScheduledAt: { $lte: now } }`, batch of 20 (a hostel is
      80 collections, not one). Purge first, delete the `Hostel` row last, so a crash
      part-way leaves it due and the next run finishes. One hostel failing must not
      strand the batch. Returns `{ due, failed, purged }`.
- [x] **B4 — final audit row.** `HOSTEL_PURGED` written after the erase and deliberately
      kept — it is the only evidence the archive was honoured.
- [x] **B5 — cron route.** `POST /api/v1/cron/hostel-purge`, `validateCronRequest`,
      `maxDuration = 60`, copying `cron/account-purge/route.ts`.
- [x] **B6 — register it.** Row in `docs/CRON.md` (both the prose section and the
      schedule table), `0 3 * * *` alongside `account-purge`, then the job on
      cron-job.org. Until this is registered nothing is ever erased — archived hostels
      just accumulate, which is safe but is not the feature.
      **Docs done; the cron-job.org entry is not — that is a console action, not a
      commit.** Add `POST /api/v1/cron/hostel-purge` with the `x-cron-secret` header
      on `0 3 * * *`.
- [x] **B7 — purge now.** `DELETE /api/v1/platform/hostels/[id]` calling the same
      `purgeHostel()`, superadmin only, refusing any hostel that is **not already
      archived** — so it is always a second, deliberate act on something already gone
      from the site, never a one-click erase of a live tenant. Typed-name confirm in the
      UI, on the Archived filter only. This is what clears the current dev data today
      instead of in 60 days.
- [ ] **B8 — verify (yours, in the browser).** Archive a throwaway hostel, purge it now, confirm every
      collection is empty for that `hostelId`, the R2 objects are gone, and the
      `AuditLog` row survives. Then hand-set another's `purgeScheduledAt` to yesterday
      and confirm the cron does the same thing unattended.

---

## C. The cleanup pass itself

Code is done; this half is data work through the shipped UI, so it is yours to run.
Do it only after A7 and B8 come back clean.

- [ ] **C1** — Inventory: list every hostel and every PLATFORM_AGENT, and mark each
      *real* or *dummy*. Education Light Hostel and everything under it is real. Write
      the list down before touching anything.
- [ ] **C2** — Archive every dummy hostel through the superadmin UI (not the shell, not
      a script — if the UI cannot do it, the UI is wrong), then Purge now.
- [ ] **C3** — Delete the fake PLATFORM_AGENT team members through the shipped
      `?mode=delete` route.
- [ ] **C4** — Verify the public site: `/hostels`, the map, search, the landing page and
      the sitemap show Education Light and nothing else.
- [ ] **C5** — Verify the superadmin dashboard: no dummy payment, no dummy team member,
      and the payment totals match the real rows.
