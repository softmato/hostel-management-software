import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { getMonthlyPaymentMatrix } from "@/modules/payments/payment.service";
import { paymentMatrixQuerySchema } from "@/modules/payments/payment.validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const principal = await requireHostelCapability(request, "verifyPayments");
    const query = paymentMatrixQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const result = await getMonthlyPaymentMatrix(query, principal);

    return successResponse(result, "Payment matrix loaded");
  } catch (error) {
    return handleRouteError(error);
  }
}
