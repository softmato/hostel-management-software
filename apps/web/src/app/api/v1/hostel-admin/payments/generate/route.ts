import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { generateMonthlyPayments } from "@/modules/payments/payment.service";
import { monthlyPaymentGenerateSchema } from "@/modules/payments/payment.validation";

export const runtime = "nodejs";

/** Fee run: create this month's payment records for active residents. */
export async function POST(request: NextRequest) {
  try {
    const principal = await requireHostelCapability(request, "verifyPayments");
    const input = monthlyPaymentGenerateSchema.parse(await request.json());
    const result = await generateMonthlyPayments(input, principal);

    return successResponse(result, "Monthly payments generated", { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
