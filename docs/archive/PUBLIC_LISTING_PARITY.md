# The public hostel page shows what registration collected

A hostel filed by a team agent goes live thinner than the reference listing
(Education Light Hostel), even though the agent collected more. Two separate
causes, neither of them the registration form's fault.

## Cause 1 — the sections were deleted

Commit `219b117` ("feat(finance): add manage rate history screen…") removed
**Rooms & Pricing** and **Food** from `public-hostel-detail-page.tsx`, along with
their two tabs and the per-room detail sheet. It is a mobile-finance commit that
took the public listing's two data-richest sections with it.

Everything those sections read is still collected, still stored, still served:
`getPublicHostelBySlug` returns `roomConfigurations`, `pricing`, `food` and the
whole `foodRoutine`, and `/compare` renders the routine today. The hostel's own
Food & Menu screen shows the full week. Only the public page — the one page a
prospective resident reads — shows none of it.

## Cause 2 — no registration path ever geocodes

`geocodeAndCacheHostel` is called from exactly two places: the hostel admin's
profile save, and the nightly sweep. Neither runs when a hostel is published, so
a team-registered hostel has `location.lat = null` and `nearbyPlaces = []` on the
day it goes live. The public page falls back to a dashed box reading "The exact
location appears once the hostel admin saves an address" and three hardcoded
bullets about campus access — which is the listing telling a visitor that nobody
has finished setting this hostel up.

The team form makes it worse by design: it collects a maps link as a *string*,
hinting "We store the link, not coordinates", while `LocationPicker` and
`parseMapLink` already resolve exactly that link into a pin on the admin's own
profile screen.

---

## Work

Tick an item only after it is written and verified.

- [x] 1 `locationSource` joins `lat`/`lng` on the registration contract, so a
      pin an agent placed is stored as MANUAL and the geocoder never drags it
      back to the neighbourhood centroid
- [x] 2 Publishing geocodes. Both registration paths (team submit, public
      approval) call `geocodeAndCacheHostel` best-effort, so the map and the
      nearby list exist on the first page view rather than after the next sweep
- [x] 3 The team form's "Where it is" step uses `LocationPicker` — paste the
      link, search, use my location, or drag the pin — instead of a text box
      that throws the coordinates away
- [x] 4 A backfill for hostels already published without a pin
- [x] 5 Rooms & Pricing restored on the public page: one card per submitted room
      configuration, its own photos, rent, beds per room, vacancy, meals. No
      interpolated rent and no facility chips masquerading as room features —
      both were in the deleted version and both were guesses
- [x] 6 Food restored: the week as a table, the food facts as chips, noted meals
      and the month-end special
- [x] 7 The Location block reads honestly — landmark, the owner's maps link, and
      an empty state that does not invent nearby amenities
- [x] 8 The app's hostel page gets the same two sections, in phone shape

---

## Verified

**Web** — `apps/web`: 2508 tests across 173 files, green. Typecheck and lint
clean on everything touched.

**App** — `apps/mobile`: 1393 tests across 85 files, green, including the 13 new
ones in `hostel-food.test.ts`. The routine's day grouping, the Sunday-first
order, the meal order within a day, the empty-day drop and the today-or-first
fallback are all pinned there rather than left to the screen.

**End to end, against a running server** — `check:team-registration`, now 35
assertions (was 33). The two new ones send a pin with the registration and read
the stored hostel back:

```
PASS  the agent's pin was stored — 27.6892, 85.3435
PASS  publishing left the manual pin where the agent put it — MANUAL
```

That second one is the whole point of `locationSource`: publishing now geocodes,
and a geocode that overwrote a hand-placed pin would move every team-registered
hostel off its own building on the day it went live.

**In the browser** — `study-sanjal-hostel-narephat`, the hostel this started
from, now renders Rooms & Pricing (rent, beds per room, rooms, vacancy, meals,
admission fee), the full seven-day routine with timings, its landmark, an "Open
in Maps" link and a real map. The per-room sheet opens with that room's facts and
a call button.

### What is still thin, and why it is not ours

`nearbyPlaces` is empty for this hostel, so the Location panel says the list is
still being built rather than inventing three amenities as it used to. Every
Overpass mirror is refusing from here — `overpass-api.de` answers 504 ("too
busy", its documented overload response) and the two fallbacks do not connect at
all. `fetchNearbyPlaces` returns null rather than an empty array for exactly this
case, so nothing is cached, the hostel stays on the sweep's list, and the next
run picks it up. Re-run `backfill:hostel-map-pins -- --apply` when the mirrors
are back.

That outage is also why every upstream map call is now bounded
(`lib/maps/upstream-fetch.ts`). `fetch` has no timeout, and these calls used to
run only from a profile save and a cron where a hang was survivable. Publishing a
hostel now geocodes, and a team agent standing in a lobby having just taken an
owner's money must not watch the submit spin because a free OpenStreetMap mirror
in Germany is busy.

### Not verified in the browser

The team form's new map pin, and the app's two new sections. The pin needs a
signed-in agent session; the app's public listing needs either a device or a
local API pointer — Expo web cannot reach the dev server at all, because the API
sends no CORS headers to any origin, and adding them platform-wide to take a
screenshot would be a security change made for the wrong reason.
