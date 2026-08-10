# CRON.md — Scheduled Jobs

This project runs scheduled maintenance via **[cron-job.org](https://cron-job.org)** (external
scheduler), not Vercel Cron. Each cron endpoint is a normal API route protected by a shared secret.

## Authentication

Cron endpoints authorize with the `CRON_SECRET` env var, sent in a **header only** — never a
`?key=` query param (a secret in a URL leaks into access logs, CDN/proxy logs, browser history, and
the `Referer` header of outbound navigations). Comparison is timing-safe. Helper:
[`apps/web/src/lib/cron-auth.ts`](../apps/web/src/lib/cron-auth.ts) → `validateCronRequest(request)`.

Send the secret as either:

- `x-cron-secret: <CRON_SECRET>`  ← use this on cron-job.org
- `Authorization: Bearer <CRON_SECRET>`

Set `CRON_SECRET` in the deployed environment (a long random string; rotate before production —
the dev value in `.env` is a placeholder).

## Endpoints

### Purge expired OTP challenges

`POST /api/v1/cron/purge-expired-otps`

Deletes `OtpChallenge` documents whose `expiresAt` has passed. The collection also has a TTL index,
so this is an explicit backup sweep (MongoDB's TTL monitor runs on its own ~60s cadence and can lag
under load). Idempotent. Returns `{ deleted: <count> }`.

- Recommended schedule: daily (e.g. `0 3 * * *`).

### Refresh nearby places

`POST /api/v1/cron/refresh-nearby-places`

Re-fetches stale or missing nearby-place caches for published hostels (ARCHITECTURE.md §4.5).
Processes a small batch per run to respect the Nominatim/Overpass rate limits, so caches fill in
over several runs. Idempotent.

- Recommended schedule: hourly (e.g. `0 * * * *`).

### Monthly billing cycle

`POST /api/v1/cron/billing-cycle`

Issues the month's `Invoice` rows for every hostel — the single billing path of
FINANCE_IMPLEMENTATION_PLAN.md item 2.5 (target §6.1), replacing the three that
disagreed with each other. Amounts come from the hostel's `FeeSchedule` and the
per-resident override, prorated for mid-month move-ins **and move-outs**; nothing
is guessed and nothing is billed as a silent zero.

Idempotent: the double-billing index makes a second run a no-op, so a retried or
double-scheduled invocation cannot bill anyone twice. Accepts `?period=YYYY-MM`
to re-run a specific month; defaults to the current one in UTC.

Returns `{ period, invoicesIssued, totalBilled, hostels, failedHostels }`. **Read
`failedHostels`.** A hostel whose room types do not map to a bed type has no fee
schedule and fails here by design (plan §7.3) — that is a data problem to fix in
the fee editor, not a run to ignore, and one hostel's failure never stops the
others.

- Recommended schedule: monthly on the 1st, early morning (e.g. `0 1 1 * *`).

### Payment reminders and overdue chases

`POST /api/v1/cron/payment-reminders`

Walks open payments across every hostel (PHASES.md §3.1 "Payment System") and:

- sends one reminder at or inside `paymentReminderDaysBefore` days before the due
  date (platform setting `operations`, default 3);
- flips past-due invoices to `OVERDUE` and climbs a **terminating** ladder:
  first overdue notice → second at day 3 → up to four weekly chases → escalation
  to the hostel's admins → stop. After the stop the software never contacts the
  resident about that invoice again;
- writes an in-app `Notification` in every case, whether or not payment email is
  switched on.

**The stage is recorded per invoice, not computed from today's date**
(FINANCE_IMPLEMENTATION_PLAN.md item 5.2, target §10.3). The job this replaced
compared the day offset to an exact number, so one missed run skipped that
resident permanently and silently. A late run now still climbs the rung it
missed, and a second run the same day does nothing. A failed send does not
advance the stage, so it is retried rather than skipped.

Returns `{ scanned, reminded, overdueNotified, markedOverdue, escalated, stopped }`
and writes a `ReconciliationRun` of kind `DUNNING` — the old version returned
statistics to nobody, which is why a job that had stopped working looked exactly
like a month when everyone paid on time.

- Recommended schedule: daily, early morning local time (e.g. `0 2 * * *`).

### Ledger drift check

`POST /api/v1/cron/ledger-drift`

Verifies that the finance ledger still agrees with itself, per hostel
(FINANCE_IMPLEMENTATION_PLAN.md item 5.1, target §10.1). Six checks: a stored
`InvoiceBalance` that disagrees with the sum of its settled events, an invoice
status that disagrees with its balance, an invoice marked `PAID` whose events sum
short, a settled credit with no live receipt, a live receipt with no settled
event, a `PENDING` event past its expiry that was never swept — plus a
verification of the finance audit hash chain.

**It reports and never corrects, and that is deliberate.** A drift means
something wrote where it should not have; recomputing the projection would erase
the only evidence that path exists. Every finding is a row on a
`ReconciliationRun`, one run per hostel, so a job that has been throwing for a
fortnight is visible rather than silent. `WARN` means it found something,
`FAIL` means the job itself broke — one hostel's failure never stops the others.

Read-only, therefore safe to run at any time and as often as you like. Returns
`{ scanned, findings, hostels }`.

- Recommended schedule: nightly (e.g. `0 3 * * *`).

### Complaint SLA breach check

`POST /api/v1/cron/complaint-sla`

Finds complaints that are still open (`PENDING` / `IN_PROGRESS`) and past `slaDueAt`, stamps
`slaBreachedAt`, and alerts the hostel's admins by email plus an in-app `Notification`
(PHASES.md §4.1). The SLA window itself comes from the `operations` setting `complaintSlaHours`
(default 72) and is applied when the complaint is filed.

Idempotent by construction: the job only selects complaints where `slaBreachedAt` is missing, so a
breached complaint is alerted exactly once no matter how often the job runs. Returns
`{ flagged, hostelsNotified, scanned }`.

- Recommended schedule: daily (e.g. `0 4 * * *`).

### Attendance maintenance (absence alerts + retention purge)

`POST /api/v1/cron/attendance-maintenance`

For every hostel with `attendance.enabled`, this job does two things (PHASES.md §4.1,
PRIVACY_POLICY.md):

1. **Absence alerts** — counts each active resident's consecutive absent days (`OUTSIDE`,
   `UNKNOWN`, or no reading at all) and opens an `AttendanceAlert` once the streak reaches the
   hostel's `absenceAlertDays` (default 14). An alert already open is updated with the new day
   count rather than re-raised, and a resident who is seen again has their alert auto-resolved.
2. **Retention purge** — deletes `AttendanceLog` rows older than the hostel's `retentionDays`
   (default 600, platform maximum 1095).

Returns `{ alertsRaised, alertsUpdated, hostelsProcessed, logsPurged }`.

- Recommended schedule: daily (e.g. `0 5 * * *`).

### Account deletion purge

`POST /api/v1/cron/account-purge`

Permanently erases accounts whose 60-day grace period has run out (ARCHITECTURE.md §13.1
step 4, PRIVACY_POLICY.md §8.3).

A request qualifies only when `scheduledDeletionAt` is set **and** past, and it is neither
cancelled nor already executed. A `PLATFORM_REVIEW` request that no superadmin has approved
has no `scheduledDeletionAt` at all, so this job can never pick one up by accident.

Each account is purged first and marked `executed` afterwards, so a crash part-way through
leaves the request due and the next run finishes it. One account failing does not strand the
rest of the batch. Returns `{ due, failed, purged }`.

- Recommended schedule: daily (e.g. `0 3 * * *`).

### Dispatch scheduled notifications

`POST /api/v1/cron/notification-dispatch`

Sends every `NotificationCampaign` whose `scheduledFor` has passed and is still `SCHEDULED`
(PHASES.md §5.1). A campaign written without a `scheduledFor` never reaches this job — it fans out
in the request that created it.

Each campaign is **claimed** first: the job flips it out of `SCHEDULED` with a conditional update
before writing any receipts, so two overlapping runs cannot deliver the same broadcast twice. A
campaign whose fan-out throws is marked `FAILED` with the reason rather than retried forever.

Returns `{ dispatched, failed, recipients, scanned }`.

- Recommended schedule: every 15 minutes (e.g. `*/15 * * * *`). The interval is the worst-case
  delay between the time an admin picked and the notification landing, so pick it to taste — the
  job is cheap when nothing is due.

> **Note on the `operations` platform setting.** Several runtime knobs live in a single
> `PlatformSetting` document keyed `operations`: `qrActivationExpiryDays`,
> `paymentReminderDaysBefore`, `foodReadyCooldownMinutes`, `complaintSlaHours`,
> `sendNoticeEmails`, `sendPaymentEmails`, `sendComplaintEmails`, `receiptNumberPrefix`, and the
> Phase 5 ceilings `maxInsideZoneRadiusMeters`, `maxNearbyZoneRadiusMeters`,
> `maxAttendanceRetentionDays`. Reads never throw — a missing or malformed document falls back to
> the shipped defaults. Writes go through `PUT /api/v1/platform/operations-config` (superadmin
> only), which *does* throw on an invalid value so the person editing sees it.

> Per-hostel attendance settings (geofence radii, ping times, alert threshold, retention) live on
> `HostelSettings.attendance` instead, because they are a property of the building, not the
> platform.

> Later phases add more cron jobs here (soft-deleted account purge). Each one reuses
> `validateCronRequest` and is added to this list.

## cron-job.org setup (per job)

- **Method:** `POST`
- **URL:** the deployed endpoint, e.g. `https://your-domain.com/api/v1/cron/purge-expired-otps`
  (no query parameters)
- **Headers:** add `x-cron-secret` with the value of the deployed `CRON_SECRET`
  (cron-job.org: job → *Advanced* → *Headers*)
- **Body:** none
- **Schedule:** as listed per endpoint above

## Troubleshooting `Unauthorized` / `500`

1. `500 CRON_NOT_CONFIGURED` → `CRON_SECRET` is not set in the deployed environment.
2. `401 UNAUTHORIZED` → the header value doesn't match the deployed `CRON_SECRET`, or you're calling
   the wrong domain, or the job still uses a retired `?key=` query param instead of the header.
3. Confirm the method is `POST`.
