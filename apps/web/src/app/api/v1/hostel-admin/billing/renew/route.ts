import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireHostelAdminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { raiseRenewalInvoice } from "@/modules/billing/subscription.service";

export const runtime = "nodejs";

const bodySchema = z.object({
  cycle: z.enum(["monthly", "halfYearly", "annual"]),
  planId: z.string().trim().min(1),
});

/**
 * "Pay for this plan" and "Upgrade plan" on Plan billing: raises the invoice
 * that extends the running plan (on the same plan, or a bigger one). Paying it
 * goes through the Pay your plan panel like any other plan invoice.
 */
export async function POST(request: NextRequest) {
  try {
    const principal = await requireHostelAdminPrincipal(request);
    const hostelId = principal.hostelIds?.[0];

    if (!hostelId) {
      throw Object.assign(new Error("No hostel in scope."), { errorCode: "NO_HOSTEL", status: 400 });
    }

    const { reused } = await raiseRenewalInvoice(
      hostelId,
      bodySchema.parse(await request.json()),
      principal.userId,
    );

    return successResponse({ reused }, reused ? "Invoice already open" : "Invoice raised", {
      status: 201,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
