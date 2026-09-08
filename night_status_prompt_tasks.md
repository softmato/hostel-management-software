# Attendance & Night Status — the nightly prompt

The feature is called **Attendance** (the geofence zone reading) and **Night
Status** (what the resident says about their own night). Both names stay. The
one stray string calling it "Night Roll" gets corrected, and so do the
warden-facing "Roll call" labels, so the product says one thing everywhere.

Read this top to bottom. Code an item, verify it, flip its ☐ to ☑ before the
next one.

---

## What already exists — do not rebuild any of it

- `NightStatus` — one current row per resident (`INSIDE_HOSTEL`,
  `OUTSIDE_HOSTEL`, `NOT_VERIFIED`, `MARKED_SAFE`, `SOS_TRIGGERED`), plus
  `NightStatusLog` for every change.
- `GET`/`POST /api/v1/resident/night-status`, `GET /api/v1/hostel-admin/night-status`,
  `POST /api/v1/hostel-admin/night-status/[residentId]/override`.
- Mobile `app/night-status.tsx`, `app/manage/roll-call.tsx`, `lib/night-status.ts`
  (which already owns the 17:00 night boundary), `lib/roll-call.ts`.
- Web `/resident/night-status`, `/hostel-admin/night-status`.

What is missing is the thing the owner actually asked for: **nobody is ever
asked.** A resident has to remember, open the app, and go to a screen. So the
board fills up with `NOT_VERIFIED` and the warden does the round by hand anyway.

---

## What is being added

At the hostel's own hour (default **20:00**, changed by a warden from **either**
the app or the web — it is one field on one settings document, so one edit moves
both) every resident who has not already answered gets one notification:

> **Are you in the hostel tonight?**
> `Inside`  ·  `At home`  ·  `Outside…`

- **Inside** — one tap. Recorded `INSIDE_HOSTEL`. The app never opens.
- **At home** — one tap. Recorded `OUTSIDE_HOSTEL`, reason already filled in.
  The app never opens.
- **Outside…** — opens the notification's own inline text field, the same
  control WhatsApp's *Reply* uses (Android `RemoteInput`, iOS
  `UNTextInputNotificationAction`). They type where they are and send. The app
  never opens.

### The one place the OS says no

A notification can show buttons and **one** free-text field. It cannot show a
dropdown, a chip row or a radio list — not on Android, not on iOS. So the
"already-made options" become **the buttons themselves**: `At home` is the
preset, `Outside…` is the custom typeable field. The full preset list —
`At home`, `At a friend's`, `Travelling`, `Working late`, `Hospital` — lives on
the in-app screen and the bell row, neither of which is bound by the shade's
layout.

That is a platform limit, and the only one in this whole feature.

### Where the answer goes when the app is dead

| | app open | backgrounded | force-quit / never opened |
|---|---|---|---|
| **Android** | posts now | posts now | **posts now** — `registerTaskAsync` runs the handler headless |
| **iOS** | posts now | posts now | queued on disk, flushed on next open |

The Android row is the feature and it has no caveat. The iOS force-quit cell is
an `expo-notifications` limit — its background task is documented as running for
action taps *on Android only*. Item 12 closes it with a native `didReceive`
handler in the iOS AppDelegate, which iOS **does** call after a force-quit.
Until then no answer is ever lost, only delayed: the queue is written before the
notification is dismissed.

---

## Items

### Shared

- ☑ 1. `packages/shared/src/night/night-window.ts` — the 17:00 night key, moved
  out of `apps/mobile/src/lib/night-status.ts` so the cron, the board and the app
  agree on which night an answer belongs to. Metro alias `@hostel/night/*`
  beside the existing `@hostel/food/*`, plus the vitest alias.

### Data

- ☑ 2. `HostelSettings.attendance.nightStatus` — `{promptEnabled, promptTime,
  remindAfterMinutes}`, defaults `false` / `"20:00"` / `0`. One document, one
  field: this is the "single source" the owner asked for.
- ☑ 3. `NightStatus` gains `night` (`YYYY-MM-DD`) and `reasonCode`, so a status
  can be read as *tonight's* answer rather than the last answer ever given.
- ☑ 4. `packages/db/src/models/NightStatusPrompt.ts` — the per-hostel-per-night
  claim row that stops a retried cron run buzzing a hostel twice.

### Server

- ☑ 5. `push.service.ts` carries `categoryId` through to Expo.
- ☑ 6. `night-status-prompt.service.ts` — who is due this run, claim, send.
  Window arithmetic pure and tested.
- ☑ 7. `POST /api/v1/cron/night-status-prompt` + `docs/CRON.md` entry.
- ☑ 8. `safety.service.ts` / `safety.validation.ts` accept `reasonCode`, stamp
  `night`, and treat a stale `night` as `NOT_VERIFIED` on the board.
- ☑ 9. Attendance settings validation + service accept the `nightStatus` block.

### Mobile

- ☑ 10. `lib/night-status-notification.ts` — the category and its three actions,
  action-identifier parsing, and a submit that runs with no React tree above it.
- ☑ 11. `lib/night-status-queue.ts` — disk queue and flush on foreground.
- ☑ 12. `index.js` entry defining and registering the background task before
  `expo-router/entry`; `package.json main` pointed at it. **Android only** —
  see item 19.
- ☑ 13. Register the category at push registration; `NIGHT_STATUS` push routing.
- ☑ 14. Preset reasons on `app/night-status.tsx`.
- ☑ 15. Prompt-time editor in `app/manage/settings.tsx`.

### Web

- ☑ 16. Prompt-time editor on the hostel-admin settings/night-status page.

### Naming

- ☑ 17. `"Daily Attendance & Night Roll"` → `"Daily Attendance & Night Status"`;
  warden-facing `Roll call` → `Night status`.

### Still open

- ☐ 19. **iOS force-quit.** `expo-notifications` runs its background task for an
  action tap on Android only, so on a force-quit iPhone the answer is queued and
  flushed on next open rather than posted immediately. Closing it means a native
  `userNotificationCenter(_:didReceive:withCompletionHandler:)` in the iOS
  AppDelegate that posts directly — iOS *does* relaunch the app in the
  background for that. `apps/mobile/ios/` is not prebuilt yet, so this waits on
  the first iOS build. Nothing is lost in the meantime; only delayed.

- ☐ 20. **A native rebuild is required before any of this runs on a phone.**
  `expo-task-manager` is a native module and the entry point moved, so EAS
  Update cannot ship this — it needs `expo run:android` or an EAS build.

- ☐ 21. **Turn the prompt on for a hostel.** It ships off by default. Settings →
  Night status → toggle, and pick the hour.

- ☐ 22. **Register the cron job** on cron-job.org: `POST
  /api/v1/cron/night-status-prompt`, `*/15 * * * *`, `x-cron-secret` header.
  Without it nothing is ever sent. See `docs/CRON.md`.

### Close-out

- ☐ 18. Verify on the handset: prompt arrives, all three buttons answer with the
  app force-quit, board updates.
