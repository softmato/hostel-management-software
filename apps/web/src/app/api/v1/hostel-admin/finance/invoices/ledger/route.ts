import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { getHostelLedger } from "@/modules/finance/invoice-list.service";
import { resolveAdminHostelId } from "@/modules/hostels/hostel.service";

export const runtime = "nodejs";

const querySchema = z.object({
  hostelId: z.string().optional(),
});

/**
 * The hostel's whole transaction ledger, newest first.
 *
 * Separate from `GET /finance/invoices` on purpose: that route is the month
 * matrix — one row per resident for one period — and the Transactions screen
 * wants every invoice this hostel has ever raised, including the one-off
 * admission fees that belong to no period and so appear in no month of the
 * matrix. The screen used to call the matrix route and read a `payments` key it
 * never returned, which is why the table was permanently empty.
 *
 * **Reads never bill.** Same rule as the matrix.
 */
export async function GET(request: NextRequest) {
  try {
    const principal = await requireHostelCapability(request, "viewPayments");
    const query = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const hostelId = resolveAdminHostelId(principal, query.hostelId);

    return successResponse(await getHostelLedger(hostelId), "Transactions");
  } catch (error) {
    return handleRouteError(error);
  }
}
