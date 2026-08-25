import { router } from "expo-router";

import { IdScanner } from "@/components/manage/id-scanner";

/**
 * The viewfinder — hold a resident's card up and read who they are.
 *
 * ## One job, and nothing else on the screen
 *
 * `ebl-01` and `esewa-01` both put a QR scanner behind the one circular button
 * in the middle of the tab bar, and `NOTES.md` §10 records that we did not adopt
 * the FAB because no single admin action earned it. Scanning a resident is that
 * action for a hostel owner standing in a corridor, and this is what it opens:
 * a camera, an aiming frame, and a way in for the card whose QR will not read.
 * There is deliberately no menu, no tabs and no second thing to do here.
 *
 * ## It rises from the bottom, and that is a claim about what it is
 *
 * Registered `slide_from_bottom` in `app/_layout.tsx`, alongside `sos`,
 * `complaints/new` and `id-card/edit`. Every other push in this app fades,
 * because a fade reads as *the destination resolving where you already are*.
 * This one is the other shape — a thing you open, use once, and dismiss — and
 * rising from the edge is what tells a thumb it can be thrown away again. The
 * chevron in the corner points **down** for the same reason.
 *
 * ## This one looks up; it does not admit
 *
 * The camera, the frame, the torch and the typed-id fallback all live in
 * `<IdScanner>`, which the intake step of `manage/resident/new` uses too. The
 * two must never be mistaken for each other from across a corridor, so this one
 * takes the **neutral** tone — white brackets, no step pill — and the intake
 * takes green with a "Step 1 of 3" badge above the title. Mistaking them costs a
 * wasted minute in this direction and a spent bed in the other.
 */
export default function ScanResidentScreen() {
  return (
    <IdScanner
      manualTitle="Resident ID"
      onClose={() => router.back()}
      onResidentId={(residentId) => router.push(`/manage/scan/${residentId}`)}
      subtitle="Hold the QR on their HostelHub ID card inside the frame."
      title="Look up a resident"
      tone="neutral"
    />
  );
}
