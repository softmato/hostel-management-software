# Supply Store — upgrade plan

Work this file **item by item**: build one checkbox, verify it, flip `[ ]` to `[x]`,
then move on. Do not batch.

> Ordering note: §A (config + delivery promise) and §B (images/seed) unblock most of
> the rest. Do them first.

---

## 0. Read before touching anything

| Area | Files |
| --- | --- |
| Mobile store screens | `apps/mobile/src/app/(store)/{_layout,index,cart,categories,orders}.tsx`, `apps/mobile/src/app/store/{checkout,product/[id],order/[id]}.tsx` |
| Mobile store parts | `apps/mobile/src/components/store/store-ui.tsx`, `store-cart.tsx`, `apps/mobile/src/lib/{store-api,store-format}.ts` |
| Server store | `apps/web/src/modules/store/{catalog,store-admin,order,cart}.service.ts`, `store-config.ts`, `store-pricing.ts`, `store.validation.ts` |
| Models | `packages/db/src/models/{StoreProduct,StoreCategory,StoreOrder,StoreCart}.ts` |
| Superadmin UI | `apps/web/src/app/_components/platform-store-page.tsx`, `platform-store-orders-page.tsx` |
| Push | `apps/web/src/modules/notifications/{push.service,push-routing,notification.service}.ts`, `apps/mobile/src/lib/push-notifications.ts` |
| Email | `packages/shared/src/email/{sender.ts,identity.ts,templates/layout.ts}`, `templates/payment/payment-verified.ts` (style reference) |
| Uploads (must read before §G) | `apps/web/src/lib/{client-upload,public-upload,file-assets,file-asset-kinds}.ts`, `apps/web/src/app/api/v1/files/*` |
| Design law | `CLAUDE.md`, `docs/DESIGN.md`, `ui_inspiration_folder/app_recordings/NOTES.md` |

Standing rules this work must not break:

- Money is **paisa integers** everywhere; `rupees()` / `toRupees()` convert **once**, at draw time.
- Mobile palette is black / white / green. Take layout from the references, never colour.
- Order documents are **snapshots**. Never re-read a placed order through `productId`.
- Totals are always the server's. No client ever recomputes a fee.

---

## A. Delivery promise — "order by 10 AM → today 4 PM, after 4 PM → tomorrow by 7 AM" (user item 6)

The rule is commercial, so it lives in config and is **computed on the server**; the phone
and the emails only render the sentence.

- [x] **A1 — extend `storeConfigSchema`** in `apps/web/src/modules/store/store-config.ts`
      with a `deliverySchedule` object whose defaults are exactly what the owner described:
      `morningCutoffHour: 10`, `morningArrivalText: "today between 4 PM and 7 PM"`,
      `eveningCutoffHour: 16`, `eveningArrivalText: "tomorrow morning before 7 AM"`,
      `timezone: "Asia/Kathmandu"`, plus `cutoffCopy` (the static two-line explainer shown
      on the shop screen). Keep the existing free-text `deliveryEstimate` as the fallback
      one-liner — do not delete it, older clients read it.
- [x] **A2 — new pure module** `apps/web/src/modules/store/delivery-window.ts` exporting
      `deliveryPromise(config, now): { arrivesText, cutoffText, placedBefore: "morning" | "evening" | "next-day" }`.
      Nepal is UTC+05:45 — do the offset arithmetic explicitly; do **not** rely on the
      server's local time. Unit-test 09:59, 10:00, 15:59, 16:00, 16:01 and midnight.
- [x] **A3 — surface it**: add `deliveryPromise` to `getStoreHome()`, `getCheckout()` and
      the store config slice, and stamp the resolved sentence onto the order at placement
      (`StoreOrder.deliveryPromise: String`) so the order screen and every email quote the
      same promise for ever, even after the owner edits the cutoffs.
- [x] **A4 — render it**: shop screen (one line under the free-delivery bar), cart footer,
      checkout `SectionHeader subtitle`, order detail, both emails, both pushes.
- [x] **A5 — superadmin form**: a "Delivery windows" block in the *Delivery & fees* tab with
      the two cutoffs and two arrival sentences, and a live preview line
      ("An order placed now arrives …").

---

## B. Every product needs a photograph (user item 3)

- [x] **B1 — seed script** `scripts/seed-store-catalogue.mjs`. Upserts by `slug`
      (idempotent — safe to re-run), writes `isDemoData: true`, gives **every** product 2–4
      images and every category a tile image. Curate the URLs by hand from a licence-clean
      source; do not scrape. Keep the list in the script as data.
- [x] **B2 — backfill mode** `--fill-missing`: touches only products whose `images` array is
      empty, matching on `tags`/`name` keywords, so hand-added products get pictures without
      the script overwriting anyone's chosen artwork.
- [x] **B3 — `--upload` flag**: pull each URL once and push it into the **public** R2 bucket
      through the existing asset pipeline, then store `assetId` instead of the remote `url`.
      The private bucket must never be used here — it is a security boundary. Without the
      flag the remote URLs are stored as-is, which the model already supports.
- [x] **B4 — the gap must be visible to whoever can fix it**: keep `ProductArtwork`'s tinted
      glyph fallback on the phone, but add a "No photo" warning badge on superadmin
      catalogue rows.
- [x] **B5** — document the script in `README.md` under the store section.

---

## C. Add to cart — persistent button state, and a vibration instead of a notification (user item 1)

### C1 — the button must stay "added"

- [x] Add the cart's line map (`productId → quantity`) to
      `apps/mobile/src/components/store/store-cart.tsx`, hydrated from `GET /store/cart` and
      updated on every add. It already fetches the count; widen that payload rather than
      adding a second request.
- [x] `ProductCard` / `ProductRow` in `store-ui.tsx` take `inCart?: number`. When set, the
      `+` circle becomes a **filled check** (card) and the pill reads **"In cart · 2"** (row),
      both still tappable to add another. `busy` behaviour is unchanged.
- [x] Same treatment on `apps/mobile/src/app/store/product/[id].tsx` and its related rail.
- [x] **Corrected after testing on device.** The "added" state was a **tick**, and a tick is
      the universal *done* mark — so tapping it to take the item back out is what everybody
      tried, and what it actually did was add another one. There was no way to remove from
      the shop screen at all. A product already in the basket now shows `QuantityStepper`,
      the same control the cart uses, whose minus turns into a bin at the floor.
      `useAddToCart()` gained `setQuantity(product, next)` (`0` removes) to drive it.
- [x] **The tap now wins the frame.** `add` and `setQuantity` awaited the server before
      touching state, so the control sat unchanged for the second or two the round trip
      takes — which reads as a tap that missed. `StoreCartProvider` gained `expect` /
      `forget`: the asked-for quantity is written into `lineQuantities` *before* the request
      goes out and dropped when its response lands, so what replaces the guess is the
      server's own copy. A clamp or a failure therefore corrects the number rather than
      being papered over. The tab badge sums the merged map, so it moves in the same frame.
- [x] **Rapid taps cannot land out of order.** `setCartQuantity` is absolute, so two taps a
      frame apart send "2" then "3" — and a slow "2" arriving last would overwrite the 3 on
      screen and stay there. Each call takes a ticket per product and only the newest one is
      allowed to write. Nothing disables on `busy` any more; blocking the second tap would
      put back the lag the optimism just removed.
- [x] **The stepper wears the Add button's clothes.** `QuantityStepper` is the cart screen's
      — a bordered box, which on a product tile read as a stray form field floating under a
      price. Shop cards get `CartStepper`: same height, radius and `--primary` fill as the
      `Add` control it replaces, full width on a tile and 104 dp on a list row, so a product
      moving in and out of the basket never makes the card jump.
- [x] **The busy state no longer swaps the glyph.** `name={busy ? "ellipsis-horizontal" : …}`
      made one tap read as add → "…" → tick, three apparent states for one action. The
      control keeps its shape and dims instead.

### C2 — no notification on add to cart. A vibration, and nothing else.

**Decided after the first pass, and it reverses what this section used to say.**
Adding to a basket gets a **haptic** and the button state above — no toast, no local
notification, and no server push. A hostel admin restocking taps `+` a dozen times in a
row; a banner per tap is a queue of dismissals for something already visible in the button
and the cart badge. Notifications are reserved for orders (§H).

- [x] **C2a** — `useAddToCart()` in `apps/mobile/src/components/store/store-cart.tsx` is the
      one add path for every screen. Success → `Haptics.notificationAsync(Success)`;
      a clamped quantity → `Warning` **and** the toast, because a basket holding less than
      was asked for has to say so; a failure → `Error` and the toast, because a tap that did
      nothing looks exactly like a tap that worked.
- [x] **C2b** — the shop, the departments screen and the product page were each carrying
      their own copy of the add handler and had already drifted: the departments one
      silently dropped the clamp warning. All three now call the hook.
- [x] **C2c** — the add-to-cart push is **removed** from
      `apps/web/src/modules/store/cart.service.ts` (`notifyCartAdded`, the 30-second dedupe
      map and the image resolver), along with the `STORE_CART` category in `push-routing.ts`,
      its branch in `androidChannel()`, and the `cart` Android channel in
      `apps/mobile/src/lib/push-notifications.ts`.
- [x] **C2d** — `richContent` / `PushPayload.imageUrl` on the push service **stays**: the
      order-placed push uses it to carry the product picture. `STORE_ORDER` still routes to
      `/store/order/<id>` rather than the web path the superadmin notification used to send.

---

## D. Cart screen — the hidden checkout button, spacing, and an obvious way to order (user item 2, and the first half of item 8)

### D0 — the checkout button is drawn *underneath the tab bar* — fix this first

This is a real layout bug in `apps/mobile/src/components/ui/screen.tsx`, not a store bug.
`Screen` decides who owns the bottom edge:

```
const reservedBottom = insideTabs
  ? TAB_BAR_HEIGHT + insets.bottom + MIN_BOTTOM_PAD   // <- insideTabs wins
  : footer ? MIN_BOTTOM_PAD : insets.bottom + MIN_BOTTOM_PAD;
```

`insideTabs` short-circuits, so when a screen passes **both** `footer` and `insideTabs` —
which the cart does — the scroll content correctly reserves the tab bar's height, but the
**footer itself** is laid out flush to the bottom with only
`paddingBottom: max(insets.bottom, 16)`. The tab bar is *absolutely positioned and floats
over the content* (`TAB_BAR_HEIGHT = 58` plus `insets.bottom`), so it lands directly on top
of the footer. The button is the bottom-most element in that footer, so the tab bar covers
exactly it. The `floating` branch a few lines below already adds `TAB_BAR_HEIGHT +
insets.bottom` for the same reason — the `footer` branch simply never did.

- [x] **D0a** — in `screen.tsx`, let the footer own the tab bar clearance and stop the
      content double-counting it:

      const tabClearance = insideTabs ? TAB_BAR_HEIGHT + insets.bottom : 0;

      const reservedBottom = footer
        ? MIN_BOTTOM_PAD
        : (insideTabs ? tabClearance : insets.bottom) + MIN_BOTTOM_PAD;

      // footer style
      paddingBottom: insideTabs
        ? tabClearance + MIN_BOTTOM_PAD
        : Math.max(insets.bottom, MIN_BOTTOM_PAD)

      The padding band under the button sits *behind* the floating bar, so it costs no
      visible space. Update the "who owns the bottom inset, in priority order" doc comment
      above it — the ordering it describes is what caused this.
- [x] **D0b** — three other screens pass both props and have the same bug on the same line:
      `apps/mobile/src/app/(admin)/community-reports.tsx`,
      `apps/mobile/src/components/hostel-browser.tsx`, and `apps/mobile/src/app/ui-preview.tsx`.
      Check each after the fix — one change should repair all four.
- [ ] **D0c** — verify with an `adb` screenshot of the cart on three-button navigation as
      well as gesture navigation. Three-button is where `insets.bottom` jumps to ~48 dp, and
      it is the configuration that hides the most.

### D1–D4 — wording and spacing

Placing an order **is** already wired (`cart → /store/checkout → placeStoreOrder`), but the
button reads "Checkout · 3 items", which never says an order gets placed — and until D0 lands
nobody can see it anyway.

- [x] **D1** — in `apps/mobile/src/app/(store)/cart.tsx`, give the Subtotal/Delivery group and
      the Total row real separation: wrap subtotal + delivery in their own `gap-2` block, then
      the Total row takes `mt-3 pt-3` above its `border-t`. Total stays `variant="subtitle"`
      with `Money size="large"`.
- [x] **D2** — the button becomes **"Place order · NPR 12,450"** with a caption above it
      reading `Cash on delivery · <deliveryPromise.arrivesText>`. It still routes to checkout —
      checkout is the confirm step — so if "Place order" reads as a lie on device, use
      "Continue to place order". Decide from a screenshot, not in the abstract.
- [x] **D3** — fix the checkout footer in `apps/mobile/src/app/store/checkout.tsx`:
      `<Button className="flex-1 ml-4">` sitting in a `flex-row` beside an unconstrained
      `View` squeezes the price on long totals. Make it a stacked footer — price line full
      width, then a full-width **Place order** button.
- [x] **D4** — re-check the empty-cart and store-closed states after the footer change.

---

## E. Superadmin catalogue — a proper "Add product" tab (user item 4)

`platform-store-page.tsx` crams the whole product form into a 400 px sidebar. Split it.

- [ ] **E1 — tabs become** `Products` · `Add product` · `Categories` · `Delivery & fees`.
      Editing an existing product switches to the *Add product* tab in edit mode (titled
      "Edit <name>"), so the file keeps exactly one product form.
- [ ] **E2 — layout inside the tab**: `xl:grid-cols-[minmax(0,1fr)_420px]` — the form on the
      left with room to breathe, a **live preview** column on the right that is `sticky top-4`.
- [ ] **E3 — the preview column** renders, from the form's current values:
      1. a **phone-shaped mock** of the mobile product card and product screen — the real
         numbers: 2-up grid width, `aspect-square` artwork, price under the name,
         `per <unit>`, the `% off` badge derived from `compareAtPrice`;
      2. the **plain catalogue row** as the Products tab will list it.
      Drive it from a `useState` mirror of the form (controlled inputs) or an `onInput`
      handler on the `<form>`; do not create a second source of truth for the values that
      actually get submitted.
- [ ] **E4 — a worked example card** pinned above the form: one filled-in specimen showing
      the house standard — name shape (`Cotton mattress, 3 inch`), summary
      (`Single bed, cotton filled — 6 ft × 3 ft`), description structure (what it is /
      material / size / what it fits), three images (front, detail, in use), unit, tags. Add a
      **"Fill the form with this example"** button, so the standard is one click rather than a
      paragraph nobody reads.
- [ ] **E5 — the category field becomes searchable and creatable**: a combobox that filters
      `categoryRows` as you type and, when nothing matches, offers
      **"Create category '<typed>'"** — POSTs `CATEGORIES_ENDPOINT` with a slugified handle
      and the default `cube-outline` glyph, then selects it. No API change needed.
- [ ] **E6 — seed more departments** in the same pass (through §B1): Bedding, Furniture,
      Kitchen & Cookware, Cleaning & Hygiene, Bathroom, Electrical & Lighting, Water &
      Storage, Laundry, Safety & Fire, Stationery & Office, Study & Desk, Doors & Locks,
      Networking, Maintenance & Tools, Outdoor & Garden, Waste Management.
- [ ] **E7 — rename the confusing money fields**: `Price (NPR)` → **"Selling price (NPR)"**,
      hint "What a hostel pays. Charged per <unit>."; `Was (NPR)` →
      **"Struck-through price (NPR)"**, hint "Optional. Shown crossed out beside the selling
      price — must be higher. Leave blank if there is no offer." Show the computed discount
      percentage live underneath. Keep both fields and both API names.
- [ ] **E8 — group the form into fieldsets** with headings, so nothing overlaps:
      *What it is* (name, category, summary, description, tags) · *Photos* (§G) ·
      *Price* (selling, struck-through, unit) · *Stock & limits* (track stock, on hand, min,
      max) · *Placement* (handle, priority, featured, live).
- [ ] **E9 — validate inline**, not only through the page-level `Message`. min > max and
      compare ≤ price are already server rules; mirror them under the offending field.

---

## F. Wider product cards (user item 5)

- [x] **F1** — featured rail in `apps/mobile/src/app/(store)/index.tsx`: `width: 158` → `186`.
- [x] **F2** — `ProductGridSkeleton` and any 2-up grid: raise `minCellWidth` so a 360 dp phone
      still gets two columns but each is wider. Read `Grid`'s contract in
      `components/ui/layout.tsx` before choosing the number.
- [x] **F3** — `ProductRow` thumbnail 72 → 80; `CartRow` thumbnail 68 → 76.
- [ ] **F4** — verify on device with an `adb` screenshot beside the reference frame. Ask before
      launching anything on the handset; one shot, then stop.

---

## G. Uploads — many files at once, or a list of URLs (user item 7)

Read the uploader files in §0 first. There is already one upload pipeline and a global
toaster, and this must go through them.

- [ ] **G1 — new component** `apps/web/src/app/_components/image-input.tsx`: a drop zone
      (`<input type="file" multiple accept="image/*">` plus drag-and-drop) **and** a "paste
      URLs" textarea accepting one URL per line, or comma/whitespace separated. It emits
      `{ assetId?, url? }[]` — exactly `productImage` in `store.validation.ts`.
- [ ] **G2 — reorderable thumbnails** with a remove button and a "Cover" marker on the first
      entry, because `images[0]` is the thumbnail everywhere. Enforce the max of 8 the schema
      already sets.
- [ ] **G3 — wire it into the product form**, replacing the single `Image URL` input. The
      current form submits at most one image
      (`images: text(form,"imageUrl") ? [...] : []`) even though the model, the validation and
      the mobile gallery all support eight.
- [ ] **G4 — the same component for the category tile image** (single-image mode) in the
      Categories tab.
- [ ] **G5 — validate on paste**: reject anything that is not `http(s)://` or a same-origin `/`
      path. `linkUrl` already says so on the server — say it in the UI before the POST.

---

## H. Order placed → email and push to both sides (user item 8)

### H1 — templates

New directory `packages/shared/src/email/templates/store/`, built with `emailLayout`,
`paragraph`, `ctaButton` and `escapeHtml` — the same shape as
`templates/payment/payment-verified.ts`. Add a small `itemsTable()` helper there (48 px
thumbnail, name, `qty × unit price`, line total), inline styles only.

- [x] **H1a** `store-order-placed-buyer.ts` — `category: "info"`
- [x] **H1b** `store-order-received-platform.ts` — `category: "alert"`
- [x] **H1c** `store-order-status-buyer.ts` — `category: "info"`

### H2 — what each email actually says

**To the hostel owner / whoever placed it — "We've got your order"**

- Subject: `Order <orderNumber> placed — NPR <total>`
- Confirmation line: hostel name, order number, when it was placed.
- **The delivery promise**, verbatim from `order.deliveryPromise` — the whole point of §A:
  "Placed at 9:12 AM — arriving today between 4 PM and 7 PM."
- The item table, then Subtotal / Delivery (or **Free**) / **Total**.
- **Payment**: "Cash on delivery — please keep **NPR <total>** ready for the courier."
- Delivery address, contact name, phone, and the courier note if one was written.
- "You can cancel from the app until it ships." + CTA **Track this order** → deep link.
- Support address in the footer.
- Never include: stock levels, internal ids, or anything about another hostel.

**To the superadmin — "New supply order to fulfil"**

- Subject: `New order · <hostel> · NPR <total> · <orderNumber>`
- Who: hostel name, the person who placed it, their phone.
- **When it must arrive** — the same promised window, phrased as the deadline it is.
- The item table **with the unit and the quantity to pick**, plus `stock left after this
  order` per line, and a red flag on any line that has just hit zero.
- Subtotal / Delivery / Total, and **"Collect NPR <total> in cash on delivery."**
- The full delivery address and note, with a one-tap `tel:` link on the phone number.
- CTA **Open the fulfilment queue** → `/platform/store/orders`.

**Status change, to the buyer** — sent on `CONFIRMED`, `SHIPPED`, `DELIVERED` and
`CANCELLED` only. `PACKED` is internal; an email for it is noise.

- `CONFIRMED`: "We're preparing your order" + the window + the total to keep ready.
- `SHIPPED`: "On the way" + the window + the courier note if any + the amount to pay.
- `DELIVERED`: "Delivered" + the amount paid + a reply address for anything wrong.
- `CANCELLED`: what was cancelled, the reason given, and that nothing is owed.

### H3 — wiring

> **Superadmin on mobile.** There is no superadmin portal in the app yet, so today the
> superadmin's push has nowhere useful to land — but build the server side **now**, addressed
> by role rather than by surface: resolve every ACTIVE `SUPERADMIN` and send them the push and
> the email exactly as you do for the buyer. A superadmin with no device token simply gets no
> push (`activeTokensFor` returns nothing) and still gets the email. When the portal ships,
> the notification already works and only its `data.path` needs a destination — which is why
> C2d maps `STORE_ORDER` to a real mobile route instead of leaving the web path in place.

- [x] **H3a** — in `order.service.ts` `placeOrder`, beside the existing
      `notifyPlatformOfOrder`: resolve the buyer's email (the placing user, falling back to
      the hostel's contact email) and every ACTIVE `SUPERADMIN`, and send both emails. Wrap
      in `try/catch`; a failed send must never fail the order — the file states that rule
      twice already, keep it.
- [x] **H3b** — push the buyer as well as the platform. Buyer: title
      `Order placed · <orderNumber>`, body `<n> items · NPR <total> · <arrivesText>`,
      `imageUrl` = the first item's image. Platform: title `New order · <hostel>`, body
      `<n> items · NPR <total> · deliver by <arrivesText>`. Send the platform one whether or
      not anyone can currently receive it — see the note above.
- [x] **H3c** — in `updateOrderStatus`, send the status email beside the existing
      `notifyHostelOfOrderStatus` push, for the four statuses above.
- [x] **H3d** — one `resolveOrderRecipients(order)` helper, so the two paths cannot drift on
      who gets told.
- [x] **H3e** — tests in `apps/web/src/modules/store/order-notify.test.ts`: buyer and platform
      are both addressed; a throwing mailer does not fail `placeOrder`; `PACKED` sends no
      email; the promise string stamped on the order is the one that reaches both emails.

---

## I. Verification — nothing above gets ticked without this

- [x] `npm run lint` and `npm run typecheck` clean across `apps/web`, `apps/mobile`, `packages`.
- [x] Vitest green, including the new `delivery-window.test.ts` and `order-notify.test.ts`.
- [ ] Superadmin: add a product through the new tab with three dropped files and two pasted
      URLs, a newly created category, and a struck-through price — and confirm the preview
      matched what the phone then drew.
- [ ] Phone: the cart's **Place order button is visible above the tab bar** on both gesture
      and three-button navigation (§D0), and the other three `footer` + `insideTabs` screens
      still look right.
- [ ] Phone: add to cart from the grid → the button stays "in cart", a **server-sent** push
      appears in the shade **with the picture**, and tapping it opens the cart.
- [ ] Place an order end to end → both emails land (Resend log, or the `email_skipped` JSON
      line locally), both pushes arrive, and the order screen shows the same promised window
      the emails quote.
- [ ] `adb` screenshot of shop, cart and checkout beside the reference frames — widths and
      spacing only, no colour drift.
- [x] `graphify update .` once the code settles.

---

## K. Department drill-down (found on device)

- [x] **K1** — tapping a department tile on the shop pushed `/(store)/categories?slug=…`,
      which is a **tab switch** in response to what reads as a drill-down: the bar underneath
      relights, the back gesture goes somewhere unexpected, and what arrives is a chooser
      rather than the thing chosen. The shop now pushes
      `apps/mobile/src/app/store/category/[slug].tsx` — a normal detail screen on the store
      stack, beside `product/[id]`, from which back returns to the shop.
- [x] **K2** — the Departments **tab** keeps its inline select-and-filter behaviour. That is
      not a contradiction: its job is comparing shelves, where a push-and-back between every
      department turns four glances into eight taps. The new screen serves the other job —
      arriving with one shelf in mind. The tab's "See all" link is unchanged.
- [x] **K4 — the Departments tab was a copy of the shop.** Same painted header, same search
      field, a grid of tiles and then a column of `ProductRow`s: two tabs that looked alike
      are one tab and a wasted slot in the bar. It is now **a shelf per department** — a
      heading with the product count and a horizontal rail of `ProductCard`s, the whole
      catalogue in one vertical scroll, nothing to select before anything can be seen. The
      heading's "See all" drills into the same `store/category/[slug]` the shop's tiles push,
      so there is one department screen and not two.
- [x] **K5 — search there narrows the shelves rather than flattening them.** It filters the
      products and drops whatever shelf comes back empty, so "bucket" answers *which
      departments stock one*. The shop's box answers "which product" — different questions,
      and flattening this one would rebuild the duplication K4 removed.
- [x] **K6 — one request, not sixteen.** New `GET /store/shelves` +
      `getStoreShelves()` in `catalog.service.ts`: a single aggregate that sorts before it
      groups (so `$slice` means the best twelve, not twelve arbitrary ones) and counts the
      total before slicing. A `listStoreProducts` call per category would have been a round
      trip per tile on a screen that has to open at once.
- [x] **K3** — the department screen takes the title, the product count and the list from the
      one `listStoreProducts({ category })` call, which already returns the category it
      resolved the slug to. No second lookup, so the header is never blank for a beat.

---

## J. Deliberately out of scope

- Per-hostel catalogues, or hostel-to-hostel selling. `StoreCategory` and `StoreProduct`
  carry no `hostelId` on purpose; that absence **is** the tenancy rule.
- Online payment. `paymentMethod` stays a one-member enum until eSewa is actually added.
- Promo codes and loyalty points — the cart screen's own doc comment rejects them.
- Rewriting `platform-store-orders-page.tsx`. It only gains the status-email side effect;
  no UI change.
