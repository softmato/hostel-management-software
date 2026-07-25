import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import {
  generateActivationCode,
  regenerateActivationCode,
} from "@/modules/residents/activation.service";
import { activationCodeGenerateSchema } from "@/modules/residents/activation.validation";

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
    const input = activationCodeGenerateSchema.parse(await request.json());
    const result = await generateActivationCode(id, input, principal);

    return successResponse(result, "Activation code generated", { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelCapability(request, "registerResidents");
    const { id } = await context.params;
    const input = activationCodeGenerateSchema.parse(await request.json());
    const result = await regenerateActivationCode(id, input, principal);

    return successResponse(result, "Activation code regenerated");
  } catch (error) {
    return handleRouteError(error);
  }
}
