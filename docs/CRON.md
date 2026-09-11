# CRON.md — Scheduled jobs (cron-job.org)

16 jobs. Each block below gives you exactly what to paste into the cron-job.org form.

## Same on every job

| Field | Tab | Value |
| --- | --- | --- |
| Request method | Advanced | `POST` |
| Headers → Add → Key | Advanced | `x-cron-secret` |
| Headers → Add → Value | Advanced | the `CRON_SECRET` value from Vercel → Settings → Environment Variables |
| Time zone | Advanced | `Asia/Kathmandu` |
| Request body | Advanced | empty |
| Timeout | Advanced | `30` seconds |
| Requires HTTP authentication | Advanced | off |
| Enable job | Common | on |
| Save responses in job history | Common | on |
| Notify me when execution fails | Common | on |
| Execution schedule | Common | pick **Custom**, paste the crontab from the job's block |

All times are **Nepal time**, which is why the time zone must be `Asia/Kathmandu`.

---

## 1. Gateway expiry sweep

- Title: `Gateway expiry sweep`
- URL: `https://hostel-management-software-web.vercel.app/api/v1/cron/gateway-expiry-sweep`
- Method: `POST`
- Header: `x-cron-secret`: `<CRON_SECRET>`
- Crontab: `*/5 * * * *` (every 5 minutes)

## 2. Notification dispatch

- Title: `Notification dispatch`
- URL: `https://hostel-management-software-web.vercel.app/api/v1/cron/notification-dispatch`
- Method: `POST`
- Header: `x-cron-secret`: `<CRON_SECRET>`
- Crontab: `*/15 * * * *` (every 15 minutes)

## 3. Meal call reminders

- Title: `Meal call reminders`
- URL: `https://hostel-management-software-web.vercel.app/api/v1/cron/meal-call-reminders`
- Method: `POST`
- Header: `x-cron-secret`: `<CRON_SECRET>`
- Crontab: `*/15 * * * *` (every 15 minutes, never slower)

## 4. Night status prompt

- Title: `Night status prompt`
- URL: `https://hostel-management-software-web.vercel.app/api/v1/cron/night-status-prompt`
- Method: `POST`
- Header: `x-cron-secret`: `<CRON_SECRET>`
- Crontab: `*/15 * * * *` (every 15 minutes, never slower)

## 5. Push receipts

- Title: `Push receipts`
- URL: `https://hostel-management-software-web.vercel.app/api/v1/cron/push-receipts`
- Method: `POST`
- Header: `x-cron-secret`: `<CRON_SECRET>`
- Crontab: `0 * * * *` (every hour, on the hour)

## 6. Refresh nearby places

- Title: `Refresh nearby places`
- URL: `https://hostel-management-software-web.vercel.app/api/v1/cron/refresh-nearby-places`
- Method: `POST`
- Header: `x-cron-secret`: `<CRON_SECRET>`
- Crontab: `0 * * * *` (every hour, on the hour)

## 7. Billing cycle

- Title: `Billing cycle`
- URL: `https://hostel-management-software-web.vercel.app/api/v1/cron/billing-cycle`
- Method: `POST`
- Header: `x-cron-secret`: `<CRON_SECRET>`
- Crontab: `15 0 * * *` (every day at 00:15)

## 8. Payment reminders

- Title: `Payment reminders`
- URL: `https://hostel-management-software-web.vercel.app/api/v1/cron/payment-reminders`
- Method: `POST`
- Header: `x-cron-secret`: `<CRON_SECRET>`
- Crontab: `45 7 * * *` (every day at 07:45)

## 9. Purge expired OTPs

- Title: `Purge expired OTPs`
- URL: `https://hostel-management-software-web.vercel.app/api/v1/cron/purge-expired-otps`
- Method: `POST`
- Header: `x-cron-secret`: `<CRON_SECRET>`
- Crontab: `45 8 * * *` (every day at 08:45)

## 10. Account purge

- Title: `Account purge`
- URL: `https://hostel-management-software-web.vercel.app/api/v1/cron/account-purge`
- Method: `POST`
- Header: `x-cron-secret`: `<CRON_SECRET>`
- Crontab: `45 8 * * *` (every day at 08:45)

## 11. Hostel purge

- Title: `Hostel purge`
- URL: `https://hostel-management-software-web.vercel.app/api/v1/cron/hostel-purge`
- Method: `POST`
- Header: `x-cron-secret`: `<CRON_SECRET>`
- Crontab: `45 8 * * *` (every day at 08:45)

## 12. Ledger drift

- Title: `Ledger drift`
- URL: `https://hostel-management-software-web.vercel.app/api/v1/cron/ledger-drift`
- Method: `POST`
- Header: `x-cron-secret`: `<CRON_SECRET>`
- Crontab: `45 8 * * *` (every day at 08:45)

## 13. Complaint SLA

- Title: `Complaint SLA`
- URL: `https://hostel-management-software-web.vercel.app/api/v1/cron/complaint-sla`
- Method: `POST`
- Header: `x-cron-secret`: `<CRON_SECRET>`
- Crontab: `45 9 * * *` (every day at 09:45)

## 14. Attendance maintenance

- Title: `Attendance maintenance`
- URL: `https://hostel-management-software-web.vercel.app/api/v1/cron/attendance-maintenance`
- Method: `POST`
- Header: `x-cron-secret`: `<CRON_SECRET>`
- Crontab: `45 10 * * *` (every day at 10:45)

## 15. Gateway health

- Title: `Gateway health`
- URL: `https://hostel-management-software-web.vercel.app/api/v1/cron/gateway-health`
- Method: `POST`
- Header: `x-cron-secret`: `<CRON_SECRET>`
- Crontab: `15 12 * * *` (every day at 12:15)

## 16. Gateway settlement recon

- Title: `Gateway settlement recon`
- URL: `https://hostel-management-software-web.vercel.app/api/v1/cron/gateway-settlement-recon`
- Method: `POST`
- Header: `x-cron-secret`: `<CRON_SECRET>`
- Crontab: `45 9 * * 1` (every Monday at 09:45)

---

**Billing cycle runs daily on purpose.** Rent is billed per Bikram Sambat month,
and a BS month doesn't start on a fixed Gregorian date. A run just after Nepal
midnight bills each month on its first day. Every other day's run answers
`ALREADY_BILLED` and changes nothing.

## Check it works

Press **TEST RUN** after creating each job.

| Response | Meaning |
| --- | --- |
| `200` | Working |
| `401 UNAUTHORIZED` | Header key or value is wrong |
| `500 CRON_NOT_CONFIGURED` | `CRON_SECRET` isn't set in Vercel. Add it and redeploy |
| `405` | Method isn't `POST` |

The auth check is in [`apps/web/src/lib/cron-auth.ts`](../apps/web/src/lib/cron-auth.ts). A new
cron route uses `validateCronRequest` and gets a block above.
