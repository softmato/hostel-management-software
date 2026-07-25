import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { setResidentMonthlyFee } from "@/modules/payments/payment.service";
import { residentFeeUpdateSchema } from "@/modules/payments/payment.validation";

export const runtime = "nodejs";

/** Set the recurring monthly fee for one, several, or all active residents. */
export async function PATCH(request: NextRequest) {
  try {
    const principal = await requireHostelCapability(request, "verifyPayments");
    const input = residentFeeUpdateSchema.parse(await request.json());
    const result = await setResidentMonthlyFee(input, principal);

    return successResponse(result, "Monthly fee updated");
  } catch (error) {
    return handleRouteError(error);
  }
}
