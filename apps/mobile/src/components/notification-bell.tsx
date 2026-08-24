import { router } from "expo-router";
import { useCallback } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useAppSelector } from "@/hooks/redux";
import { useResource } from "@/hooks/use-resource";
import { listNotifications, type NotificationFeed } from "@/lib/notifications-api";

/**
 * The bell, and the unread count on it.
 *
 * ## Why a role's app bar has one at all
 *
 * `/notifications` is scoped to `principal.userId` with no role branch, so every
 * signed-in account already has a feed — an admin's includes the claim
 * notifications `notifyAdminsOfClaim` writes and the SOS fan-out to wardens.
 * The public home had the only bell in the app, which meant a hostel admin's
 * notifications were reachable only by leaving their own tabs. Same control,
 * same destination, now on the screens where the alerts are about.
 *
 * ## It is not the action queue
 *
 * The bell is the chronological record of what the platform sent you. The
 * decisions — verify this claim, reply to this complaint — live on the tab that
 * owns them, with the money and the evidence next to them. Two surfaces, and on
 * purpose: a notification you have read is done with, whereas a claim stays in
 * the queue until somebody decides.
 */
export function NotificationBell({
  /** Passed through to `IconButton` — `onAccent` on a painted app bar or hero. */
  tone = "default",
}: {
  tone?: "default" | "onAccent";
} = {}) {
  const account = useAppSelector((state) => state.auth.account);

  /*
   * No account, no request — `useResource` fetches on mount and on every
   * refocus, so a signed-out shell would otherwise send a 401 per visit.
   *
   * `notifications` as a topic makes the count live: the socket publishes it on
   * `notification:new`, so the badge moves while the app is open without a poll.
   */
  const feed = useResource<NotificationFeed>(
    useCallback(
      async () =>
        account
          ? await listNotifications("unread")
          : { actionCount: 0, notifications: [], unreadCount: 0 },
      [account],
    ),
    { topics: [REALTIME_TOPIC.NOTIFICATIONS] },
  );

  // A failed count is not worth reporting from an app bar: the bell shows no
  // badge, which is what it shows when there is nothing unread anyway.
  const unread = feed.data?.unreadCount ?? 0;

  return (
    <IconButton
      badge={unread}
      label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      name="notifications-outline"
      onPress={() => router.push("/notifications")}
      tone={tone}
    />
  );
}
