import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { updatePaymentRecord } from "@/modules/payments/payment.service";
import { paymentUpdateSchema } from "@/modules/payments/payment.validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelCapability(request, "verifyPayments");
    const { id } = await context.params;
    const input = paymentUpdateSchema.parse(await request.json());
    const result = await updatePaymentRecord(id, input, principal);

    return successResponse(result, "Payment updated");
  } catch (error) {
    return handleRouteError(error);
  }
}
