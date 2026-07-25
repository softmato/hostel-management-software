import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { createGuardianAccess } from "@/modules/guardian/guardian.service";
import { guardianAccessCreateSchema } from "@/modules/guardian/guardian.validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelCapability(request, "registerResidents");
    const { id } = await context.params;
    const input = guardianAccessCreateSchema.parse(await request.json());
    const result = await createGuardianAccess(id, input, principal);

    return successResponse(result, "Guardian access created", { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
