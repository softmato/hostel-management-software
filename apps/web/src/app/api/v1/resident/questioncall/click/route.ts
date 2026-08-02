import type { NextRequest } from "next/server";

import { requireResidentPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { trackQuestionCallClick } from "@/modules/questioncall/questioncall.service";
import { questionCallClickSchema } from "@/modules/questioncall/questioncall.validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const principal = await requireResidentPrincipal(request);
    const input = questionCallClickSchema.parse(await request.json().catch(() => ({})));
    const result = await trackQuestionCallClick(input, principal);

    return successResponse(result, "QuestionCall click recorded");
  } catch (error) {
    return handleRouteError(error);
  }
}
