# Mobile — M5 handoff

> **M5 IS COMPLETE as of 2026-08-17 — all nine work items are built and ticked.**
> This document has served its purpose and is kept for the reasoning in §1–§3, not
> as a work order. **The live tracker is [`MOBILE_APP_PHASES.md`](MOBILE_APP_PHASES.md)
> §M5**, which now carries every decision below plus the five server-side defects
> found while building. What is left in M5 is a device pass and the ⛔ items.

**Written 2026-08-17, mid-milestone, then updated through it.** Everything below is
either *done*, *decided* (build it as written) or *blocked* (named, with what
unblocks it). §3's three traps are all resolved — see the note at the end of that
section.

Read this, then [`MOBILE_APP_PHASES.md`](MOBILE_APP_PHASES.md) §M5 and
[`MOBILE_M6_HANDOFF.md`](MOBILE_M6_HANDOFF.md) §4 (the traps list — it still
applies, especially §4.1 on installing dependencies).

---

## 0. State

| Check, run 2026-08-17 after M5.1 | Result |
|---|---|
| `npm run mobile:typecheck` | clean |
| `npm run mobile:lint` | clean |
| `npm run mobile:test` | **253 passing / 23 files** |
| `expo export --platform android` | bundles (5.7 MB) |

**No device run has happened, in this session or any previous one.** The in-app
Browser pane cannot render React Native, so every `☑` means "typechecks, lints,
tests and bundles", never "seen working on a phone". `adb devices` is empty;
there is one AVD (`Medium_Phone`) if you want to try an emulator. **A device
build was not started** — it was raised as something to run in parallel, and it
did not happen, so treat the whole app as unrun.

### Files added by M5.1

```
src/lib/safety-api.ts        SOS + emergency contacts (typed off safety.service.ts)
src/lib/sos.ts               pure: describeFanout, message validation  ← 10 tests
src/lib/sos.test.ts
src/hooks/use-sos.ts         the one arm → countdown → send → report pipeline
src/components/sos-overlay.tsx   presentational: countdown, spinner, outcome
src/components/sos-fab.tsx   the floating button; tap vs long press
src/app/sos.tsx              contacts (tap to call), note, guardian toggle
```

Modified: `src/app/(resident)/_layout.tsx` (renders `<SosFab/>` outside the
navigator), `src/app/_layout.tsx` (registers the `sos` root route),
`docs/MOBILE_APP_PHASES.md` (§1 gaps table + the M5 section).

---

## 1. The endpoint audit — do not skip this section

The milestone was opened on the premise that every endpoint M5 needs already
exists. **Three sub-items have no endpoint at all.** Each is now a row in
`MOBILE_APP_PHASES.md` §1 and marked ⛔ in the M5 checklist.

| Blocked | Evidence | Ship instead |
|---|---|---|
| Night-status **history list** | `NightStatusLogModel` is written on every change (`safety.service.ts:220`) and the `create` is its **only** reference in the repo. No route, no aggregation. | The setter. Do not draw an empty History section. |
| Emergency-contact **add/remove** | `/resident/emergency-contacts` is GET-only; the sole `EmergencyContactModel.create` is inside admin resident creation (`resident.service.ts:789`). | Read-only list. `app/sos.tsx` already does this — its empty state says to ask the hostel office. |
| **Notification preferences** | No `notificationPreference` / `emailNotifications` / `pushEnabled` field on any model. Nothing to read, nothing to write, and nothing for `push.service.ts` to consult. | Theme, account deletion and privacy policy. A client-only toggle would be a lie — the server would keep sending. |

**The rule this codebase already follows, and you should too:** never render a
control the server will ignore, and never render a field nothing writes. An
honest "not yet" row beats a control that silently does nothing, because the
user believes the silent one worked.

---

## 2. What M5.1 decided (don't re-litigate)

- **The countdown runs before the request.** `sosStatusUpdateSchema` is
  admin-only, so only staff can move an alert to `FALSE_ALARM`. Those three
  seconds are the entire undo.
- **A `201` is not success.** `fanOutSOSAlert` catches and swallows its own
  failures so a dead mail provider cannot stop an alert being *recorded*. The
  only evidence anyone heard it is `notified.staff` / `notified.guardians`, and
  `describeFanout` in `lib/sos.ts` is what turns those into words. Zero/zero
  reads "Recorded — but nobody was reached. Call your emergency contacts now."
  If you touch that function, keep the tests that pin the wording.
- **Two gestures on the FAB.** Tap → `/sos`; long press (600ms) → arm with
  guardians included. One tap firing a hostel-wide alert fires it in pockets.
- **One pipeline, two entry points** (`use-sos.ts`), with a ref guard because
  the send is kicked off from an effect.
- The FAB hides on scroll with the rest of the bottom chrome — that is the §0
  shell contract, which names this button specifically.

---

## 3. M5.2 Complaints — ☑ built 2026-08-17

`GET/POST /api/v1/resident/complaints`, `PATCH .../[id]/confirm-resolution`.

**There is no detail endpoint and you do not need one.** `listResidentComplaints`
calls `complaintChildren()` and returns every complaint with its `attachments`
and its full `updates` thread inline. Build the thread view off the list row you
already hold.

`serializeComplaint` returns:
`adminResponse, attachments[], category, confirmedAt?, createdAt?, description,
hostelId, id, isAnonymous, isOverdue, rejectedAt?, residentId, resolvedAt?,
slaBreachedAt?, slaDueAt, status, title, updatedAt?, updates[]`

`serializeUpdate`: `actorId, actorRole, complaintId, createdAt?, hostelId, id,
message, nextStatus?, previousStatus?, type`
`serializeAttachment`: `complaintId, fileAssetId, hostelId, id, uploadedAt,
uploadedBy`

Statuses `PENDING | IN_PROGRESS | RESOLVED | REJECTED`. Categories `FOOD, ROOM,
MAINTENANCE, SAFETY, PAYMENT, STAFF, NOISE, OTHER`.

`complaintCreateSchema`: `title` 2–160, `description` 5–4000, `category`
defaults `OTHER`, `isAnonymous` defaults false, `attachmentAssetIds` **max 5**.

`complaintResolutionConfirmSchema`: `note?` 2–1000. The service **409s with
`COMPLAINT_NOT_RESOLVED`** unless `status === "RESOLVED"` — so only show Confirm
on a resolved complaint, and handle that code.

Three things to watch:

1. **The route ignores query params.** `route.ts` calls
   `listResidentComplaints(principal)` with no second argument, so the default
   `{ page: 1, pageSize: MAX_PAGE_SIZE }` always applies and the client
   **cannot page**. Don't build a paginator against it; either accept the single
   page or add query parsing to the route as a separate, tracked change.
2. **Residents cannot reply.** `complaintReplySchema` exists but its only route
   is the admin one. The thread is read-only for a resident, which matches what
   §M5 asks for (list, create, thread, confirm) — just don't add a reply box.
3. **Attachments are PRIVATE assets.** `lib/uploads.ts`'s `assetUrl(assetId)`
   is the authorising read route and **needs the bearer token**, so a plain
   `<Image source={{ uri }}>` will 401 silently — the same class of failure as
   the relative-photo-URL bug in `827a52c`. Pass the auth header explicitly, or
   check whether `files/[assetId]/url` 302s for this kind the way it does for
   `PUBLIC` assets. **Verify before building the gallery, not after.**

Upload path for the create form: `uploadAsset(asset, { kind: "GENERIC", label })`
from `lib/uploads.ts` → returns an `assetId` for `attachmentAssetIds`. Use
`GENERIC`, not `PAYMENT_PROOF` — the presign route refuses a financial asset
that is not tenant-scoped. Progress renders itself through the always-mounted
`<UploadToaster/>`; do not build a second progress UI.

### How the three traps landed

1. **Pagination** — real, and now a §1 row in `MOBILE_APP_PHASES.md`. No pager is
   drawn; the response is always the newest 100.
2. **No resident reply** — confirmed. No reply box exists.
3. **Private attachments — measured, not assumed.** Against the live bucket: the
   presigned URL serves `200 image/jpeg` bare, and **the same URL carrying an
   `Authorization` header answers `400 InvalidRequest — Missing
   x-amz-content-sha256`**. R2 treats any `Authorization` header as SigV4 and
   stops honouring the query signature. The token therefore has to reach *our*
   route and not the redirect target, which is what
   `privateAssetSource()` in `lib/uploads.ts` assembles — the single place every
   private image in the app now goes through (`food.tsx` was inlining the same
   pattern and was moved onto it). It relies on the native loader stripping
   `Authorization` across a cross-host redirect. **That is the first thing to
   check on the device pass**, and if it fails the fix is server-side: a mode on
   the read route that returns the presigned URL as JSON.

Two more things found while building it, both recorded in the tracker:
`updateComplaintStatus` writes `adminResponse` *and* appends a `STATUS_CHANGE`
update with the same message (render one, not both), and `actorId` on an update is
a `User` id while `complaint.residentId` is a `Resident` id — so authorship comes
from `actorRole`, never from an id comparison that is always false.

---

## 4. The rest of M5, in order

Endpoints verified to exist for all of these.

**All nine are done.** 404 tests / 30 files, Android bundle 5.9 MB, typecheck and
lint clean. Nothing in this table is outstanding except the device pass and the ⛔
sub-items.

**The standing instruction, given by the user on 2026-08-17:** *"each and every
thing you make in the app, we have the website already — be inspired from there
in terms of UI, just make the mobile native UI for those."* So for every
remaining item, read the web component first and carry over its structure,
section order, labels and copy; change only the controls. The ID card is the
worked example — its faces follow `platform-id-card.ts`'s `drawFront`/`drawBack`
and its form follows `resident-identity.tsx`'s eight sections verbatim.
For item 6 that means `apps/web`'s referral UI; for 7, its review form; for 8,
`community-page-content.tsx`.

| # | Item | Endpoint |
|---|---|---|
| ~~3~~ | ☑ Night status *(2026-08-17)* — and note the §1 row it added: the resident route accepts all five enum values, so `SOS_TRIGGERED` is settable with nobody alerted. The client offers three | `GET/POST /resident/night-status` ⛔ no history |
| ~~4~~ | ☑ Profile *(2026-08-17)* — read-only throughout, no Edit button drawn. `ResidentProfile` was already accurate | `GET /resident/profile` ⛔ contacts read-only |
| ~~5~~ | ☑ Digital ID card *(2026-08-17)* — card faces + the 30-field profile form + photo + sharing toggle. One sub-item left open by choice: a rasterised save-to-gallery needs `react-native-view-shot` + `expo-media-library`, i.e. a dev build, which would stop Expo Go running an app nobody has run yet. The QR saves through the share sheet meanwhile | `GET /users/resident-identity` + `/qr` + `/photo`; `PUT` saves, `PATCH` toggles sharing |
| ~~6~~ | ☑ Referrals *(2026-08-17)* — **the share sends the code, not the link**: the web's `/inquiry?ref=` page still ignores `ref`, so the link credits nobody. Now a §1 row; `lib/referrals.ts` names the condition for restoring the link | `GET /resident/referral` (the GET mints the code) |
| ~~7~~ | ☑ Reviews *(2026-08-17)* — star rows instead of the web's number inputs. Two new §1 rows: there is **no `GET /resident/reviews`** (a resident cannot read their own review) and the POST is a **merging `$set` upsert** (a category cannot be cleared). Both stated on the screen in one sentence | `POST /resident/reviews`; 403 `REVIEW_NOT_ALLOWED` unless `ACTIVE`/`MOVED_OUT` |
| ~~8~~ | ☑ Community *(2026-08-17)* — feed, composer, 6 reactions, threads, votes, report, permalink. ⛔ **no anonymous option** (no such field on the schema or model). Two fixes worth knowing: `uploadAsset` now takes `accessLevel` because community media must be `PUBLIC`, and `authorImage` is only rendered when absolute — new §1 row | `GET/POST /community`, `/spaces`, `/[postId]/{comments,reactions,report}`, `/comments/[commentId]/vote` |
| ~~9~~ | ☑ Settings *(2026-08-17)* — theme picker, the ⛔ notification position stated rather than toggled, privacy policy, and the four-pathway deletion panel with the web's `PATHWAY_COPY` verbatim. `SELF_SERVICE` ends the session. `soon()` is now gone from `more.tsx` | Theme is local (`uiSlice`). `GET/POST /users/account-deletion` |

`(resident)/more.tsx` is the entry point for 3–7 and 9: every one of those rows
currently calls `soon()` and toasts "it lands in the next release". Replacing a
`soon()` with a `router.push()` is the last step of each item.

---

## 5. How to work this milestone

Per `MOBILE_APP_PHASES.md`'s own instruction and the project's standing rule:
**one item at a time — write it, verify it, then flip `☐` to `☑` in
`docs/MOBILE_APP_PHASES.md` before starting the next. Do not batch.**

Verification for each item, all four:

```bash
npm run mobile:typecheck && npm run mobile:lint && npm run mobile:test
```

then, from `apps/mobile`:

```bash
./node_modules/.bin/expo export --platform android
```

Use `./node_modules/.bin/expo`, never `npx expo` (npx resolves a global legacy
CLI that rejects Node 17+).

### Conventions that are settled

1. **Read the *service*, not the route name.** Every type in `lib/*-api.ts`
   cites the `apps/web` serializer it mirrors. `finance-api.ts` was once typed
   by guessing from endpoint names and every shape was wrong.
2. **Pure logic lives in `lib/`, never in a screen.** Vitest here is node-side
   with no React Native shim, so anything importing `react-native` — or
   importing a module that does — cannot be tested. That is why `lib/sos.ts`
   holds the wording and `hooks/use-sos.ts` holds the timers.
3. **`useResource` for every GET.** Don't add TanStack Query.
4. **Detail screens go on the root stack** (`app/_layout.tsx`), not inside a
   role's tab group — a folder under a `<Tabs>` layout becomes another tab.
5. **Money and dates through `lib/format.ts`.**
6. **Copy the mockups' layout, never their colours** — the mockups are blue, the
   product is green (`#0a8a4b`). Check `docs/mockups/mobile/README.md` for M5
   screens before designing one from scratch.
7. `react-hooks/set-state-in-effect` traces into the callee: an effect that
   calls a helper is an error if that helper has a synchronous `setState` on any
   path. Both effects in `use-sos.ts` are written around this — copy the shape.

---

## 6. Suggested opening prompt for the next session

> Read `docs/MOBILE_M5_HANDOFF.md`, then continue M5 in the order in §4,
> starting with M5.2 Complaints (§3 has the serializer shapes and three traps
> already found). Work one item at a time: write it, run `mobile:typecheck`,
> `mobile:lint`, `mobile:test` and `expo export --platform android`, then flip
> the `☐` to `☑` in `docs/MOBILE_APP_PHASES.md` before starting the next. Do not
> batch.
>
> Before building the complaint attachment gallery, verify how a PRIVATE
> `FileAsset` is read from the phone — §3 trap 3.
>
> Do not build the three ⛔ items in §1; they have no endpoint. Render them as
> honest "not yet" rows the way `app/sos.tsx` does for emergency contacts.
