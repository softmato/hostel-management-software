import type { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { PaymentModel } from "@hostel/db/models/Payment";
import { ResidentModel } from "@hostel/db/models/Resident";
import { createInAppNotification } from "@/modules/notifications/notification.service";
import { getOperationsConfig } from "@/modules/platform-config/operations-config";
import {
  appUrl,
  getHostelName,
  resolveResidentContact,
} from "@/modules/residents/resident-notify";
import { sendNotificationEmail } from "@/modules/residents/resident-notify";
import { paymentDueReminderEmail } from "@hostel/shared/email/templates/payment/payment-due-reminder";
import { paymentOverdueEmail } from "@hostel/shared/email/templates/payment/payment-overdue";

type PaymentRecord = {
  _id: Types.ObjectId;
  dueAmount: number;
  dueDate: Date;
  hostelId: Types.ObjectId;
  month: string;
  paidAmount: number;
  residentId: Types.ObjectId;
  status: string;
};

type ResidentRecord = {
  _id: Types.ObjectId;
  email?: string;
  firstName: string;
  hostelId: Types.ObjectId;
  lastName: string;
  userId?: Types.ObjectId;
};

const OPEN_STATUSES = ["UNPAID", "PARTIAL", "OVERDUE"];

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function daysBetween(from: Date, to: Date) {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);
}

export type PaymentReminderRun = {
  markedOverdue: number;
  overdueNotified: number;
  reminded: number;
  scanned: number;
};

/** Overdue chase schedule, in days past the due date. Weekly after the first week. */
function shouldChaseOverdue(daysOverdue: number) {
  return daysOverdue === 1 || daysOverdue === 3 || daysOverdue % 7 === 0;
}

/**
 * Daily job (PHASES.md §3.1 "Payment System"): reminds residents exactly
 * `paymentReminderDaysBefore` days before the due date, then chases overdue
 * payments on a decaying schedule so a forgotten record does not email someone
 * every morning. Runs against every hostel — this is platform-level plumbing,
 * not a tenant-scoped request.
 */
export async function runPaymentReminders(now = new Date()): Promise<PaymentReminderRun> {
  await connectToDatabase();

  const config = await getOperationsConfig();
  const today = startOfDay(now);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + config.paymentReminderDaysBefore);

  const payments = await PaymentModel.find({
    status: { $in: OPEN_STATUSES },
  })
    .sort({ dueDate: 1 })
    .limit(500)
    .lean<PaymentRecord[]>();

  const result: PaymentReminderRun = {
    markedOverdue: 0,
    overdueNotified: 0,
    reminded: 0,
    scanned: payments.length,
  };

  if (payments.length === 0) {
    return result;
  }

  const residents = await ResidentModel.find({
    _id: { $in: payments.map((payment) => payment.residentId) },
    isDeleted: false,
    status: { $ne: "MOVED_OUT" },
  }).lean<ResidentRecord[]>();
  const residentById = new Map(
    residents.map((resident) => [resident._id.toString(), resident]),
  );
  const hostelNames = new Map<string, string>();

  for (const payment of payments) {
    const resident = residentById.get(payment.residentId.toString());

    if (!resident) {
      continue;
    }

    const daysUntilDue = daysBetween(today, payment.dueDate);
    const isOverdue = daysUntilDue < 0;

    if (isOverdue && payment.status !== "OVERDUE") {
      await PaymentModel.updateOne({ _id: payment._id }, { $set: { status: "OVERDUE" } });
      result.markedOverdue += 1;
    }

    const shouldNotify = isOverdue
      ? shouldChaseOverdue(Math.abs(daysUntilDue))
      : daysUntilDue === config.paymentReminderDaysBefore;

    if (!shouldNotify) {
      continue;
    }

    const hostelKey = payment.hostelId.toString();

    if (!hostelNames.has(hostelKey)) {
      hostelNames.set(hostelKey, await getHostelName(payment.hostelId));
    }

    const hostelName = hostelNames.get(hostelKey)!;
    const outstanding = Math.max(payment.dueAmount - payment.paidAmount, 0);
    const contact = await resolveResidentContact(resident);
    const paymentsUrl = appUrl("/resident/payments");

    if (resident.userId) {
      await createInAppNotification({
        body: isOverdue
          ? `Your ${payment.month} fee is overdue.`
          : `Your ${payment.month} fee is due on ${payment.dueDate.toDateString()}.`,
        category: "PAYMENT",
        data: { paymentId: payment._id.toString() },
        hostelId: hostelKey,
        title: isOverdue ? "Payment overdue" : "Payment due soon",
        userId: resident.userId.toString(),
      });
    }

    if (!config.sendPaymentEmails || !contact) {
      continue;
    }

    const email = isOverdue
      ? paymentOverdueEmail({
          amount: outstanding,
          daysOverdue: Math.abs(daysUntilDue),
          dueDate: payment.dueDate,
          hostelName,
          month: payment.month,
          paymentsUrl,
          residentName: contact.name,
        })
      : paymentDueReminderEmail({
          amount: outstanding,
          dueDate: payment.dueDate,
          hostelName,
          month: payment.month,
          paymentsUrl,
          residentName: contact.name,
        });

    const sent = await sendNotificationEmail({
      action: isOverdue ? "payment_overdue" : "payment_due_reminder",
      html: email.html,
      subject: email.subject,
      to: contact.email,
    });

    if (sent && isOverdue) {
      result.overdueNotified += 1;
    } else if (sent) {
      result.reminded += 1;
    }
  }

  return result;
}
