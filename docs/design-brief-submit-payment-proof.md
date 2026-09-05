# Design brief — "Submit payment proof" screen (mobile)

> Paste everything below the line into ChatGPT. It is written to be handed over
> whole: it carries the product context, the flow, the exact data, the exact
> controls and every state the screen can be in, so the designer never has to
> guess what a scenario means.

---

You are designing one screen of an existing Android/iOS app. I need screen
designs for **every state listed below**, not a single happy-path mockup. Work
from the data and rules given — do not invent fields, and do not drop states you
find repetitive.

## 1. Product context

**HostelHub** is hostel-management software used in Nepal. This screen belongs to
the **resident** (the person living in the hostel). It is reached from an unpaid
invoice by tapping "I've paid".

Residents pay their rent **outside the app** — through Nepali wallets (eSewa,
Khalti, Fonepay), a bank transfer, or cash to a warden. The hostel has no
automatic feed of those payments. So the resident comes back into the app
afterwards and **claims** that they paid, attaching a screenshot or PDF receipt
as proof. A human at the hostel later reviews it.

The screen's whole job: **get one good piece of proof, and as much correct
information off it as possible, with the least typing.**

### The one mechanic that shapes the design

When the resident attaches a file, the **server reads it** (OCR on an image, text
extraction on a PDF) and answers two different kinds of question:

1. **What does it say?** — the amount, the transaction ID, which app was used.
   These *pre-fill the form*. The resident can override any of them.
2. **Is this acceptable proof at all?** — some files are refused outright.

That read takes a few seconds and reports its progress in stages. Much of the
design problem is: *how does a screen stay calm and legible while an answer it
depends on is still arriving, and how does it change when the answer is bad?*

### Tone

Plain, warm, non-accusing. Users are students and working people, many on old
Android phones and slow mobile data, many reading English as a second language.
Never blame the user for a file we could not read — that is our limitation. Do
blame the *file* when it is genuinely the wrong file, because that is something
they can fix in ten seconds.

## 2. Visual system (fixed — do not redesign)

- **Palette is black, white and green only.** One accent: green `#0a8a4b`
  (light mode) / `#12a95d` (dark). Plus semantic amber (warning), red
  (destructive) and green (success) where they carry meaning. **No other hues.**
  No blue, no purple, no gradients-as-decoration.
- Light **and** dark mode.
- Rounded surfaces (~16px), generous vertical rhythm, no heavy shadows.
- The screen is a **scrolling form** with a **pinned footer button**.
- Loading is **skeletons**, never spinners — except inline in a status strip
  where a small activity indicator sits beside live progress text.
- Row overflow / choosers open a **bottom sheet**, never an anchored dropdown.

## 3. The flow

```
Invoice screen → [I've paid]
        ↓
  Submit payment proof screen
        ↓
  attach a file  ──►  uploading  ──►  server reads it  ──►  verdict
        ↓                                                     │
  form pre-fills from what was read                           │
        ↓                                                     ▼
  resident checks / corrects              blocked?  → must attach a different file
        ↓
  [Submit claim]  →  accepted  → back to invoice
                  →  refused   → full-screen rejection, with a way back
```

Attaching is **encouraged first**, before typing, because the read fills the
fields — and the read deliberately never overwrites something the resident has
already typed.

## 4. Layout regions, in order

1. App bar — back chevron + title **"Submit payment proof"**
2. Context notice
3. Blocking refusal (conditional)
4. Attachment-failed notice (conditional)
5. Section label + file picker (with preview once attached)
6. Read-status strip
7. **Amount** field
8. **Method** select
9. **Transaction ID** field
10. Reference-code notice
11. **Note** field
12. Tips list
13. Pinned footer button

## 5. Exact data and controls

### Context notice (always)
- Title: `Claiming against Rs 2,000` — the invoice's outstanding amount, NPR.
- Body: `Reference EDU-000D-6. You can submit up to 8 claims per hour.`
  - The reference code may be **absent**; then the body is only the rate limit.
  - The rate limit is 8/hour and is the thing residents cannot discover
    elsewhere, which is why it is here.
- Icon: clock.

### File picker
- Section label: `Payment screenshot or receipt (required)`
- **Before anything is attached**, a green/brand notice:
  - Title: `Just upload the proof — we read it and fill the form in below.`
  - Body: `We take the amount, the transaction ID and which app you paid with straight off your receipt. Change anything we get wrong.`
- **Empty state**: a dropzone offering three ways in.
- **Attached state**: a preview of the file (image thumbnail, or a PDF affordance
  reading `PDF receipt uploaded — tap to open it`), tappable to open full-screen,
  with the same three ways in repeated underneath as a row of **3 buttons**:
  **Photos**, **Camera**, **Files**.
  - Design note: the three buttons must remain reachable *after* a file is
    attached. Swapping the file is the single action every refusal asks for.
- Accepted: JPG, PNG, WEBP, PDF. Max 10 MB.

### Amount
- Numeric field, label `Amount`, NPR, placeholder `0`.
- Helper when not auto-filled: `Edit it if you paid part of the month.`
- When read off the receipt, a caption under it instead:
  - `Read from your receipt`
  - or, if it disagrees with the invoice balance:
    `Read from your receipt — this invoice's balance is Rs 2,000`

### Method
- A select opening a bottom sheet titled `How did you pay?`.
- **7 options**, each with a brand mark / icon:
  `Auto — read it from my receipt` (default), `eSewa`, `Khalti`, `Fonepay`,
  `Bank transfer`, `Cash`, `Other`.
- `Auto` keeps saying "Auto" even after the receipt resolves to a specific
  wallet — otherwise the setting silently changes under the resident.
- When Auto resolved: caption `Read from your receipt: eSewa`.

### Transaction ID
- Label changes with method:
  - Cash → `Who did you give the cash to?`, placeholder `Enter their name`,
    helper `The warden or owner who took it.`
  - eSewa / Khalti / Fonepay / bank → `Transaction ID` (**required**)
  - otherwise → `Transaction ID (optional)`
- Helper (non-cash): `UTR, txn id or reference id.`
- A text link under it (non-cash only): **`Show me where to find this`** — opens a
  bottom sheet `Where to find the transaction ID` with **numbered steps** that
  differ per method.
- When read off the receipt: caption `Read from your receipt — check it matches`.

### Reference-code notice — 3 mutually exclusive states
- **confirmed** (success): title `We found EDU-000D-6 on your receipt`,
  body `Your hostel can match this payment automatically.`
- **missed** (warning): title names the code as not found,
  body `Submit anyway — your hostel will match it by hand. Next time, put the code in the remarks.`
- **reminder** (neutral, before any file is read): title
  `Your reference code is EDU-000D-6`, body
  `Put it in the remarks when you pay, so your hostel can match it automatically.`
- Shown **not at all** when the attached file is one the hostel itself issued.
- This notice is **never** a gate. A resident who forgot the code has still paid.

### Note
- Optional multiline, label `Anything your hostel should know?`,
  placeholder `Paid from my brother's eSewa, etc.`, max 200 chars.

### Tips (static, 4 lines)
- `Just upload the proof — we read it and fill the form in for you.`
- `Make sure the amount, the date and the transaction ID are visible.`
- `Send the receipt for this payment, not one you have sent before.`
- `Supported: JPG, PNG, WEBP and PDF (max 10MB).`

### Footer — one full-width button, label depends on state
| State | Label | Enabled |
|---|---|---|
| nothing attached | `Upload your proof first` | no |
| uploading / reading | `Reading your receipt…` | no |
| ready | `Submit claim` | yes |
| blocked | `Upload a different file` | no |
| submitting | `Submit claim` + loading | no |

## 6. THE STATES TO DESIGN

Design each. Where a state is a notice, show it in position with the rest of the
screen around it.

### A. Loading
Skeletons in the shape of the form: a 64px card, a short label, a 168px picker
block, then three 72px field blocks.

### B. Could not load the invoice
Failure state with a retry.

### C. Idle — nothing attached yet
Dropzone, the "just upload the proof" notice, empty fields, reference reminder,
footer disabled reading `Upload your proof first`.

### D. Uploading
Status strip: small activity indicator + `Uploading your receipt…`

### E. Reading — 3 sequential stages, same strip, text changes
1. `Opening your receipt…`
2. `Reading the amount and transaction ID…`
3. `Matching it to this invoice…`

Design one strip that carries all four progress strings (D + E) without the
layout jumping as the text length changes.

### F. Read succeeded, fields filled — SUCCESS
Strip (success): `We read your receipt and filled in what we found. Please check it.`
Amount, Method and Transaction ID each carry a "Read from your receipt" caption.
Reference notice in **confirmed**. Footer `Submit claim`, enabled.

### G. Read succeeded, nothing usable found — NEUTRAL
Strip: `We could not read this one — please fill in the amount and transaction ID yourself.`
Not an error. Footer still enabled — a resident who types the fields can submit.

### H. Uploaded, no read attempted — NEUTRAL
Strip: `Uploaded. Please fill in the amount and transaction ID.`

### I. Looks like a statement, not a receipt — WARNING, not blocking
Strip (amber): `That is a statement, not a receipt` + guidance to send the single
receipt. Their payment probably *is* on that page, so they may still submit.

### J. Does not look like a payment receipt — WARNING, not blocking
Strip (amber): `This does not look like a payment receipt` /
`We could not find a payment app, an amount or a transaction ID on it. Check you picked the right file — you can still submit, but your hostel will have to look at it by hand.`

### K. BLOCKED — 5 variants. Red notice near the top; footer reads `Upload a different file`
The read strip goes **silent** in all of these — the banner is the only voice, or
the screen contradicts itself.

1. **Not a payment at all** — `That file does not look like a payment at all — there is no app name, no amount and no transaction ID on it. Please upload the screenshot or receipt from the app you paid with.`
2. **Our own receipt handed back** — `That is a receipt your hostel issued, not a record of your payment. Please upload the screenshot or receipt from the app you paid with — the one showing the money leaving your account.`
3. **Wrong direction** — money arriving in their account, not leaving it.
4. **Failed transaction** — the receipt says the payment did not succeed.
5. **Wrong payee** — paid to someone who is not this hostel.

Variants 3–5 arrive as **server-written prose of 1–2 sentences**, so the design
must hold a long refusal gracefully. A short toast also fires, because the
resident's eye is on the preview at the bottom of the form, not the top.

### L. The attachment itself failed — 6 variants, red notice, picker still present
Title + one line of detail. The file never became an attachment, so the preview
is gone and the dropzone is back.
1. `That image could not be opened` — may be damaged, or send a PDF instead
2. `That kind of file is not supported` — names JPEG/PNG/WebP/PDF
3. `That file cannot be uploaded` — wrong type **or** over the size limit
4. `That upload did not arrive intact`
5. `That upload did not finish`
6. *(transient network failures show no notice — a toast handles those)*

### M. Field validation errors
Amount empty/zero/not a number; Method not chosen; Transaction ID missing when
the method requires one. Inline error under each field.

### N. Submit refused — full-screen rejection
Replaces the form. Red card: title + explanation, then **2 buttons**:
**Try again** and **Cancel**. Six variants:
1. `This screenshot was already used` — names when, and for which month
2. `That image cannot be read` — blank or too small
3. `That is not a payment receipt`
4. `This receipt cannot be used as proof` — server prose
5. `That is a receipt we issued`
6. `Transaction ID already recorded` — names the ID and the month

### O. Cash variant
Method = Cash: the Transaction ID field becomes a person's name, and the
"Show me where to find this" link disappears.

### P. Dark mode
At least: idle, success (F), and one blocked variant (K).

## 7. What I want back

- One artboard per state above, phone-sized (~390×844), light unless stated.
- A short rationale for the read-status strip: it must carry 4 progress strings,
  3 outcome tones (neutral / warning / success) and a silent state, **without
  resizing the layout around it**.
- Your recommendation for showing a long (2-sentence) server refusal near the top
  of a scrolling form without pushing the file picker off screen — this is the
  hardest single problem on the screen.
- Do not add fields. Do not add a second primary button. Do not introduce colour
  outside the palette in §2.
