import type { NextRequest } from "next/server";

import { requirePlatformPrincipal } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-response";
import {
  resolveInvoiceDocument,
  resolveReceiptDocument,
} from "@/modules/billing/documents/deliver";

type RouteContext = { params: Promise<{ kind: string; number: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The same document, for the platform, on any hostel.
 *
 * A separate route rather than a flag on the hostel one, because the two differ
 * in the single thing that matters about them — who may read whose paperwork —
 * and a shared handler taking a "scope everything" switch is one careless
 * refactor away from serving every hostel's invoices to a warden. The scope is
 * decided by which file the request landed in.
 *
 * `null` below is the platform's entitlement, spelled out. It is passed
 * explicitly rather than by omitting an argument so that nobody reaches
 * unscoped access by forgetting one.
 *
 * This is what makes the superadmin ledger's download work at all: those rows
 * belong to hostels the reader is not staff of, so the hostel route would
 * answer `404` for every one of them.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    await requirePlatformPrincipal(request);

    const { kind, number } = await context.params;

    if (kind !== "invoice" && kind !== "receipt") {
      return new Response("Not found", { status: 404 });
    }

    const documentNumber = decodeURIComponent(number);
    const document =
      kind === "invoice"
        ? await resolveInvoiceDocument(documentNumber, null)
        : await resolveReceiptDocument(documentNumber, null);

    if (!document) {
      return new Response("Not found", { status: 404 });
    }

    return new Response(new Uint8Array(document.bytes), {
      headers: {
        "Content-Disposition": `attachment; filename="${document.filename}"`,
        "Content-Type": document.contentType,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
