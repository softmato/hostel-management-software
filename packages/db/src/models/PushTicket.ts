import { Schema, model, models } from "mongoose";

/**
 * One Expo push, between being accepted and being delivered.
 *
 * ## Why a row exists at all
 *
 * Expo answers a send with a *ticket*, and a ticket only says the message was
 * queued. Whether FCM or APNS actually took it is answered later, by a
 * *receipt*, fetched from `/push/getReceipts` with that ticket's id. The two
 * are minutes apart, and the invocation that did the sending is long gone by
 * then — so the id has to be written down somewhere or the answer can never be
 * collected.
 *
 * ## The failure this was built for
 *
 * Every push in this product was silently undeliverable while `sendPushToUsers`
 * counted them as sent. Expo returned `{"status":"ok"}` for each one — the
 * message really had been accepted — and the receipts, which nothing fetched,
 * carried the actual answer:
 *
 *     FCM 403 · PERMISSION_DENIED
 *     Permission 'cloudmessaging.messages.create' denied on
 *     resource 'projects/softmato-e65a6'
 *
 * The service account EAS holds for this project had lost the Cloud Messaging
 * permission, so Google refused every message. Nothing upstream could see it:
 * the `Notification` row committed, the socket fired, the bell badge moved, the
 * ticket said ok. Only the receipt disagreed, and nobody was asking.
 *
 * That is the whole justification for this collection. A delivery pipeline
 * whose only failure signal is one nobody reads is a pipeline that reports
 * success while delivering nothing, and it did exactly that for months.
 *
 * ## Rows are short-lived
 *
 * A receipt is only available for about a day, so a row that has been checked —
 * or that is older than the window — is worthless and gets swept. This is a
 * queue, not a history: `AuditLog` is where anything durable belongs.
 */
const pushTicketSchema = new Schema(
  {
    /** Expo's ticket id, the key `/push/getReceipts` is asked with. */
    ticketId: { required: true, trim: true, type: String },
    /**
     * The address this ticket was for, kept so a receipt reporting
     * `DeviceNotRegistered` can revoke the right `DeviceToken` — the receipt
     * itself names only the ticket.
     */
    token: { required: true, trim: true, type: String },
    /** Carried through only so a delivery failure can be read by category. */
    category: { trim: true, type: String },
    status: {
      default: "PENDING",
      enum: ["PENDING", "CHECKED"],
      type: String,
    },
  },
  { timestamps: true },
);

pushTicketSchema.index({ ticketId: 1 }, { unique: true });
pushTicketSchema.index({ status: 1, createdAt: 1 });

export const PushTicketModel =
  models.PushTicket || model("PushTicket", pushTicketSchema);
