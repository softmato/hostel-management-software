/**
 * Plan payment reminders — the steps before and after a plan's due day, by
 * email to the owner and by push and bell to the hostel's admins.
 *
 * The rules are asserted on the pure decision, and the run is asserted on the
 * things that would go wrong silently: a hostel told twice, a backlog replayed
 * after a missed morning, an owner who sent proof being told they have not
 * paid, a failed send recorded as sent and so never retried, and a push that
 * tells somebody to pay somewhere the app is not allowed to point.
 */
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatBsDate, formatBsPeriod, hostelDayEnd } from "@hostel/shared/calendar/bs";
import {
  planDueSoonEmail,
  planOverdueEmail,
} from "@hostel/shared/email/templates/billing/plan-due";
import { emailDate, monthName } from "@hostel/shared/email/templates/layout";

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
  createInApp: vi.fn(),
  getOperationsConfig: vi.fn(),
  hostelFind: vi.fn(),
  invoiceFind: vi.fn(),
  invoiceUpdateOne: vi.fn(),
  memberFind: vi.fn(),
  runCreate: vi.fn(),
  runUpdateOne: vi.fn(),
  sendEmail: vi.fn(),
  sendPush: vi.fn(),
  subscriptionFind: vi.fn(),
  userFind: vi.fn(),
}));

/** A Mongoose query stand-in: every chained call returns itself, `lean` resolves. */
function query<T>(rows: T) {
  const chain = {
    lean: async () => rows,
    limit: () => chain,
    select: () => chain,
    sort: () => chain,
  };

  return chain;
}

vi.mock("@/lib/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/modules/hostels/hostel-registration.events", () => ({
  formatEmailDate: (value: Date) => `DAY(${value.toISOString()})`,
  hostelBillingUrl: (slug: string) => `https://example.test/${slug}/admin/billing`,
  registrationStatusUrl: () => "https://example.test/register-hostel/form",
}));
vi.mock("@/modules/notifications/notification.service", () => ({
  createInAppNotification: mocks.createInApp,
}));
vi.mock("@/modules/notifications/push.service", () => ({ sendPushToUsers: mocks.sendPush }));
vi.mock("@/modules/platform-config/operations-config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/platform-config/operations-config")>()),
  getOperationsConfig: mocks.getOperationsConfig,
}));
vi.mock("@hostel/db/models/ReconciliationRun", () => ({
  ReconciliationRunModel: { create: mocks.runCreate, updateOne: mocks.runUpdateOne },
}));
vi.mock("@hostel/db/models/SubscriptionInvoice", () => ({
  SubscriptionInvoiceModel: { find: mocks.invoiceFind, updateOne: mocks.invoiceUpdateOne },
}));
vi.mock("@hostel/db/models/Hostel", () => ({ HostelModel: { find: mocks.hostelFind } }));
vi.mock("@hostel/db/models/HostelMember", () => ({
  HostelMemberModel: { find: mocks.memberFind },
}));
vi.mock("@hostel/db/models/HostelSubscription", () => ({
  HostelSubscriptionModel: { find: mocks.subscriptionFind },
}));
vi.mock("@hostel/db/models/SubscriptionPayment", () => ({
  SubscriptionPaymentModel: { aggregate: mocks.aggregate },
}));
vi.mock("@hostel/db/models/User", () => ({ UserModel: { find: mocks.userFind } }));
vi.mock("@hostel/shared/email/sender", () => ({ sendEmail: mocks.sendEmail }));

import {
  composePlanDueNotice,
  nextPlanDueStep,
  runPlanDueReminders,
  type PlanReminderSent,
} from "@/modules/billing/plan-due-reminders.service";
import {
  DEFAULT_PLAN_DUE_REMINDERS,
  operationsConfigSchema,
  type PlanDueReminderSchedule,
} from "@/modules/platform-config/operations-config";

/** 07:45 in Kathmandu, when the job runs. */
const NOW = new Date("2026-09-15T02:00:00.000Z");

const ALL = ["email", "push", "bell"] as const;

/** Every channel of `offset` recorded as sent. */
function sentAt(offset: number, channels: readonly PlanReminderSent["channel"][] = ALL) {
  return channels.map((channel) => ({ channel, offset }));
}

function decide(overrides: Partial<Parameters<typeof nextPlanDueStep>[0]> = {}) {
  return nextPlanDueStep({
    claimInReview: false,
    daysSinceIssue: 5,
    daysUntilDue: 1,
    owingWhileLive: true,
    schedule: DEFAULT_PLAN_DUE_REMINDERS,
    sent: [],
    ...overrides,
  });
}

describe("the shipped schedule", () => {
  it("is the day before and the due day, then one, three and seven days late", () => {
    const { planDueReminders } = operationsConfigSchema.parse({});

    expect(planDueReminders.beforeDue.map((step) => step.days)).toEqual([1, 0]);
    expect(planDueReminders.afterDue.map((step) => step.days)).toEqual([1, 3, 7]);
    // Push and bell at every step.
    expect(
      [...planDueReminders.beforeDue, ...planDueReminders.afterDue].every(
        (step) => step.push && step.bell,
      ),
    ).toBe(true);
    // Email only at the first step on each side of the due day.
    expect(planDueReminders.beforeDue.map((step) => step.email)).toEqual([true, false]);
    expect(planDueReminders.afterDue.map((step) => step.email)).toEqual([true, false, false]);
  });

  it("refuses a day listed twice, and days outside their side of the due day", () => {
    const step = { bell: true, email: false, push: true };
    const parse = (planDueReminders: unknown) =>
      operationsConfigSchema.safeParse({ planDueReminders }).success;

    expect(parse({ afterDue: [], beforeDue: [{ ...step, days: 1 }, { ...step, days: 1 }] })).toBe(
      false,
    );
    expect(parse({ afterDue: [{ ...step, days: 0 }], beforeDue: [] })).toBe(false);
    expect(parse({ afterDue: [{ ...step, days: 1 }], beforeDue: [{ ...step, days: 0 }] })).toBe(
      true,
    );
  });
});

describe("which step is owed", () => {
  it("sends the day-before step on every channel it lists", () => {
    expect(decide({ daysUntilDue: 1 })).toEqual({ channels: ["email", "push", "bell"], offset: -1 });
  });

  it("sends the due-day step after the day before went out", () => {
    expect(decide({ daysUntilDue: 0, sent: sentAt(-1) })).toEqual({
      channels: ["push", "bell"],
      offset: 0,
    });
  });

  it("says nothing while the first step is further off", () => {
    expect(decide({ daysUntilDue: 2 })).toBeNull();
    expect(decide({ daysUntilDue: 14 })).toBeNull();
  });

  it("sends each channel of a step once", () => {
    expect(decide({ daysUntilDue: 1, sent: sentAt(-1) })).toBeNull();
    expect(decide({ daysUntilDue: -2, sent: sentAt(1) })).toBeNull();
    expect(decide({ daysUntilDue: -30, sent: sentAt(7) })).toBeNull();
  });

  it("makes up a missed morning with the latest step, never the ones it skipped", () => {
    // The day-before run was missed: the due-day step goes, and its email-less
    // channels are all it sends.
    expect(decide({ daysUntilDue: 0 })).toEqual({ channels: ["push", "bell"], offset: 0 });
    // Five days late with nothing sent: the three-day step, not one, not three.
    expect(decide({ daysUntilDue: -5, sent: sentAt(0) })).toEqual({
      channels: ["push", "bell"],
      offset: 3,
    });
    expect(decide({ daysSinceIssue: 33, daysUntilDue: -30 })).toEqual({
      channels: ["push", "bell"],
      offset: 7,
    });
  });

  it("tells a live hostel that still owes it is late, from any earlier step", () => {
    expect(decide({ daysUntilDue: -1, sent: sentAt(0, ["push", "bell"]) })).toEqual({
      channels: ["email", "push", "bell"],
      offset: 1,
    });
    // Between steps, the last one stays the latest.
    expect(decide({ daysUntilDue: -2, sent: sentAt(1) })).toBeNull();
  });

  it("retries a failed channel while its step is still the latest", () => {
    // The email was taken off the record when it failed; push and bell were not.
    expect(decide({ daysUntilDue: -2, sent: sentAt(1, ["push", "bell"]) })).toEqual({
      channels: ["email"],
      offset: 1,
    });
    // Once the next step is due, the failed email is not replayed.
    expect(decide({ daysUntilDue: -3, sent: sentAt(1, ["push", "bell"]) })).toEqual({
      channels: ["push", "bell"],
      offset: 3,
    });
  });

  it("never goes back to an earlier step, even after the schedule is edited", () => {
    const edited: PlanDueReminderSchedule = {
      afterDue: [
        { bell: true, days: 1, email: true, push: true },
        { bell: true, days: 2, email: true, push: true },
      ],
      beforeDue: [],
    };

    expect(decide({ daysUntilDue: -4, schedule: edited, sent: sentAt(3) })).toBeNull();
  });

  it("does not remind on the day the invoice was sent — the invoice already said it", () => {
    expect(decide({ daysSinceIssue: 0, daysUntilDue: 1 })).toBeNull();
    // A one-day deadline: the due-day step the next morning, never the day-before one.
    expect(decide({ daysSinceIssue: 1, daysUntilDue: 0 })).toEqual({
      channels: ["push", "bell"],
      offset: 0,
    });
  });

  it("does not send a step whose day came before the invoice existed", () => {
    const early: PlanDueReminderSchedule = {
      afterDue: [],
      beforeDue: [{ bell: true, days: 7, email: true, push: true }],
    };

    // Raised three days before the due day; the seven-day step never applied.
    expect(decide({ daysSinceIssue: 1, daysUntilDue: 2, schedule: early })).toBeNull();
  });

  it("never calls a hostel that is not live late", () => {
    // A self-registered hostel simply is not published until it pays.
    expect(decide({ daysUntilDue: -1, owingWhileLive: false })).toBeNull();
    expect(decide({ daysUntilDue: 1, owingWhileLive: false })).toEqual({
      channels: ["email", "push", "bell"],
      offset: -1,
    });
  });

  it("stays quiet while the owner's payment proof is with us", () => {
    expect(decide({ claimInReview: true, daysUntilDue: 1 })).toBeNull();
    expect(decide({ claimInReview: true, daysUntilDue: -2 })).toBeNull();
  });

  it("sends only the channels the platform switched on", () => {
    const quiet: PlanDueReminderSchedule = {
      afterDue: [{ bell: false, days: 1, email: false, push: false }],
      beforeDue: [{ bell: true, days: 3, email: false, push: false }],
    };

    expect(decide({ daysUntilDue: 3, schedule: quiet })).toEqual({ channels: ["bell"], offset: -3 });
    expect(decide({ daysUntilDue: -1, schedule: quiet })).toBeNull();
    expect(decide({ schedule: { afterDue: [], beforeDue: [] } })).toBeNull();
  });
});

describe("the push and bell text", () => {
  const base = {
    hostelName: "Rupa Hostel",
    invoiceNumber: "SUB-2609-0001-4F2A",
    now: NOW,
    outstanding: 4900,
    planName: "Pro Plan",
  };

  it("states the amount, plan, hostel and day, and nothing about paying", () => {
    const soon = composePlanDueNotice({ ...base, dueAt: hostelDayEnd(NOW, 1) });
    const late = composePlanDueNotice({ ...base, dueAt: hostelDayEnd(NOW, -3) });

    expect(soon.title).toBe("Plan payment due tomorrow");
    expect(late.title).toBe("Plan payment overdue by 3 days");
    expect(composePlanDueNotice({ ...base, dueAt: hostelDayEnd(NOW, 0) }).title).toBe(
      "Plan payment due today",
    );
    expect(soon.body).toBe(
      `Rs 4,900 for Pro Plan · Rupa Hostel, due ${formatBsDate(hostelDayEnd(NOW, 1))}. Invoice SUB-2609-0001-4F2A.`,
    );

    for (const text of [soon.title, soon.body, late.title, late.body]) {
      expect(text).not.toMatch(/\bpay\b|pay now|website|online|https?:|esewa|khalti/i);
    }
  });
});

describe("runPlanDueReminders", () => {
  const hostelId = new Types.ObjectId();
  const ownerId = new Types.ObjectId();
  const memberId = new Types.ObjectId();
  const subscriptionId = new Types.ObjectId();

  function invoice(overrides: Record<string, unknown> = {}) {
    return {
      _id: new Types.ObjectId(),
      amount: 4900,
      billedTo: { email: "old@example.test", hostelName: "Rupa Hostel", name: "Sita" },
      dueAt: hostelDayEnd(NOW, 1),
      hostelId,
      invoiceNumber: "SUB-2609-0001-4F2A",
      issuedAt: new Date("2026-09-12T05:00:00.000Z"),
      planName: "Pro Plan",
      subscriptionId,
      ...overrides,
    };
  }

  function hostel(status = "PUBLISHED") {
    return { _id: hostelId, name: "Rupa Hostel", ownerId, slug: "rupa-hostel", status };
  }

  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getOperationsConfig.mockResolvedValue({ planDueReminders: DEFAULT_PLAN_DUE_REMINDERS });
    mocks.runCreate.mockResolvedValue({ _id: new Types.ObjectId() });
    mocks.runUpdateOne.mockResolvedValue({});
    mocks.hostelFind.mockReturnValue(query([hostel()]));
    mocks.memberFind.mockReturnValue(query([{ hostelId, userId: memberId }]));
    mocks.userFind.mockReturnValue(
      query([
        { _id: ownerId, email: "sita@example.test", name: "Sita Sharma", role: "HOSTEL_ADMIN" },
        { _id: memberId, email: "ram@example.test", name: "Ram", role: "HOSTEL_ADMIN" },
      ]),
    );
    mocks.subscriptionFind.mockReturnValue(query([{ _id: subscriptionId }]));
    mocks.aggregate.mockResolvedValue([]);
    mocks.invoiceUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    mocks.sendEmail.mockResolvedValue({ id: "email-1", sent: true });
    mocks.createInApp.mockImplementation(async (input: { userId: string }) => ({
      _id: `row-${input.userId}`,
    }));
    mocks.sendPush.mockResolvedValue({ revoked: 0, sent: 1, skipped: false });
  });

  it("claims every channel of the step, then emails the owner and tells the admins", async () => {
    const row = invoice();
    mocks.invoiceFind.mockReturnValue(query([row]));

    const result = await runPlanDueReminders(NOW);

    expect(result).toEqual({
      bell: 1,
      dueSoon: 1,
      email: 1,
      failed: 0,
      overdue: 0,
      push: 1,
      scanned: 1,
    });
    expect(mocks.invoiceUpdateOne).toHaveBeenCalledTimes(1);
    expect(mocks.invoiceUpdateOne).toHaveBeenCalledWith(
      {
        _id: row._id,
        "reminders.sent": {
          $not: {
            $elemMatch: {
              $or: [
                { offset: { $gt: -1 } },
                { channel: { $in: ["email", "push", "bell"] }, offset: -1 },
              ],
            },
          },
        },
      },
      {
        $push: {
          "reminders.sent": {
            $each: [
              { at: NOW, channel: "email", offset: -1 },
              { at: NOW, channel: "push", offset: -1 },
              { at: NOW, channel: "bell", offset: -1 },
            ],
          },
        },
      },
    );

    const sent = mocks.sendEmail.mock.calls[0]![0];
    expect(sent.to).toBe("sita@example.test");
    expect(sent.subject).toBe("Payment due tomorrow — Pro Plan · Rupa Hostel");
    expect(sent.html).toContain("https://example.test/rupa-hostel/admin/billing");
    expect(sent.html).toContain("Rs 4,900");

    // A bell row per admin, opening Billing, and never a task left open.
    expect(mocks.createInApp).toHaveBeenCalledTimes(2);
    expect(mocks.createInApp.mock.calls.map((call) => call[0].userId)).toEqual([
      ownerId.toString(),
      memberId.toString(),
    ]);
    expect(mocks.createInApp.mock.calls[0]![0]).toMatchObject({
      actionUrl: "/rupa-hostel/admin/billing",
      category: "PAYMENT",
      data: { hostelSlug: "rupa-hostel", type: "PLAN_DUE" },
      hostelId: hostelId.toString(),
      kind: "NORMAL",
      push: false,
      title: "Plan payment due tomorrow",
    });

    // One push for both, each phone given its own row id.
    expect(mocks.sendPush).toHaveBeenCalledTimes(1);
    expect(mocks.sendPush).toHaveBeenCalledWith(
      [ownerId.toString(), memberId.toString()],
      expect.objectContaining({
        category: "PAYMENT",
        data: expect.objectContaining({ type: "PLAN_DUE" }),
        dataByUser: {
          [memberId.toString()]: { notificationId: `row-${memberId.toString()}` },
          [ownerId.toString()]: { notificationId: `row-${ownerId.toString()}` },
        },
        title: "Plan payment due tomorrow",
      }),
    );
  });

  it("reminds about what is left, not the whole invoice", async () => {
    const row = invoice();
    mocks.invoiceFind.mockReturnValue(query([row]));
    mocks.aggregate.mockResolvedValue([
      { _id: { invoiceId: row._id, status: "SETTLED" }, total: 1400 },
    ]);

    await runPlanDueReminders(NOW);

    expect(mocks.sendEmail.mock.calls[0]![0].html).toContain("Rs 3,500");
    expect(mocks.sendPush.mock.calls[0]![1].body).toContain("Rs 3,500");
  });

  it("makes up a missed morning with the due-day step alone", async () => {
    mocks.invoiceFind.mockReturnValue(query([invoice({ dueAt: hostelDayEnd(NOW, 0) })]));

    const result = await runPlanDueReminders(NOW);

    expect(result).toMatchObject({ bell: 1, dueSoon: 1, email: 0, push: 1 });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.sendPush.mock.calls[0]![1].title).toBe("Plan payment due today");
  });

  it("sends the late step to a live hostel that still owes", async () => {
    mocks.invoiceFind.mockReturnValue(
      query([
        invoice({
          dueAt: hostelDayEnd(NOW, -2),
          reminders: { sent: [...sentAt(-1), ...sentAt(0, ["push", "bell"])] },
        }),
      ]),
    );

    const result = await runPlanDueReminders(NOW);

    expect(result).toMatchObject({ overdue: 1, push: 1 });
    expect(mocks.sendEmail.mock.calls[0]![0]).toMatchObject({
      category: "alert",
      subject: "Payment overdue — Pro Plan · Rupa Hostel",
    });
    expect(mocks.sendPush.mock.calls[0]![1].title).toBe("Plan payment overdue by 2 days");
  });

  it("does not remind an owner whose payment proof is waiting on review", async () => {
    const row = invoice();
    mocks.invoiceFind.mockReturnValue(query([row]));
    mocks.aggregate.mockResolvedValue([
      { _id: { invoiceId: row._id, status: "IN_REVIEW" }, total: 4900 },
    ]);

    const result = await runPlanDueReminders(NOW);

    expect(result.dueSoon).toBe(0);
    expect(mocks.invoiceUpdateOne).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.sendPush).not.toHaveBeenCalled();
    expect(mocks.createInApp).not.toHaveBeenCalled();
  });

  it("sends nothing when another run claimed the step first", async () => {
    mocks.invoiceFind.mockReturnValue(query([invoice()]));
    mocks.invoiceUpdateOne.mockResolvedValue({ modifiedCount: 0 });

    await runPlanDueReminders(NOW);

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.sendPush).not.toHaveBeenCalled();
    expect(mocks.createInApp).not.toHaveBeenCalled();
  });

  it("takes only the failed channel off the record, so the next run tries it again", async () => {
    const row = invoice();
    mocks.invoiceFind.mockReturnValue(query([row]));
    mocks.sendEmail.mockResolvedValue({ reason: "send_failed", sent: false });

    const result = await runPlanDueReminders(NOW);

    expect(result).toMatchObject({ bell: 1, dueSoon: 1, email: 0, failed: 1, push: 1 });
    expect(mocks.invoiceUpdateOne).toHaveBeenLastCalledWith(
      { _id: row._id },
      { $pull: { "reminders.sent": { at: NOW, channel: { $in: ["email"] }, offset: -1 } } },
    );
  });

  it("emails a hostel that is not live yet, and pushes nothing to it", async () => {
    mocks.hostelFind.mockReturnValue(query([hostel("PENDING")]));
    const row = invoice();
    mocks.invoiceFind.mockReturnValue(query([row]));

    const result = await runPlanDueReminders(NOW);

    expect(result).toMatchObject({ bell: 0, email: 1, push: 0 });
    expect(mocks.memberFind).not.toHaveBeenCalled();
    expect(mocks.createInApp).not.toHaveBeenCalled();
    expect(mocks.sendPush).not.toHaveBeenCalled();
    // Push and bell are left unclaimed, not recorded as sent.
    expect(mocks.invoiceUpdateOne.mock.calls[0]![1]).toEqual({
      $push: { "reminders.sent": { $each: [{ at: NOW, channel: "email", offset: -1 }] } },
    });

    const html = mocks.sendEmail.mock.calls[0]![0].html as string;
    expect(html).toContain("https://example.test/register-hostel/form");
    expect(html).toContain("Your listing goes live as soon as this is paid.");
  });

  it("pushes only to accounts that can open Billing", async () => {
    mocks.memberFind.mockReturnValue(query([]));
    mocks.userFind.mockReturnValue(
      query([{ _id: ownerId, email: "sita@example.test", name: "Sita", role: "PUBLIC" }]),
    );
    mocks.invoiceFind.mockReturnValue(query([invoice()]));

    const result = await runPlanDueReminders(NOW);

    expect(result).toMatchObject({ bell: 0, email: 1, push: 0 });
    expect(mocks.sendPush).not.toHaveBeenCalled();
  });

  it("follows the schedule the platform saved", async () => {
    mocks.getOperationsConfig.mockResolvedValue({
      planDueReminders: {
        afterDue: [],
        beforeDue: [{ bell: false, days: 1, email: false, push: true }],
      },
    });
    mocks.invoiceFind.mockReturnValue(query([invoice()]));

    const result = await runPlanDueReminders(NOW);

    expect(result).toMatchObject({ bell: 0, email: 0, push: 1 });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.createInApp).not.toHaveBeenCalled();
    // With no bell rows there are no row ids to hand the phones.
    expect(mocks.sendPush.mock.calls[0]![1].dataByUser).toEqual({});
  });
});

describe("the reminder emails", () => {
  const base = {
    amountDue: 4900,
    dueDate: "Aswin 1, 2083 BS (17 Sep 2026)",
    hostelName: `Rupa <Hostel> & "Lodge"`,
    invoiceNumber: "SUB-2609-0001-4F2A",
    ownerName: "Sita",
    payUrl: "https://example.test/rupa-hostel/admin/billing?from=email&x=1",
    planName: "Pro Plan",
  };

  it("names the day in plain words", () => {
    expect(planDueSoonEmail({ ...base, daysUntilDue: 1, live: true }).subject).toContain(
      "due tomorrow",
    );
    expect(planDueSoonEmail({ ...base, daysUntilDue: 0, live: true }).subject).toContain(
      "due today",
    );
  });

  it("escapes what an owner typed and keeps the button's link intact", () => {
    const { html } = planOverdueEmail(base);

    expect(html).toContain("Rupa &lt;Hostel&gt; &amp; &quot;Lodge&quot;");
    expect(html).not.toContain("<Hostel>");
    expect(html).toContain('href="https://example.test/rupa-hostel/admin/billing?from=email&amp;x=1"');
    expect(html).toContain("Pay now");
  });

  it("is drawn in the brand green, with red kept for the overdue label", () => {
    const soon = planDueSoonEmail({ ...base, daysUntilDue: 1, live: true }).html;
    const overdue = planOverdueEmail(base).html;

    expect(soon).toContain("#0a8a4b");
    expect(soon).not.toContain("#0f766e");
    expect(soon).not.toContain("#dc2626");
    expect(overdue).toContain("#dc2626");
  });
});

describe("dates and months in email", () => {
  it("prints the Nepal day in both calendars, turning over at midnight in Kathmandu", () => {
    const lastMoment = new Date("2026-09-16T18:14:59.999Z");
    const nextDay = new Date("2026-09-16T18:15:00.000Z");

    expect(emailDate(lastMoment)).toBe(`${formatBsDate(lastMoment)} (16 Sep 2026)`);
    expect(emailDate(nextDay)).toBe(`${formatBsDate(nextDay)} (17 Sep 2026)`);
    expect(emailDate(null)).toBeNull();
  });

  it("names a Bikram Sambat period as one, instead of reading it as a Gregorian month", () => {
    expect(monthName("2083-05")).toBe(formatBsPeriod("2083-05"));
    expect(monthName("2083-05")).not.toContain("May");
    expect(monthName("2026-07")).toBe("July 2026");
  });
});
