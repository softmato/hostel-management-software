# Performance & caching

The work order for making the website and the app fast. Phases run in order —
each one's reason for coming before the next is stated, and the reasons are
about dependency, not effort.

Tick a box only after the change is in and verified. See `RULES.md` — plan docs
are trackers, not proposals.

---

## Where the time actually goes

Measured by reading the flow end to end on 2026-09-19, not estimated.

**One hard reload of the hostel-admin dashboard is ~20 database round trips:**

| Where                                                       | Round trips                                                                                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| root layout → `loadSiteConfig`                              | 1 `PlatformSetting.find`                                                                                         |
| admin layout → `canAccessWorkspace` + `workspaceHostelName` | 2 identical `Hostel.find` (no `cache()`)                                                                         |
| `GET /reports/dashboard` → `requireHostelStaffPrincipal`    | 1 `Hostel.find` + suspension check                                                                               |
| that route's body → `getHostelAdminDashboardReport`         | `countableResidentIds` per hostel, then 9 parallel counts, then `getStatementNudge` — **three sequential waves** |
| `GET /profile`                                              | auth again (2) + hostel read                                                                                     |

**And each of those round trips crossed an ocean.** Functions ran in `iad1`
(Washington D.C., the unset default); the database sat in Frankfurt. Phase 1
is about that, and nothing else is worth measuring until it is done.

**No public API route carried a `Cache-Control` header.** Every visitor and
every app launch invoked a function and read Mongo for byte-identical data.

**The web client cache dies on refresh.** `staleTime: 30_000` in
`components/query-provider.tsx` saves a tab switch and nothing else — the
TanStack cache is in-memory only, so F5 refetches everything.

**The app's client cache is already good** — `apps/mobile/src/lib/query-cache.ts`
does disk persistence, in-flight dedup, prefetch warming and topic invalidation.
The app is slow because the _answers_ are slow, not because it re-asks.

### Vercel quota state that shapes the order

Hobby plan, read from the dashboard on 2026-09-19:

| Metric               | Reading           | Meaning                              |
| -------------------- | ----------------- | ------------------------------------ |
| Functions Storage    | **29.31 / 10 GB** | 3× over — blocks deploys             |
|   ↳ re-read 2026-09-20 | **29.31 / 10 GB** | unchanged. Nothing has been deleted, and Phase 5's ~8 GB saving does not exist until a new deploy carries it. |
| ISR Writes           | **199K / 200K**   | 99.5% — hits the wall                |
|   ↳ re-read 2026-09-20 | **208K / 200K** | **over.** The 60 → 600 fix is written but unshipped — it only starts counting after a deploy, which Functions Storage is blocking. |
| Fluid Active CPU     | 3h11m / 4h        | 80%                                  |
| Edge Requests        | 159K / 1M         | 16% — the bucket to move load _into_ |
| Fast Origin Transfer | 2.43 / 10 GB      | 24%                                  |

Two facts that decide several items below:

- **CDN cache reads and writes are free and unmetered** on Vercel. A
  `Cache-Control: s-maxage` response on a Route Handler costs nothing and
  removes a function invocation.
- **`export const revalidate` does not use the CDN cache.** It uses the ISR /
  durable cache, which is metered. Anywhere `revalidate` sits on a Route
  Handler, a header does the same job for free.

---

## Phase 1 — Stop the bleeding, then move the database

Nothing after this phase can be judged until it is done: every later change is
measured by "is it fast now?", and removing ~500 ms of network latency
afterwards makes it impossible to tell which change bought what.

### 1.1 Quota fires — these do not touch the database

- [ ] Delete old Vercel deployments. Functions Storage is cumulative across
      retained deployments; Hobby keeps the 3 most recent production plus the 3
      most recent of any type. If the number does not drop within ~24h it is
      Vercel's known "orphaned storage" case — open a community thread and ask
      for a purge.
- [x] `apps/web/src/app/(public)/layout.tsx` — `revalidate` 60 → 600. Every
      public page currently regenerates every 60s on access, and that is the ISR
      Writes bill. Vercel skips the write when output is byte-identical, so also
      grep the public pages for anything time-varying (`new Date()`, timestamps,
      random ids) that forces a write on every regeneration.
      — done. The grep found **nothing that forces a write**: the only `new Date()`
      reaching public HTML is the footer's copyright year, which is byte-identical
      for a year. The build's route table now prints `10m` against every public
      page, which is the check that this landed.
- [x] `apps/web/src/app/api/v1/public/site-config/route.ts` — replace
      `export const revalidate = 60` with a `Cache-Control` header. Same
      behaviour, moves it from the metered ISR cache to the free CDN cache.
      — done, through the `PUBLIC_CACHE` init added for Phase 3.

### Session log — 2026-09-19

**Done.** Investigation and measurement (the tables above). The new Atlas
cluster exists on the company account in Mumbai, with its URI in the root
`.env` as `MONGODB_URI_TARGET` — the app still runs on `MONGODB_URI`, so
nothing about production has changed yet. Two scripts written and exercised
against the live clusters: `compare-clusters.mjs` (read-only, exits non-zero on
any difference) and `migrate-cluster.mjs` (dry run reads 111 collections, 2,265
documents). Target cluster verified empty — `admin` and `local` only. The
`hostelhub` → `hostelpalika` rename landed in full (see the appendix); web and
mobile typecheck, mobile 1449/1449, web 2974/2975.

**Not started.** Everything in 1.1, and the cutover half of 1.2 from the copy
onwards. Phases 2–5 untouched.

**Carried over, unrelated to this work.** `hostel-purge.test.ts` fails on
`main`: `RentConcession` (commit c0cb193) was never registered in the purge
registry, so deleting a hostel orphans its concession rows — and `hostel-purge`
is one of the 17 crons, skipping it on every run. Erase-or-retain is a data
decision, not a mechanical fix.

**Next session starts at 1.1**, deleting old Vercel deployments — that is what
is blocking deploys, and the cutover needs a deploy.

---

### Session log — 2026-09-20

**Done.** Everything in this document that does not need the Vercel dashboard or
the Atlas cutover: the two code items in 1.1, all of Phase 2, most of Phase 3,
all of Phase 4, all of Phase 5. Each is ticked above with what it actually turned
out to be.

Verified, not assumed: web and mobile typecheck; web 2978/2979 and mobile
1449/1449; `next build` green, which is what proves `next.config.ts` still loads
after it grew an import; and the trace manifests counted straight out of
`.next/` for the Phase 5 numbers.

**Three items changed shape once the code was read**, and the reasons are on each
one above rather than here: `public/search` turned out to be a `POST` carrying a
per-visitor quota cookie and must never be CDN-cached; the Phase 4 Suspense item
was retired by the `cache()` in 2.1 rather than skipped; and Phase 5's allowlist
needed a graph walk rather than greps, so it came with a test that fails when the
list falls behind the code.

**Not started.** Everything in 1.1's first item and in 1.2 — both need the Vercel
dashboard or the Atlas UI, which are yours. Phase 3's impression decision is a
product call and `public/hostels` waits on it.

**Carried over, unchanged.** `hostel-purge.test.ts` still fails on `main` for the
reason recorded in the previous log: `RentConcession` is not in the purge
registry. It is the only failing web test and it is not from this work.

**The Phase 1 ordering still holds.** None of the above has been measured against
a stopwatch, because the ~500 ms Frankfurt hop is still in every number and would
swamp all of it. What can be measured without the move has been: query counts,
bundle counts, and the build's own route table.

**Next session starts at 1.1**, deleting old Vercel deployments — still what
blocks deploys, and Phase 5 needs a deploy before its 8 GB shows up on the
Functions Storage line.

---

### 1.2 The Atlas move — **depends on the company Atlas account existing**

Target pair: **Atlas Free (M0) in AWS `ap-south-1` (Mumbai) + Vercel
`"regions": ["bom1"]`**, co-located.

Mumbai is the nearest region to Nepal at ~40–60 ms from Kathmandu, against
~90–110 ms to Singapore, ~150–180 ms to Frankfurt and ~250–300 ms to Washington.
Vercel's `bom1` is the same AWS region, which takes the function↔database hop to
~1–2 ms.

> The AWS reference table at `mongodb.com/docs/atlas/reference/amazon-aws/`
> lists `ap-south-1` as M10+ only. **It is wrong, or at least stale** — the live
> Deploy-your-cluster form offers Mumbai on the Free tier and marks it
> _Recommended_. Trust the form. Singapore (`ap-southeast-1` + `sin1`) is the
> fallback if Mumbai is ever unavailable at creation time.

> **Measured 2026-09-19 from Kathmandu**, driver `ping`, median of 7: Frankfurt
> **190 ms**, Mumbai **60 ms**. 3.2× per round trip before the functions move at
> all. This is the number to re-check after the cutover.

- [x] New Atlas **project** under the company Google account. M0 is one free
      cluster per project, so the existing personal project cannot hold it.
      — done: "Softmato's Org" / Project 0, cluster `cluster0`.
- [x] Create the Free cluster in **AWS `ap-south-1`**. Two things on that form:
      **uncheck "Preload sample dataset"** — it seeds Atlas's demo collections,
      which pollutes production and trips the compare script's "target was not
      empty" check for a real reason — and **name it properly**, because the name
      cannot be changed after creation (the current one is `Cluster0` by default;
      the old personal one is `base` in "Project 0"). "Automate security setup"
      is fine to leave on: it creates the DB user and allowlists your current IP,
      and the `0.0.0.0/0` rule below is still needed on top of it.
- [x] **Drop the `sample_*` databases.** The sample dataset loaded despite the
      checkbox. It lands in its own databases, so `hostelpalika` stays clean and the
      migration is unaffected — but the full set is ~350 MB against a 512 MB
      tier, which leaves no room to grow. Wait for the load to finish first, or
      the loader recreates what you drop.
      — done. The Atlas Data Explorer on 2026-09-20 lists `admin` and `local`
      and nothing else, and the cluster is showing the "Load sample data" prompt
      that only appears with no user data on it. Full 512 MB available.
- [x] Network Access → allow `0.0.0.0/0`. Vercel Hobby has no static egress IPs.
      The allowlist entry Atlas created covers this machine only, which is why
      the scripts already connect.
      — done 2026-09-20, alongside the auto-setup `/32` entry, which is harmless
      to leave.
- [x] Create the database user. Put the new URI in the root `.env` as
      `MONGODB_URI_TARGET` for now — **do not** replace `MONGODB_URI` yet.
      — done, with `/hostelpalika?retryWrites=true&w=majority` appended. Two
      traps: the URI Atlas hands you carries **no database name** and would
      silently use `test`, and the database is named `hostelpalika`, not
      `hostelhub` — the rename starts here, on the one cluster where it is free.
- [x] Drop the empty `users` collection created by hand in the Atlas UI.
      `migrate-cluster.mjs` refuses a non-empty target, and it is right to:
      the check exists so a half-seeded cluster is never migrated into.
      — done, same screenshot: there is no `hostelpalika` database on the target
      at all. **The target is now in the exact state the migration requires**, so
      the only thing standing between here and the copy is the allowlist below.
- [~] ~~Pause the cron-job.org jobs.~~ **The user decided on 2026-09-19 to leave
  all 17 running.** Recorded so nobody re-proposes it. The exposure: between
  the copy finishing and Vercel being redeployed, the live site still writes
  to Frankfurt, so anything a cron writes in that window (`billing-cycle`
  raising invoices, `payment-reminders`, `ledger-drift`, `account-purge`,
  `hostel-purge`) is copied nowhere. Accepted because the copy itself is
  seconds at this size. **The mitigation is already in this list and is not
  optional now:** re-run `compare:clusters` against the old cluster _after_
  the switch — a cron that wrote during the window shows up as a count
  difference, which turns a silent loss into a visible one. Pick a quiet
  Nepal hour and keep copy→redeploy short. See `CRON.md`.
- [x] Copy the data: `npm run web:migrate:cluster` (`--dry-run` first).
      This uses the driver rather than `mongodump`/`mongorestore`, which are a
      separate install and not on this machine. Safe here because the source was
      checked and is **111 plain collections, ~2,265 documents, no views, no
      timeseries, no capped collections, no per-collection options** — and
      because a driver-to-driver copy never serialises to JSON, so BSON types
      survive. Indexes are copied explicitly. It refuses a non-empty target.
      Re-check that list before reusing this on a different database.
      — **done 2026-09-20: 111 collections, 2,329 documents, 297 indexes**, dry
      run first and clean. The count moved 2,265 → 2,329 in a day, which is the
      17 crons and normal traffic — and the plainest argument for keeping the
      copy→redeploy window short.
- [x] Verify: `npm run web:compare:clusters -- --target="<new uri>"`.
      Read-only. Compares per-collection document counts and index names, and
      exits non-zero on any difference. **A non-zero exit means do not switch.**
      — done, immediately after the copy. Exit 0, every collection equal on both
      counts and index names: *"Clusters match. Safe to switch MONGODB_URI."*
- [x] Switch `MONGODB_URI` — root `.env` (see `ENVIRONMENT.md`; the root file is
      the single source) **and** Vercel's environment variables.
      — done 2026-09-20, both. Confirmed rather than assumed: `compare:clusters`
      now prints `source db: hostelpalika`, which is the new cluster answering as
      `MONGODB_URI`.

      `compare-clusters.mjs` gained `MONGODB_URI_OLD` as a last-resort fallback
      for `--target`, so the post-cutover check below needs no URI on the command
      line — a production password in shell history is not a good trade for
      saving a variable.

      **Keep the Frankfurt URI, do not overwrite it.** Rename the current
      `MONGODB_URI` to `MONGODB_URI_OLD` and promote `MONGODB_URI_TARGET` into
      `MONGODB_URI`. The last verification step below compares against the old
      cluster, and it cannot if the only copy of that URI was the line you
      replaced. — done that way; `MONGODB_URI_TARGET` no longer exists, and it
      was never read by anything but the two migration scripts.

      > **A Vercel environment variable does not reach a deployment that is
      > already running.** Production keeps writing to Frankfurt until the
      > redeploy below, so setting the variable does not start the clock — the
      > deploy does.
- [x] `vercel.json` → `"regions": ["bom1"]`.
      — done, in `apps/web/vercel.json` (the repo has no root one). Ships with
      the redeploy; it does nothing until then.
- [ ] Redeploy, watch logs. (Nothing to un-pause — the crons were left running
      by the 2026-09-19 decision above.) Two things to watch for in the build
      log: `bom1` being accepted, and the first request confirming the new
      cluster. This deploy also carries every code change in Phases 1–5, so it is
      the point where the ISR overage stops and the ~8 GB of bundle saving starts
      counting.
- [ ] Re-run `compare:clusters` against the old cluster once traffic is on the
      new one, to confirm nothing is still writing to Frankfurt.
      — **already drifting, measured 2026-09-20 before the redeploy**, which is
      the window working exactly as this document predicted:

      | Collection           | Mumbai | Frankfurt |
      | -------------------- | ------ | --------- |
      | `nightstatusprompts` | 96     | **98**    |
      | `pushtickets`        | 84     | **85**    |

      Both are self-healing and neither is worth recovering: a night prompt
      repeats until it is answered, and a push ticket exists to have its receipt
      checked once and then age out. **The reason to keep the window short is the
      collections that are not on this list** — `billing-cycle` raising an
      invoice, or a login writing a session, would not heal themselves.

      Run this again after the deploy and read *which* collections moved, not
      just how many.

      **There is no top-up tool, and `--force` is not one.** It inserts alongside
      what is already there rather than reconciling, so on a populated target it
      duplicates all 2,329 documents. If the post-deploy compare shows a
      collection that matters, that needs a targeted backfill written for it.
- [ ] Delete the Frankfurt cluster — after a few days, not immediately.

**Writes between the dump and the env switch are lost.** Run it at a Nepal
low-traffic hour.

**The app needs no release.** The API base URL (`hostelpalika.com`) does not
change, so every installed copy follows automatically.

**Ceiling this does not lift:** Free/M0 is shared, throttled hardware with no
performance guarantee and **no backups at all** (`Backups Inactive` is not a
setting — the tier does not support them). Production currently has no automated
backup. Either schedule a `mongodump`, or move up a tier: **Flex** (from
~$0.011/hr, capped ~$30/mo) adds daily backups and 5 GB on shared hardware;
**M10** ($0.08/hr) adds dedicated compute, 99.995% uptime SLA, customizable
backups and private networking. Flex is the smallest step that ends the
no-backup problem; M10 is the one that also ends the throttling.

---

## Phase 2 — Cut round trips on the server

Helps the website and the app equally: these shrink the work inside the authed
endpoints the app spends its time waiting on.

- [x] `apps/web/src/lib/hostel-workspace.ts` — wrap `listWorkspaceHostels` in
      React's `cache()`. The admin layout calls it twice per render
      (`canAccessWorkspace`, then `workspaceHostelName`) and issues two identical
      `Hostel.find` queries. Same pattern as `lib/site-config-server.ts`.
      — done. This is also what retires the Phase 4 Suspense item below.
- [x] `modules/platform-config/site-config.service.ts` — TTL memo on
      `getSiteConfig`, ~60s, plus an `invalidateSiteConfigCache()` called from
      the section-save path. `react.cache` only dedups within one request, and
      this is read on every request of every route in every portal. Copy the
      shape already proven in `modules/reports/platform-highlights.service.ts`.
      — done, 60s. `updateSiteConfigSection` is the only writer of a site-config
      section — the booking, operations and store configs use their own
      `PlatformSetting` keys — so one `invalidateSiteConfigCache()` there covers
      every save.
- [x] `modules/reports/report.service.ts` — memo
      `getHostelAdminDashboardReport` per `hostelId`, ~30s. Cheaper than the
      `$facet` rewrite and removes the same nine counts on a hit. The facet only
      matters if one hostel's dashboard is hot.
      — done, 30s, **keyed on the resolved hostel scope rather than
      `query.hostelId`**: a principal who omits the parameter is scoped to every
      hostel they may see, so the id in the request is not what the numbers are
      derived from, and two principals with different access must never collide
      on one entry. `resetHostelAdminDashboardCache()` exists for tests, which
      otherwise assert against the previous case's answer.

Per-instance memos are not shared across Fluid instances, so the hit rate is
good but not guaranteed. That gap — and rate-limit counters, which an
in-process memo genuinely cannot do correctly on serverless — is the only real
argument for Redis. Do not add it before this phase is in and measured.

---

## Phase 3 — Serve the public API from the CDN

Website win. **Not an app win** — the app hits authed endpoints almost
exclusively (`/api/v1/public/files/upload` is the only public one it touches),
and authed responses are per-user and cannot be CDN-cached.

- [x] `lib/api-response.ts` — export a `PUBLIC_CACHE` init:
      `{ headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=600" } }`
      — done; `successResponse` already accepted a `ResponseInit`.
- [~] Apply it to `public/hostels`, `public/hostels/[slug]`, `public/search`,
      `public/service-providers`, `public/site-config`.
      — **three of the five are in**: `public/hostels/[slug]`,
      `public/service-providers` and `public/site-config`.

      `public/hostels` is held by the impression decision immediately below.

      **`public/search` must never get this, and the line above was wrong to list
      it.** The route is `public/search/parse`: a `POST` that reads and writes a
      per-visitor LLM quota cookie. A shared cache entry would hand one visitor's
      remaining quota to the next, and a `POST` is not CDN-cacheable regardless.
      The item is closed, not pending.
- [ ] Decide the listing-impression tradeoff. `public/hostels/route.ts` records
      search appearances in `afterResponse`, and a CDN hit never reaches the
      function, so the owner's performance report will undercount. Either move
      impressions to a client beacon or accept the undercount — **this is a
      product decision, not a technical one.** Do not ship the header until it
      is made.

---

## Phase 4 — Make the click feel instant

The goal this whole document exists for: static chrome paints immediately,
only genuinely dynamic data shows a skeleton.

### Web

- [~] ~~`(hostel-admin)/[hostelSlug]/admin/layout.tsx` — move the hostel name
      into a `<Suspense>` so the shell streams.~~ **Retired by 2.1, not skipped.**
      The two reads were two identical `Hostel.find`s; `cache()` made them one,
      and the one left is the auth gate, which this item already said must block.
      Wrapping the name now would mean widening `PortalShell`'s `workspaceName`
      from a string to a `ReactNode` to stream a value that is already resolved —
      diff with no latency behind it.
- [x] Prefetch on nav hover. Next already prefetches the RSC payload for
      `<Link>`; it does not prefetch TanStack data. Add
      `queryClient.prefetchQuery({ queryKey: resourceKey(url), queryFn: ..., staleTime: 30_000 })`
      on `onMouseEnter` in the portal nav. Mouse travel is 200–400 ms — the
      request lands before the click.
      — done, in `renderLeaf`, the one place every sidebar link renders, on
      `onMouseEnter` **and** `onFocus` so keyboard navigation gets it too.

      **The href→endpoint mapping is learned, not declared.** `usePortalResource`
      records which endpoints each pathname actually read, and the hover reads
      that back. A declared table would need an entry per nav item and would go
      stale silently the first time a page changed what it fetches, while a
      missing hint here costs only the fetch that was going to happen anyway.
- [x] `components/query-provider.tsx` — hydrate from `sessionStorage` on mount,
      `dehydrate` on `pagehide`. `@tanstack/react-query` already exports both;
      no new dependency. **`sessionStorage`, not `localStorage`** — it dies with
      the tab, so a shared hostel-office PC does not hand one account's roster to
      the next. Must also clear on logout.
      — done. Hydration runs in an effect, not during render: the server HTML has
      no cached data, so filling the cache before the first paint is a hydration
      mismatch. Saved on `pagehide` rather than `beforeunload` — that is the one
      that fires on mobile and on entering the bfcache.

      The logout clear is **one function, not three call sites**. Three components
      had their own `fetch("/api/v1/auth/logout")`; all three now go through
      `lib/sign-out.ts`, so a fourth sign-out button added later cannot forget to
      drop the cache.

### App

- [x] Move the store screens onto the query cache. These use `useResource` with
      no cache key — no persistence, no warm-up, a cold fetch and a spinner on
      every mount:
      `(store)/index.tsx`, `(store)/cart.tsx`, `(store)/categories.tsx`,
      `(store)/orders.tsx`, `store/category/[slug].tsx`, `store/checkout.tsx`,
      `store/order/[id].tsx`, `store/product/[id].tsx`,
      `components/store/store-cart.tsx`, `app/sos.tsx`,
      `components/admin-moderation.tsx`.
      The store catalogue is the most cacheable data in the product — it has no
      `hostelId` and changes rarely.
      — done. `lib/store-queries.ts` names the eight store reads, the sibling of
      `cook-queries.ts` and `community-queries.ts`. `app/sos.tsx` went into
      `resident-queries.ts` as two `safety` keys, and `admin-moderation.tsx` now
      reads the `admin:moderation:flagged` key the moderation screen was already
      using — so opening the queue from the badge paints what the badge counted.

      **Free-text search deliberately keeps its uncached loader**, on the shop
      front and the category page both. A key per keystroke fills the cache — and
      the disk it persists to — with answers nobody asks twice, evicting the
      catalogue this was done for. The cart is one key shared by the cart screen
      and every header badge, so the two stopped racing.

---

## Phase 5 — Shrink the deployment

Billing item and a cold-start item at once: a smaller bundle starts faster, and
cold starts are what the app pays on any tab the warm-up has not reached.

365 route handlers means 365 function bundles, each carrying its own copy of
mongoose, the models, zod and the service layer.

- [x] Fence `pdf-lib` (22 MB, reached from 14 files including
      `modules/finance/evidence.ts`, which the finance service pulls in widely)
      out of the general trace, then allowlist it back onto the routes that
      render a document. Same `outputFileTracingExcludes` / `-Includes` pattern
      already written for `@napi-rs/canvas` in `next.config.ts` — read its
      comments first, especially the one about `[id]` being a character class in
      a glob.
- [x] Same for `xlsx` (7.8 MB, 3 files).

**Both are in, and the allowlist has a tripwire.** The globs live in
`src/lib/output-tracing.ts`; `next.config.ts` excludes both packages under `**`
and hands them back per route.

Walking the real import graph first was the part that mattered: **135 of the 365
routes reach `pdf-lib`**, because `finance/evidence.ts` and `receipt-pdf.ts` are
pulled in by `finance-notify`, `payment-event.service` and `booking.service`,
which most of the authed surface touches. Hand-globbing that from greps would
have missed routes, and **a missed route is a production 500** — it ships without
the library, the build stays green, and the failure arrives the first time
somebody asks that route for a document.

So `src/lib/output-tracing.test.ts` re-walks the graph on every test run and
fails naming any reaching route the list does not cover. It also fails on a glob
that matches **nothing**, which is the `[id]`-as-character-class trap
`next.config.ts` already warns about. Both assertions were checked by breaking
them on purpose before this was written down.

Measured from the build's own trace manifests
(`.next/server/app/**/route.js.nft.json`), across 372 route bundles:

| Package   | Bundles still carrying it | Bundles freed |
| --------- | ------------------------- | ------------- |
| `pdf-lib` | 132                       | **240**       |
| `xlsx`    | 11                        | **361**       |

---

## Deliberately not doing

- **Redis.** For public data the CDN beats it outright — zero function
  invocation against Redis's network hop. Its real job is authed cross-instance
  reads and rate-limit counters. Revisit after Phase 2, with a measurement.
- **PPR / `cacheComponents`.** The right long-term answer to the Phase 4 goal,
  but turning it on makes every uncached dynamic read a build error until it is
  wrapped, across 137 pages. Not while a deploy-blocking storage limit is open.
- **The `$facet` dashboard rewrite.** The memo in Phase 2 gets most of it for a
  fraction of the diff.

---

## Appendix — the `hostelhub` → `hostelpalika` rename (done 2026-09-19)

Recorded here because it rode along with the Atlas move and touches the same
cutover.

**Renamed.** The new database (`hostelpalika`), the web session cookies, every
browser/device storage key, the cross-tab notification-sound channel, the health
probe's service label, and test fixture hostnames.

Cookies and the three storage keys that hold unsaved work are renamed **with a
fallback**, not dropped:

- `lib/auth-cookies.ts` — `readAccessTokenCookie` / `readRefreshTokenCookieValue`
  read the new name, then every older spelling. Every read site goes through
  them; `applySessionCookies` clears the old pair the moment a new one is
  written. Without this the rename is a silent mass logout at the next deploy.
- `lib/storage-rename.ts` — `readRenamedStorage` moves a value from the old key
  to the new one on first read. Used by the public and team hostel-registration
  drafts and the submitted marker, because those are somebody's unfinished work
  and nothing else has a copy.

`lib/auth-cookies.test.ts` covers the fallback. **The fallbacks can be deleted
once every live session has rotated through a refresh** — see
`refreshTokenTtlSeconds()`.

**Deliberately not renamed** (decided with the user):

- `x-hostelhub-client` — the app↔server contract deciding refresh-token
  exposure. Installed app copies keep sending the old header until a Play
  release clears review; changing the server first gives them one refresh and
  then a mystery logout.
- `modules/hostelhub-sound`, `-night-prompt`, `-downloads` and the
  `com.softmato.hostelhub.*` Java packages — renaming changes the native
  fingerprint, which changes `runtimeVersion` and breaks the bound OTA channels.
  Invisible names, real risk. Bundle it with a native release or not at all.
- `source: "hostelhub"` and `utm_source=hostelhub` in
  `modules/questioncall/questioncall.service.ts` — these are sent **to
  QuestionCall**, inside a signed SSO claim and their attribution. An outside
  party's contract, not ours to change unilaterally. Ask them first.
- History notes that quote the old name on purpose (`site-config.defaults.ts`
  on the previous support address, `cook-identity.ts` on the old cook email
  scheme). Rewriting the old value inside a note about the old value makes the
  note claim the opposite of what happened.
