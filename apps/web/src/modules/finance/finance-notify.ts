import type { Types } from "mongoose";

import {
  appUrl,
  getHostelName,
  resolveHostelAdminContacts,
  resolveResidentContact,
  sendNotificationEmail,
} from "@/modules/residents/resident-notify";
import { createInAppNotification } from "@/modules/notifications/notification.service";
import { getOperationsConfig } from "@/modules/platform-config/operations-config";
import { ResidentModel } from "@hostel/db/models/Resident";
import { paymentProofUploadedEmail } from "@hostel/shared/email/templates/payment/proof-uploaded";
import { paymentRejectedEmail } from "@hostel/shared/email/templates/payment/payment-rejected";
import { paymentReversedEmail } from "@hostel/shared/email/templates/payment/payment-reversed";
import { paymentVerifiedEmail } from "@hostel/shared/email/templates/payment/payment-verified";

/**
 * Tell the hostel's admins a claim is waiting (target §11.4, plan item 2.8).
 *
 * **Never throws.** The claim is already recorded by the time this runs, and a
 * failed notification must not fail the resident's submission — they did their
 * part, and the queue is still correct without the email.
 */
export async function notifyAdminsOfClaim(input: {
  amount: number;
  eventId: string;
  method: string;
  period: string | null;
  referenceNote: string | null;
  resident: { firstName?: string; hostelId: Types.ObjectId; lastName?: string };
}): Promise<void> {
  try {
    // `sendPaymentEmails` is an *email* switch (item 0.6). Gating the whole
    // function on it left the verification queue with nothing pointing at it.
    const config = await getOperationsConfig();

    const [hostelName, admins] = await Promise.all([
      getHostelName(input.resident.hostelId),
      resolveHostelAdminContacts(input.resident.hostelId),
    ]);

    const residentName =
      `${input.resident.firstName ?? ""} ${input.resident.lastName ?? ""}`.trim();
    const email = paymentProofUploadedEmail({
      amount: input.amount,
      hostelName,
      method: input.method,
      month: input.period ?? "",
      referenceNote: input.referenceNote ?? undefined,
      residentName,
      reviewUrl: appUrl("/hostel-admin/payments"),
    });

    await Promise.all(
      admins.map(async (admin) => {
        if (admin.userId) {
          await createInAppNotification({
            // Approving is a one-click decision, so it happens in the bell.
            // Rejecting needs a written reason, so that one only deep-links.
            actions: [
              {
                endpoint: `/api/v1/hostel-admin/finance/events/${input.eventId}/approve`,
                key: "approve",
                label: "Verify payment",
                method: "POST",
              },
            ],
            body: `${residentName} submitted proof of NPR ${input.amount.toLocaleString("en-US")}${
              input.period ? ` for ${input.period}` : ""
            }.`,
            category: "PAYMENT",
            data: { eventId: input.eventId },
            hostelId: input.resident.hostelId.toString(),
            title: "Payment proof submitted",
            userId: admin.userId.toString(),
          });
        }

        if (config.sendPaymentEmails) {
          await sendNotificationEmail({
            action: "payment_proof_uploaded",
            html: email.html,
            subject: email.subject,
            to: admin.email,
          });
        }
      }),
    );
  } catch (error) {
    console.warn(
      JSON.stringify({
        action: "payment_claim_notification_failed",
        eventId: input.eventId,
        level: "warn",
        message: error instanceof Error ? error.message : "Unknown notification error",
      }),
    );
  }
}

/**
 * Tell the resident what happened to their claim (target §11.4).
 *
 * Same shape as the reversal notice below and for the same reason: the in-app
 * message is outside the email switch. A hostel with email off used to verify a
 * payment and tell the resident nothing at all (item 0.6).
 */
export async function notifyClaimReviewed(input: {
  hostelId: Types.ObjectId | string;
  invoiceId: string | null;
  outcome:
    | {
        kind: "verified";
        receiptNumber: string | null;
        remainingAmount: number;
        verifiedAmount: number;
      }
    | { kind: "rejected"; rejectionReason: string };
  period: string | null;
  residentId: Types.ObjectId | string;
}): Promise<void> {
  const resident = await ResidentModel.findOne({
    _id: input.residentId,
    isDeleted: false,
  }).lean<{
    _id: Types.ObjectId;
    email?: string;
    firstName: string;
    lastName: string;
    userId?: Types.ObjectId;
  } | null>();

  if (!resident) {
    return;
  }

  const [config, hostelName, contact] = await Promise.all([
    getOperationsConfig(),
    getHostelName(input.hostelId),
    resolveResidentContact(resident),
  ]);

  const period = input.period ?? "your account";

  if (resident.userId) {
    await createInAppNotification({
      body:
        input.outcome.kind === "verified"
          ? `Your payment for ${period} was verified.${
              input.outcome.receiptNumber ? ` Receipt ${input.outcome.receiptNumber}.` : ""
            }`
          : `Your payment proof for ${period} was not accepted: ${input.outcome.rejectionReason}`,
      category: "PAYMENT",
      data: { invoiceId: input.invoiceId ?? undefined },
      hostelId: input.hostelId.toString(),
      title:
        input.outcome.kind === "verified" ? "Payment verified" : "Payment proof rejected",
      userId: resident.userId.toString(),
    });
  }

  if (!contact || !config.sendPaymentEmails) {
    return;
  }

  const email =
    input.outcome.kind === "verified"
      ? paymentVerifiedEmail({
          amount: input.outcome.verifiedAmount,
          hostelName,
          month: input.period ?? "",
          paymentsUrl: appUrl("/resident/payments"),
          receiptNumber: input.outcome.receiptNumber ?? "",
          remainingAmount: input.outcome.remainingAmount,
          residentName: contact.name ?? resident.firstName,
        })
      : paymentRejectedEmail({
          hostelName,
          month: input.period ?? "",
          paymentsUrl: appUrl("/resident/payments"),
          rejectionReason: input.outcome.rejectionReason,
          residentName: contact.name ?? resident.firstName,
        });

  await sendNotificationEmail({
    action: `payment_${input.outcome.kind}`,
    html: email.html,
    subject: email.subject,
    to: contact.email,
  });
}

/**
 * Telling a resident their money stopped counting (target §9.3, plan item 2.7).
 *
 * A reversal that nobody is told about is discovered from a dunning notice, and
 * the hostel discovers it from an angry phone call. It is the single most
 * important notification in the finance module and the current system does not
 * send it at all, because reversals happen through the unrestricted `PATCH`.
 *
 * **The in-app notification always fires.** `sendPaymentEmails` is an *email*
 * switch (§5.5, target §12) — the bug item 0.6 fixed was exactly this early
 * return taking the in-app message down with it, so a hostel with email off
 * changed a resident's balance and told them nothing.
 */
export async function notifyPaymentReversed(input: {
  amount: number;
  hostelId: Types.ObjectId | string;
  invoiceId?: string | null;
  outstandingAmount: number;
  period?: string | null;
  reason: string;
  residentId: Types.ObjectId | string;
}): Promise<void> {
  const resident = await ResidentModel.findOne({
    _id: input.residentId,
    isDeleted: false,
  }).lean<{
    _id: Types.ObjectId;
    email?: string;
    firstName: string;
    hostelId: Types.ObjectId;
    lastName: string;
    userId?: Types.ObjectId;
  } | null>();

  if (!resident) {
    return;
  }

  const [config, hostelName, contact] = await Promise.all([
    getOperationsConfig(),
    getHostelName(input.hostelId),
    resolveResidentContact(resident),
  ]);

  if (resident.userId) {
    await createInAppNotification({
      body: `A payment of NPR ${input.amount.toLocaleString("en-US")} was reversed: ${input.reason}`,
      category: "PAYMENT",
      data: { invoiceId: input.invoiceId ?? undefined },
      hostelId: input.hostelId.toString(),
      title: "Payment reversed",
      userId: resident.userId.toString(),
    });
  }

  if (contact && config.sendPaymentEmails) {
    const email = paymentReversedEmail({
      amount: input.amount,
      hostelName,
      outstandingAmount: input.outstandingAmount,
      paymentsUrl: appUrl("/resident/payments"),
      period: input.period ?? null,
      reason: input.reason,
      residentName: contact.name ?? resident.firstName ?? "there",
    });

    await sendNotificationEmail({
      action: "payment_reversed",
      html: email.html,
      subject: email.subject,
      to: contact.email,
    });
  }
}
