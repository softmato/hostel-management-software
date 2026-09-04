# WEB_MAP_PLAN.md — the same map, on the website

**Created 2026-08-19.** Work order for porting the mobile map to `apps/web`. The mobile side is
finished and its reasoning is written down in [`MAP_NAV_PLAN.md`](MAP_NAV_PLAN.md); this file is
the **handoff**: a session picking this up reads it top to bottom, then works at the first
unticked box.

## How to use this file

- **One item at a time.** Write the code, verify it, then flip `☐` to `☑` **in this file**
  before starting the next item. Do not batch several items into one pass.
- A `☑` means *seen working*, not *file written*.
- Anything found along the way that is out of scope gets appended to §8, not fixed inline.
- `MAP_NAV_PLAN.md` is the reference implementation. When this file says "see §D.1", it means
  that section of the mobile plan, which carries the reasoning rather than repeating it here.

## Verification commands

```bash
npm run web:lint && npm run web:test && npm run web:build
```

**Baseline, measured 2026-09-03 before the first line was written:** `web:lint` clean (exit 0,
no output), `web:test` **146 files / 2054 tests passing** in ~39s. Anything above those numbers
after this work is this work's fault.

**Measure the baseline before writing anything** and record it here — the mobile plan's baseline
line saved an argument later. Note that `npm run web:typecheck` is **red before you start**:
`.next/types/validator.ts` fails against Next 16's `LayoutProps` (`tasks.md` §7.2, pre-existing
and unrelated). Compare error counts against the baseline; do not expect zero.

---

## 1. Objective — port the map, feature for feature

The owner's words: *"add this exactly feature into the web"*, plus two additions that are web-only
(§2). Everything the mobile `/map` screen does, the website should do:

1. **One global map** over the whole public catalogue — every geocoded hostel as a pin, not the
   result set of a filter.
2. **Debounced search with a result list.** Type, brief pause, a list of matching hostels
   appears and the pins update at the same moment — not per keystroke.
3. **Clicking a result moves the map** to that hostel and opens its details, the same end state
   as clicking its pin.
4. **Directions** — a road route from the reader to the hostel, by vehicle or on foot, with the
   distance and duration those two genuinely different graphs return.
5. **Start: live turn-by-turn.** The map follows the reader, rotates so the way they are facing
   is up, gives written maneuvers that count down, reroutes when they leave the line, and says
   when they have arrived.
6. **A compass** showing which way is north and which way they face (N, NE, E…), tapping to lock
   north-up.
7. **Map styles** — Standard, Satellite, Terrain.
8. **The chosen pin says its name** on the map, in addition to the details panel.
9. **The map never springs back.** Once the reader drags or zooms, nothing automatic moves the
   view until they ask for it.

## 2. Decisions the owner has already made

Do not re-open these; build to them.

- **The map is reachable from the header**, as a global map viewer — not only from a hostel.
  Landing on `/map` bare means all pins, empty search, nothing selected.
- **The UI should read like Google Maps**, not like the phone screen scaled up. That means a
  full-viewport map with floating panels over it, a search box top-left with its results in a
  side panel, controls stacked bottom-right, and the hostel's details in that same side panel
  rather than a card across the bottom. Below the `md` breakpoint it collapses to the phone
  pattern — a bottom sheet — which is what Google Maps itself does on a narrow window.
- **Same features, not a subset.** Where a browser genuinely cannot do a thing (§5), say so on
  screen; do not silently drop it.

## 3. What `apps/web` already has

Read these before writing anything.

| File | What it is |
|---|---|
| `apps/web/src/components/maps/hostel-map.tsx` | Picks the provider and renders one hostel's location. **Leave it alone** — it is the detail-page map, and it is not what this builds. |
| `apps/web/src/components/maps/leaflet-map.tsx` | The existing Leaflet component: `next/dynamic` with `ssr: false`, `import("leaflet")`, a `divIcon` pin, nearby-place markers. The closest thing to a starting point. |
| `apps/web/src/components/maps/google-map.tsx` | The Google alternative, chosen only when a browser key exists. See §4 for why the new screen does not use it. |
| `apps/web/src/lib/maps/use-map-provider.ts` | `useMapProvider()` → `"google"` when `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` is set, else `"osm"`. |
| `apps/web/src/lib/maps/nearby.ts` | `haversineMeters` — **the same function** the mobile `geo.ts` mirrors. Use this one; do not bring a second copy across. |
| `apps/web/src/lib/maps/types.ts` | `Coordinates`, `NearbyPlace`. |
| `apps/web/src/hooks/use-hostels.ts` | TanStack Query over the public hostel API. How the listing page gets its rows. |
| `apps/web/src/app/_components/public-hostel-listing-page.tsx` | The browse page: filters, distance sorting, `HostelCard`. The house patterns for search UI, Zustand stores and result cards. |
| `apps/web/src/app/_components/public-hostel-data.ts` | `mapPublicHostelToSummary` — the shape the cards read. |
| `apps/web/src/components/public-header.tsx` | `navItems` at the top; each entry carries a comment saying why it earns its place. The header entry goes here. |
| `apps/web/src/app/(public)/` | Where a public route lives. Route files are thin; the page body goes in `src/app/_components/public-*-page.tsx`. |

`leaflet@^1.9.4` and `@types/leaflet` are already dependencies — **npm, not a CDN**, so the SRI
dance in the mobile shell has no equivalent here and none is needed.

## 4. What is different from mobile, and what each difference changes

This is the section that decides whether the port goes well. Four differences, in the order they
will bite.

### 4.1 There is no WebView, so there is no bridge

Mobile draws Leaflet inside a `WebView` and drives it with `injectJavaScript`, because a React
Native tree cannot hold a Leaflet object. **On the web, Leaflet is just an object in the same
JavaScript as the React tree.** Everything in `map-explorer.tsx` that exists to cross that
bridge — `window.__map`, the `; true;` suffix, the `ready` gate, `inlineJson`, the message
handler, the four-field marker payload — is **dead weight here. Do not port it.**

What *does* port is every rule that is about the map rather than about the bridge:

- the view is never moved automatically after the reader has touched it (§G.1),
- a route frames itself once per route, not once per render (§G.2),
- following never steals the zoom (§G.3),
- rotation is CSS on an oversized square, pins counter-rotate, and fits must pad by the hidden
  overflow (§D.1, §D.2, §G.5),
- attribution is rendered outside the rotating element and changes with the layer (§D.5, §H.1).

A React component owning one Leaflet instance, exposing an imperative handle with the same verbs
(`center`, `fitAll`, `follow`, `setBearing`, `setLayer`) is the right shape. Keep the state in
Leaflet and the *decisions* in hooks, exactly as mobile does.

### 4.2 The sensors are browser APIs, with browser conditions

| Mobile | Web | What changes |
|---|---|---|
| `expo-location` `watchPositionAsync`, `Accuracy.BestForNavigation` | `navigator.geolocation.watchPosition(cb, err, { enableHighAccuracy: true })` | No manifest permission and no rebuild; the browser prompts per origin. `coords.heading` and `coords.speed` exist, and are `null` when standing still — same rule as mobile. **Secure context required**: `https://` or `localhost`. |
| `expo-location` `watchHeadingAsync` | `deviceorientationabsolute`, or `deviceorientation` with `event.webkitCompassHeading` on iOS | **iOS needs `DeviceOrientationEvent.requestPermission()` from inside a user gesture** — it must be called from the Start click handler, not from an effect. **Desktops have no compass at all.** |
| `expo-keep-awake` | `navigator.wakeLock.request("screen")` | Needs a secure context and a visible document, and must be re-acquired on `visibilitychange`. Absent on older iOS Safari — feature-detect and skip silently. |

**The desktop case is a real product decision, not an edge case.** With no compass, `chooseHeading`
falls back to GPS course, which is `null` below walking pace — so a desktop reader gets no
rotation. That is correct: a laptop does not turn. The map should stay north-up, the compass
control should show `—` rather than a lie, and none of it should look broken.

### 4.3 The provider switch

`useMapProvider()` may say `"google"`. Everything in this plan — the rotation, the arrow, the
label, the layer switcher — is built on Leaflet, and the Google JS API does all of it differently.

**Recommendation: the `/map` screen renders Leaflet regardless of the provider setting**, and says
so in a docblock. The setting stays what it is today: the choice of engine for the *detail-page*
map. Rewriting the whole screen twice to honour a key that may not be set is not worth it, and a
half-featured Google version is worse than one good map. Raise it with the owner if you disagree,
but do not build both.

### 4.4 `apps/mobile` is not an npm workspace

The root `workspaces` are `apps/web`, `packages/db`, `packages/shared` — **mobile is standalone**.
So the web cannot import the mobile `lib/navigation.ts`, and moving it into `packages/shared`
would mean pulling mobile into the workspace, which is a much larger change than this feature.

**Copy the pure modules into `apps/web/src/lib/maps/`**, with a docblock in each copy naming its
twin so the next person knows there are two. Copy the tests with them — they are the reason the
arithmetic is trustworthy, and they pass unchanged under the web's vitest.

---

## 5. Work items

### A. Groundwork

- ☑ **A.1 Port the pure modules, with their tests.**
      *Done 2026-09-03. `lib/maps/geo.ts`, `navigation.ts`, `routing.ts` + both test files;
      64 tests pass. `haversineMeters` comes from `nearby.ts`, not a second copy.
      `hostelCoordinates` takes a structural parameter rather than `PublicHostel`, because
      `serializePublicHostel` spreads the whole `location` subdocument — the raw `lat`/`lng` are
      on the wire even though the hand-written type does not declare them.*
      From `apps/mobile/src/lib/` into `apps/web/src/lib/maps/`:
      - `navigation.ts` — `normaliseHeading`, `headingDifference`, `chooseHeading`,
        `smoothHeading`, `cardinalFor`, `instructionFor`, `formatManeuverDistance`,
        `distanceToPath`, `progressAlong`, `nextStep`, `isOffRoute`, `hasArrived`.
      - `routing.ts` — `routeUrl`, `parseRoadRoute`, `fetchRoadRoute`, `RouteStep`, `RouteMode`.
      - The three helpers from `geo.ts` the above need: `isUsableCoordinate`,
        `hostelCoordinates`, and `boundsCenter` if the initial view uses it.
      Rewire the copies to import `haversineMeters` from `@/lib/maps/nearby` rather than carrying
      a second one, and keep `Coordinates` from `@/lib/maps/types`.
      Both test files come across as they are; `navigation.test.ts` is 48 cases and
      `routing.test.ts` holds a **real** captured OSRM reply — do not regenerate it, and never
      replace it with an invented fixture.

- ☑ **A.2 A route, and a way into it.**
      *Done 2026-09-03. `(public)/map/page.tsx` (thin, `metadata`, a `Suspense` boundary the
      `useSearchParams` deep link requires) → `_components/public-map-page.tsx`. `Map` sits
      immediately after `Hostels` in `navItems`; `"map"` added to the `active` unions in both
      `public-header.tsx` and `PublicShell`. Verified against the running dev server:
      `GET /map` → 200, and the header renders `href="/map"`. Not added to
      `providerNavItems` — that list exists to drop the hostel-shopping tabs.*
      `apps/web/src/app/(public)/map/page.tsx` — thin, with `metadata`, rendering a
      `PublicMapPage` in `src/app/_components/`. Full-viewport: this page is the map, so it does
      not sit inside the usual page padding.
      Header: add `{ href: "/map", id: "map", label: "Map" }` to `navItems` in
      `public-header.tsx`, immediately after Hostels — it is a second way to browse the same
      catalogue, and the file's convention is a comment saying why an entry earns its place.
      Deep links must work the way mobile's do: `/map?slug=…&route=1` opens on that hostel with
      directions running, so a "Directions" link anywhere else can point here.

### B. The map itself

- ☑ **B.1 One Leaflet instance, owned by one client component.**
      `src/components/maps/map-canvas.tsx` — `"use client"`, loaded through `next/dynamic` with
      `ssr: false` (Leaflet touches `window`; `leaflet-map.tsx` already shows the pattern).
      Props for markers, selection, the device, the route and the layer; an imperative handle for
      `center`, `fitAll`, `follow`, `setBearing`. The Leaflet map is created **once** and driven
      by effects — never re-created when a prop changes.
      *Done 2026-09-03. `components/maps/map-canvas.tsx` — one `L.Map` built in a mount effect with no deps and never rebuilt; every prop change is one small imperative update in its own effect. Handle: `center`, `fitAll`, `follow`, `setBearing`, plus `zoomBy` for D.6. Loaded through `next/dynamic` with `ssr: false`, so the static `import L from "leaflet"` is safe; the `ref` reaches it because React 19 passes `ref` as an ordinary prop and `next/dynamic` spreads props into the lazy component (checked in `next/dist/shared/lib/lazy-dynamic/loadable.js`).*

- ☑ **B.2 Pins, selection, and the name on the chosen pin.**
      The teardrop pin and its selected size from the mobile shell, and the name label from §H.2:
      built as **DOM inside the icon**, not as a Leaflet tooltip. The tooltip route was tried on
      mobile and abandoned — unbinding left the node in the pane, so three selections put three
      names on screen — and `L.divIcon` accepts an element, which is also what keeps a hostel
      called `<img onerror=…>` a name rather than markup.
      *Done 2026-09-03. Teardrop pin, selected pin grows rather than recolouring, name label built as **DOM inside the `divIcon`** — not a tooltip, for the reason the mobile plan records. Verified on the running dev server: pins render, the chosen one shows its full name over "VIEWING NOW".*

- ☑ **B.3 The route line, framed once.**
      Solid for a road route, dashed for the straight-line fallback, and the fallback must keep
      saying so — a dashed line through a riverbank is a claim about the world. Fit the bounds
      only when the route's shape actually changes (§G.2): compare length plus first and last
      point, not object identity.
      *Done 2026-09-03. Solid for a road route, dashed + device blue for the straight-line fallback. The fit compares `length:first:last` rather than object identity, so a re-render does not reframe the map. Stroke colour is a CSS rule on `.hh-route`, not Leaflet's `color` option — that becomes an SVG **attribute**, and an attribute cannot read `var(--brand-teal)`; the line would come out unpainted.*

- ☑ **B.4 The takeover guard (§G.1).**
      A drag, a pinch, a wheel or a double-click and the map belongs to the reader: nothing
      automatic moves the view until an explicit control asks for it. Watch the reader's own
      input, **not** Leaflet's `zoomstart` — that fires for the map's own animations too, and
      inferring gestures from it is what the mobile side had to undo. A single click does not
      count: choosing a pin is not taking the map over.
      *Done 2026-09-03. `dragstart`, `wheel`, `dblclick` and a multi-touch `touchstart` — the reader's own input, never `zoomstart`. A single click is excluded. `center`/`fitAll` clear the flag; `zoomBy` deliberately does not, so zooming in on the junction ahead does not stop the map following.*

- ☑ **B.5 Rotation, for navigation (§D.1–D.3, §G.5).**
      The stage/oversized-square CSS, pins counter-rotated by the same variable, the device drawn
      as an arrow with an accuracy circle when it knows its heading and a dot when it does not,
      and every `fitBounds` padded by half the hidden overflow. Attribution rendered as a chip
      **outside** the rotating element (§D.5), since the corners rotate off screen.
      On desktop, where there is no compass, none of this ever engages — check that the north-up
      path is the default and costs nothing.
      *Done 2026-09-03. Stage + oversized square (the diagonal, resized by a `ResizeObserver`), pins counter-rotated by the same `--bearing`, arrow-with-accuracy-circle when the heading is known and a dot when it is not, and every fit padded by half the hidden overflow. Attribution is a chip outside the rotating element. **Dragging is disabled while a bearing is applied** — the trap in §6: Leaflet reads the axis-aligned box of a rotated container, so a drag moves the map at an angle to the pointer. The compass restores it in one click. On desktop none of this engages: no compass, so the bearing stays 0.*

- ☑ **B.6 Standard, Satellite, Terrain (§H.1).**
      One table of sources with `url`, `attribution`, `maxZoom`, `subdomains`. Three things that
      are not the URL: each attribution is a **licence condition** and must be the one on screen;
      OpenTopoMap stops at zoom 17 where the others reach 19, so switching down has to bring the
      map with it; and the old layer is removed only once the new one has drawn, or the reader
      watches the background colour while photographs load.
      Esri's path is `{z}/{y}/{x}` — **y before x**. Written the usual way round it does not
      error, it serves the wrong place.
      *Done 2026-09-03. `lib/maps/layers.ts` — one table, per-source `attribution` (a licence condition, not a caption), `maxZoom` and `subdomains`. The map comes down to the new ceiling before swapping, and the old layer is removed only on the replacement's `load` (with a 3s backstop). Esri's path is `{z}/{y}/{x}`, y before x.*

### C. Sensors and guidance

- ☑ **C.1 Position.** `src/lib/maps/geolocation.ts` — a `watchNavigationPosition(onFix)` over
      `navigator.geolocation.watchPosition` with `enableHighAccuracy`, returning an unsubscribe.
      Pass `accuracy`, `speed` and `heading` through; normalise "no reading" to `null`; drop
      unusable coordinates inside the watcher. **The coordinate is never persisted** — not to a
      store, not to `localStorage`, not into a URL. The mobile docblock explains why in one
      paragraph; carry that paragraph across.
      *Done 2026-09-03. `lib/maps/geolocation.ts` — `watchNavigationPosition` over `watchPosition` with `enableHighAccuracy`, returning an unsubscribe. Unusable coordinates dropped in the watcher; `accuracy`/`speed`/`heading` normalised to `null`. The "nothing is stored" paragraph is carried across, and the two browser-only conditions (secure context, and a refusal that may or may not be permanent) are written down with it.*

- ☑ **C.2 Heading.** `watchDeviceHeading(onHeading)` over `deviceorientationabsolute`, falling
      back to `deviceorientation` with `webkitCompassHeading`. **iOS needs
      `DeviceOrientationEvent.requestPermission()` called from a user gesture** — wire it into the
      Start handler. Where no compass exists, the subscription simply never fires, and everything
      downstream already copes with a `null` heading.
      *Done 2026-09-03. `deviceorientationabsolute`, falling back to `deviceorientation` + `webkitCompassHeading`. **`alpha` is anticlockwise from north**, so the heading is `360 - alpha`; a non-absolute `alpha` is refused rather than reported as north. `requestHeadingPermission()` is called **synchronously at the top of `start()`**, before the awaited location request — an `await` first would end the gesture and iOS would refuse silently.*

- ☑ **C.3 `useGuidance` for the web.** Port `apps/mobile/src/hooks/use-guidance.ts` — the same
      states, the same fused smoothed heading, the same off-route rule (**3 consecutive fixes and
      at least 10 s since the last reroute**; OSRM is somebody else's free service), the same
      refusal to draw a straight line as though it were guidance, and the same ETA taken from the
      route's average pace rather than the reader's current speed. Every subscription comes down
      on stop, on arrival, and on unmount.
      Wake lock lives here too, acquired while guiding and re-acquired on `visibilitychange`.
      *Done 2026-09-03. `hooks/use-guidance.ts` — same states, same fused smoothed heading, same off-route rule (3 consecutive fixes **and** 10s since the last reroute), same refusal to draw a straight line as guidance, same ETA from the route's average pace. Every subscription comes down on stop, on arrival and on unmount. Wake lock lives here, re-acquired on `visibilitychange` and feature-detected throughout.*

### D. The interface, Google-Maps-like

- ☑ **D.1 The shell.**
      Map fills the viewport under the site header. A floating rounded search card top-left
      (~380px) with its results in the panel below it; the panel is the same surface that later
      shows the hostel's details and the directions — one panel that changes contents, not three
      stacked things. Controls stack bottom-right: zoom in/out, locate, layers, compass.
      Attribution bottom-left. Under `md`, the panel becomes a bottom sheet and the search card
      spans the width — the phone layout, which is what Google Maps does at that size.
      *Done 2026-09-03. Map fills the viewport under the header; search card top-left, one panel under it that changes contents, controls stacked right. Below `md` the panel is a bottom sheet and the controls move to the top-right, because the sheet would otherwise sit on top of them. Overlays are `z-20`, not four digits: the rotation `transform` traps every Leaflet pane in the canvas's own stacking context, and `MediaLightbox` portals to the body at `z-[100]`.*

- ☑ **D.2 Search.** Debounced (250 ms on mobile, and it was chosen carefully — see §A.1 there),
      capped result rows with an "N more" footer, each row name / place · distance / price.
      Clicking a row selects the hostel, flies the map to it and opens its details. The query is
      **kept**, not cleared: somebody searching an area is looking through the answers.
      While the first word is still being typed, show "Searching…" rather than eight arbitrary
      hostels.
      *Done 2026-09-03. 250ms debounce, capped at 8 rows with an "N more" footer, each row name / place · distance / price. Clearing the box skips the wait. The query is kept, not cleared. "Searching…" only while the first word is still being typed. Rows fire on `mousedown` — the input's blur closes the list, and a click would land after it.*

- ☑ **D.3 The hostel panel.** What `PreviewCard` shows on mobile — photos, name, area, rating,
      type, distance, price, facilities, and two actions: Directions, and View details linking to
      `/hostels/[slug]`. Reuse the existing card components rather than inventing a second visual
      language for the same hostel.
      *Done 2026-09-03. Photo strip, name, area, rating, type, vacancy, distance, price, facilities, and Directions + View details. Built on `mapPublicHostelToSummary`, the listing's own shape, so the map cannot quote a different price from the page it links to. Photos open `MediaLightbox` — the same viewer the hostel's own page uses.*

- ☑ **D.4 The directions panel.** Vehicle/foot toggle, the routed distance and duration (and the
      straight-line fallback saying which it is), and **Start** — disabled until there is both a
      fix and a route. Every way it can fail gets its own sentence: refused, blocked, no
      position, no road. A Start button that spins forever is the one outcome to design out.
      *Done 2026-09-03. Vehicle/foot toggle, routed distance and duration with the straight-line fallback saying which it is, and Start disabled until there is both a fix and a route. Five failure sentences, one each: dismissed, blocked, insecure context, no position, no road. A **dismissed** prompt keeps the button live and says "press it again" — only a real block disables it, because only a block is answered without a prompt.*

- ☑ **D.5 The navigation panel.** The maneuver large — an arrow, the distance counting down
      ("In 120 m"), the instruction under it — with remaining distance and ETA small beneath, and
      a Stop that is always in the same place. Arrival says so and returns to the hostel panel.
      Rerouting and "off the route, and no new one came back" both say so plainly.
      *Done 2026-09-03. Maneuver large — icon, distance counting down, instruction under it — with remaining distance and ETA small beneath, and Stop always in the same place. Arrival says so and lands back on the hostel panel. Rerouting and "off the route, and no new one came back" each say so plainly.*

- ☑ **D.6 Compass and zoom controls.** The compass shows only while navigating, its needle
      pointing at north on screen and two letters naming the direction the reader faces; clicking
      it locks north-up and clicking again follows the heading. Zoom in/out buttons are worth
      adding here even though the phone has none — a desktop reader with a mouse expects them,
      and Leaflet's own control would rotate off screen, so render them natively like the rest.
      *Done 2026-09-03. Compass shows only while navigating, needle at north-on-screen, two letters for the direction faced, click to lock north-up and again to follow. Zoom in/out rendered natively — Leaflet's own control would rotate off screen. Controls are `size-11`/`md:size-12`, and the layer menu opens **upward** on desktop, where the controls sit at the bottom and it used to run off the edge of the screen.*

### E. Verification

- ☑ **E.1** `npm run web:lint && npm run web:test` clean, with the ported tests included, against
      the baseline recorded at the top of this file.
      *Done 2026-09-03. `web:lint` clean, `web:test` **148 files / 2118 tests** — baseline 146/2054 plus exactly the 64 ported ones. `web:typecheck` is also clean, which is worth noting: this file predicted it would be red, and it is not (see §8).*
- ☐ **E.2** `npm run web:build` — a production build, which is where an accidental server-side
      `window` shows up.
      *Not yet run — the owner declined it mid-session while the dev server was in use. This is
      the one verification step still outstanding, and it is the one that would catch a `window`
      touched during SSR. Run it before this work is called finished.*
- ☐ **E.3 [browser]** With the dev server running: search settles once, clicking a result flies
      the map and opens the panel, the map does **not** spring back after a drag or a zoom, all
      three layers load, the chosen pin shows its name, and the deep link
      `/map?slug=…&route=1` opens on that hostel with directions.
      *Partly seen 2026-09-03 on the owner's own browser: `/map` renders every pin, the chosen
      pin shows its name over "VIEWING NOW", debounced search returns the hostel and its panel
      opens with photos, price and facilities, and the photo viewer opens over the page. **Still
      unchecked:** the no-spring-back behaviour after a drag, all three layers loading, and the
      `?slug=…&route=1` deep link.*
- ☐ **E.4 [browser]** Directions and Start on a laptop: the route draws, Start asks for location,
      the arrow appears, the panel counts down, Stop returns cleanly. No rotation is expected —
      confirm the map stays north-up and the compass reads `—` rather than looking broken.
- ☐ **E.5 [phone, optional]** The same over `https://` or a tunnel, where the compass exists and
      the map should rotate. This is the only way to see §B.5 do anything.
- ☐ **E.6** Tick every box above, then add a one-line pointer to this work in `tasks.md` §7 and a
      row in its session log.

## 6. Traps, roughly in the order you will meet them

- **`window` on the server.** Leaflet touches it at import time. Anything importing it must be
  behind `next/dynamic` with `ssr: false`, and `npm run web:build` is what catches a slip.
- **`web:typecheck` is red before you start.** `.next/types/validator.ts`, unrelated (`tasks.md`
  §7.2). Compare against the baseline rather than chasing zero.
- **Geolocation and the compass need a secure context.** `localhost` counts; a LAN IP does not.
  Testing on a phone means `https` or a tunnel.
- **iOS wants the orientation permission inside a click handler.** Asked from an effect it is
  refused silently, which looks exactly like a phone with no compass.
- **A rotated container skews Leaflet's own drag maths** — it reads the axis-aligned bounding box
  of a rotated element, so dragging moves the map at an angle to the pointer. Noted but not fixed
  on mobile (`MAP_NAV_PLAN.md` §6); it matters more with a mouse. Either disable dragging while a
  bearing is applied or unproject the pointer by it.
- **`routed-foot` and `routed-car` are different hosts**, so switching profile mid-navigation
  means a fresh route from the current position.
- **OSRM is a free service.** Rate-limit reroutes exactly as §E.1 of the mobile plan does.
- **Do not touch `hostel-map.tsx` or the detail page.** They work; this is a new screen.

## 7. Where the reference implementation lives

| Mobile file | What to read it for |
|---|---|
| `apps/mobile/src/app/map.tsx` | The whole screen: state, the three panels, the search, the controls, the effects that drive the map. |
| `apps/mobile/src/components/map-explorer.tsx` | The Leaflet page: pins, labels, route, rotation stage, layers, takeover guard. Ignore everything about the bridge. |
| `apps/mobile/src/hooks/use-guidance.ts` | Guidance lifetimes, reroute rationing, arrival. |
| `apps/mobile/src/lib/navigation.ts` + `.test.ts` | All the arithmetic, and why each threshold is what it is. |
| `apps/mobile/src/lib/routing.ts` + `.test.ts` | OSRM, the two profiles, the real captured reply. |
| `apps/mobile/src/lib/location.ts` | The permission dance, and the paragraph about never storing a coordinate. |
| `MAP_NAV_PLAN.md` §D, §G, §H | Why the rotation is CSS, why the guard watches raw input, why the label is inside the icon. Each item records what was tried and rejected. |

## 8. Found along the way

*(Append anything discovered here rather than fixing it inline.)*

- **`web:typecheck` is green, not red.** This file (and `tasks.md` §7.2) says to expect
  `.next/types/validator.ts` failing against Next 16's `LayoutProps`. It does not: `tsc --noEmit`
  exits 0 on a clean tree as of 2026-09-03. Nothing was done to fix it, so either a Next patch
  release or an earlier session dealt with it. **Treat zero as the baseline from now on.**

- **`hostelCoordinates` cannot take `PublicHostel`.** `serializePublicHostel` spreads the whole
  `location` subdocument into the response, so `location.lat`/`lng` are on the wire — but
  `PublicHostel` declares `location` as the four address strings, so there is no type to read
  them off. The parameter takes `location?: unknown` and checks at runtime. Widening
  `PublicHostel` instead would be the wrong direction: it would be asserting a shape nothing
  validates.

- **A Leaflet marker click reaches the map's own `click` handler.** Choosing a pin arrived as
  "select this hostel" immediately followed by "select nothing", and whether it did depended on
  which element under the cursor was hit — so it presented as an intermittent glitch where the
  details panel sometimes refused to open. Fixed in `map-canvas.tsx` by reading the DOM target
  (`closest(".leaflet-marker-icon")`) rather than reasoning about Leaflet's propagation.
  **The mobile side has the same shape of code** (`post({type:'select'})` then the map's
  `post({type:'clear'})`) and may well have the same bug — worth checking on a device.

- **A dismissed geolocation prompt is not a block.** Both come back as `PERMISSION_DENIED`, and
  only `navigator.permissions.query({name:"geolocation"})` tells them apart. Reporting both as
  "blocked — go and edit your site permissions" is a dead end for the common case, where pressing
  the button again simply re-asks. `requestDeviceLocation` now returns `canAskAgain`.

- **Two web-only additions the owner asked for during the build**, both now in:
  photos in the hostel panel open the existing `MediaLightbox` rather than a second viewer, and
  the controls are sized for a mouse (`size-11` / `md:size-12`) with the layer menu opening
  upward on desktop.
