import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-response";
import { renderReceiptById } from "@/modules/finance/receipt.service";

export const runtime = "nodejs";

/** A hostel's receipt as a PDF, scoped to the hostels the principal may see. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const principal = await requireHostelCapability(request, "viewPayments");
    const { id } = await context.params;

    const { bytes, receiptNumber } = await renderReceiptById(id, {
      hostelIds: principal.hostelIds,
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
