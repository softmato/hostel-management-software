import type { NextRequest } from "next/server";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import {
  deleteTeamMember,
  reinstateTeamMember,
  removeTeamMember,
  suspendTeamMember,
} from "@/modules/team/team-member.service";
import {
  teamMemberActionSchema,
  teamMemberDeleteModeSchema,
} from "@/modules/team/team-member.validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export const runtime = "nodejs";

/**
 * Suspending a member, and lifting it again.
 *
 * Superadmin only, matching every other endpoint under `/platform/team` — a
 * platform moderator moderates content and has no business ending a colleague's
 * access or reading what they collected.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const { id } = await context.params;
    const { action } = teamMemberActionSchema.parse(await request.json());

    if (action === "SUSPEND") {
      return successResponse(
        await suspendTeamMember(id, principal),
        "Team member suspended",
      );
    }

    return successResponse(
      await reinstateTeamMember(id, principal),
      "Team member reinstated",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * Ending somebody's place on the team, in one of two strengths.
 *
 * `?mode=remove` (the default) revokes the platform grant and hands the account
 * back the role it held before the invitation took it over. `?mode=delete`
 * destroys the account, and the service refuses unless nothing points at it.
 *
 * The mode rides in the query string rather than a body because DELETE bodies
 * are inconsistently forwarded by proxies and fetch implementations, and a mode
 * that silently fails to arrive would default to the wrong half of a pair where
 * one half is irreversible.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const { id } = await context.params;
    const mode = teamMemberDeleteModeSchema.parse(
      request.nextUrl.searchParams.get("mode") ?? undefined,
    );

    if (mode === "delete") {
      return successResponse(await deleteTeamMember(id, principal), "Account deleted");
    }

    return successResponse(
      await removeTeamMember(id, principal),
      "Removed from the team",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
