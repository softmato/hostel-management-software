import type { NextRequest } from "next/server";

import { requireResidentPrincipal } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-response";
import { renderReceiptById } from "@/modules/finance/receipt.service";
import { findCurrentResident } from "@/modules/residents/resident-access";

export const runtime = "nodejs";

/**
 * A resident's receipt as a PDF (target §4.4, current §7.12).
 *
 * Scoped to the caller's own resident record, not to their hostel: a resident
 * may read their own receipts and nobody else's, and passing the id as the scope
 * means the query cannot return someone else's document even if the route is
 * called with a guessed id.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const principal = await requireResidentPrincipal(request);
    const resident = await findCurrentResident(principal);
    const { id } = await context.params;

    const { bytes, receiptNumber } = await renderReceiptById(id, {
      residentId: resident._id,
    });

    return new Response(bytes as BodyInit, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${receiptNumber}.pdf"`,
        "Content-Type": "application/pdf",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
