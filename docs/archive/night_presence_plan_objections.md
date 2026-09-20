# Objections to the Night Presence plan v1.0

Reply to the plan you produced (`plan.md`, "HostelHub — Automatic Night
Presence", primary signal Wi-Fi BSSID). Written to be answered point by point.

**Ground rules for your reply.**

1. **Do not quote schedules.** No "1 week", no "2 weeks", no day counts anywhere.
   Sequence and dependency only. Strip the durations out of your phase headings.
2. **Our codebase is not a constraint.** Missing libraries, absent native
   modules, schema rewrites, custom dev builds, rewiring existing modules — all
   of that is just work and we will do it. Never soften a recommendation because
   it needs new code. Only external limits count: OS restrictions, store policy,
   the hostel's own hardware, physics.
3. Answer with a decision, not a menu. Where you disagree with an objection
   below, say so and show why.

---

## Already settled — do not re-argue these

- The Wi-Fi-first direction is accepted. GPS as the primary night signal is dead.
- Accuracy gating (§1.4) is accepted and will ship regardless.
- "Needs check", never an automatic "absent", is accepted as UI language.
- The three-collection split and the 90/600 day retention split are accepted.
- Shadow mode before showing wardens anything is accepted.

---

## 1. You solved the wrong side of the problem — the phone, not the network

This is the largest objection. Everything painful in the plan — iPhone
restrictions, Xiaomi and Realme battery killers, Play Store declarations,
foreground-service tricks, silent push that may never arrive, battery cost —
exists **only because you decided the phone must observe itself and report in.**

There is a second architecture you never considered: **observe from the network
side.** The hostel's router already knows every device associated with it, all
night, with no app running, no permission, no push, no battery, and no
difference between Android and iPhone. A small always-on box on the hostel LAN
(a cheap OpenWrt router, a Pi, or the existing router where its firmware allows)
can report the set of associated devices to our server on a schedule we choose.

The obvious counter is MAC randomisation — but a randomised Wi-Fi address is
**stable per network** on both current Android and iOS. So it needs binding
once, not nightly. One clean way to bind without any special permission on the
phone: the app reports its **local IP** (readable with no permission on both
platforms) during enrolment or any ordinary foreground use; the hostel-side box
maps that local IP to a hardware address at that moment; from then on the box
alone sees that resident every night, and the phone does nothing at all.

Answer specifically:

- Why was network-side detection not evaluated? The brief explicitly asked for
  "anything we have not thought of" and this is the obvious member of that set.
- Does it not eliminate, in one move: background location permission, the Play
  Store declaration and demo video, the OEM battery-optimiser failure mode, the
  entire iOS problem, push delivery uncertainty, and battery cost?
- What are its real failure modes? Hostel has no manageable router. Hostel Wi-Fi
  is a chain of dumb repeaters. Box loses power or internet. Resident's phone
  rotates its address. Hostel refuses to plug in our hardware. Rank these
  honestly against the failure modes of the phone-side design.
- What is the correct **hybrid**: box where the hostel accepts one, phone-side
  Wi-Fi read where it does not?
- If you still prefer phone-side after considering this, say why in terms of
  something other than "it needs no hardware".

## 2. The server never looks at where the request came from

A phone on hostel Wi-Fi reaches our API through the hostel's internet
connection. The **source IP of the request is observed by our server**, not
reported by the client, so a modified app cannot forge it. You never mention
this once.

Two consequences you did not draw:

- It is the only signal in the whole design that a hostile client cannot fake.
  Everything else — BSSID, coordinates, timestamps — is a string the phone
  chooses to send.
- It means **no dedicated ping is needed at all** for a large share of
  residents. Any authenticated API call the app makes during the night window —
  opening the app, loading notices, checking an invoice — is already a sighting.
  Free, silent, identical on iPhone and Android, no permission, no battery, no
  store review.

Answer:

- Why is this not in the plan?
- Can the hostel's public IP be learned the same way you propose learning
  BSSIDs — a set of addresses seen from many distinct residents — instead of
  being configured?
- What does carrier-grade NAT do to it in Nepal specifically, where residential
  and small-business fibre increasingly shares public addresses? Under CGNAT a
  match is weaker evidence. Is it still worth having as corroboration, and how
  should confidence be graded when IP matches but Wi-Fi does not, and the
  reverse?
- Does it change your verdict table? Give the revised table.

## 3. Your verdict rule throws away time, which is the thing the owner asked for

We are keeping multiple samples across the night. Sampling frequency was never
the constraint — sending more pings is trivial for us.

The real problem is §8.3: **"≥ 1 Wi-Fi match on an ACTIVE network → PRESENT,
HIGH"**, with no reference to *when* the match happened. A resident seen at
19:05 who walks out at 21:00 is `PRESENT / HIGH` for the whole night. The skip
rule in §6.2 makes this worse by stopping observation the moment the weakest
possible evidence arrives.

The owner's requirement was presence **at night**, not attendance at the
building some time after dinner.

Answer:

- Give a verdict rule that is time-aware. Our starting position: a night is
  `PRESENT` only if there is at least one match **after the hostel's curfew
  time** (configurable, typically 22:00). An evening-only match is its own
  state — seen early, not seen after curfew — and it is *not* the same as
  present.
- Should the skip rule be re-scoped to "stop sampling once a **post-curfew**
  match exists" rather than "once any match exists"?
- What should the record keep — first and last sighting, or the full set of
  sighting times? Argue it against the privacy position, because a full timeline
  of when a resident's phone was on the network is more revealing than a single
  nightly verdict.
- Does the warden board need to distinguish "in all night" from "in at 7, gone
  by 10"? We think yes. If you disagree, say why.

## 4. Your anti-spoofing argument does not hold

§7.2 says server-side matching means a client "cannot trivially fake a match".
It can. The client sends a string. Anyone can send any string. Worse, a resident
can clone the hostel's access-point address onto a phone hotspot or a cheap
router at home, and then the honest, unmodified app reports a genuine match from
anywhere in the country.

§11 dismisses this as "low expected prevalence". In a hostel full of engineering
students with a curfew, that assumption will not survive first contact.

Answer:

- What actually binds a claimed match to the physical building? Source IP (§2)
  is one answer. Are there others — a challenge value served by a hostel-side
  box, correlation between the local IP the phone claims and the subnet the
  hostel actually uses, agreement between several residents' reports at the same
  moment?
- Give a concrete detection rule for the cloned-AP case: one resident reporting
  a match from a public IP that no other resident of that hostel is ever seen
  from is a strong tell. Where should that live?

## 5. iOS — give a definitive answer, not a caveat

The plan assumes reading the connected access point is cheap and always
available. On iPhone this is the least certain part of the entire design and you
treat it in one line.

Answer precisely:

- Name the exact API and entitlement required to read the connected network's
  identifier on current iOS.
- State whether it returns a value when the app is **backgrounded**, when it is
  **woken by a silent push**, and when the user has **force-quit** it.
- State what location authorisation level it requires, and whether "while using
  the app" is sufficient or whether it demands "always".
- If Phase 2 (push wakes the phone, phone reads Wi-Fi, phone reports) does not
  function on iOS, say so plainly and give the iOS-specific design instead. Do
  not describe a mechanism that only works on Android as if it were the design.

## 6. Android — you understated what the store still asks for

§6.5 presents the short-lived foreground service as avoiding store scrutiny.
Two things you did not cover:

- A foreground service declaring a location type now requires its own Play
  Console declaration and justification, separate from background location. It
  is easier than the background-location process, but "no review risk" is wrong.
- Recent Android versions block starting a foreground service from the
  background. The usual exemption is a high-priority message from the push
  service. Confirm this exemption exists, confirm it survives Expo's push
  infrastructure, and state exactly what happens when it does not apply — does
  the wake silently do nothing?

Also state what the OEM autostart whitelists on Xiaomi, Redmi, Realme and Oppo
actually gate, and whether there is any in-app flow that can get a resident to
grant it.

## 7. Your auto-learning list is a privacy leak, and you present it as a privacy feature

§4.5 stores an unrecognised access-point identifier **together with the list of
residents who saw it**, for fourteen days. An unrecognised network is, most of
the time, the resident's own home, a friend's flat, or a café. That is a
fourteen-day trail of where residents go, held in our database, in a product
whose §12.1 rule one is that no location is ever written to disk.

Answer:

- Does storing a one-way scrambled form of the identifier still allow matching?
  It should — the incoming value can be scrambled the same way before lookup.
- Can the resident list be replaced with a distinct-count that cannot be
  reversed to individuals, given the promotion threshold only needs "at least
  three different residents"?
- If neither works, justify keeping the trail explicitly rather than describing
  it as privacy-protecting.

## 8. We are rejecting §8.7 — now reconcile the contradiction that creates

We are keeping the existing absence-alert behaviour: a night with no reading
counts toward the absence streak. The guardian alert when a resident stops
appearing is a large part of what the hostel is paying for, and we are not
turning it into something only a warden can trigger by hand.

That collides head-on with your own strongest rule — "the system may never write
ABSENT". If a missing signal still escalates to a guardian, the system is
calling someone absent through the back door, and every failure mode in §11
(dead battery, Wi-Fi off, OEM killer, iPhone force-quit) becomes a false alarm
sent to a parent.

Answer:

- Resolve this without weakening the alert. Options we want considered, not a
  survey: require the streak to consist of nights that were *observable* —
  nights where the phone produced evidence of being reachable but not present;
  require a warden to have been shown the resident on the check list some number
  of times first; escalate to the warden before the guardian and let the warden's
  inaction be the trigger.
- Whatever you pick, define the exact condition and the exact message the
  guardian sees.

## 9. Being on the Wi-Fi is not being in the building

§0 calls a Wi-Fi association "proof that the phone is inside the building". An
access point covers the street, the shop across the lane and the neighbouring
roof. Give the honest claim and use it consistently in the UI wording table —
"on the hostel network" is defensible, "inside the building" is not.

## 10. "The current AttendanceLog must go" is stated without a path

That collection is read in eight places, including the resident's own history
screen, the operations analytics, and the account-deletion routine. Give the
migration: what happens to existing rows, whether history is converted or
retained in parallel, and what the resident sees on the boundary night.

## 11. Internal inconsistencies to fix in v2

- §6.1 posts `source: "GPS_ATTEMPT"`, which is not in the `source` enum in §4.3.
- §12.4 sets `gpsFallbackEnabled: false` until Phase 4, but §6.1 describes GPS
  fallback as part of the core routine from the start.
- §4.6 puts a fixed 90-day expiry on samples while §12.4 exposes a per-hostel
  `sampleRetentionDays`. A fixed expiry cannot honour a per-hostel value. Pick
  one or state which wins.
- §4.7 says erasure happens "in one transaction". Multi-collection transactions
  in MongoDB require a replica set. Either state that requirement or drop the
  word and give an ordered, resumable deletion instead.
- §11 says the server "clamps `nightDate` to a sane range around `receivedAt`"
  without defining the clamp. Define it.

## 12. Two product questions the plan never asks

- **A hostel with no Wi-Fi, or Wi-Fi that reaches half the rooms.** Your design
  gives that customer nothing but a "needs check" list containing everyone,
  which is worse than what they have today. What do they get?
- **Consent is revocable and the feature dies without it.** Nothing in the plan
  addresses why a resident would agree to this, or what the hostel may do when
  they refuse. What is the resident-facing case for saying yes, and what is the
  rule when a resident revokes — does the hostel get told, and does refusal have
  consequences the resident should be warned about up front?

---

## What we want back

A v2 of the plan, not a defence of v1. Specifically:

1. A decision on phone-side versus network-side detection, with the hybrid
   spelled out.
2. Source IP folded into the design, or a reasoned rejection of it.
3. A time-aware verdict rule with a post-curfew requirement.
4. A definitive iOS answer with the API named.
5. The absence-alert contradiction resolved with the alert intact.
6. The staging privacy hole closed.
7. The inconsistencies in §11 above corrected.

No day counts anywhere in it.
