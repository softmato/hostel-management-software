import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireTeamPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { TRACK_SHEET_EVENT } from "@/lib/realtime/channels";
import { publishTrackSheet } from "@/lib/realtime/server";

export const runtime = "nodejs";

const focusSchema = z.object({
  /** When they first got to the line — kept when a viewer says it again for a newcomer. */
  at: z.number().int().positive().optional(),
  /** A saved line's id, or `new-3` for the fourth line under the saved ones. Null: on no line. */
  line: z
    .string()
    .regex(/^([a-f\d]{24}|new-\d{1,4})$/i)
    .nullable(),
});

/**
 * "I'm on this line" — or on none — passed to everyone else on the track sheet.
 * `at` is what decides who may type in a line two people are on: whoever got
 * there first. It is the server's clock, so every screen agrees on the order.
 *
 * Sent through the server rather than as a Pusher client event, so it needs no
 * dashboard switch and the sender's name is the session's, never the browser's.
 */
export async function POST(request: NextRequest) {
  try {
    const principal = await requireTeamPrincipal(request);
    const input = focusSchema.parse(await request.json());
    const place = { at: input.at ?? Date.now(), line: input.line };

    await publishTrackSheet(TRACK_SHEET_EVENT.FOCUS, { ...place, userId: principal.userId });

    return successResponse(place, "Line shared");
  } catch (error) {
    return handleRouteError(error);
  }
}
