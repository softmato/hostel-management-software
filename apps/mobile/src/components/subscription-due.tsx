import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ListRow } from "@/components/ui/list-row";
import { Money } from "@/components/ui/money";
import { Text } from "@/components/ui/text";
import { useDates } from "@/hooks/use-dates";
import type { AdminSubscription } from "@/lib/admin-api";

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
 */
export function SubscriptionDueCard({
  busy = false,
  onPay,
  state,
}: {
  busy?: boolean;
  onPay: () => void;
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
        icon="alert-circle-outline"
        right={<Money owed size="large" value={state.outstanding} />}
        subtitle={
          state.subscription.planName
            ? `Balance on your ${state.subscription.planName}`
            : "Balance on your plan"
        }
        title="Payment due"
      />

      <View className="flex-row items-center justify-between gap-3 border-t border-border pt-3">
        <Text variant="caption">
          {state.subscription.dueBy
            ? `Pay by ${dates.dateLong(state.subscription.dueBy)}`
            : "Your listing stays live in the meantime."}
        </Text>

        <Button
          label="Pay now"
          loading={busy}
          onPress={onPay}
          size="sm"
          variant="primary"
        />
      </View>
    </Card>
  );
}
