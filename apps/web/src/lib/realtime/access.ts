import type { ApiPrincipal } from "@/lib/api-auth";
import { PLATFORM_ROLES } from "@/lib/permissions";
import {
  GLOBAL_CHANNEL,
  PLATFORM_CHANNEL,
  hostelChannel,
  userChannel,
} from "@/lib/realtime/channels";

/**
 * Which private channels a principal is allowed on.
 *
 * One policy, two callers: `/realtime/config` uses it to tell the browser what
 * to subscribe to, and `/realtime/auth` uses it to sign — so a client cannot
 * widen its own reach by asking the auth endpoint for a channel the config
 * endpoint never offered. Hostel scope comes from the access token's
 * `hostelIds`, the same claim every tenant-scoped route trusts.
 */

export function realtimeChannelsFor(principal: ApiPrincipal) {
  // Everyone authenticated gets their own feed plus the global broadcast.
  const channels = [userChannel(principal.userId), GLOBAL_CHANNEL];

  for (const hostelId of principal.hostelIds) {
    channels.push(hostelChannel(hostelId));
  }

  if (PLATFORM_ROLES.includes(principal.role)) {
    // Platform staff watch the approval and application queues, which are not
    // scoped to any one hostel.
    channels.push(PLATFORM_CHANNEL);
  }

  return channels;
}

export function canSubscribeToChannel(principal: ApiPrincipal, channel: string) {
  return realtimeChannelsFor(principal).includes(channel);
}
