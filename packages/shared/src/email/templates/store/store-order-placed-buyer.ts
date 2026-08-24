import {
  ctaButton,
  emailLayout,
  escapeHtml,
  paragraph,
  type EmailContent,
} from "../layout";
import { formatNpr, itemsTable, type StoreEmailItem } from "./items-table";

export function storeOrderPlacedBuyerEmail(input: {
  address: string;
  contactName: string;
  createdAt: string;
  deliveryFee: number;
  hostelName: string;
  items: readonly StoreEmailItem[];
  note?: string;
  orderNumber: string;
  orderUrl: string;
  phone: string;
  subtotal: number;
  total: number;
  deliveryPromise: string;
}): EmailContent {
  return {
    category: "info",
    subject: `Order ${input.orderNumber} placed — ${formatNpr(input.total)}`,
    html: emailLayout({
      heading: "We've got your order",
      bodyHtml: [
        paragraph(
          `${escapeHtml(input.hostelName)} · order <strong>${escapeHtml(input.orderNumber)}</strong> · placed ${escapeHtml(input.createdAt)}.`,
        ),
        paragraph(
          `Placed at ${escapeHtml(input.createdAt)} — arriving <strong>${escapeHtml(input.deliveryPromise)}</strong>.`,
        ),
        itemsTable(input.items),
        paragraph(
          `Subtotal: <strong>${formatNpr(input.subtotal)}</strong><br/>Delivery: <strong>${input.deliveryFee === 0 ? "Free" : formatNpr(input.deliveryFee)}</strong><br/>Total: <strong>${formatNpr(input.total)}</strong>`,
        ),
        paragraph(
          `Cash on delivery — please keep <strong>${formatNpr(input.total)}</strong> ready for the courier.`,
        ),
        paragraph(
          `Delivery address: ${escapeHtml(input.address)}<br/>Contact: ${escapeHtml(input.contactName)} · ${escapeHtml(input.phone)}${input.note ? `<br/>Courier note: ${escapeHtml(input.note)}` : ""}`,
        ),
        paragraph("You can cancel from the app until it ships."),
        ctaButton(input.orderUrl, "Track this order"),
      ].join("\n"),
    }),
  };
}
