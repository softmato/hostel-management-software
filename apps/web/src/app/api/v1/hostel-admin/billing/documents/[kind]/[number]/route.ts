import type { NextRequest } from "next/server";

import { requireHostelStaffPrincipal } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-response";
import {
  resolveInvoiceDocument,
  resolveReceiptDocument,
} from "@/modules/billing/documents/deliver";

type RouteContext = { params: Promise<{ kind: string; number: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams a plan invoice or receipt to the hostel it belongs to.
 *
 * ## Why the bytes come through here at all
 *
 * Softmato's `document_url` is an API address that needs our **client secret**
 * in an `Authorization` header. Emailing it to an owner would hand them a link
 * that 401s; putting the secret in a browser to fix that would publish it. So
 * the document is fetched server-side and streamed from a route that
 * authenticates the reader as somebody entitled to this hostel's paperwork.
 *
 * That reasoning now covers a second case. When Softmato cannot be reached we
 * issue the document ourselves, and it is rendered on demand from rows rather
 * than stored — so there is no URL to hand out for it either. Both kinds arrive
 * through one call (`documents/deliver.ts`), and this route does not know or
 * care which side printed the page it is sending.
 *
 * ## Tenancy is ours to enforce
 *
 * Every hostel on this platform shares one Softmato credential. To their API,
 * one hostel asking for another hostel's receipt is the same application asking
 * for its own document, and it would be served. So the scope passed below is
 * not defence in depth — it is the only check there is.
 *
 * A document belonging to another hostel answers `404`, the same as one that
 * does not exist. There is nothing to learn from the difference.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelStaffPrincipal(request);
    const { kind, number } = await context.params;

    if (kind !== "invoice" && kind !== "receipt") {
      return new Response("Not found", { status: 404 });
    }

    const hostelIds = principal.hostelIds ?? [];

    if (hostelIds.length === 0) {
      return new Response("Not found", { status: 404 });
    }

    const documentNumber = decodeURIComponent(number);
    const document =
      kind === "invoice"
        ? await resolveInvoiceDocument(documentNumber, hostelIds)
        : await resolveReceiptDocument(documentNumber, hostelIds);

    if (!document) {
      return new Response("Not found", { status: 404 });
    }

    return new Response(new Uint8Array(document.bytes), {
      headers: {
        "Content-Disposition": `attachment; filename="${document.filename}"`,
        "Content-Type": document.contentType,
        // A financial document is per-reader. No shared cache may hold it.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
