import type { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { createInAppNotification } from "@/modules/notifications/notification.service";
import { getOperationsConfig } from "@/modules/platform-config/operations-config";
import { withRun } from "@/modules/finance/reconciliation/run-recorder";
import {
  appUrl,
  getHostelName,
  resolveHostelAdminContacts,
  resolveResidentContact,
  sendNotificationEmail,
} from "@/modules/residents/resident-notify";
import { InvoiceBalanceModel } from "@hostel/db/models/InvoiceBalance";
import { InvoiceModel } from "@hostel/db/models/Invoice";
import { ResidentModel } from "@hostel/db/models/Resident";
import { paymentDueReminderEmail } from "@hostel/shared/email/templates/payment/payment-due-reminder";
import { paymentOverdueEmail } from "@hostel/shared/email/templates/payment/payment-overdue";

/**
 * Reminders and overdue chases (target §10.3, plan item 5.2).
 *
 * Three defects of the job this replaces, and the shape of each fix:
 *
 * 1. **`.limit(500)`, platform-wide, with no pagination.** Not a safety valve —
 *    a silent cap. The 501st open invoice on the platform was never chased and
 *    nothing said so. Fixed early, in 2.8, by the id cursor below.
 * 2. **Exact-day equality** (`daysUntilDue === N`). A single missed cron run
 *    skipped that resident *permanently*, because the day it would have fired
 *    never comes back. Replaced by a **stage recorded on the invoice**: the
 *    question is no longer "is today the day" but "has this invoice been chased
 *    at this stage yet", which a late run answers correctly and a double-run
 *    answers once.
 * 3. **No stop condition.** Chases continued forever. The ladder now terminates:
 *    reminder → first overdue → second overdue → four weekly chases → escalate
 *    to the owner → stop. After `STOPPED` the software never contacts the
 *    resident about this invoice again. That is the line between dunning and
 *    harassment, and it belongs in code rather than in a hostel's restraint.
 *
 * Every run writes a `ReconciliationRun` (§5.4), so a job that has been throwing
 * for a fortnight is visible rather than silent — which is exactly the failure
 * current §5.6 describes, where the run stats were returned to nobody.
 */

type DunningState = {
  chaseCount?: number;
  lastNotifiedAt?: Date | null;
  stage?: DunningStage;
};

export type DunningStage =
  | "CHASING"
  | "ESCALATED"
  | "NONE"
  | "OVERDUE_FIRST"
  | "OVERDUE_SECOND"
  | "REMINDED"
  | "STOPPED";

type InvoiceRow = {
  _id: Types.ObjectId;
  dueDate: Date;
  dunning?: DunningState;
  hostelId: Types.ObjectId;
  period?: string;
  residentId: Types.ObjectId;
  status: string;
  totalAmount: number;
};

type ResidentRow = {
  _id: Types.ObjectId;
  email?: string;
  firstName: string;
  hostelId: Types.ObjectId;
  lastName: string;
  userId?: Types.ObjectId;
};

const OPEN_STATUSES = ["OPEN", "PARTIAL", "OVERDUE"];
const BATCH_SIZE = 200;

/**
 * Weekly chases before the invoice becomes a person's problem instead of a
 * cron's. Four is a month: long enough that a resident who is simply late still
 * gets there on their own, short enough that a genuinely stuck account reaches
 * the owner while the resident is still living there.
 */
export const MAX_CHASES = 4;
const CHASE_INTERVAL_DAYS = 7;

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function daysBetween(from: Date, to: Date) {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);
}

export type PaymentReminderRun = {
  escalated: number;
  markedOverdue: number;
  overdueNotified: number;
  reminded: number;
  scanned: number;
  stopped: number;
};

export type DunningAction = {
  /** What to send. `stop` sends nothing and only closes the ladder. */
  kind: "chase" | "escalate" | "overdue" | "reminder" | "stop";
  stage: DunningStage;
};

/**
 * The next thing owed on an invoice, or null for "nothing today". **Pure.**
 *
 * The whole correctness argument of this rebuild lives in this function, so it
 * takes no clock and no database: every threshold is `>=`, never `===`, which is
 * what makes a missed day self-healing — a run three days late still finds the
 * stage unreached and acts. Re-running the same day finds the stage already
 * recorded and does nothing, so the job stays idempotent without a lock.
 */
export function nextDunningAction(input: {
  chaseCount: number;
  daysSinceLastNotice: number | null;
  daysUntilDue: number;
  reminderDaysBefore: number;
  stage: DunningStage;
}): DunningAction | null {
  const { chaseCount, daysSinceLastNotice, daysUntilDue, stage } = input;

  if (stage === "STOPPED") {
    return null;
  }

  // The ladder ends one run after the owner was told, so `ESCALATED` is a state
  // the invoice is observed in rather than one it passes straight through.
  if (stage === "ESCALATED") {
    return { kind: "stop", stage: "STOPPED" };
  }

  if (daysUntilDue >= 0) {
    // Not yet overdue — due today still counts. One reminder, at any point at or
    // inside the configured window, which is what makes a late run correct.
    return stage === "NONE" && daysUntilDue <= input.reminderDaysBefore
      ? { kind: "reminder", stage: "REMINDED" }
      : null;
  }

  const daysOverdue = -daysUntilDue;

  if (daysOverdue >= 1 && (stage === "NONE" || stage === "REMINDED")) {
    return { kind: "overdue", stage: "OVERDUE_FIRST" };
  }

  if (daysOverdue >= 3 && stage === "OVERDUE_FIRST") {
    return { kind: "overdue", stage: "OVERDUE_SECOND" };
  }

  if (stage === "OVERDUE_SECOND" || stage === "CHASING") {
    if (chaseCount >= MAX_CHASES) {
      return { kind: "escalate", stage: "ESCALATED" };
    }

    // A chase is due a week after the *last notice*, not a week after the due
    // date — otherwise a late first run collapses four chases into one day.
    const readyForChase =
      daysSinceLastNotice === null || daysSinceLastNotice >= CHASE_INTERVAL_DAYS;

    return readyForChase && daysOverdue >= CHASE_INTERVAL_DAYS
      ? { kind: "chase", stage: "CHASING" }
      : null;
  }

  return null;
}

export async function runPaymentReminders(now = new Date()): Promise<PaymentReminderRun> {
  await connectToDatabase();

  const config = await getOperationsConfig();
  const today = startOfDay(now);

  const { result } = await withRun(
    // Platform-wide: one row for the whole nightly pass rather than one per
    // hostel, because the job pages across every hostel's invoices at once.
    { hostelId: null, kind: "DUNNING", triggeredBy: "CRON" },
    async (recorder) => {
      const totals: PaymentReminderRun = {
        escalated: 0,
        markedOverdue: 0,
        overdueNotified: 0,
        reminded: 0,
        scanned: 0,
        stopped: 0,
      };

      const hostelNames = new Map<string, string>();
      let cursor: Types.ObjectId | null = null;

      for (;;) {
        const batch: InvoiceRow[] = await InvoiceModel.find({
          status: { $in: OPEN_STATUSES },
          ...(cursor ? { _id: { $gt: cursor } } : {}),
        })
          // Ordered by id, not due date: the cursor has to be on the field it
          // pages by, or a batch boundary can skip or repeat invoices.
          .sort({ _id: 1 })
          .limit(BATCH_SIZE)
          .lean<InvoiceRow[]>();

        if (batch.length === 0) {
          break;
        }

        cursor = batch[batch.length - 1]!._id;
        totals.scanned += batch.length;
        recorder.count("scanned", batch.length);

        const [residents, balances] = await Promise.all([
          ResidentModel.find({
            _id: { $in: batch.map((invoice) => invoice.residentId) },
            isDeleted: false,
            status: { $ne: "MOVED_OUT" },
          }).lean<ResidentRow[]>(),
          InvoiceBalanceModel.find({
            invoiceId: { $in: batch.map((invoice) => invoice._id) },
          }).lean<{ invoiceId: Types.ObjectId; settledAmount: number }[]>(),
        ]);

        const residentById = new Map(
          residents.map((resident) => [resident._id.toString(), resident]),
        );
        const settledByInvoice = new Map(
          balances.map((balance) => [
            balance.invoiceId.toString(),
            balance.settledAmount,
          ]),
        );

        const planned: {
          action: DunningAction;
          invoice: InvoiceRow;
          outstanding: number;
          resident: ResidentRow;
        }[] = [];

        for (const invoice of batch) {
          const resident = residentById.get(invoice.residentId.toString());

          if (!resident) {
            continue;
          }

          const daysUntilDue = daysBetween(today, invoice.dueDate);

          if (daysUntilDue < 0 && invoice.status !== "OVERDUE") {
            // The status is derived everywhere else; here the derivation is
            // simply being applied on time rather than waiting for a payment.
            await InvoiceModel.updateOne(
              { _id: invoice._id },
              { $set: { status: "OVERDUE" } },
            );
            totals.markedOverdue += 1;
          }

          const action = nextDunningAction({
            chaseCount: invoice.dunning?.chaseCount ?? 0,
            daysSinceLastNotice: invoice.dunning?.lastNotifiedAt
              ? daysBetween(invoice.dunning.lastNotifiedAt, today)
              : null,
            daysUntilDue,
            reminderDaysBefore: config.paymentReminderDaysBefore,
            stage: invoice.dunning?.stage ?? "NONE",
          });

          if (!action) {
            continue;
          }

          planned.push({
            action,
            invoice,
            outstanding: Math.max(
              invoice.totalAmount -
                (settledByInvoice.get(invoice._id.toString()) ?? 0),
              0,
            ),
            resident,
          });
        }

        // Hostel names first, deduplicated: the loop below would otherwise fetch
        // the same name once per invoice.
        for (const item of planned) {
          const key = item.invoice.hostelId.toString();

          if (!hostelNames.has(key)) {
            hostelNames.set(key, await getHostelName(item.invoice.hostelId));
          }
        }

        // **Batched.** The old job awaited each send inside the loop, so a
        // hostel with three hundred overdue invoices ran three hundred round
        // trips end to end and routinely hit the function timeout — at which
        // point the tail of the list was silently never contacted.
        const outcomes = await Promise.all(
          planned.map((item) =>
            deliver({
              action: item.action,
              config,
              hostelName: hostelNames.get(item.invoice.hostelId.toString()) ?? "",
              invoice: item.invoice,
              outstanding: item.outstanding,
              resident: item.resident,
            }),
          ),
        );

        for (let index = 0; index < planned.length; index += 1) {
          const item = planned[index]!;
          const delivered = outcomes[index]!;

          if (!delivered) {
            recorder.count("errors");
            recorder.finding({
              code: "DUNNING_SEND_FAILED",
              detail: `stage ${item.action.stage}`,
              entityId: item.invoice._id,
              entityType: "Invoice",
              severity: "WARN",
            });
            continue;
          }

          await InvoiceModel.updateOne(
            { _id: item.invoice._id },
            {
              $set: {
                "dunning.lastNotifiedAt":
                  item.action.kind === "stop"
                    ? (item.invoice.dunning?.lastNotifiedAt ?? null)
                    : now,
                "dunning.stage": item.action.stage,
              },
              ...(item.action.kind === "chase"
                ? { $inc: { "dunning.chaseCount": 1 } }
                : {}),
            },
          );

          if (item.action.kind === "reminder") {
            totals.reminded += 1;
            recorder.count("reminded");
          } else if (item.action.kind === "overdue" || item.action.kind === "chase") {
            totals.overdueNotified += 1;
            recorder.count("overdueNotified");
          } else if (item.action.kind === "escalate") {
            totals.escalated += 1;
            recorder.count("escalated");
            recorder.finding({
              code: "DUNNING_ESCALATED",
              detail: `${MAX_CHASES} chases sent with no payment; handed to the hostel`,
              entityId: item.invoice._id,
              entityType: "Invoice",
              severity: "WARN",
            });
          } else {
            totals.stopped += 1;
            recorder.count("stopped");
          }
        }

        if (batch.length < BATCH_SIZE) {
          break;
        }
      }

      return totals;
    },
  );

  return result;
}

/**
 * Sends one rung of the ladder. Returns false if nothing could be delivered.
 *
 * The in-app notification always fires; `sendPaymentEmails` gates only the email
 * (§5.5, item 0.6). A hostel with email switched off must still see its own
 * reminders in the app, which is the bug that fix was about.
 */
async function deliver(input: {
  action: DunningAction;
  config: { paymentReminderDaysBefore: number; sendPaymentEmails: boolean };
  hostelName: string;
  invoice: InvoiceRow;
  outstanding: number;
  resident: ResidentRow;
}): Promise<boolean> {
  try {
    const { action, invoice, resident } = input;
    const period = invoice.period ?? "";
    const hostelKey = invoice.hostelId.toString();

    if (action.kind === "stop") {
      // Nothing is sent. The ladder simply closes, and the escalation notice the
      // owner already has is the last word.
      return true;
    }

    if (action.kind === "escalate") {
      return await escalateToHostel({
        hostelName: input.hostelName,
        invoice,
        outstanding: input.outstanding,
        resident,
        sendEmail: input.config.sendPaymentEmails,
      });
    }

    const overdue = action.kind !== "reminder";
    const daysOverdue = Math.max(0, -daysBetween(new Date(), invoice.dueDate));

    if (resident.userId) {
      await createInAppNotification({
        body: overdue
          ? `Your ${period} fee is overdue.`
          : `Your ${period} fee is due on ${invoice.dueDate.toDateString()}.`,
        category: "PAYMENT",
        data: { invoiceId: invoice._id.toString() },
        hostelId: hostelKey,
        title: overdue ? "Payment overdue" : "Payment due soon",
        userId: resident.userId.toString(),
      });
    }

    const contact = await resolveResidentContact(resident);

    if (!input.config.sendPaymentEmails || !contact) {
      return true;
    }

    const email = overdue
      ? paymentOverdueEmail({
          amount: input.outstanding,
          daysOverdue,
          dueDate: invoice.dueDate,
          hostelName: input.hostelName,
          month: period,
          paymentsUrl: appUrl("/resident/payments"),
          residentName: contact.name,
        })
      : paymentDueReminderEmail({
          amount: input.outstanding,
          dueDate: invoice.dueDate,
          hostelName: input.hostelName,
          month: period,
          paymentsUrl: appUrl("/resident/payments"),
          residentName: contact.name,
        });

    await sendNotificationEmail({
      action: overdue ? "payment_overdue" : "payment_due_reminder",
      html: email.html,
      subject: email.subject,
      to: contact.email,
    });

    return true;
  } catch {
    // A failed send must not abort the batch. The stage is not advanced, so the
    // next run retries this rung rather than skipping to the following one.
    return false;
  }
}

/**
 * The end of the automated ladder: hand the invoice to a person (target §10.3).
 *
 * Deliberately a notification to the hostel's admins rather than another message
 * to the resident. Four weekly chases that produced nothing is not evidence that
 * a fifth would work — it is evidence that something the software cannot see is
 * wrong, and the only useful next step is a human who can knock on a door.
 */
async function escalateToHostel(input: {
  hostelName: string;
  invoice: InvoiceRow;
  outstanding: number;
  resident: ResidentRow;
  sendEmail: boolean;
}): Promise<boolean> {
  const admins = await resolveHostelAdminContacts(input.invoice.hostelId);
  const residentName = `${input.resident.firstName} ${input.resident.lastName}`.trim();
  const body = `${residentName} has not paid NPR ${input.outstanding.toLocaleString(
    "en-IN",
  )} for ${input.invoice.period ?? "an earlier period"} after ${MAX_CHASES} reminders. Automated reminders have stopped.`;

  await Promise.all(
    admins.map(async (admin) => {
      if (admin.userId) {
        await createInAppNotification({
          body,
          category: "PAYMENT",
          data: { invoiceId: input.invoice._id.toString() },
          hostelId: input.invoice.hostelId.toString(),
          title: "Unpaid fee needs your attention",
          userId: admin.userId.toString(),
        });
      }

      if (input.sendEmail) {
        await sendNotificationEmail({
          action: "payment_escalated",
          html: `<p>${body}</p><p><a href="${appUrl("/hostel-admin/payments")}">Open payments</a></p>`,
          subject: `Unpaid fee: ${residentName}`,
          to: admin.email,
        });
      }
    }),
  );

  return true;
}
