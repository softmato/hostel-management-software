/**
 * Plan payment reminders — a week and five days before the due day on the
 * morning run, then every morning and evening from three days before until paid;
 * email to the owner on the morning run, push to the hostel's admins on both.
 *
 * The rules are asserted on the pure decision, and the run is asserted on the
 * things that would go wrong silently: a hostel told twice in one run, an owner
 * who sent proof being told they have not paid, an inbox getting the evening
 * run too, and a push that tells somebody to pay somewhere the app may not point.
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
  hostelFind: vi.fn(),
  invoiceFind: vi.fn(),
  memberFind: vi.fn(),
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
  attach: async () => [],
  formatEmailDate: (value: Date) => `DAY(${value.toISOString()})`,
  hostelBillingUrl: (slug: string) => `https://example.test/${slug}/admin/billing`,
  registrationStatusUrl: () => "https://example.test/register-hostel/form",
}));
vi.mock("@/modules/notifications/push.service", () => ({ sendPushToUsers: mocks.sendPush }));
vi.mock("@hostel/db/models/SubscriptionInvoice", () => ({
  SubscriptionInvoiceModel: { find: mocks.invoiceFind },
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
  planEmailsToday,
  planRemindsToday,
  sendPlanDueReminders,
} from "@/modules/billing/plan-due-reminders.service";

/** 07:45 in Kathmandu. */
const NOW = new Date("2026-09-15T02:00:00.000Z");
const MORNING = { earlyDays: [7, 5], email: true, now: NOW };
const EVENING = { earlyDays: [], email: false, now: NOW };

function decide(overrides: Partial<Parameters<typeof planRemindsToday>[0]> = {}) {
  return planRemindsToday({
    claimInReview: false,
    daysSinceIssue: 10,
    daysUntilDue: 3,
    earlyDays: MORNING.earlyDays,
    owingWhileLive: true,
    ...overrides,
  });
}

describe("which days are reminded", () => {
  it("reminds 7 and 5 days out on the morning run, and every day from 3 days out", () => {
    const days = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0, -1, -2, -30];

    expect(days.filter((daysUntilDue) => decide({ daysUntilDue }))).toEqual([
      7, 5, 3, 2, 1, 0, -1, -2, -30,
    ]);
  });

  it("emails a week out, three days out, on the day, then weekly while late", () => {
    const days = [9, 7, 5, 3, 2, 1, 0, -1, -6, -7, -8, -14, -30];

    expect(days.filter(planEmailsToday)).toEqual([7, 3, 0, -7, -14]);
  });

  it("leaves the early heads-ups to the morning run", () => {
    const days = [7, 5, 3, 0, -4];

    expect(days.filter((daysUntilDue) => decide({ daysUntilDue, earlyDays: [] }))).toEqual([
      3, 0, -4,
    ]);
  });

  it("never calls a hostel that is not live late", () => {
    expect(decide({ daysUntilDue: -1, owingWhileLive: false })).toBe(false);
    expect(decide({ daysUntilDue: 0, owingWhileLive: false })).toBe(true);
  });

  it("stays quiet while the owner's payment proof is with us", () => {
    expect(decide({ claimInReview: true })).toBe(false);
  });

  it("does not remind on the day the invoice was sent — the invoice already said it", () => {
    expect(decide({ daysSinceIssue: 0 })).toBe(false);
    expect(decide({ daysSinceIssue: 1 })).toBe(true);
  });
});

describe("the push text", () => {
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

describe("sendPlanDueReminders", () => {
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
    mocks.sendEmail.mockResolvedValue({ id: "email-1", sent: true });
    mocks.sendPush.mockResolvedValue({ revoked: 0, sent: 3, skipped: false });
  });

  it("emails the owner the website link and pushes the facts to the admins", async () => {
    mocks.invoiceFind.mockReturnValue(query([invoice({ dueAt: hostelDayEnd(NOW, 3) })]));

    const result = await sendPlanDueReminders(MORNING);

    expect(result).toEqual({ devices: 3, emails: 1, recipients: 2 });

    const sent = mocks.sendEmail.mock.calls[0]![0];
    expect(sent.to).toBe("sita@example.test");
    expect(sent.subject).toBe("Please pay your hostel plan fee in 3 days — Rupa Hostel");
    expect(sent.html).toContain("Pay on the HostelPalika website");
    expect(sent.html).toContain("https://example.test/rupa-hostel/admin/billing");

    expect(mocks.sendPush).toHaveBeenCalledTimes(1);
    expect(mocks.sendPush).toHaveBeenCalledWith(
      [ownerId.toString(), memberId.toString()],
      expect.objectContaining({
        category: "PAYMENT",
        data: expect.objectContaining({ hostelSlug: "rupa-hostel", type: "PLAN_DUE" }),
        title: "Plan payment due in 3 days",
      }),
    );
  });

  it("pushes without an email on the days between", async () => {
    mocks.invoiceFind.mockReturnValue(query([invoice()]));

    const result = await sendPlanDueReminders(MORNING);

    expect(result).toEqual({ devices: 3, emails: 0, recipients: 2 });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("sends the evening push without another email", async () => {
    mocks.invoiceFind.mockReturnValue(query([invoice()]));

    const result = await sendPlanDueReminders(EVENING);

    expect(result).toEqual({ devices: 3, emails: 0, recipients: 2 });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("reminds a hostel once per run, about its earliest bill", async () => {
    mocks.invoiceFind.mockReturnValue(
      query([
        invoice({ dueAt: hostelDayEnd(NOW, 0), invoiceNumber: "SUB-EARLY" }),
        invoice({ dueAt: hostelDayEnd(NOW, 2), invoiceNumber: "SUB-LATER" }),
      ]),
    );

    await sendPlanDueReminders(MORNING);

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendPush).toHaveBeenCalledTimes(1);
    expect(mocks.sendPush.mock.calls[0]![1].title).toBe("Plan payment due today");
  });

  it("reminds about what is left, and not at all once it is settled", async () => {
    const row = invoice();
    mocks.invoiceFind.mockReturnValue(query([row]));
    mocks.aggregate.mockResolvedValue([
      { _id: { invoiceId: row._id, status: "SETTLED" }, total: 900 },
    ]);

    await sendPlanDueReminders(MORNING);
    expect(mocks.sendPush.mock.calls[0]![1].body).toContain("Rs 4,000");

    vi.clearAllMocks();
    mocks.aggregate.mockResolvedValue([
      { _id: { invoiceId: row._id, status: "SETTLED" }, total: 4900 },
    ]);

    expect(await sendPlanDueReminders(MORNING)).toEqual({ devices: 0, emails: 0, recipients: 0 });
  });

  it("emails a hostel that is not live yet, and pushes nothing to it", async () => {
    mocks.hostelFind.mockReturnValue(query([hostel("PENDING")]));
    mocks.invoiceFind.mockReturnValue(query([invoice({ dueAt: hostelDayEnd(NOW, 0) })]));

    const result = await sendPlanDueReminders(MORNING);

    expect(result).toEqual({ devices: 0, emails: 1, recipients: 0 });
    expect(mocks.memberFind).not.toHaveBeenCalled();
    expect(mocks.sendPush).not.toHaveBeenCalled();

    const html = mocks.sendEmail.mock.calls[0]![0].html as string;
    expect(html).toContain("https://example.test/register-hostel/form");
    expect(html).toContain("Your hostel shows online after you pay.");
  });

  it("sends a live hostel that still owes the overdue email once a week", async () => {
    mocks.invoiceFind.mockReturnValue(query([invoice({ dueAt: hostelDayEnd(NOW, -14) })]));

    await sendPlanDueReminders(MORNING);

    expect(mocks.sendEmail.mock.calls[0]![0].subject).toBe(
      "Please pay your hostel plan fee — Rupa Hostel",
    );
    expect(mocks.sendPush.mock.calls[0]![1].title).toBe("Plan payment overdue by 14 days");
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
      "fee tomorrow",
    );
    expect(planDueSoonEmail({ ...base, daysUntilDue: 0, live: true }).subject).toContain(
      "fee today",
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
