# Research brief — automatic night presence for a hostel management app

**Hand this whole file to the assistant.** It is written to be self-contained: a
reader with no access to our codebase should be able to act on it.

---

## 1. What we are building

HostelHub is a hostel-management platform used in **Nepal**. Hostels (student
accommodation, typically 20–200 beds) pay for it. Residents, wardens, guardians
and cooks each get their own portal, and there is one React Native app (Expo SDK
57, `expo-router`) that serves all of them.

**The question the hostel is paying to have answered: was each resident inside
the hostel last night?**

Today that question is answered by the resident tapping a button, or by a warden
walking the corridor with a phone. The owner's requirement is that it becomes
**automatic**:

> "the hostel keeps this app coz they can know either the resident are at hostel
> at night or not, so we need to make it auto."

> "we want to track the resident night time certain time location as 7–7:30,
> then 9–9:30, 12:30 etc or even less so we can make sure they were in the
> hostel radius"

---

## 2. What already exists (do not redesign these)

**Server (Next.js API, MongoDB):**

- `POST /resident/location/ping` takes `{ lat, lng, recordedAt? }`. It computes
  the great-circle distance to the hostel's pin and buckets it:
  - `INSIDE` ≤ 50 m, `NEARBY` ≤ 200 m, `OUTSIDE` beyond, `UNKNOWN` if the hostel
    has no pin.
  - It stores the **zone and the distance**. It never stores the coordinate.
- One `AttendanceLog` row per `{ day, residentId }`, upserted — **last write
  wins**.
- The day bucket is the hostel's calendar day (UTC+05:45, no DST).
- Consent is a revocable `ConsentLog`; the most recent entry wins. Pings are
  refused `403` without it.
- Attendance is **off per hostel by default** (`enabled: false`), configurable:
  `insideZoneRadiusMeters` (50), `nearbyZoneRadiusMeters` (200),
  `pingTimes` (`["06:00","08:00","22:00"]`), `absenceAlertDays` (14),
  `retentionDays` (600).
- A cron raises an alert when a resident is absent past `absenceAlertDays`.

**Client (Expo):**

- A resident-facing screen showing consent, the day-by-day zone history, and
  erasure. Built and shipped.
- **No ping is currently sent.** Nothing on the phone calls the ping endpoint.
- `expo-location@57` is installed (`startGeofencingAsync` is available).
  `expo-task-manager` is **not** installed. Background location is explicitly
  disabled in `app.json` and `ACCESS_BACKGROUND_LOCATION` is not requested.

---

## 3. Hard constraints — an answer that violates these is not usable

1. **Coordinates are never persisted.** Not on the device, not in the database.
   The phone may hold a fix in memory long enough to post it, and that is all.
   (Redux is `redux-persist`-backed, so a lat/lng in Redux is a location history
   on disk.)
2. **Public and non-resident users get no background location, ever.** Foreground
   only, while the app is open, for sorting hostels by distance and navigation.
   Background location is residents-only, consented, and time-limited.
3. **"Outside" is not a warning.** Our design guide is explicit: students leaving
   the hostel is normal life, not a red flag. The product must not read as
   surveillance, and must never assert the resident's location — only their
   phone's.
4. **Nepal-specific hardware reality.** Xiaomi, Redmi, Realme and Oppo dominate,
   and their battery optimisers kill background work aggressively. **A killed
   task produces no ping, and no ping is indistinguishable from an absence** —
   the single most dangerous failure mode in this feature.
5. **Play Store.** `ACCESS_BACKGROUND_LOCATION` needs a written justification and
   a demo video, reviewed by a human, frequently rejected first time.
6. **Battery.** Residents will uninstall an app that visibly drains their phone.

---

## 4. What we already believe, and want challenged or confirmed

State clearly which of these you agree with, and correct any that are wrong.

- **GPS indoors is the core difficulty.** Roughly 3–10 m open sky, 20–50 m dense
  urban outdoors, but **50–200 m inside a concrete building**, often falling back
  silently to wifi/cell triangulation. A resident asleep in their room at 22:00 is
  in GPS's worst environment.
- **The radius is squeezed.** 50 m produces false `OUTSIDE` readings for residents
  who are genuinely in bed; 200 m includes the neighbouring building and the
  street, so `INSIDE` stops meaning inside.
- **OS geofencing wants ≥ 100 m.** Both Android's Geofencing API and iOS region
  monitoring degrade badly below that.
- **Geofence transitions alone are insufficient.** A resident who arrives at 19:00
  and never leaves generates **no event at 22:00**, so transitions must maintain
  state *and* something must sample at the check times.
- **OS-registered geofences survive battery optimisers better than a periodic
  background task**, because the OS does the waking.
- **The phone is not the person.** No design removes this. Someone who leaves
  their handset on the bed reads as present.

---

## 5. The specific questions we want answered

### 5.1 Sampling design — the main question

The owner wants several samples across the night (roughly 19:00–19:30,
21:00–21:30, 00:30, "or even less" apart) rather than one nightly check. We want
a concrete, defensible design:

- **How many samples, and at what times?** What does the marginal sample actually
  buy after the second or third? Is there a point where more samples cost battery
  and Play Store scrutiny without improving the verdict?
- **Should the times be randomised within each window?** A fixed 22:00 check is
  gameable — be in the building at 22:00, leave at 22:05. Does jitter within a
  window meaningfully change that, and what does it cost in predictability for
  debugging and for explaining the feature to residents?
- **How should several samples combine into one verdict?** Majority? Any-inside?
  All-inside? Weighted toward later samples? What does each choice do to false
  positives versus false negatives, given that a **false absence** (resident
  asleep upstairs, reported out) is far more damaging to trust than a false
  presence?
- **How should missing samples be treated?** If two of four fired and both said
  inside, is that a verdict or an unknown? Where is the line?

### 5.2 Storage model

Our current model is one row per resident per day, last-write-wins. Several
samples per night clearly breaks that — a resident stepping out at 23:50 would
overwrite an evening of readings. Recommend a model. Consider: a per-sample
collection with a derived nightly verdict; a single row holding an array of
samples; a separate `nightVerdict` field. Weigh storage growth (200 residents ×
4 samples × 600 days retention), query cost for the warden's board, and how
easily a resident's erasure request stays complete.

### 5.3 Mechanism on Android and iOS

Given Expo SDK 57 managed workflow, what is the most reliable way to fire a
sample inside a time window?

- `expo-location`'s `startGeofencingAsync` + `expo-task-manager`
- `startLocationUpdatesAsync` with a background task
- `expo-background-task` / `expo-background-fetch`
- Silent/data push notifications as a trigger — we already have Expo push
  working and a cron on the server, so the server could wake the device
- Some combination

For each: reliability on Xiaomi/Redmi/Realme/Oppo specifically, battery cost,
whether it survives app termination and device reboot, iOS behaviour, and what
Play Store review makes of it. **We are especially interested in whether a
server-triggered silent push can replace or reduce background-location
scheduling**, since it moves the timing decision to a server we control.

### 5.4 Better signals than GPS

Rank these for *indoor* presence in a Nepali hostel, on cost, accuracy and
privacy:

- **Hostel wifi SSID/BSSID.** A phone joined to the hostel network is in the
  building. What are the real permission requirements on current Android and iOS,
  and can it be read in the background?
- **BLE beacons** at the entrance or in the building.
- **NFC tag** the resident taps.
- **QR scan at the gate** by a warden.
- Anything we have not thought of.

Is a **hybrid** — wifi where available, GPS as fallback — worth the complexity?

### 5.5 The honesty problem

Given the phone-is-not-the-person limit, how should the warden's roster present a
verdict so a hostel is neither misled into false confidence nor given something
so hedged it is useless? We want concrete wording and UI treatment, not a
principle.

### 5.6 Legal and store compliance

- What exactly must the Play Store Data safety form and the background-location
  declaration say for this use case, and what gets these rejected?
- What does the demo video need to show?
- Does India/Nepal or Google policy require anything specific for a **minor**
  resident, given some residents will be under 18?
- Apple's equivalent requirements if we ship to the App Store.

---

## 6. What a good answer looks like

- A **recommended design**, stated plainly, not a menu of options.
- The **reasoning**, including what it gives up.
- **Numbers where numbers exist** — accuracy figures, battery measurements,
  storage estimates — with sources, and an explicit note where a figure is an
  estimate rather than measured.
- **Named failure modes** and what happens in each.
- A **staged plan**: what to ship first to learn something real, and what to hold
  until that data exists.
- Where you disagree with §4, say so directly and show why.

## 7. What not to suggest

- Anything that stores coordinates.
- Background location for public or non-resident users.
- Continuous or high-frequency tracking.
- Presenting a location log as an attendance grade or a percentage.
- Ejecting from Expo managed workflow unless nothing else can work — and if so,
  say what specifically forces it.
