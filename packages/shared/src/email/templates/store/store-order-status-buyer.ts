import {
  ctaButton,
  emailLayout,
  escapeHtml,
  paragraph,
  type EmailContent,
} from "../layout";
import { formatNpr, itemsTable, type StoreEmailItem } from "./items-table";

export type StoreBuyerOrderStatus =
  "CONFIRMED" | "SHIPPED" | "DELIVERED" | "CANCELLED";

export function storeOrderStatusBuyerEmail(input: {
  cancelledReason?: string;
  deliveryPromise: string;
  items: readonly StoreEmailItem[];
  note?: string;
  orderNumber: string;
  orderUrl: string;
  status: StoreBuyerOrderStatus;
  total: number;
}): EmailContent {
  const copy = {
    CANCELLED: "Your order was cancelled. Nothing is owed.",
    CONFIRMED: `We're preparing your order. It is due ${input.deliveryPromise}; please keep ${formatNpr(input.total)} ready.`,
    DELIVERED: `Delivered. You paid ${formatNpr(input.total)}. Reply to us if anything is wrong.`,
    SHIPPED: `Your order is on the way. It is due ${input.deliveryPromise}; please keep ${formatNpr(input.total)} ready${input.note ? ` · courier note: ${input.note}` : ""}.`,
  }[input.status];

  return {
    category: "info",
    subject: `Order ${input.orderNumber} — ${input.status.toLowerCase()}`,
    html: emailLayout({
      heading:
        input.status === "CANCELLED"
          ? "Order cancelled"
          : `Order ${input.status.toLowerCase()}`,
      bodyHtml: [
        paragraph(`<strong>${escapeHtml(input.orderNumber)}</strong>`),
        paragraph(escapeHtml(copy)),
        itemsTable(input.items),
        input.status === "CANCELLED" && input.cancelledReason
          ? paragraph(`Reason: ${escapeHtml(input.cancelledReason)}`)
          : "",
        input.status === "CANCELLED"
          ? ""
          : ctaButton(input.orderUrl, "Track this order"),
      ].join("\n"),
    }),
  };
}
