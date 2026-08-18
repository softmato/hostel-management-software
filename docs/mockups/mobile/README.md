# Mobile mockups — public / discovery

Reference for `apps/mobile`. These describe the **signed-out, hostel-hunting**
side of the app (phase M6), not the resident core (M3).

> **The image files are not in this folder yet.** They arrived as chat
> attachments, which I cannot write to disk as binary. Drop the four PNGs in
> here as `01-home-and-browse.png`, `02-compare.png`, `03-hostel-detail.png`,
> `04-browse-and-filters.png` and they will be versioned next to this
> transcription. Until then this file *is* the record, and it is written to be
> buildable on its own.

Palette is already correct — these mockups are green, so unlike the web
mockups ([`ui-mockups-are-blue-theme-is-green`]) the colours can be taken at
face value. Two things in them cannot: the wordmark reads **"HostelDays"** (the
product is **HostelHub**), and the price chips on the home screen use **₹**
(every amount in this product is **NPR**).

---

## 1. Public home — `01-home-and-browse.png`, left

Top bar: hamburger · centred logo + wordmark · notification bell.

1. **Hero** — "Find a hostel you can actually trust", one line of supporting
   copy, a search field with a filled green **Search** button inside it, and
   three trust chips: *Verified Hostels · No Hidden Fees · 24/7 Support*. A
   listing card floats over the hero's right edge (photo, name, area, price).
2. **Popular Near You** + *View all* — horizontal carousel. Each card: photo,
   `Verified` chip top-left, save/bookmark icon top-right, name, area, rating
   (`4.5 ★`), `NPR 7,000 / month`, distance (`1.2 km`). A circular chevron
   affordance sits on the carousel edge.
3. **Premium Hostels** (crown icon) + *View all* — segmented chips
   *All · Boys Hostel · Girls Hostel · PG / Apartment* filtering the same card
   style.
4. **Services to make life easy** — three tiles: *Book a Room*, *Pay Rent
   Online*, *Report an Issue*.
5. **Announcements / Notices** + *View all* — shown in its empty state, "No
   announcements at the moment."
6. **Newly Listed** + *View all* — same cards.
7. **Browse by Facility** — six icon tiles: Wi-Fi, Study Room, Hot Water,
   Laundry, Parking, More.
8. **Why students trust HostelDays** — four tiles: Verified with care,
   Transparent prices, Safe & secure stays, Trusted by many.
9. **Rent on the go** — five icon shortcuts (Search, Compare, Book, Pay Rent,
   Get Support) plus a *List your Hostel → Partner with us* promo card.
10. **Stats band** — full-bleed green: 500+ Verified Hostels · 10,000+ Happy
    Students · 50+ Cities Covered · 4.6★ Average Rating.

Bottom tabs: **Home · Search · Bookings · Messages · Profile**.

## 2. Search / browse hub — `01-home-and-browse.png`, right

Location selector (`Kathmandu, Nepal ⌄`), search field, then:

- **Browse** — four tiles: All, Boys Hostel, Girls Hostel, PG / Apartment.
- A single list of icon rows, each with title, one-line subtitle and a chevron:
  *Near Me · Top Rated · Newly Listed · Offers · My Bookings · Payments ·
  My Favorites · Help & Support · Settings.*

## 3. Compare — `02-compare.png`

Header: back · "Compare Hostels" · filled **+ Add**. Dark CTA banner: "Tell us
your budget & colleges for bespoke matches" → *Talk to an Expert*.

Two columns, each with photo, `Verified` chip, a `✕` to drop it, name and
rating. Comparison rows: Monthly Rent · Location · Room Types · Vacant Beds ·
Facilities (chips + `+4`) · Food · Verification · Rating & Reviews. Per column
footer: **Send Inquiry** (filled) and *View Details →*.

Below the table, section per topic, each split into two side-by-side cards:
**Photos** (grid with `+11 more`), **Rooms & Pricing** (room type, occupancy,
attached, price, *View all rooms →*), **Facilities** (chips), **Food** (chips +
weekly routine), **About & Rules**, **Ratings & Reviews**, **Location &
Contact** (map thumbnail, address, distance to campus, phone). Closing note:
"All hostels are verified. Information displayed here is provided by hostels."

Bottom tabs here read **Home · Explore · Saved · Messages · Profile** — see
§Open questions.

## 4. Hostel detail — `03-hostel-detail.png`

Header: logo · inline search field · bell with unread dot.

- Gallery hero with `Verified Hostel` chip, `1/12` counter and a thumbnail strip.
- Name + rating, address, distance to campus.
- Three stat tiles: **Monthly Fee** NPR 10,000 · **Security** NPR 5,000 ·
  **Advance** 1 Month.
- Facility chips with sub-labels (Wi-Fi *High Speed*, CCTV *24/7 Security*, Hot
  Water *24/7*, Laundry *Available*, Parking *Bike & Car*, Meals *3 Times a day*).
- Two CTAs side by side: **Call Hostel** (outline) · **Book a Visit** (filled).
- Sticky section tabs: Overview · Rooms & Pricing · Facilities · Photos · Food.
- **Rooms & Pricing** — horizontal cards (photo, "Single Room", "with Attached
  Bath", `NPR 14,000 / month`, bed count, *See Details*) with pager dots.
- **Facilities** grid + *View all facilities*; **Photos** grid + `+12`.
- **Food Routine** — chips (3 Meals/Day, Veg & Non-Veg, Healthy & Hygienic) and
  a Day / Breakfast / Lunch / Snacks / Dinner table + *View full menu*.
- **Hostel Information** — key/value rows: Hostel Type, Total Rooms, Total Beds,
  Floor, Warden, Established (B.S.), Contact (call button).
- Green callout: **Rules, Vaccination & ID Proof**.
- **Contact the Hostel** — *Chat on WhatsApp* (filled green) and *Call Now*.
- **Location** — map, address, distance, landmark, *Directions*.

## 5. Browse list + filters — `04-browse-and-filters.png`

List side: tinted header block (`DISCOVER PLACES` / "Browse Hostels in Nepal" +
line art), breadcrumb `Home > Hostels`, a Filters bar, search field, result
count with a **Sort** dropdown, and a **Grid / Map** toggle. Result cards carry
a `Compare` chip top-left and a heart top-right; footer chips show
`Vacant 54 · Wi-Fi · Food`. Ends with "You've reached the end".

Filter sheet: `✕ · Filters · Clear All`, a search field, then radio groups —
**Area** (All Areas, Kathmandu, Ghattekulo, Narephat), **Budget (monthly)**
(Any, Under NPR 8,000, NPR 8,000–10,000, Above NPR 10,000), **Hostel type**
(All, Boys, Girls, Co-living), **Room type** (All, Single, Double, Triple,
Dormitory), **Food option** (Any, With Food, Without Food), **Dietary** (Any,
Veg, Non-veg) — then **Facilities** as checkboxes (Wi-Fi, Food, CCTV, Hot
Water, Laundry, Study Room) and **Near my college** as a select. Sticky footer:
**Reset** · **Apply Filters**.

---

## What these need from the server

| Mockup element | Server today |
|---|---|
| Hostel lists, filters, sort, detail, facilities, food routine, rooms & pricing | ✅ `/public/hostels`, `/public/hostels/{slug}` |
| `Verified` chip, photos (exterior-first), price/month, facilities, veg/non-veg | ✅ all on `serializePublicHostel` |
| **Vacant beds** (`Vacant 54`) | ✅ `capacitySummary.vacantBeds` |
| **Distance from a campus** (`3.2 km from TU, Pulchowk`) | ✅ derivable — `nearbyPlaces[]` carries `{ name, type, distance }` and `type` can be `"college"` |
| **Distance from me** (`1.2 km` on *Popular Near You*) | ◐ computable client-side: `coordinates` is on the payload, but it needs the device's location and the app asks for no location permission today |
| **Star rating on a list card or the detail hero** (`4.5 ★`, `4.8`) | ✅ *added 2026-08-17.* Every public payload now carries `ratingSummary: { averageRating, cleanlinessRating, foodRating, safetyRating, total }`. **Branch on `total === 0`, not on `averageRating`** — the averages are `0` for an unreviewed hostel and `0` is also a legitimate average, so reading the average alone renders a brand-new hostel as one star. The mockups' own `★ 0 (0)` and `New (0 reviews)` states are the right treatment |
| Compare | ✅ `/public/hostels/compare` |
| Send Inquiry / Book a Visit | ◐ `/public/hostels/{slug}/inquiries` exists — it is an **inquiry**, not a booking. There is no availability hold, no confirmation, no booking record |
| Search | ✅ `/public/search` |
| **Bookings tab / My Bookings** | ❌ **Nothing.** No booking model, route or status anywhere |
| **Messages tab** | ❌ **Nothing.** No chat, thread or DM endpoint. The nearest things are complaint threads (resident-only) and community comments |
| **Saved / My Favorites / heart icon** | ❌ **Nothing.** No favourites collection or route |
| Offers | ❌ Nothing under that name |
| Payments (in the browse hub) | ✅ but resident-only — `/resident/finance/*` |
| Announcements / Notices on the public home | ◐ notices are hostel-scoped and resident-only; there is no public announcement feed |
| Talk to an Expert | ◐ QuestionCall exists at `/resident/questioncall/*`, resident-only |
| Ratings & reviews | ✅ read on the public hostel payload; writing is resident-only |

**Three of the five tabs in the mockup have no backend at all.** That is the
substance of the tab question below, not a styling preference: a tab that opens
onto a permanent empty state teaches people the app is broken.

## Decisions taken (2026-08-16, agreed — do not re-litigate)

1. **Residents keep their own tabs.** `Home · Payments · Food · Notices · More`
   stands; hostel discovery is an **Explore** entry inside More. Someone who
   already has a bed opens the app to pay rent or read a notice, not to shop for
   another hostel.
2. **Bookings, Messages and Saved are cut** until there is a server behind them.
   The signed-in `PUBLIC_USER` tab set becomes
   **Home · Search · Compare · Profile**. Nothing ships that opens onto a
   permanent empty state — a tab that is always empty teaches people the app is
   broken, and it is the *tab* they stop trusting, not the feature.
3. **Signed-out still has no tab bar**, per the §0 shell contract: the bottom
   belongs to the floating **Log in** pill until there is an account. The tab
   bars drawn on the signed-out screens in these mockups do not apply; the rest
   of each screen does.
4. Booking, saving and messaging stay open as product decisions with server work
   behind them. When they are scheduled, the mockups above are the design.
5. M3 (resident core) finishes before any of this is built. These are M6.

## Built 2026-08-17

Home, browse + filters, hostel detail, compare and inquiry are all in
`apps/mobile`. What the mockups show and the build does **not**, each for a
stated reason:

| Mockup element | Why not |
|---|---|
| Sort dropdown | `publicHostelListQuerySchema` has no sort. A control that silently does nothing is worse than no control |
| Facilities as checkboxes | The server takes one `facility`. Multi-select would drop everything after the first while the user believes the list is narrowed |
| Pagination / "load more" | No pagination server-side; the list is the first 60, sorted cheapest-first. The footer says so when it is full |
| Map/list toggle | Needs a device-location permission the app does not request. `coordinates` is on the payload, so this is a permission decision, not a data gap |
| "Book a Visit" / Bookings | No booking model. The button says **Send inquiry**, and the copy says it does not reserve a bed |
| Distance from *me* (`1.2 km`) | Same location-permission gap. Distance *from a campus* is shown instead, from `nearbyPlaces` |
| Offers, Messages, Saved, My Bookings | Nothing behind them |
| Stats band, trust tiles, "why students trust us" | Marketing copy with no data source; the sections kept are the ones a hostel can actually fill |
