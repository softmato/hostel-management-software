import type { NextRequest } from "next/server";

import { requireResidentPrincipal } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-response";
import { renderStatementForResident } from "@/modules/finance/receipt.service";
import { findCurrentResident } from "@/modules/residents/resident-access";

export const runtime = "nodejs";

/**
 * The resident's payment statement as a PDF (current §7.12).
 *
 * The "Download Statement" button has had no handler since it was built, so a
 * resident asked for proof of rent by a landlord, a bank or a visa office had
 * nothing the product could give them. Always the caller's own statement — there
 * is no id in the path, so there is nothing to enumerate.
 */
export async function GET(request: NextRequest) {
  try {
    const principal = await requireResidentPrincipal(request);
    const resident = await findCurrentResident(principal);

    const bytes = await renderStatementForResident({
      hostelId: resident.hostelId,
      residentId: resident._id,
      residentName:
        [resident.firstName, resident.lastName].filter(Boolean).join(" ") || "Resident",
    });

    return new Response(bytes as BodyInit, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": 'attachment; filename="statement.pdf"',
        "Content-Type": "application/pdf",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
