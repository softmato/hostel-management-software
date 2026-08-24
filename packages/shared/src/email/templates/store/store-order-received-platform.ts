import {
  ctaButton,
  emailLayout,
  escapeHtml,
  paragraph,
  type EmailContent,
} from "../layout";
import { formatNpr, itemsTable, type StoreEmailItem } from "./items-table";

export function storeOrderReceivedPlatformEmail(input: {
  address: string;
  contactName: string;
  hostelName: string;
  items: readonly StoreEmailItem[];
  note?: string;
  orderNumber: string;
  ordersUrl: string;
  phone: string;
  placedByName: string;
  subtotal: number;
  total: number;
  deliveryFee: number;
  deliveryPromise: string;
}): EmailContent {
  return {
    category: "alert",
    subject: `New order · ${input.hostelName} · ${formatNpr(input.total)} · ${input.orderNumber}`,
    html: emailLayout({
      heading: "New supply order to fulfil",
      urgent: true,
      bodyHtml: [
        paragraph(
          `<strong>${escapeHtml(input.hostelName)}</strong> placed order <strong>${escapeHtml(input.orderNumber)}</strong>.`,
        ),
        paragraph(
          `Placed by ${escapeHtml(input.placedByName)} · ${escapeHtml(input.phone)}.<br/><strong>Deliver by ${escapeHtml(input.deliveryPromise)}.</strong>`,
        ),
        itemsTable(input.items, true),
        paragraph(
          `Subtotal: <strong>${formatNpr(input.subtotal)}</strong><br/>Delivery: <strong>${input.deliveryFee === 0 ? "Free" : formatNpr(input.deliveryFee)}</strong><br/>Total: <strong>${formatNpr(input.total)}</strong>`,
        ),
        paragraph(
          `Collect <strong>${formatNpr(input.total)}</strong> in cash on delivery.`,
        ),
        paragraph(
          `Delivery address: ${escapeHtml(input.address)}<br/>Contact: ${escapeHtml(input.contactName)} · <a href="tel:${escapeHtml(input.phone)}">${escapeHtml(input.phone)}</a>${input.note ? `<br/>Courier note: ${escapeHtml(input.note)}` : ""}`,
        ),
        ctaButton(input.ordersUrl, "Open the fulfilment queue"),
      ].join("\n"),
    }),
  };
}
