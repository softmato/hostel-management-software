import "server-only";

import { SubscriptionInvoiceModel } from "@hostel/db/models/SubscriptionInvoice";
import { SubscriptionPaymentModel } from "@hostel/db/models/SubscriptionPayment";
import { sendEmail } from "@hostel/shared/email/sender";
import { formatRupees } from "@hostel/shared/email/templates/billing/subscription-invoice";
import { detailsTable, emailLayout, paragraph, smallPrint } from "@hostel/shared/email/templates/layout";

import { connectToDatabase } from "@/lib/db";
import { isSoftmatoDown, softmato } from "@/modules/billing/softmato/client";
import { rupeesToPaisa } from "@/modules/billing/softmato/money";
import { rememberTask } from "@/modules/billing/softmato/outage";
import { ensureInvoiceRaised, type InvoiceRecord } from "@/modules/billing/subscription.service";

/**
 * Cash an agent took, filed with Softmato as a claim: it books — and the
 * receipt is issued — only when a Softmato admin confirms it against the money
 * handed over (two people). Recorded here as PENDING with the agent as the
 * collector; `payment.success` for its transaction settles it like any other.
 */
export async function fileFieldCash(
  invoiceId: string,
  input: { amount: number; reference?: string },
  agent: { name: string; userId: string },
): Promise<void> {
  await connectToDatabase();

  const invoice = await SubscriptionInvoiceModel.findById(invoiceId).lean<InvoiceRecord | null>();

  if (!invoice) return;

  const payment = await SubscriptionPaymentModel.create({
    amount: input.amount,
    collectedBy: agent.userId,
    gatewayReference: input.reference || null,
    hostelId: invoice.hostelId,
    invoiceId: invoice._id,
    method: "CASH",
    recordedBy: agent.userId,
    status: "PENDING",
    subscriptionId: invoice.subscriptionId,
  });

  await submitFieldCash(String(payment._id), agent.name).catch(async (error: unknown) => {
    if (!isSoftmatoDown(error)) throw error;
    // Filed automatically once Softmato answers (`softmato/retry.ts`).
    await rememberTask({ kind: "CASH_FILING", name: agent.name, ref: String(payment._id) });
  });
}

/** Files one waiting cash payment with Softmato and tells the owner. Throws on an outage. */
export async function submitFieldCash(paymentId: string, collectedBy: string | null): Promise<void> {
  const payment = await SubscriptionPaymentModel.findById(paymentId).lean<{
    amount: number;
    gatewayReference?: string | null;
    invoiceId: string;
    softmatoTransactionNo?: string | null;
    status: string;
  } | null>();

  if (!payment || payment.status !== "PENDING" || payment.softmatoTransactionNo) return;

  const loaded = await SubscriptionInvoiceModel.findById(payment.invoiceId).lean<InvoiceRecord | null>();

  if (!loaded) return;

  const invoice = await ensureInvoiceRaised(loaded, { required: true });
  const filed = await softmato().recordOfflinePayment(
    {
      amount_minor: rupeesToPaisa(payment.amount),
      collected_by: collectedBy || "Field agent",
      invoice_id: invoice.softmatoInvoiceNo as string,
      ...(payment.gatewayReference ? { reference: payment.gatewayReference } : {}),
    },
    { idempotencyKey: `hh-cash:${paymentId}` },
  );

  await SubscriptionPaymentModel.updateOne(
    { _id: paymentId },
    { $set: { softmatoTransactionNo: filed.transaction_id } },
  );

  const email = invoice.billedTo?.email;

  if (!email) return;

  await sendEmail({
    category: "billing",
    html: emailLayout({
      bodyHtml: [
        paragraph(`We have your cash payment for <strong>${invoice.planName}</strong>.`),
        detailsTable([
          { emphasis: true, label: "Amount", value: formatRupees(payment.amount) },
          { label: "Received by", value: collectedBy || "Field agent" },
          { label: "Reference", value: filed.transaction_id },
        ]),
        smallPrint(
          "Softmato, our parent company, confirms cash against the money handed over and then emails your official receipt.",
        ),
      ].join(""),
      eyebrow: "Cash received",
      heading: "Cash payment received",
      preheader: `${formatRupees(payment.amount)} cash received. Your receipt follows once it is confirmed.`,
    }),
    subject: `${formatRupees(payment.amount)} cash received — receipt to follow`,
    to: email,
  });
}
