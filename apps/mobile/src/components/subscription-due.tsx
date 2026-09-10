import { router } from "expo-router";
import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ListRow } from "@/components/ui/list-row";
import { Money } from "@/components/ui/money";
import { Text } from "@/components/ui/text";
import { useDates } from "@/hooks/use-dates";
import { type AdminSubscription, hasClaimInReview } from "@/lib/admin-api";

/**
 * "Pay this much, by this date" — the plan shortfall a team registration leaves.
 *
 * ## Why this card exists at all
 *
 * A hostel our field team registered goes live the moment the agent submits it,
 * whether or not the owner paid the whole plan price that day. Anything short
 * becomes a due, and the owner is then running a published listing while owing
 * money — so the reminder has to reach them where they actually work, which for
 * most hostel owners is the phone rather than the portal.
 *
 * ## Why it is a card and not a strip
 *
 * `NOTES.md` §11: two registers of information in one card, separated by a rule
 * — the claim on top, the position below it. That is exactly the shape of this
 * message. The amount and what it is for lead; the deadline and the action sit
 * under a hairline. A one-line coloured strip could carry the number but not the
 * date, and the date is the half that makes it actionable.
 *
 * The tone is `warning`, not `destructive`. Nothing has gone wrong — an agreement
 * is being honoured on a schedule — and painting it red would make an ordinary
 * instalment look like a suspension notice.
 *
 * ## It renders nothing far more often than it renders
 *
 * Every hostel that registered itself paid before it was published, so it never
 * owes anything and never sees this. `PAST_DUE` with money actually outstanding
 * is the only state that produces a card; everything else returns `null` rather
 * than an empty state, because there is no news to give.
 *
 * ## Two states, and the second one exists to stop a hostel paying twice
 *
 * A balance stays outstanding while a manual payment claim is being reviewed —
 * only settled money moves it — so an owner who paid an hour ago and sent us
 * the screenshot would otherwise be looking at exactly the card they were
 * looking at before, `Pay now` and all. The natural reading of that is that the
 * first attempt did not take. So while a claim is in review the card says so
 * and the button goes; the amount stays, because it is still owed and the card
 * would be lying by omission without it.
 *
 * ## The card navigates rather than paying
 *
 * `Pay now` used to open a confirm dialog whose confirm button *recorded a
 * payment* from the phone. It cannot: a client saying money arrived is not
 * evidence that it did, and the endpoint behind that dialog had already
 * dropped the branch it was calling. It opens `manage/pay-plan` now, which
 * shows our QR and takes the owner's proof.
 */
export function SubscriptionDueCard({
  state,
}: {
  state: AdminSubscription | null;
}) {
  const dates = useDates();

  if (
    !state ||
    state.subscription.status !== "PAST_DUE" ||
    state.outstanding <= 0
  ) {
    return null;
  }

  const reviewing = hasClaimInReview(state);

  /*
   * The date, in the reader's own calendar — not "in 12 days".
   *
   * A countdown has to read the clock during render, which is impure and gives
   * a number that silently goes stale on a screen somebody leaves open. The date
   * is also the more useful half: an owner arranging a payment needs the day
   * they have to hit, and `useDates` gives it to them in Bikram Sambat if that
   * is what they read the rest of the app in.
   */

  return (
    <Card className="gap-3 border-warning/40 bg-warning/5">
      <ListRow
        icon={reviewing ? "time-outline" : "alert-circle-outline"}
        right={<Money owed size="large" value={state.outstanding} />}
        subtitle={
          reviewing
            ? "We are checking the proof you sent"
            : state.subscription.planName
              ? `Balance on your ${state.subscription.planName}`
              : "Balance on your plan"
        }
        title={reviewing ? "Payment in review" : "Payment due"}
      />

      {/*
        Date on its own line, buttons on the next. They shared one row until a
        device showed the long form of a BS date ("Aswin 8, 2083 BS · Thursday")
        plus two buttons is wider than a 360dp card, and `Pay now` — the one
        control this card exists for — was pushed past the border.
      */}
      <View className="gap-3 border-t border-border pt-3">
        <Text variant="caption">
          {reviewing
            ? "We will email you within 1–2 working days. Your plan keeps working until then."
            : state.subscription.dueBy
              ? `Pay by ${dates.dateLong(state.subscription.dueBy)}`
              : "Your listing stays live in the meantime."}
        </Text>

        <View className="flex-row items-center justify-end gap-2">
          {/*
            A way out of the card that is not paying.
            The owner reading this may want the invoice — to check what the
            balance is actually for, to forward it to whoever holds the money,
            or to see what was already collected in the field. Sending them to
            hunt for it under More is how a due card becomes something people
            dismiss rather than act on. Quiet variant, because Pay now is still
            the thing this card is asking for.
          */}
          <Button
            label="View billing"
            onPress={() => router.push("/manage/billing")}
            size="sm"
            variant="ghost"
          />

          {/*
            Gone while a claim is in review. See the header comment: the one
            thing this card must never do is invite a second payment for money
            we already have proof of.
          */}
          {reviewing ? null : (
            <Button
              label="Pay now"
              onPress={() => router.push("/manage/pay-plan")}
              size="sm"
              variant="primary"
            />
          )}
        </View>
      </View>
    </Card>
  );
}
