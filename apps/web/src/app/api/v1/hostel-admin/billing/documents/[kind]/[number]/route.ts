import { Types } from "mongoose";
import type { NextRequest } from "next/server";

import { requireHostelStaffPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { handleRouteError } from "@/lib/api-response";
import {
  documentFilename,
  downloadInvoiceFile,
  downloadReceiptFile,
} from "@/modules/billing/softmato/documents";
import { SubscriptionInvoiceModel } from "@hostel/db/models/SubscriptionInvoice";
import { SubscriptionPaymentModel } from "@hostel/db/models/SubscriptionPayment";

type RouteContext = { params: Promise<{ kind: string; number: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams an invoice or receipt PDF to the hostel it belongs to.
 *
 * ## Why this route exists at all
 *
 * Softmato's `document_url` is an API address that needs our **client secret**
 * in an `Authorization` header. Putting it in an email would hand an owner a
 * link that 401s; putting the secret in the browser to make it work would
 * publish the secret. So the bytes come through here, where the reader is
 * authenticated as this app's user and the secret never leaves the server.
 *
 * ## Tenancy is ours to enforce
 *
 * Softmato scopes documents to the calling *application*, and every hostel on
 * this platform shares one credential. To their API, one hostel asking for
 * another hostel's receipt is the same application asking for its own
 * document, and it would be served. So the ownership check below is not
 * defence in depth — it is the only check there is.
 *
 * A document belonging to another hostel answers `404`, the same as one that
 * does not exist. There is nothing to learn from the difference.
 *
 * ## The extension comes from the bytes
 *
 * A deployment with no PDF engine answers with a complete, printable HTML
 * rendering and a header saying so. It is a real document — it is just not a
 * PDF, and naming it `.pdf` hands the owner a file their reader refuses to
 * open. So the filename is decided from the content type we actually received,
 * never from what we asked for.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelStaffPrincipal(request);
    const { kind, number } = await context.params;

    if (kind !== "invoice" && kind !== "receipt") {
      return new Response("Not found", { status: 404 });
    }

    const documentNumber = decodeURIComponent(number);
    const hostelIds = (principal.hostelIds ?? []).map(
      (id) => new Types.ObjectId(id),
    );

    if (hostelIds.length === 0) {
      return new Response("Not found", { status: 404 });
    }

    await connectToDatabase();

    /*
     * The number in the URL is *ours* for an invoice and *theirs* for a
     * receipt, because that is what each side is identified by: our invoice
     * number is the one on our emails, and a receipt has no local number until
     * it settles. Both are looked up against rows this hostel owns, so neither
     * can be used to reach across tenants.
     */
    const softmatoNumber =
      kind === "invoice"
        ? (
            await SubscriptionInvoiceModel.findOne({
              hostelId: { $in: hostelIds },
              invoiceNumber: documentNumber,
            }).lean<{ softmatoInvoiceNo?: string | null } | null>()
          )?.softmatoInvoiceNo
        : (
            await SubscriptionPaymentModel.findOne({
              hostelId: { $in: hostelIds },
              softmatoTransactionNo: documentNumber,
            }).lean<{ softmatoTransactionNo?: string | null } | null>()
          )?.softmatoTransactionNo;

    if (!softmatoNumber) {
      return new Response("Not found", { status: 404 });
    }

    const file =
      kind === "invoice"
        ? await downloadInvoiceFile(softmatoNumber)
        : await downloadReceiptFile(softmatoNumber);

    if (!file) {
      return new Response("Not found", { status: 404 });
    }

    if (file.pdfFallbackReason) {
      console.warn(
        JSON.stringify({
          action: "softmato_pdf_fallback",
          documentNumber: softmatoNumber,
          level: "warn",
          reason: file.pdfFallbackReason,
        }),
      );
    }

    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Disposition": `attachment; filename="${documentFilename(softmatoNumber, file)}"`,
        "Content-Type": file.contentType,
        // A financial document is per-reader. No shared cache may hold it.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
