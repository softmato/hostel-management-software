# MAP_NAV_PLAN.md — the global map: debounced search, and real navigation

**Created 2026-08-18.** Work order for the `/map` screen in `apps/mobile`, opened after the
owner reported three faults on it. This file is the **handoff document**: a session picking
this up starts by reading it top to bottom and works at the first unticked box.

## How to use this file

- **One item at a time.** Write the code, verify it, then flip `☐` to `☑` **in this file**
  before starting the next item. Do not batch several items into one pass.
- A `☑` means *seen working*, not *file written*. Where "working" needs the phone, the item
  says **[device]** and stays `☐` until that pass.
- Anything found along the way that is out of scope gets appended to §6, not fixed inline.
- The repo-wide work order is `tasks.md`; this file is a branch off it for the map only.

## Verification commands

```bash
npm run mobile:typecheck && npm run mobile:lint && npm run mobile:test
```

Baseline, measured 2026-08-18 before section A: typecheck clean, lint clean, **605 tests /
44 files** green. (`tasks.md` says 566/36 — that number is stale, not a regression.)

---

## 1. Objective — what the owner asked for, in their words and in ours

Three faults, all on the one map screen (`apps/mobile/src/app/map.tsx`):

1. **"search should show the available results in realtime … but use debouncing — let the
   user type first and when the user stops then only show the result"**
   Today there is no debounce and no result list at all. Every keystroke recomputes the
   match set and re-injects the whole marker array into the WebView, and the only feedback
   is a count pill (`"3 hostels"`). Wanted: type → brief pause → a list of matching hostels
   appears → the pins update at the same moment, not per letter.

2. **"clicking any result should the map reflect — means map moves to that hostel"**
   Tapping a row must select that hostel, fly the map to it, and open its card — the same
   end state as tapping its pin, reachable from the list.

3. **"currently direction clicking shows the path, but we want a Start button which will use
   the device gyroscope etc, whatever Google uses, so user moves then direction wise the map
   shows"**
   Today `Directions` draws a static line and stops. Wanted: a **Start** button that enters a
   live navigation mode — the map follows the device, **rotates so the direction you are
   facing is up**, and gives turn-by-turn instructions that count down as you move.

## 2. Decisions the owner has already made

Asked and answered on 2026-08-18. Do not re-open these; build to them.

- **Fine location is enabled**, for navigation only. `ACCESS_FINE_LOCATION` comes out of
  `blockedPermissions`, and `Accuracy.BestForNavigation` is used **only while navigation is
  running**. Everything else — the Nearby row, distance badges, the sort — stays on the
  existing coarse `Accuracy.Low` path, untouched. A fresh native build is expected and
  accepted (§4.B.1).
- **Full turn-by-turn**, not a follow-only mode and not a hand-off to the Google Maps app:
  heading-up rotation, written maneuvers from OSRM (`steps=true`), a remaining distance and
  ETA that count down, automatic reroute when the reader leaves the line, and an arrival
  state.

## 3. The architecture you are working inside

Read these files before writing anything. They carry the reasoning in their own docblocks,
and the docblocks are accurate.

| File | What it is |
|---|---|
| `apps/mobile/src/app/map.tsx` (679 lines) | The screen. Owns query, mode, selection, the route resource, and the two bottom cards (`PreviewCard`, `RouteCard`). |
| `apps/mobile/src/components/map-explorer.tsx` (414 lines) | The map itself: a `WebView` whose HTML is **built once** and then driven by `injectJavaScript`. `buildShell()` at the bottom is the Leaflet page. |
| `apps/mobile/src/lib/routing.ts` | OSRM. `routeUrl` / `parseRoadRoute` / `fetchRoadRoute`. One deployment per profile — `routed-car` and `routed-foot` are genuinely different graphs. |
| `apps/mobile/src/lib/geo.ts` | Pure arithmetic: `haversineMeters`, `isUsableCoordinate`, `hostelCoordinates`, `sortByDistance`. Tested. |
| `apps/mobile/src/lib/location.ts` + `src/hooks/use-nearby.ts` | The permission dance and the one coarse reading. Position lives in screen state and is **never** persisted. |

Also relevant: `src/lib/hostel-search.ts` (substring match over name/area/city/address),
`src/lib/leaflet.ts` (CDN URLs + SRI hashes + `inlineJson`), `src/hooks/use-resource.ts`
(the GET hook — **its loaders must stay memoised**), and `src/app/directions/[slug].tsx`,
which is now only a redirect into `/map?route=1&slug=…`.

### The five rules this screen already lives by — do not break them

1. **The WebView is never remounted.** `source={{ html }}` comes from a `useState` lazy
   initialiser. Any change that puts markers, colours or a bearing into the HTML string
   reloads the browser on every keystroke and throws away the reader's pan and zoom. New
   state reaches the page through `injectJavaScript` and nothing else.
2. **Every injected script ends `; true;`** (see `call()` in `map-explorer.tsx`), or iOS
   warns on every call.
3. **Injection is gated on `ready`.** A script injected before Leaflet has parsed is lost
   silently and looks exactly like an empty map. Every effect depends on that flag.
4. **The marker payload is four fields** (`id`, `lat`, `lng`, `name`). It crosses the bridge
   on every search; price, photos and facilities are read natively from the hostel.
5. **Everything from inside the page is untrusted.** Only `ready`, `select` and `clear` are
   honoured, and a selected `id` is matched against the markers this component was given
   before it reaches navigation.

### And the one privacy line

Coordinates are never written to Redux — `redux-persist` puts Redux on disk, and a lat/lng on
disk is a location history. Navigation raises the *accuracy* of what is held in screen state;
it must not change *where* it is held. `apps/web` has a test holding attendance pings to the
same line.

---

## 4. Work items

### A. Search: debounce, a result list, and fly-to — **done 2026-08-18**

- ☑ **A.0 A way into the map that is not a hostel.** *(added mid-flight, owner's request)*
      Every door into `/map` arrived with a hostel already chosen. `DiscoveryHeader` now
      carries a map button **outside** the search pill, to the right of it, pushing `/map`
      bare — all pins, empty field, nothing selected. Outside rather than inside beside the
      filter button because what is inside the pill acts on the query it sits in, and the
      map does not take the query anywhere.
      44dp with a 19 glyph (the filter button's 18-in-40 proportion at a second size), `card`
      not `primary` so the row keeps one accent.
      Two icons fixed while there: the ID card button was `card-outline`, Ionicons' *payment*
      card, now `id-card-outline`; and the home placeholder shrank to "Search hostels or
      cities", which stops it being cut off mid-word now the row is shorter.

- ☑ **A.1 A debounced value hook.**
      New `src/hooks/use-debounced-value.ts` — generic, 2-arg, timer cleared on every change
      and on unmount. No test: every test in this app is a pure `lib/` function and there is
      no RTL or react-test-renderer to mount a hook with. Adding one is §6 material, not a
      reason to hold the item.
      The "clearing skips the wait" rule is **not** in the hook: it is one line at the call
      site (`query.trim() ? settled : query`), which keeps the hook generic instead of a
      string helper with an opinion.

- ☑ **A.2 Pins driven off the debounced query.**
      `map.tsx` holds two values now: `query` drives the field and must never lag, `search`
      drives `matches` → `markers` → the WebView. Six-letter word, one pass instead of six.

- ☑ **A.3 The result list.**
      The count pill is gone; the comment that argued for it is rewritten rather than left
      contradicting the code. Rows are name / place · distance / price, capped at 8 with an
      "N more" footer, `maxHeight: 300`, `keyboardShouldPersistTaps="handled"`.
      Gated on `searching` (field focus) **and** a non-empty query.
      One judgement not in the original plan: while the *first* word is still being typed the
      list would show eight arbitrary hostels (`search` is empty, so `matches` is the whole
      catalogue), so that one case shows "Searching…" instead. Later keystrokes leave the
      previous rows up and let them change — 250 ms of slightly stale rows reads as fast,
      250 ms of "Searching…" between every letter reads as slow.

- ☑ **A.4 Tapping a row moves the map.**
      `openResult` → select, `center(point, 16)`, blur, `Keyboard.dismiss()`. The query is
      deliberately kept: somebody searching an area is usually looking through the answers,
      not at one of them.

Verified: `mobile:typecheck` clean, `mobile:lint` clean, **605 tests / 44 files** green.
Still to see on the phone (§F.3).

### B. Fine location, for navigation only

- ☑ **B.1 Permission config.** *(native change — needs a rebuild)*
      In `apps/mobile/app.json`:
      - add `"ACCESS_FINE_LOCATION"` to `android.permissions`;
      - remove `"android.permission.ACCESS_FINE_LOCATION"` from `android.blockedPermissions`
        (drop the key if it empties);
      - widen the two permission strings, which currently promise only proximity sorting:
        `ios.infoPlist.NSLocationWhenInUseUsageDescription` and the `expo-location` plugin's
        `locationWhenInUsePermission` should both say the app also uses location **while you
        are navigating to a hostel**, and still that it is never saved or shared. An App
        Store reviewer reads that string against what the app does.

      `apps/mobile/android/` is **committed**, and line 3 of
      `android/app/src/main/AndroidManifest.xml` is currently
      `<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" tools:node="remove"/>`.
      Either re-run prebuild (`node_modules/.bin/expo prebuild --clean` — **not** `npx expo`)
      and read the resulting diff, or hand-edit that one line to drop `tools:node="remove"`.
      The hand-edit is smaller and more reviewable; say in the tick which one you did.

      Done by **hand-edit**: that one line lost its `tools:node="remove"` and nothing else in
      the manifest moved. `app.json` gained `ACCESS_FINE_LOCATION`, lost the whole
      `blockedPermissions` key (it emptied), and both permission strings now name navigation
      as a second use while still promising the reading is never saved or shared.
      Verified with `node_modules/.bin/expo config --type prebuild`: the resolved config lists
      `android.permission.ACCESS_FINE_LOCATION` and `blockedPermissions` is now undefined.
      Note `apps/mobile/android/` is **gitignored**, not committed (§6) — so `app.json` is the
      only half of this that travels, and it is the half prebuild reads.

- ☑ **B.2 The live-position seam.** Extend `apps/mobile/src/lib/location.ts` with
      `watchNavigationPosition(onFix)` — `Location.watchPositionAsync` at
      `Accuracy.BestForNavigation`, `distanceInterval: 5`, `timeInterval: 2000`, returning the
      subscription so the caller can `.remove()` it. Keep it beside the existing coarse reader
      and **update the docblock**: the "Coarse, and only coarse" section becomes "coarse
      everywhere except navigation", with the reason. A file whose docblock says the opposite
      of its code is worse than no docblock.
      Pass the fix's `accuracy`, `speed` and `heading` through — B.4 and D.3 need all three.

      Done. The three extra fields come back as a `NavigationFix`, with Android's `-1`
      normalised to `null` in one helper so no caller has to know that convention — zero is
      kept, being a real speed (stopped) and a real heading (due north). Unusable coordinates
      are dropped inside the watcher rather than at the call site: a `0, 0` mid-route would
      read as a reroute across the planet. Permission is deliberately *not* requested here —
      E.6 has to tell refused from blocked from no-fix, and a helper that quietly prompts
      takes that apart. The docblock's "Coarse, and only coarse" section is now "Coarse
      everywhere except navigation" and says why the exception is worth it.
      typecheck clean, lint clean.

- ☑ **B.3 The compass seam.** `watchDeviceHeading(onHeading)` in the same file, wrapping
      `Location.watchHeadingAsync`. No new dependency: `expo-location` carries the compass,
      and `expo-sensors` is **not** installed and does not need to be. Prefer `trueHeading`,
      fall back to `magHeading` when it is `-1` (Android reports that until it has a fix).

      Done, beside the position watcher and under the same contract: the caller owns the
      subscription and permission. Samples where *both* headings are negative are swallowed
      rather than forwarded as `-1`, so a consumer never has to re-check what this already
      checked. typecheck clean, lint clean.

- ☑ **B.4 Which heading to believe — a pure function with tests.**
      New `apps/mobile/src/lib/navigation.ts`: `chooseHeading({ compass, gpsHeading, speed })`.
      Standing still, the compass is the only thing that knows which way the phone points;
      moving above roughly **1.5 m/s**, GPS course-over-ground is far steadier than a
      magnetometer sitting next to a magnetic phone case. Google fuses both; this is the cheap
      version of the same idea, it is pure, so test it.
      Also here: `smoothHeading(previous, next, alpha)` — a low-pass filter that **handles the
      359° → 1° wrap** (interpolate the short way round, not through 180°). Without it the map
      spins a full turn every time the compass crosses north.

      Done. `lib/navigation.ts` now holds `chooseHeading`, `smoothHeading` and the
      `normaliseHeading` both are built on — exported because C.3 and D need the same
      `[0, 360)` convention and two copies of an angle wrap is how the signs drift apart.
      `smoothHeading` clamps `alpha` rather than trusting the caller: above 1 it overshoots
      the target and below 0 it runs away from it, both of which read as a hardware fault.
      13 tests, including a convergence loop that oscillates instead of settling if the sign
      is wrong. **618 tests / 45 files** green, typecheck and lint clean.

### C. Turn-by-turn data

- ☑ **C.1 Ask OSRM for steps.** In `lib/routing.ts`, add `&steps=true` to `routeUrl` and parse
      `routes[0].legs[*].steps[*]` in `parseRoadRoute` into a `RouteStep[]`:
      `{ distanceMeters, durationSeconds, location: Coordinates, maneuver: { type, modifier, exit? }, name }`.
      **`maneuver.location` is `[lng, lat]`** like every other OSRM coordinate — the existing
      docblock warns about exactly this and there is already a test pinning the URL order.
      Keep `steps` optional on `RoadRoute` so a router that omits them still draws a line.
      Extend `routing.test.ts` against a **real** captured reply, never an invented one — this
      repo has been bitten by invented fixtures before (see the statement-parser note in
      `tasks.md`). Capture one with:

      ```bash
      curl -s "https://routing.openstreetmap.de/routed-foot/route/v1/foot/85.324,27.7172;85.34,27.70?overview=full&geometries=geojson&steps=true"
      ```

      Done, against exactly that reply — 34 steps, captured 2026-08-19. Three of them are in
      `routing.test.ts` verbatim, chosen because they are the shapes an invented fixture would
      have missed: a `depart` whose street name is **Devanagari**, a `turn` with an **empty**
      name (20 of the 34 had none — C.2 must not print "Turn left onto "), and the zero-length
      `arrive`. The live data also carries maneuver types with spaces in them — `end of road`,
      `new name` — which C.2 has to match on.
      `steps=true` goes on **every** route, not just navigating ones: it costs the same single
      request, and the alternative is re-requesting the moment Start is pressed, which is the
      worst possible moment to wait. `steps` is left off the parsed route entirely when the
      reply has none, so the existing "just draw a line" path is untouched.
      Steps with an unusable `maneuver.location` are dropped, same reasoning as B.2.
      **624 tests / 45 files** green, typecheck and lint clean.

- ☑ **C.2 Instruction text.** In `lib/navigation.ts`: `instructionFor(step)` → `"Turn right
      onto Ring Road"`, `"Continue straight"`, `"Take the 2nd exit"`, `"You have arrived"`.
      Drive it off `maneuver.type` + `maneuver.modifier`, appending the street `name` only when
      OSRM gave one — half the roads in Kathmandu come back unnamed, and `"Turn right onto "`
      is a bug the reader can see. British spelling, sentence case, matching the app's copy.
      Pure, so test every branch.

      Done, driven off the real reply's vocabulary rather than the OSRM docs: `end of road`,
      `new name`, `on ramp` and `off ramp` have **spaces** in the type string, and a
      camelCase spelling would compile, pass an invented fixture and quietly fall through to
      "Continue straight" at a junction. An unknown modifier does the same on purpose — being
      vague costs a glance at the map, being wrong costs a wrong turn.
      Two wordings are deliberate: a `fork` says "Keep left", not "Turn left", which would
      send someone across a carriageway hunting for a junction; and `continue` runs *along* a
      road where a turn goes *onto* one. Nothing is punctuated — these set as a heading.
      23 tests on the file, including a sweep over every type × modifier × named/unnamed
      combination asserting no output ever ends in a stray "onto".
      **634 tests / 45 files** green, typecheck and lint clean.

- ☑ **C.3 Where am I on the route.** Also `lib/navigation.ts`, all pure, all tested:
      - `distanceToPath(point, points)` — point-to-**segment** distance, not point-to-vertex.
        A vertex-only check reports 200 m off-route halfway down a straight kilometre of road.
      - `progressAlong(points, point)` → remaining metres to the destination.
      - `nextStep(steps, point)` → the step being approached, plus metres to its maneuver.
      - `isOffRoute(distanceMeters, mode)` → **40 m on foot, 60 m by car**. GPS in a city
        street canyon is routinely 20 m out, and a map that reroutes on that is unusable.
      - `hasArrived(point, destination)` → within **30 m**.

      Done, all five, 16 tests. One shared `projectOntoSegment` underneath them: a flat local
      projection centred on the query point, which over a few kilometres is accurate to
      centimetres and is far easier to read — and to test — than cross-track trigonometry.
      Zero-length segments are answered rather than divided by, because OSRM does emit
      duplicate points.
      `nextStep` needed a decision the plan did not spell out: an OSRM step's maneuver sits at
      its **start**, so the nearest maneuver to somebody mid-leg is the one *behind* them.
      It therefore locates the reader on the chord between two maneuvers and returns the one
      at the far end — which is also what makes the countdown land on zero at the turn.
      **650 tests / 45 files** green, typecheck and lint clean.

### D. The map page: follow and rotate

All of this is inside `buildShell()` in `map-explorer.tsx`, plus new methods on `window.__map`
and new entries on `MapHandle`. **Leaflet 1.9 has no rotation of its own**, and no plugin is
being added, so it is done in CSS:

- ☑ **D.1 A rotating stage.**
      Wrap `#map` in `#stage { position:absolute; inset:0; overflow:hidden }`. `#map` becomes a
      square of side `hypot(width, height)`, centred with `translate(-50%,-50%)`, carrying
      `transform: translate(-50%,-50%) rotate(var(--bearing))`. Oversizing it is what stops the
      corners showing bare background as it turns. Call `map.invalidateSize()` after the resize
      and on every `resize` event. Put `transition: transform 300ms linear` on it so the turn is
      smooth rather than a snap — and **inject a new bearing only when it has moved more than
      2°**, or there is one injection per compass sample.

      Page half done here; the 2° gate belongs to the native side and went in with D.4.
      `window.__map.setBearing(heading)` takes the **device heading** and negates it in that
      one line, so the sign §5 warns about lives in exactly one place instead of at every
      call site.
      Verified in a desktop browser rather than on the phone: `scratchpad/render-shell.js`
      pulls the real `buildShell()` template out of the component and serves it, so what was
      checked is the shipping page, not a copy of it. With the pane at 668×655 the square
      sized itself to 936 = hypot(668, 655); `setBearing(90)` settled on
      `matrix(0, -1, 1, 0, …)`, which is −90°, i.e. east pointing up; and the screenshot shows
      tiles to all four corners with no bare background. The first `getComputedStyle` after a
      call reads the pre-transition frame — worth knowing before concluding rotation is broken.
      Also visible in that shot: the attribution has rotated off-screen, which is D.5.

- ☑ **D.2 Counter-rotate the pins.**
      A rotated container rotates its markers with it. Change the divIcon HTML to
      `<div class="pin-wrap"><div class="pin"></div></div>` and give `.pin-wrap`
      `transform: rotate(calc(-1 * var(--bearing)))`, so pins stay upright at every bearing.
      `.pin` keeps its own `rotate(-45deg)` teardrop transform — which is why the wrapper is a
      second element rather than another transform on the same one.

      Done. The wrapper carries the same `300ms linear` transition as the stage, or the pins
      lag behind the map they are pinned to during a turn.
      Verified in the browser harness at a bearing of 135°: the stage computes to
      `rotate(-135°)` and the wrapper to `rotate(+135°)` — exact opposites, so the pin sits at
      its own −45° and no other angle — and the screenshot shows an upright teardrop over an
      upside-down map.

- ☑ **D.3 The device marker becomes an arrow.**
      `setMe(point, heading)`: keep the blue dot when `heading` is null, and draw a
      north-pointing arrow rotated by `heading` when it is not. Because the stage is rotated by
      `-heading` in navigation mode, the two cancel and the arrow points up the screen — one
      element doing the right thing in both modes rather than two markers.
      A translucent accuracy circle (`L.circle`, radius = the fix's `accuracy` in metres) is
      worth drawing while navigating: it is the honest picture of a 30 m fix, and it is what
      stops "the arrow is in the wrong place" being a mystery.

      Done, with one thing the plan did not call for: the marker is **moved, not replaced**
      when the kind of marker has not changed. Removing and re-adding a layer on every fix
      throws away the arrow's CSS transition, so a heading that eases round on paper snaps in
      ten-degree steps on screen. The circle is likewise moved and resized in place.
      The arrow also sits at `zIndexOffset: 1000` — a hostel pin drawn over the reader is the
      one marker they cannot pan out of the way.
      Native side: two new optional props, `meHeading` and `meAccuracyMeters`, folded into the
      existing `setMe` injection so a fix and its heading still cost one script.
      Verified in the harness: no heading → dot with no circle; heading → arrow at
      `rotate(45deg)` with a circle; a second fix of the same kind reuses the same DOM element
      (transition kept) and only updates the rotation; dropping the heading removes both the
      arrow and the circle. With heading 45 **and** bearing 45 the screenshot shows the arrow
      pointing straight up the screen, which is the cancellation this item is built on.

- ☑ **D.4 New handle methods.** `follow(point, zoom, bearing)` — one call carrying position
      **and** bearing, so a fix and a compass sample do not cost two injections; and
      `setBearing(deg)` for a compass sample with no new fix. In follow mode use
      `map.setView(latlng, zoom, { animate: false })`: Leaflet's pan animation fighting a new
      fix every second gives a map that never settles. The smoothness comes from D.1's CSS
      transition.

      Done, and the 2° gate from D.1 lives here, on both methods, in a ref rather than state —
      it changes several times a second and nothing renders from it. The comparison uses a new
      `headingDifference` exported from `lib/navigation.ts` instead of a second angle wrap
      written out in the component: 358° and 2° are four degrees apart, and a plain
      subtraction calls them 356 and injects on every sample. Four tests on it.
      `follow(…, null)` leaves the rotation alone, so a fix arriving without a fresh compass
      sample does not straighten the map out.
      Verified in the harness: `follow` with a bearing sets `--bearing: -120deg`, the next
      `follow(…, null)` leaves it at `-120deg`, the map pane translated (so the view moved),
      and a later bearing took it to `-200deg`. **652 tests / 45 files** green.

- ☑ **D.5 Keep the attribution visible.** OSM's licence requires it, and D.1 rotates Leaflet's
      control off-screen along with everything else in the corners. Set
      `attributionControl: false` in the page and render `ATTRIBUTION` natively in
      `MapExplorer` as a small chip over the bottom-left of the map, outside the WebView. It is
      then correct in every mode, and one less thing rotating.
      `components/hostel-map.tsx` (the browse-screen map) is a different component and stays as
      it is.

      Done. `attributionControl: false`, the `attribution` option off the tile layer, and the
      `.leaflet-control-attribution` rule deleted — all three, or Leaflet re-adds the control
      the moment a layer carries the string. The native chip is a `caption` in a translucent
      `background` pill at the bottom-left, `pointerEvents="none"` so it cannot eat a tap
      meant for the map.
      Verified in the harness: zero attribution controls in the page, 25 tiles still loading.
      The chip itself is React Native and cannot render in that harness — it is typechecked
      and lint-clean, and its placement over the map is on the F.4 device pass.
      `hostel-map.tsx` untouched, as the plan says.

### E. The navigation experience

- ☑ **E.1 A guidance hook.**
      New `apps/mobile/src/hooks/use-guidance.ts` (**not** `use-navigation` — that name reads
      like expo-router). Owns: the two subscriptions from B.2/B.3, the fused smoothed heading
      from B.4, the current step and remaining distance from C.3, off-route detection with a
      reroute call, and `start()` / `stop()`. Every subscription is removed in the effect's
      cleanup **and** on `stop()`; a `watchPositionAsync` left running is a GPS the reader
      cannot switch off. Position stays in this hook's state — nothing is dispatched.
      Reroute discipline: require the off-route condition on **3 consecutive fixes** and at
      least **10 s** since the last reroute, so one bad fix under a bridge does not restart the
      route over and over.

      Done, and it is a plain `fetchRoadRoute` inside the hook exactly as §5 suspected —
      `useResource` could not hold a loader that closes over a position changing every second.
      Two decisions the plan left open. **A failed reroute does not fall back to a straight
      line**: it sets `stale`, keeps the old line, and lets the card say the route is from
      where the reader was — §5's rule about the dashed line being a claim about the world
      applies hardest in navigation mode. And **the ETA uses the route's own average pace**,
      not the current speed: at a crossing the speed is zero and an ETA from that is either
      infinite or whatever it last held.
      The coarse reading taken during `start()` seeds the arrow so it appears immediately
      instead of after the first navigation-accuracy fix.
      One React Compiler note for the next person: reading `line.steps` inside a `useMemo`
      makes it infer `line` as the dependency, which no longer matches the narrower list
      written down, and it then refuses to optimise the whole hook. Destructure first.
      typecheck clean, lint clean, **652 tests / 45 files** green.

- ☑ **E.2 The Start button.** On `RouteCard` in `map.tsx`, beside the vehicle/foot toggle.
      Disabled until there is both a fix and a route. Starting swaps the bottom card for
      `NavCard` and puts the map into follow mode.

      Done bar the card swap, which is E.3 — pressing Start now begins guidance and puts the
      map into follow mode with the arrow and the accuracy circle; the bottom card is still
      `RouteCard` until the next item.
      Start sits in the toggle's row rather than under the numbers: the profile is what you
      choose before setting off, so the pair belongs together. It is `size="sm"` so the row
      keeps the toggle's height.
      Two things fell out of the wiring. While navigating the map draws **only** the router's
      own line, dropping the two straight hops from the device to the first point and from the
      last point to the door — honest enough on a planning screen, but under a turn-by-turn
      arrow they read as an instruction to walk through whatever is in the way. And a second
      effect returns the map to north-up whenever navigation ends, however it ended: a map
      left rotated after Stop looks like a broken compass.

- ☑ **E.3 `NavCard`.** The maneuver, big: an arrow icon for `maneuver.modifier`, the distance
      to it counting down (`"In 120 m"`), and `instructionFor(step)` under it. A second line
      with remaining distance and ETA. A full-width **Stop** button — the reader must be able
      to leave in one tap, and leaving must restore the north-up map, the normal pins and the
      coarse position. Reuse the `Text` variants and `useAppTheme` colours the existing cards
      use; introduce no new colours.

      Done, no new colours — `brandSoft` behind the arrow, `primary` on it, everything else a
      `Text` variant the other two cards already use.
      One thing needed inventing: `formatDistance` rounds to the nearest 50 m, which is right
      for "how far away is this hostel" and useless for a countdown, where it ticks 150, 100,
      50, turn. So `formatManeuverDistance` in `lib/navigation.ts` counts in tens, says "Now"
      under 20 m rather than claiming a precision the fix does not have, and returns "—" for a
      non-finite number rather than announcing a turn on a NaN. Five tests.
      The arrow icon is deliberately coarse — left, right, straight, U-turn, roundabout, flag.
      A glanceable arrow saying "left" beats a precise one you have to study; the words below
      carry slight-versus-sharp.
      The second line doubles as the honest-failure line: rerouting says so, and `stale` says
      the drawn route is from where the reader *was*.
      **656 tests / 45 files** green, typecheck and lint clean.

- ☑ **E.4 Arrival.** Within 30 m: the card says so, guidance stops itself, subscriptions come
      down, and the map returns to north-up with the hostel selected — which is `PreviewCard`,
      the state the reader started from.

      Done. The hook already tears both subscriptions down and sets `arrived` the moment a fix
      lands within 30 m, and the north-up effect from E.2 fires off the same transition, so
      this item is the card's second face plus one handler: a flag, "You have arrived", the
      hostel's name, and **Done**, which lands on `PreviewCard`.
      Stopping *mid-route* deliberately does not land there — it leaves directions open,
      because somebody who pressed Stop by accident wants Start again, not a photo strip.
      The handler reads `selectedId` rather than the previous choice: a reader who arrived at
      a deep-linked hostel has never set `choice`, and reading it there would close the card
      instead of opening the preview.

- ☑ **E.5 Keep the screen awake while navigating.** `expo-keep-awake` **57.0.1** is already in
      `apps/mobile/node_modules` (transitive via `expo`) and autolinked, so `useKeepAwake()`
      needs no rebuild — but add the explicit `"expo-keep-awake": "~57.0.1"` line to
      `apps/mobile/package.json`, because an import from a package nothing declares breaks the
      day that transitive dependency moves. Scope it to the navigating state only.

      Done, both halves. 57.0.1 exports no `KeepAwake` component in this version — only the
      hook and the imperative pair — and `useKeepAwake()` cannot be scoped, since it holds the
      lock for as long as its owner is mounted, which here would mean the whole map screen
      including somebody browsing hostels from a sofa. So it is
      `activateKeepAwakeAsync`/`deactivateKeepAwake` in an effect keyed on `navigating`, under
      the screen's own tag: releasing the *default* tag would also release a lock taken by
      something else, and a video player that stopped keeping the screen on because somebody
      finished walking to a hostel is a bug nobody would ever find.

- ☑ **E.6 What happens when it cannot navigate.** No fix, permission refused, permission
      blocked, no route from OSRM: each keeps the screen usable and says which it is, in the
      pattern `RouteCard` already uses for its `me === null` branch. A Start button that spins
      forever is the one outcome to avoid.

      Done: Start is disabled until there is both a fix and a route, so it cannot spin at all,
      and a line under the toggle row names which of the four it is — refused, blocked, no
      position, or no road to follow. The fourth is the one the plan did not list separately
      and the easiest to hit: a hostel geocoded into a field has no route, and without the
      sentence the reader is left tapping a grey button.
      Two smaller things came out of it. `blocked` now means "blocked according to *either*
      the nearby reader or the guidance attempt", so revoking permission mid-session still
      offers Settings rather than "Use my location". And blocked *with* a fix already in hand
      gets its own Settings button, because the existing branch only offers one when there is
      no position at all — otherwise the message names an action the reader cannot take.

### F. Verification

- ☑ **F.1** `npm run mobile:typecheck && npm run mobile:lint && npm run mobile:test` — clean,
      with the new pure tests for `navigation.ts`, `routing.ts` (steps) and the debounce hook.

      Clean, all three, run as one chain: **659 tests / 45 files** after §G, up from the 605/44
      baseline
      — 45 new tests in `navigation.test.ts` and 6 in `routing.test.ts`. The debounce hook
      still has none, for the reason A.1 gives: there is no RTL or react-test-renderer in this
      app to mount a hook with, and adding one is §6 material rather than a reason to hold an
      item.
- ☑ **F.2** `npm run mobile:build:test` (`expo export`) bundles without error.

      Bundled clean: one Android bundle, 6.2 MB, no warnings about the new modules. Worth
      running after this work specifically — `expo-keep-awake` is imported from a package that
      was only ever a transitive dependency, and a bundler is where that shows up.
- ☐ **F.3 [device]** Search: type `"edu"` slowly — pins and list update **once**, after the
      pause. Tap a row: the map flies to that hostel and its card opens.
- ☐ **F.4 [device]** Rebuild with fine location, then walk outside with Start running: the
      arrow tracks the road rather than drifting a block, the map turns as you turn, the
      instruction counts down, and walking the wrong way triggers exactly one reroute.
      A Gradle debug APK needs `adb reverse tcp:8081 tcp:8081` or it hangs on the native
      splash. **The test device is the owner's daily handset — ask before launching anything
      on it, and stop after the shot you need.**
- ☐ **F.5** Tick every box above in this file, then add a one-line pointer to this work in
      `tasks.md` §7.

      Half done, and it stays `☐` until the other half can be. The pointer is in — `tasks.md`
      §7.4, plus a session-log row — but F.3 and F.4 are `[device]` and this session did not
      touch the phone: it is the owner's daily handset, and nothing is launched on it without
      asking. Everything A–E is ticked; those two are what is left in this file.

---

### G. Reported after the first pass — the map moves under the reader

Owner, 2026-08-19, on the built app: *"when we try to zoom then it comes back to its normal
position, and also those top 2 buttons when clicked then map moves a bit but again same problem
map comes to same earlier position"*, and it happens **only** once a hostel is chosen and
Directions is open — with or without Start.

Two separate causes, one in each state, both found by reading rather than on the phone:

- **Directions, not started.** `setRoute` in the page ends with `map.fitBounds(latlngs, …)`,
  and the native side re-injects `setRoute` whenever the `route` prop is a new object — which
  it is whenever `me`, `road.data`, `destination` or `directions` changes. Every one of those
  reframes the whole route and throws away the reader's zoom and pan. This is **pre-existing**,
  not from this branch; it only became noticeable now the screen has more reasons to re-render.
- **Started.** The follow effect depends on `guidance.heading`, so every compass sample — ten
  or so a second — calls `follow()`, which is `map.setView(latlng, 17, { animate: false })`.
  A pinch is undone within a tenth of a second, and the bridge carries ten scripts a second to
  do it. That one is from this branch.

- ☑ **G.1 Nothing moves the map after the reader has touched it.**
      The general cure, and the one that survives whatever else re-injects later. In the page,
      listen for `dragstart` and `zoomstart` **that came from a gesture** (Leaflet fires both
      programmatically too — guard with a flag set around every scripted `setView`/`fitBounds`)
      and set `touched = true`. While `touched`, `setRoute` does not refit, and `follow` moves
      the marker but not the view. `center`, `fitAll` and pressing Start are explicit
      instructions and clear the flag.

      Done as described. Verified in the harness: after a zoom and a pan, re-injecting the
      same route left the view at zoom 16 and the reader's centre — unchanged — and so did a
      `follow` carrying a new fix; `center` then handed the map back, and the next `follow`
      moved it again.
      Two notes for whoever tests this next. Leaflet's **animated** moves do nothing in a
      hidden browser tab — no rAF, no transitions, not even a `zoomstart` — so an early run of
      this test measured nothing at all and looked like a rotation bug. Drive it with
      `{ animate: false }`, which fires its events synchronously. And the `scripted` flag can
      stay a boolean: every Leaflet start event fires inside the synchronous call, so two
      overlapping scripted moves cannot clear it early.

- ☑ **G.2 Fit a route once, not once per injection.**
      Even before a gesture, refitting on every injection is wrong: the route has not changed,
      only its object identity. Keep a signature of the drawn line (length + first and last
      point) and refit only when it actually differs — the same reasoning as `fitted` for the
      marker set, which already exists three functions above. Clearing the line forgets the
      signature, so choosing the same hostel again does frame it.

      Done — and testing it **rewrote G.1**. Counting `fitBounds` calls rather than watching
      the view (animated moves are inert in a hidden tab) showed a genuinely new route still
      refitting right after a pinch: the old guard inferred gestures from Leaflet's
      `zoomstart`, which fires for the map's own animations too, so every scripted move had to
      raise a flag for 400 ms — and a pinch inside that window was read as scripted. The
      reported fault, moved somewhere harder to see.
      So the guard now listens to the reader's **own input** instead: a Leaflet `dragstart`
      (which nothing else raises), a `touchstart` with more than one finger, a wheel, a
      double-tap. `withScript` and the whole scripted/timer dance are gone. A single tap is
      deliberately not on that list — tapping a pin is not taking the map over, and it must
      not stop the arrow being followed.
      Verified: new route fits once; the same route re-injected twice fits zero times; a
      different route fits again; after a two-finger touchstart neither a new route nor a
      `follow` moves the view; and after a single tap `follow` still works.

- ☑ **G.3 Follow without stealing the zoom.**
      Split the one effect in two: `follow` on a new **position**, `setBearing` on a new
      **heading**. That alone takes navigation from ~10 injections a second to one per fix.
      And pass the zoom only on the first follow of a session — after that the page keeps
      whatever zoom the map is on, so a reader who pinches out to see the next two junctions
      stays there.

      Done. `follow`'s zoom is now `number | null` all the way through the handle to the page,
      where `null` means "keep the zoom you are on", and the screen passes a number only on the
      first fix after Start — tracked in a ref that resets when navigation ends.
      Verified: the first fix arrives at zoom 17; zooming out to 14 then feeding two more
      fixes leaves the map at **14** while still following the position; and a bearing-only
      call moves neither centre nor zoom.

- ☑ **G.4 A re-centre control, since the map can now be left behind.**
      Once G.1 lets the reader take the map away from the arrow, they need one tap to get it
      back. The existing "Centre on me" button is that control while navigating: it should
      clear `touched` and resume following.

      Done — no new control, the existing one grows a second job. Three details: it reads the
      **guidance** position while navigating rather than the coarse one, it re-centres at the
      navigation zoom rather than 15 (coming back mid-route to a wider view than the one you
      were navigating is a second surprise on top of the one you were fixing), and its
      accessibility label changes to "Back to my position", since that is what it now does.
      Following resumes because `center` clears the takeover flag inside the page.

- ☑ **G.5 The oversized square breaks `fitBounds`.** *(found while reading G.1)*
      D.1 made `#map` the diagonal of the window — 936 px inside a 668 px stage in the harness.
      Leaflet fits to **its own** container, so `fitBounds` frames the route in the 936 px
      square while the reader sees the central 668, and the ends of the route fall off screen.
      Every fit needs padding of half the overflow on each axis, on top of the padding it
      already asks for.

      Done, in one `fitPadding` helper both fits go through. Measured in the harness with a
      1280×720 stage behind a 1469 px square: fitting the three-point test route with the
      **old** padding gave zoom 16 with the first and last points off screen — only the middle
      one visible — and with the new padding gives zoom 14 with all three inside the stage
      rectangle.
      Exact at north-up, which is the only state that fits anything; at a bearing it is merely
      generous, which is the harmless direction.

- ☑ **G.6 Which way is north.** *(owner's request, same message)*
      A compass over the map: a needle that rotates with the bearing, labelled N, and a tap
      that puts the map back to north-up. Native, beside the existing map buttons, so it is
      one more thing that does not rotate with the page.

      Done, and it carries two readings rather than one: the needle points at true north on
      screen — upright on a north-up map, turning as the map turns — and the two letters under
      it name the direction the **device** is facing, which is what "am I walking the right
      way" actually asks. `cardinalFor` in `lib/navigation.ts` does the naming: eight points,
      each owning the 45° centred on itself, so north runs 337.5 → 22.5. Getting that offset
      wrong reads as a compass lagging by an eighth of a turn, so it has its own tests (12).
      Tapping it is the heading-up / north-up switch, as it is in every other map app: turning
      with the reader is right while walking and wrong the moment they stop to work out where
      they are, because every label is then upside down.
      It shows only while navigating — on a north-up map it would be a needle that never moves.
      The choice is cleared when Start is pressed rather than by an effect watching
      `navigating`: `setState` in an effect body is a cascading render, and this repo's lint
      rule forbids it.

### H. Asked for after §G — map styles, and a name on the pin

Owner, 2026-08-19: add the satellite and terrain switcher, and *"when we click in the map any
hostel then below we open the modal where we show some details right, good keep it, but also
add one thing like the green dot when clicked it shows the name"*. The card stays exactly as it
is; the label is in addition to it, on the map itself.

- ☑ **H.1 Standard, satellite and terrain.**
      Leaflet renders any XYZ tile source, so this is three entries in `lib/leaflet.ts` and a
      `setLayer` on the page. Two things make it more than a URL swap:
      - **Each source carries its own attribution, and that is a licence condition, not a
        caption.** The chip D.5 renders natively has to change with the layer.
      - **Zoom ceilings differ** — OSM and Esri go to 19, OpenTopoMap stops at 17. Switching
        to terrain at zoom 18 would show empty tiles, so the map has to come down to the new
        layer's ceiling as it switches.
      Esri's imagery URL is `.../tile/{z}/{y}/{x}` — **y before x**, unlike every other
      provider. Getting it wrong shows tiles from the wrong hemisphere rather than an error.
      Control: one more `MapButton` opening a three-row panel, since a cycling button hides
      what the other options are.

      Done. `MAP_LAYERS` in `lib/leaflet.ts` holds all three with their attribution, ceiling
      and subdomains, and the page is handed that table rather than three hard-coded URLs, so
      the licence strings have one home.
      One thing beyond the plan: the old layer is removed **only once the new one has drawn**
      (with a 3 s backstop). Removing it first leaves the page's background colour on screen
      for as long as the network takes, which on photographic tiles is long enough to read as
      a broken switch.
      Verified in the harness at zoom 18: Standard serves from `{a,b,c}.tile.openstreetmap.org`,
      Satellite from `server.arcgisonline.com` — **49 of 49 tiles loaded**, path
      `…/tile/17/55026/96601`, which is y=55026 then x=96601 for Kathmandu, so the y/x order is
      right — and Terrain from `{a,b,c}.tile.opentopomap.org` **after dropping the map to
      zoom 17**, its ceiling. Switching back leaves only OSM hosts, so nothing is left stacked
      underneath.

- ☑ **H.2 The chosen pin says its name.**
      A permanent label above the selected pin, in addition to the card below — not instead of
      it. Two constraints the rotation puts on it:
      - Leaflet positions a tooltip by writing `transform: translate3d(…)` on the tooltip
        element itself, so the counter-rotation **cannot** go there or the label detaches from
        its pin. It goes on a wrapper inside, with the tooltip's own background, border and
        arrow turned off so the wrapper is the whole visible chip.
      - The name is hostel-supplied text going into a page. It is passed as a **DOM node**,
        never as an HTML string — `inlineJson` protects the script, not the markup.

      Done, but **not with a tooltip** — that was tried first and abandoned. Two faults, one
      fatal: `unbindTooltip` left the node in the pane, so three selections left three names on
      screen at once, and the counter-rotation had nowhere to live that Leaflet would not
      overwrite. The label is now part of the pin's own `divIcon`, built as DOM: it is created
      and destroyed with the marker, and it sits inside `.pin-wrap`, which D.2 already
      counter-rotates, so it stays upright at every bearing without knowing rotation exists.
      `L.divIcon` accepts an element for `html`, which is what keeps a hostel called
      `<img onerror=…>` a *name* rather than markup.
      Verified: nothing before a selection; exactly one label after; choosing another moves it
      rather than adding a second; it survives the marker re-injection every settled search
      does; closing the card removes it; a name full of markup renders as text with zero child
      elements; and at bearing 120 the stage computes to `rotate(-120°)` with the wrapper at
      `+120°`, so the label is upright.
      Third hidden-pane artefact of the day, noted for the next person: a CSS transition does
      not advance while the Browser pane is not compositing, so an existing element reads at
      its **starting** frame for ever. Newly created elements read correctly, which is why the
      pin looked right and the map it sits on looked unrotated. Remove the transition before
      measuring.

## 5. Traps, roughly in the order you will meet them

- **`reactCompiler: true`** is on in `app.json`. Refs written during render and mutable module
  state will bite; keep the new hook's state in `useState`/`useRef`, set from effects and
  handlers, as `use-nearby.ts` already does — read its comment about `statusRef`.
- **`useResource` loaders must stay memoised.** An unmemoised inline arrow now fetches in a
  loop. The reroute path is a `useResource` whose loader closes over a position that changes
  every second — think hard about whether it should be a plain `fetchRoadRoute` call inside
  the guidance hook instead. It probably should.
- **OSRM is somebody else's free service.** Reroutes must be rate-limited (E.1). A navigation
  mode that requests a route per fix is one that gets the app's IP banned.
- **`routed-foot` and `routed-car` are different hosts.** Switching profile mid-navigation
  means a fresh route from the current position, not a re-parse of the one in hand.
- **The dashed straight line is a claim about the world.** When a reroute fails, the existing
  fallback says "no route came back". Do not let navigation mode draw a dashed line as though
  it were guidance.
- **Bearing is not heading.** `--bearing` on the stage is the *negative* of the device heading.
  Getting the sign wrong gives a map that turns the wrong way, which looks like a compass
  fault and is not one.

## 6. Found along the way

*(Append anything discovered here rather than fixing it inline.)*

- **§4.B.1 says `apps/mobile/android/` is committed. It is not** — `apps/mobile/.gitignore`
  line 19 is `/android`, and `git ls-files` does not know the manifest. The hand-edit is
  therefore local-only: a clean checkout gets fine location from `app.json` at prebuild time,
  which is correct, but nobody else's tree has the edited manifest. Nothing to fix on this
  branch; the plan's claim was just wrong.

- **A rotated stage skews Leaflet's own drag maths.** D.1 turns `#map` in CSS, and Leaflet
  converts a touch into a map point through `getBoundingClientRect`, which reports the
  *axis-aligned* box of a rotated element. So while navigating, dragging the map moves it at
  an angle to the finger. Pin taps and the arrow are unaffected — those are DOM events on the
  markers themselves — and follow mode re-centres on the next fix a second later, so it is
  easy to miss. The honest fix is to disable `map.dragging` while a bearing is applied, or to
  unproject the touch by that bearing. Left alone here because it is outside what the owner
  asked for; worth deciding once F.4 has shown how it feels in the hand.

- **Nothing in this app can mount a hook in a test.** `use-debounced-value` and `use-guidance`
  are both untested for the reason A.1 gave: every test here is a pure `lib/` function, and
  there is no RTL or react-test-renderer. The arithmetic *under* guidance is tested (45 cases
  in `navigation.test.ts`), so what is uncovered is the lifetime logic — start, stop, teardown,
  the reroute gate — which is exactly the part that leaks. Adding
  `@testing-library/react-native` is a repo-level decision, not a line item on this branch.
