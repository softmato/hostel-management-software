import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/text";

/**
 * Stands in for a section the resident has not shared.
 *
 * Used **once per screen at most**, never per section: the point of gating is
 * that an ungranted section is absent, so a list of six "not shared" cards
 * would reinstate exactly the leak the gating prevents — it tells the guardian
 * what exists behind each flag and invites them to press the resident about it.
 * A screen whose entire subject is ungranted says so, plainly, and stops.
 *
 * It is also the **whole** of such a screen. Both callers used to draw a
 * `<GuardianWardCard>` above this — an identity block over a refusal, which
 * reads as one empty section of a working screen rather than as the answer to
 * everything on it. The ward's identity is the hero on Home now, which is the
 * one place it belongs.
 *
 * ## This file used to be `guardian-ward-card.tsx`
 *
 * That component — an avatar, three lines and a `Call` button in a bordered box
 * — was Home's and Safety's lead. It is `<GuardianWardHero>` in
 * `components/guardian-home.tsx` now: the painted account card both other
 * portals lead with, with the office's number in its second register. Nothing
 * was dropped in the move; the file simply stopped being about a ward card.
 */
export function GuardianNotShared({
  subject,
  wardName,
}: {
  /** Lower-case noun phrase: "fees and dues", "night status". */
  subject: string;
  wardName: string;
}) {
  return (
    <Card className="gap-2">
      <Text variant="subtitle">Not shared with you</Text>
      <Text variant="muted">
        {`${wardName} has not shared ${subject} with this guardian account. They can change that from their own portal.`}
      </Text>
    </Card>
  );
}
