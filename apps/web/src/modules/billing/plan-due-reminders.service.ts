import type { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { Role } from "@/lib/roles";
import { withRun } from "@/modules/finance/reconciliation/run-recorder";
import {
  formatEmailDate,
  hostelBillingUrl,
  registrationStatusUrl,
} from "@/modules/hostels/hostel-registration.events";
import { createInAppNotification } from "@/modules/notifications/notification.service";
import { PLAN_DUE_NOTIFICATION_TYPE } from "@/modules/notifications/push-routing";
import { sendPushToUsers } from "@/modules/notifications/push.service";
import {
  getOperationsConfig,
  type PlanDueReminderSchedule,
} from "@/modules/platform-config/operations-config";
import { HostelModel } from "@hostel/db/models/Hostel";
import { HostelMemberModel } from "@hostel/db/models/HostelMember";
import { HostelSubscriptionModel } from "@hostel/db/models/HostelSubscription";
import { SubscriptionInvoiceModel } from "@hostel/db/models/SubscriptionInvoice";
import { SubscriptionPaymentModel } from "@hostel/db/models/SubscriptionPayment";
import { formatBsDate, hostelDayEnd, hostelDaysBetween } from "@hostel/shared/calendar/bs";
import { sendEmail } from "@hostel/shared/email/sender";
import {
  planDueSoonEmail,
  planOverdueEmail,
} from "@hostel/shared/email/templates/billing/plan-due";
import { formatRupees } from "@hostel/shared/email/templates/billing/subscription-invoice";
import type { EmailContent } from "@hostel/shared/email/templates/layout";

/**
 * Reminders to a hostel about a plan payment that has not arrived.
 *
 * ## The schedule is the platform's
 *
 * `operations.planDueReminders` lists the steps — so many Nepal days before the
 * due day, so many after — and whether each one goes by email, push or bell.
 * Shipped as the day before and the due day, then one, three and seven days
 * late: push and bell at every step, email at the day before and the first day
 * late. The invoice itself is emailed when it is raised, by
 * `hostel-registration.events.ts`, not here.
 *
 * | Channel | Goes to | Opens |
 * |---|---|---|
 * | Email | the owner | the billing page, or the registration progress page for a hostel not live yet |
 * | Push, bell | the hostel's admin accounts, live hostel only | Billing — `/manage/billing` in the app, `/{slug}/admin/billing` on the web |
 *
 * ## Push and bell state facts
 *
 * The app takes no plan payments (Google Play treats the plan as business
 * software). So the text is the amount, the plan and the day, and a tap opens
 * the Billing screen that shows the bill — no pay wording, no link to pay, no
 * pointer to somewhere else to pay.
 *
 * A hostel waiting to go live gets email only: it has no admin portal to open
 * yet, and its owner pays from the progress page the email links to.
 *
 * ## Why "late" needs a live hostel
 *
 * A self-registered hostel's invoice has a due date too, but nothing about it
 * is late: the hostel is simply not published until it pays, and "overdue" would
 * read as a penalty on a listing that does not exist yet. An open renewal on an
 * active plan is the owner paying early, not owing. `PAST_DUE` — live, and money
 * still owed — is the only state where a missed date means something.
 *
 * ## Quiet while proof is with us
 *
 * An owner who has sent a payment claim is waiting on a person, not late. The
 * balance does not move until the claim is confirmed, so without this check the
 * owner who paid yesterday would be told today that they have not.
 *
 * ## The latest step, never a backlog
 *
 * A morning the job did not run is made up the next morning, with the step that
 * is due now rather than every step that was skipped: a hostel three days late
 * that missed the one-day push gets the three-day one, once. A step is never
 * sent after a later one has been, even when the schedule is edited between.
 *
 * ## Recorded first, then sent
 *
 * Each channel of a step is claimed on the invoice before it goes out — a
 * conditional update that fails when that channel of that step, or any later
 * step, is already recorded — so two overlapping runs (a cron retry on a slow
 * response) send once between them. A channel that fails is taken off the
 * record again, and the next run sends it for as long as its step is still the
 * latest one due.
 */

const BATCH_SIZE = 200;

export type PlanReminderChannel = "bell" | "email" | "push";

/** One channel of one step, as recorded on `SubscriptionInvoice.reminders.sent`. */
export type PlanReminderSent = { channel: PlanReminderChannel; offset: number };

export type PlanDueStep = {
  /** What this step still owes. Channels already recorded are left out. */
  channels: PlanReminderChannel[];
  /** Nepal days from the due day: `-1` the day before, `0` the day, `3` three days late. */
  offset: number;
};

export type PlanDueReminderRun = {
  /** Steps whose bell rows were written. */
  bell: number;
  /** Before-due steps that reached somebody on at least one channel. */
  dueSoon: number;
  email: number;
  /** Channels that failed this run and will be tried again. */
  failed: number;
  /** After-due steps that reached somebody on at least one channel. */
  overdue: number;
  push: number;
  scanned: number;
};

type InvoiceRow = {
  _id: Types.ObjectId;
  amount: number;
  billedTo?: { email?: string; hostelName?: string; name?: string };
  createdAt?: Date;
  dueAt: Date;
  hostelId: Types.ObjectId;
  invoiceNumber: string;
  issuedAt?: Date | null;
  planName: string;
  reminders?: { sent?: PlanReminderSent[] };
  subscriptionId: Types.ObjectId;
};

type HostelRow = {
  _id: Types.ObjectId;
  contact?: { email?: string };
  name?: string;
  ownerId?: Types.ObjectId;
  slug?: string;
  status?: string;
};

type UserRow = { _id: Types.ObjectId; email?: string; name?: string; role?: string };

type ClaimedStep = {
  /** Admin accounts for push and bell. Empty when neither is claimed. */
  admins: string[];
  channels: PlanReminderChannel[];
  hostel: HostelRow;
  invoice: InvoiceRow;
  offset: number;
  outstanding: number;
  ownerName?: string;
  /** The owner's address. Empty when email is not claimed. */
  to: string;
};

/** Listed in the order a step is delivered and reported. */
const CHANNELS: readonly PlanReminderChannel[] = ["email", "push", "bell"];

/**
 * The step owed on a plan invoice today, or null for none. **Pure.**
 *
 * Only the latest step whose day has come is considered, so a missed morning is
 * made up without replaying the steps it skipped. Before the due day that is a
 * before-due step; after it, an after-due step, and only for a live hostel that
 * still owes.
 */
export function nextPlanDueStep(input: {
  /** A payment claim for this invoice is waiting on a person. */
  claimInReview: boolean;
  /** Nepal days from the day the invoice was raised to today. */
  daysSinceIssue: number;
  /** Nepal days from today to the due day: 0 on the day, negative once late. */
  daysUntilDue: number;
  /** The hostel is live and still owes — `PAST_DUE`. */
  owingWhileLive: boolean;
  schedule: PlanDueReminderSchedule;
  sent: readonly PlanReminderSent[];
}): PlanDueStep | null {
  if (input.claimInReview) {
    return null;
  }

  const today = -input.daysUntilDue;
  const late = today > 0;

  if (late && !input.owingWhileLive) {
    return null;
  }

  const steps = late
    ? input.schedule.afterDue.map((step) => ({ ...step, offset: step.days }))
    : // `0`, never `-0`, for the due day — it is stored and compared.
      input.schedule.beforeDue.map((step) => ({ ...step, offset: step.days === 0 ? 0 : -step.days }));

  /*
   * A step's day has to come after the day the invoice was raised. On that day
   * the owner was sent the invoice with the date on it, and a step from before
   * it is one this invoice never had — so a deadline shorter than the first
   * step gets the next step instead of a reminder the morning after.
   */
  const issuedOn = today - input.daysSinceIssue;
  let latest: (typeof steps)[number] | null = null;

  for (const step of steps) {
    if (step.offset > today || step.offset <= issuedOn) {
      continue;
    }

    if (!latest || step.offset > latest.offset) {
      latest = step;
    }
  }

  if (!latest) {
    return null;
  }

  const chosen = latest;

  if (input.sent.some((entry) => entry.offset > chosen.offset)) {
    return null;
  }

  const channels = CHANNELS.filter(
    (channel) =>
      chosen[channel] &&
      !input.sent.some((entry) => entry.offset === chosen.offset && entry.channel === channel),
  );

  return channels.length > 0 ? { channels, offset: chosen.offset } : null;
}

export async function runPlanDueReminders(now = new Date()): Promise<PlanDueReminderRun> {
  await connectToDatabase();

  const schedule = (await getOperationsConfig()).planDueReminders;

  const { result } = await withRun(
    { hostelId: null, kind: "PLAN_DUE", triggeredBy: "CRON" },
    async (recorder) => {
      const totals: PlanDueReminderRun = {
        bell: 0,
        dueSoon: 0,
        email: 0,
        failed: 0,
        overdue: 0,
        push: 0,
        scanned: 0,
      };

      if (schedule.beforeDue.length === 0 && schedule.afterDue.length === 0) {
        return totals;
      }

      // An invoice due after the earliest step's reach cannot owe one today, so
      // it is never read — and with no step after the due day, neither is a
      // late one.
      const horizon = hostelDayEnd(now, Math.max(0, ...schedule.beforeDue.map((s) => s.days)));
      const dueAt =
        schedule.afterDue.length > 0
          ? { $lte: horizon, $ne: null }
          : { $gt: hostelDayEnd(now, -1), $lte: horizon };
      let cursor: Types.ObjectId | null = null;

      for (;;) {
        const batch: InvoiceRow[] = await SubscriptionInvoiceModel.find({
          dueAt,
          status: { $in: ["OPEN", "PARTIAL"] },
          ...(cursor ? { _id: { $gt: cursor } } : {}),
        })
          // Ordered by the field the cursor pages on, so no batch boundary
          // skips or repeats an invoice.
          .sort({ _id: 1 })
          .limit(BATCH_SIZE)
          .lean<InvoiceRow[]>();

        if (batch.length === 0) {
          break;
        }

        cursor = batch[batch.length - 1]!._id;
        totals.scanned += batch.length;
        recorder.count("scanned", batch.length);

        const context = await loadContext(batch);
        const claimed: ClaimedStep[] = [];

        for (const invoice of batch) {
          const key = invoice._id.toString();
          const hostel = context.hostels.get(invoice.hostelId.toString());
          const outstanding = Math.max(0, invoice.amount - (context.settled.get(key) ?? 0));

          if (!hostel || outstanding <= 0) {
            continue;
          }

          const step = nextPlanDueStep({
            claimInReview: context.inReview.has(key),
            daysSinceIssue: hostelDaysBetween(invoice.issuedAt ?? invoice.createdAt ?? now, now),
            daysUntilDue: hostelDaysBetween(now, invoice.dueAt),
            owingWhileLive: context.pastDue.has(invoice.subscriptionId.toString()),
            schedule,
            sent: invoice.reminders?.sent ?? [],
          });

          if (!step) {
            continue;
          }

          const owner = hostel.ownerId ? context.users.get(hostel.ownerId.toString()) : undefined;
          const to = owner?.email || hostel.contact?.email || invoice.billedTo?.email || "";
          const admins = isLive(hostel) ? (context.admins.get(hostel._id.toString()) ?? []) : [];

          if (step.channels.includes("email") && !to) {
            recorder.finding({
              code: "PLAN_DUE_NO_RECIPIENT",
              entityId: invoice._id,
              entityType: "SubscriptionInvoice",
              severity: "WARN",
            });
          }

          // A channel with nobody to reach is left unclaimed, so it still goes
          // out if somebody turns up while its step is the latest one due.
          const channels = step.channels.filter((channel) =>
            channel === "email" ? Boolean(to) : admins.length > 0,
          );

          if (channels.length === 0) {
            continue;
          }

          const claim = await SubscriptionInvoiceModel.updateOne(
            {
              _id: invoice._id,
              "reminders.sent": {
                $not: {
                  $elemMatch: {
                    $or: [
                      { offset: { $gt: step.offset } },
                      { channel: { $in: channels }, offset: step.offset },
                    ],
                  },
                },
              },
            },
            {
              $push: {
                "reminders.sent": {
                  $each: channels.map((channel) => ({ at: now, channel, offset: step.offset })),
                },
              },
            },
          );

          if (claim.modifiedCount !== 1) {
            // Another run claimed it between our read and this write.
            continue;
          }

          claimed.push({
            admins: channels.includes("push") || channels.includes("bell") ? admins : [],
            channels,
            hostel,
            invoice,
            offset: step.offset,
            outstanding,
            ownerName: owner?.name || invoice.billedTo?.name,
            to: channels.includes("email") ? to : "",
          });
        }

        const outcomes = await Promise.all(claimed.map((item) => deliverStep(item, now)));

        for (let index = 0; index < claimed.length; index += 1) {
          const item = claimed[index]!;
          const outcome = outcomes[index]!;
          const failed = item.channels.filter((channel) => !outcome[channel]);

          for (const channel of item.channels) {
            if (outcome[channel]) {
              totals[channel] += 1;
              recorder.count(channel);
            }
          }

          if (failed.length < item.channels.length) {
            const kind = item.offset > 0 ? "overdue" : "dueSoon";
            totals[kind] += 1;
            recorder.count(kind);
          }

          if (failed.length === 0) {
            continue;
          }

          // Off the record again, so the next run tries these channels.
          await SubscriptionInvoiceModel.updateOne(
            { _id: item.invoice._id },
            {
              $pull: {
                "reminders.sent": { at: now, channel: { $in: failed }, offset: item.offset },
              },
            },
          );

          totals.failed += failed.length;
          recorder.count("errors", failed.length);

          for (const channel of failed) {
            recorder.finding({
              code: "PLAN_DUE_SEND_FAILED",
              detail: `${channel} at offset ${item.offset}`,
              entityId: item.invoice._id,
              entityType: "SubscriptionInvoice",
              severity: "WARN",
            });
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

function isLive(hostel: HostelRow) {
  return hostel.status === "PUBLISHED" && Boolean(hostel.slug);
}

/** Everything a batch needs beyond the invoices, in five reads instead of five per invoice. */
async function loadContext(batch: InvoiceRow[]) {
  const { UserModel } = await import("@hostel/db/models/User");
  const invoiceIds = batch.map((invoice) => invoice._id);

  const [hostels, pastDue, payments] = await Promise.all([
    HostelModel.find({
      _id: { $in: batch.map((invoice) => invoice.hostelId) },
      isDeleted: { $ne: true },
    })
      .select("contact name ownerId slug status")
      .lean<HostelRow[]>(),
    HostelSubscriptionModel.find({
      _id: { $in: batch.map((invoice) => invoice.subscriptionId) },
      status: "PAST_DUE",
    })
      .select("_id")
      .lean<{ _id: Types.ObjectId }[]>(),
    /*
     * Settled money and claims in review, together. Only `SETTLED` reduces the
     * balance — the same rule as `outstandingFor` — while a claim only silences
     * the reminder.
     */
    SubscriptionPaymentModel.aggregate<{
      _id: { invoiceId: Types.ObjectId; status: string };
      total: number;
    }>([
      { $match: { invoiceId: { $in: invoiceIds }, status: { $in: ["IN_REVIEW", "SETTLED"] } } },
      {
        $group: {
          _id: { invoiceId: "$invoiceId", status: "$status" },
          total: { $sum: "$amount" },
        },
      },
    ]),
  ]);

  /*
   * Push and bell go to the owner and the hostel's active admin members — the
   * accounts that can open Billing. Wardens are left out: plan billing is not
   * in their portal.
   */
  const liveHostels = hostels.filter(isLive);
  const members =
    liveHostels.length > 0
      ? await HostelMemberModel.find({
          hostelId: { $in: liveHostels.map((hostel) => hostel._id) },
          isDeleted: { $ne: true },
          role: Role.HOSTEL_ADMIN,
          status: "ACTIVE",
        })
          .select("hostelId userId")
          .lean<{ hostelId: Types.ObjectId; userId: Types.ObjectId }[]>()
      : [];

  const userIds = [
    ...hostels.flatMap((hostel) => (hostel.ownerId ? [hostel.ownerId] : [])),
    ...members.map((member) => member.userId),
  ];
  const users =
    userIds.length > 0
      ? await UserModel.find({ _id: { $in: userIds }, isDeleted: { $ne: true } })
          .select("email name role")
          .lean<UserRow[]>()
      : [];
  const usersById = new Map(users.map((user) => [user._id.toString(), user]));

  const admins = new Map<string, string[]>();

  for (const hostel of liveHostels) {
    const candidates = [
      ...(hostel.ownerId ? [hostel.ownerId.toString()] : []),
      ...members
        .filter((member) => member.hostelId.toString() === hostel._id.toString())
        .map((member) => member.userId.toString()),
    ];

    admins.set(hostel._id.toString(), [
      // An owner whose account was never made an admin cannot open Billing.
      ...new Set(candidates.filter((id) => usersById.get(id)?.role === Role.HOSTEL_ADMIN)),
    ]);
  }

  const settled = new Map<string, number>();
  const inReview = new Set<string>();

  for (const row of payments) {
    const key = row._id.invoiceId.toString();

    if (row._id.status === "SETTLED") {
      settled.set(key, row.total);
    } else {
      inReview.add(key);
    }
  }

  return {
    admins,
    hostels: new Map(hostels.map((hostel) => [hostel._id.toString(), hostel])),
    inReview,
    pastDue: new Set(pastDue.map((subscription) => subscription._id.toString())),
    settled,
    users: usersById,
  };
}

/** Never throws. Each claimed channel comes back true when it reached somebody. */
async function deliverStep(
  item: ClaimedStep,
  now: Date,
): Promise<Partial<Record<PlanReminderChannel, boolean>>> {
  const [email, admins] = await Promise.all([
    item.channels.includes("email")
      ? deliverEmail(item.to, composeEmail(item, now), item.invoice.invoiceNumber)
      : undefined,
    item.admins.length > 0 ? notifyAdmins(item, now) : {},
  ]);

  return { ...admins, ...(email === undefined ? {} : { email }) };
}

/**
 * Bell rows for each admin, then one push for all of them.
 *
 * The rows carry `push: false` because the push is sent here — for the whole
 * audience at once, and also when the bell is switched off. Each phone is given
 * its own row id, so the socket and the push claim one chime between them.
 */
async function notifyAdmins(item: ClaimedStep, now: Date) {
  const { body, title } = composeNotice(item, now);
  const slug = item.hostel.slug ?? "";
  const hostelId = item.hostel._id.toString();
  const data = {
    hostelSlug: slug,
    invoiceNumber: item.invoice.invoiceNumber,
    subscriptionInvoiceId: item.invoice._id.toString(),
    type: PLAN_DUE_NOTIFICATION_TYPE,
  };
  const outcome: { bell?: boolean; push?: boolean } = {};
  const rowIds: Record<string, Record<string, unknown>> = {};

  if (item.channels.includes("bell")) {
    let written = 0;

    for (const userId of item.admins) {
      try {
        const row = await createInAppNotification({
          // What the web bell links to. The app's push goes to its own Billing
          // screen instead — see `deepLinkForNotification`.
          actionUrl: `/${encodeURIComponent(slug)}/admin/billing`,
          body,
          category: "PAYMENT",
          data,
          hostelId,
          // A reminder, not a task: nothing would ever mark it done, so it must
          // not sit under "Needs you" after the bill is paid.
          kind: "NORMAL",
          priority: "NORMAL",
          push: false,
          title,
          userId,
        });

        written += 1;

        const rowId = (row as { _id?: unknown } | null)?._id;

        if (rowId) {
          rowIds[userId] = { notificationId: String(rowId) };
        }
      } catch (error) {
        console.warn(
          JSON.stringify({
            action: "plan_due_bell_failed",
            invoiceNumber: item.invoice.invoiceNumber,
            level: "warn",
            reason: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }

    outcome.bell = written > 0;
  }

  if (item.channels.includes("push")) {
    try {
      /*
       * Best effort, like every push: an admin with no device, or one who muted
       * payments, is not a failure to retry tomorrow.
       */
      await sendPushToUsers(item.admins, {
        body,
        category: "PAYMENT",
        data,
        dataByUser: rowIds,
        hostelId,
        priority: "NORMAL",
        title,
      });
      outcome.push = true;
    } catch {
      outcome.push = false;
    }
  }

  return outcome;
}

/** The push and bell text. Facts only — see the file header. */
export function composePlanDueNotice(input: {
  dueAt: Date;
  hostelName: string;
  invoiceNumber: string;
  now: Date;
  outstanding: number;
  planName: string;
}) {
  const daysUntilDue = hostelDaysBetween(input.now, input.dueAt);
  const dueDay = formatBsDate(input.dueAt);
  const body = `${formatRupees(input.outstanding)} for ${input.planName} · ${input.hostelName}${
    dueDay ? `, due ${dueDay}` : ""
  }. Invoice ${input.invoiceNumber}.`;

  if (daysUntilDue < 0) {
    const late = -daysUntilDue;

    return { body, title: `Plan payment overdue by ${late} ${late === 1 ? "day" : "days"}` };
  }

  const when =
    daysUntilDue === 0 ? "today" : daysUntilDue === 1 ? "tomorrow" : `in ${daysUntilDue} days`;

  return { body, title: `Plan payment due ${when}` };
}

function composeNotice(item: ClaimedStep, now: Date) {
  return composePlanDueNotice({
    dueAt: item.invoice.dueAt,
    hostelName: item.hostel.name || item.invoice.billedTo?.hostelName || "",
    invoiceNumber: item.invoice.invoiceNumber,
    now,
    outstanding: item.outstanding,
    planName: item.invoice.planName,
  });
}

function composeEmail(item: ClaimedStep, now: Date): EmailContent {
  const { hostel, invoice } = item;
  const live = hostel.status === "PUBLISHED";
  const common = {
    amountDue: item.outstanding,
    dueDate: formatEmailDate(invoice.dueAt) ?? "",
    hostelName: hostel.name || invoice.billedTo?.hostelName || "",
    invoiceNumber: invoice.invoiceNumber,
    ownerName: item.ownerName,
    // A live hostel pays from its billing page; one waiting to go live, from
    // the registration progress page that publishes it.
    payUrl: live && hostel.slug ? hostelBillingUrl(hostel.slug) : registrationStatusUrl(),
    planName: invoice.planName,
  };

  return item.offset > 0
    ? planOverdueEmail(common)
    : planDueSoonEmail({
        ...common,
        daysUntilDue: hostelDaysBetween(now, invoice.dueAt),
        live,
      });
}

/** Never throws — `sendEmail` reports failure in its result. */
async function deliverEmail(to: string, message: EmailContent, invoiceNumber: string) {
  const result = await sendEmail({
    category: message.category,
    html: message.html,
    subject: message.subject,
    to,
  });

  if (!result.sent) {
    console.warn(
      JSON.stringify({
        action: "plan_due_email_failed",
        invoiceNumber,
        level: "warn",
        reason: result.reason,
      }),
    );
  }

  return result.sent;
}
