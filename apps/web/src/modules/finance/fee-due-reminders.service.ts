import type { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import {
  DAILY_FROM_DAYS,
  remindsToday,
} from "@/modules/notifications/platform-push-schedule";
import { sendPushToUsers } from "@/modules/notifications/push.service";
import { InvoiceBalanceModel } from "@hostel/db/models/InvoiceBalance";
import { InvoiceModel } from "@hostel/db/models/Invoice";
import { ResidentModel } from "@hostel/db/models/Resident";
import { formatBsPeriodMonth, hostelDayEnd, hostelDaysBetween } from "@hostel/shared/calendar/bs";

/**
 * "Please pay your hostel fee" — the push a resident gets while a bill of theirs
 * is coming due or late.
 *
 * Run by the two `FEE_DUE_*` rows on the superadmin Push tab, 08:00 and 21:00
 * Nepal time, on the same rhythm as the plan reminders: a week and five days
 * out on the morning run, then both runs every day from three days out until
 * the bill is paid. The dunning ladder (`dunning.service`) still sends the
 * emails and bell rows; the push is this, so its rows carry `push: false`.
 *
 * One push per resident per run, about their earliest open bill. A tap opens
 * the resident's payments list, where they pay in the app.
 */

const OPEN_STATUSES = ["OPEN", "PARTIAL", "OVERDUE"];
const BATCH_SIZE = 500;

type InvoiceRow = {
  _id: Types.ObjectId;
  dueDate: Date;
  hostelId: Types.ObjectId;
  period?: string | null;
  residentId: Types.ObjectId;
  totalAmount: number;
};

type Due = { daysUntilDue: number; hostelId: string; period?: string | null };

/** The push text: when, and which month. **Pure.** */
export function composeFeeDueNotice(daysUntilDue: number, period?: string | null) {
  const month = formatBsPeriodMonth(period);
  const title =
    daysUntilDue < 0
      ? "Hostel fee overdue"
      : daysUntilDue === 0
        ? "Hostel fee due today"
        : daysUntilDue === 1
          ? "Hostel fee due tomorrow"
          : `Hostel fee due in ${daysUntilDue} days`;

  return {
    // A one-off bill (admission, deposit) has no month to name.
    body: month ? `Please pay your hostel fee for ${month}.` : "Please pay your hostel fee.",
    title,
  };
}

export async function sendFeeDueReminders(input: {
  earlyDays: readonly number[];
  now?: Date;
}): Promise<{ devices: number; recipients: number }> {
  await connectToDatabase();

  const now = input.now ?? new Date();
  const horizon = hostelDayEnd(now, Math.max(DAILY_FROM_DAYS, ...input.earlyDays));
  /** Each resident's most urgent bill that is reminded about on this run. */
  const byResident = new Map<string, Due>();
  let cursor: Types.ObjectId | null = null;

  for (;;) {
    const batch: InvoiceRow[] = await InvoiceModel.find({
      dueDate: { $lte: horizon },
      status: { $in: OPEN_STATUSES },
      ...(cursor ? { _id: { $gt: cursor } } : {}),
    })
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .select("_id dueDate hostelId period residentId totalAmount")
      .lean<InvoiceRow[]>();

    if (batch.length === 0) {
      break;
    }

    cursor = batch[batch.length - 1]!._id;

    const balances = await InvoiceBalanceModel.find({
      invoiceId: { $in: batch.map((invoice) => invoice._id) },
    })
      .select("invoiceId settledAmount")
      .lean<{ invoiceId: Types.ObjectId; settledAmount: number }[]>();
    const settled = new Map(
      balances.map((balance) => [balance.invoiceId.toString(), balance.settledAmount]),
    );

    for (const invoice of batch) {
      const daysUntilDue = hostelDaysBetween(now, invoice.dueDate);
      const key = invoice.residentId.toString();
      const current = byResident.get(key);

      if (
        invoice.totalAmount - (settled.get(invoice._id.toString()) ?? 0) <= 0 ||
        !remindsToday(daysUntilDue, input.earlyDays) ||
        (current && current.daysUntilDue <= daysUntilDue)
      ) {
        continue;
      }

      byResident.set(key, {
        daysUntilDue,
        hostelId: invoice.hostelId.toString(),
        period: invoice.period,
      });
    }

    if (batch.length < BATCH_SIZE) {
      break;
    }
  }

  if (byResident.size === 0) {
    return { devices: 0, recipients: 0 };
  }

  const residents = await ResidentModel.find({
    _id: { $in: [...byResident.keys()] },
    isDeleted: false,
    status: { $ne: "MOVED_OUT" },
    userId: { $ne: null },
  })
    .select("_id userId")
    .lean<{ _id: Types.ObjectId; userId: Types.ObjectId }[]>();

  // One push per hostel and wording, to every resident it fits.
  const groups = new Map<
    string,
    { hostelId: string; notice: { body: string; title: string }; userIds: string[] }
  >();

  for (const resident of residents) {
    const due = byResident.get(resident._id.toString())!;
    const notice = composeFeeDueNotice(due.daysUntilDue, due.period);
    const key = `${due.hostelId}|${notice.title}|${notice.body}`;
    const group = groups.get(key) ?? { hostelId: due.hostelId, notice, userIds: [] };

    group.userIds.push(resident.userId.toString());
    groups.set(key, group);
  }

  const results = await Promise.all(
    [...groups.values()].map((group) =>
      sendPushToUsers(group.userIds, {
        ...group.notice,
        category: "PAYMENT",
        hostelId: group.hostelId,
        priority: "NORMAL",
      }).catch(() => null),
    ),
  );

  return {
    devices: results.reduce((sum, result) => sum + (result?.sent ?? 0), 0),
    recipients: residents.length,
  };
}
