import { NextResponse, type NextRequest } from "next/server";

import { requireApiPrincipal } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-response";
import { canSubscribeToChannel } from "@/lib/realtime/access";
import { authorizeRealtimeChannel } from "@/lib/realtime/server";

export const runtime = "nodejs";

/**
 * Pusher private-channel authorisation endpoint.
 *
 * Called by pusher-js on every subscribe. It posts `socket_id` and
 * `channel_name` as form-encoded fields and expects the bare `{ auth }` body
 * back — so this route deliberately skips the usual success envelope.
 *
 * This is the gate that makes the channels private: without the signature check
 * here, knowing a hostel id would be enough to listen in on its notifications.
 */
export async function POST(request: NextRequest) {
  try {
    const principal = await requireApiPrincipal(request);
    const form = await request.formData();
    const socketId = String(form.get("socket_id") ?? "");
    const channel = String(form.get("channel_name") ?? "");

    if (!socketId || !channel) {
      return NextResponse.json({ error: "Missing socket_id or channel_name" }, {
        status: 400,
      });
    }

    if (!canSubscribeToChannel(principal, channel)) {
      return NextResponse.json({ error: "Forbidden channel" }, { status: 403 });
    }

    const auth = authorizeRealtimeChannel(socketId, channel);

    if (!auth) {
      return NextResponse.json({ error: "Realtime is not configured" }, { status: 503 });
    }

    return NextResponse.json(auth);
  } catch (error) {
    return handleRouteError(error);
  }
}
