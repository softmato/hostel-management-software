import { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { Role } from "@/lib/roles";
import { HostelModel } from "@hostel/db/models/Hostel";
import { HostelSubscriptionModel } from "@hostel/db/models/HostelSubscription";
import { SubscriptionInvoiceModel } from "@hostel/db/models/SubscriptionInvoice";
import { SubscriptionPaymentModel } from "@hostel/db/models/SubscriptionPayment";
import { UserModel } from "@hostel/db/models/User";

/**
 * Reading the field team's work.
 *
 * The question the roster exists to answer, from the notes, is precisely:
 * *which team member added which hostel, how much they were paid, by which
 * method, and when.* Every read here is shaped to answer some part of that, and
 * all of it comes from rows written by the flow itself — `agentId` on the
 * subscription, `collectedBy` on the payment — rather than from a separate
 * activity log that could disagree with the money.
 *
 * ## Cash and QR are counted separately, on purpose
 *
 * `collected` is what the agent physically handled. A Fonepay payment an owner
 * scanned goes to the platform's merchant account and never passes through the
 * agent's hands, so rolling the two together would produce a number that looks
 * like an amount owed by the agent and is not. Cash is the number a
 * reconciliation conversation is actually about.
 */

type SubscriptionRow = {
  _id: Types.ObjectId;
  agentId?: Types.ObjectId | null;
  createdAt?: Date;
  cycleTotal?: number | null;
  dueBy?: Date | null;
  hostelId: Types.ObjectId;
  planName?: string | null;
  status: string;
};

/** Settled money per subscription, split by who bore the risk of holding it. */
async function moneyBySubscription(subscriptionIds: Types.ObjectId[]) {
  if (subscriptionIds.length === 0) {
    return new Map<string, { cash: number; online: number; total: number }>();
  }

  const rows = await SubscriptionPaymentModel.aggregate<{
    _id: { method: string; subscriptionId: Types.ObjectId };
    total: number;
  }>([
    {
      $match: { status: "SETTLED", subscriptionId: { $in: subscriptionIds } },
    },
    {
      $group: {
        _id: { method: "$method", subscriptionId: "$subscriptionId" },
        total: { $sum: "$amount" },
      },
    },
  ]);

  const byId = new Map<string, { cash: number; online: number; total: number }>();

  for (const row of rows) {
    const key = row._id.subscriptionId.toString();
    const entry = byId.get(key) ?? { cash: 0, online: 0, total: 0 };

    if (row._id.method === "CASH") {
      entry.cash += row.total;
    } else {
      entry.online += row.total;
    }

    entry.total += row.total;
    byId.set(key, entry);
  }

  return byId;
}

/**
 * Every hostel one agent has filed, newest first, with what it owes.
 *
 * Reads the subscription rather than the application because the money lives
 * there — and because a subscription exists for every registered hostel, so
 * there is no join that can come back empty and silently drop a row.
 */
export async function listAgentRegistrations(agentId: string, limit = 100) {
  await connectToDatabase();

  const subscriptions = await HostelSubscriptionModel.find({
    agentId: new Types.ObjectId(agentId),
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean<SubscriptionRow[]>();

  const hostels = await HostelModel.find({
    _id: { $in: subscriptions.map((row) => row.hostelId) },
  })
    .select("name slug status location")
    .lean<
      {
        _id: Types.ObjectId;
        location?: { area?: string; city?: string };
        name?: string;
        slug?: string;
        status?: string;
      }[]
    >();

  const hostelById = new Map(hostels.map((hostel) => [hostel._id.toString(), hostel]));
  const money = await moneyBySubscription(subscriptions.map((row) => row._id));

  return {
    registrations: subscriptions.map((row) => {
      const hostel = hostelById.get(row.hostelId.toString());
      const paid = money.get(row._id.toString()) ?? { cash: 0, online: 0, total: 0 };
      const price = row.cycleTotal ?? 0;

      return {
        area: hostel?.location?.area ?? "",
        cashCollected: paid.cash,
        city: hostel?.location?.city ?? "",
        dueBy: row.dueBy?.toISOString() ?? null,
        hostelId: row.hostelId.toString(),
        hostelName: hostel?.name ?? "Unnamed hostel",
        hostelStatus: hostel?.status ?? "",
        onlineCollected: paid.online,
        outstanding: Math.max(0, price - paid.total),
        paid: paid.total,
        planName: row.planName ?? "",
        price,
        registeredAt: row.createdAt?.toISOString() ?? null,
        slug: hostel?.slug ?? "",
        subscriptionStatus: row.status,
      };
    }),
  };
}

/** The headline figures for one agent's own dashboard. */
export async function getAgentSummary(agentId: string) {
  const { registrations } = await listAgentRegistrations(agentId, 500);

  return {
    summary: {
      cashCollected: registrations.reduce((sum, row) => sum + row.cashCollected, 0),
      collected: registrations.reduce((sum, row) => sum + row.paid, 0),
      hostelsRegistered: registrations.length,
      outstanding: registrations.reduce((sum, row) => sum + row.outstanding, 0),
      pastDue: registrations.filter((row) => row.subscriptionStatus === "PAST_DUE")
        .length,
    },
  };
}

/**
 * The superadmin's view of the whole team: who is on it, and what each of them
 * has brought in.
 *
 * One aggregate per fact rather than a per-member loop — a roster of thirty
 * agents must not become sixty round trips.
 */
export async function listTeamRoster() {
  await connectToDatabase();

  const members = await UserModel.find({
    isDeleted: { $ne: true },
    role: Role.PLATFORM_AGENT,
  })
    .select("name email phone status createdAt")
    .sort({ createdAt: -1 })
    .lean<
      {
        _id: Types.ObjectId;
        createdAt?: Date;
        email?: string;
        name?: string;
        phone?: string;
        status?: string;
      }[]
    >();

  const memberIds = members.map((member) => member._id);

  const [registrationCounts, collections] = await Promise.all([
    HostelSubscriptionModel.aggregate<{
      _id: Types.ObjectId;
      outstandingPrice: number;
      total: number;
    }>([
      { $match: { agentId: { $in: memberIds } } },
      {
        $group: {
          _id: "$agentId",
          outstandingPrice: { $sum: "$cycleTotal" },
          total: { $sum: 1 },
        },
      },
    ]),
    SubscriptionPaymentModel.aggregate<{
      _id: { collectedBy: Types.ObjectId; method: string };
      total: number;
    }>([
      { $match: { collectedBy: { $in: memberIds }, status: "SETTLED" } },
      {
        $group: {
          _id: { collectedBy: "$collectedBy", method: "$method" },
          total: { $sum: "$amount" },
        },
      },
    ]),
  ]);

  const countById = new Map(
    registrationCounts.map((row) => [row._id?.toString() ?? "", row]),
  );
  const cashById = new Map<string, number>();

  for (const row of collections) {
    if (row._id.method !== "CASH") {
      continue;
    }

    const key = row._id.collectedBy?.toString() ?? "";

    cashById.set(key, (cashById.get(key) ?? 0) + row.total);
  }

  return {
    members: members.map((member) => {
      const key = member._id.toString();
      const counts = countById.get(key);

      return {
        cashCollected: cashById.get(key) ?? 0,
        email: member.email ?? "",
        hostelsRegistered: counts?.total ?? 0,
        id: key,
        joinedAt: member.createdAt?.toISOString() ?? null,
        name: member.name ?? "Unnamed",
        phone: member.phone ?? "",
        status: member.status ?? "ACTIVE",
      };
    }),
  };
}

/**
 * Every hostel the team has filed, across all agents, with who filed it.
 *
 * This is the superadmin's audit surface — the notes ask for it in as many
 * words — and it deliberately shows the agent's name on every row rather than
 * making a reader cross-reference the roster above.
 */
export async function listTeamRegistrations(limit = 200) {
  await connectToDatabase();

  const subscriptions = await HostelSubscriptionModel.find({
    agentId: { $ne: null },
    source: "TEAM",
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean<SubscriptionRow[]>();

  const [hostels, agents, money, invoices] = await Promise.all([
    HostelModel.find({ _id: { $in: subscriptions.map((row) => row.hostelId) } })
      .select("name slug status")
      .lean<{ _id: Types.ObjectId; name?: string; slug?: string; status?: string }[]>(),
    UserModel.find({
      _id: { $in: subscriptions.map((row) => row.agentId).filter(Boolean) },
    })
      .select("name email")
      .lean<{ _id: Types.ObjectId; email?: string; name?: string }[]>(),
    moneyBySubscription(subscriptions.map((row) => row._id)),
    SubscriptionInvoiceModel.find({
      subscriptionId: { $in: subscriptions.map((row) => row._id) },
    })
      .select("invoiceNumber subscriptionId")
      .lean<
        { invoiceNumber: string; subscriptionId: Types.ObjectId }[]
      >(),
  ]);

  const hostelById = new Map(hostels.map((hostel) => [hostel._id.toString(), hostel]));
  const agentById = new Map(agents.map((agent) => [agent._id.toString(), agent]));
  const invoiceBySubscription = new Map(
    invoices.map((invoice) => [invoice.subscriptionId.toString(), invoice.invoiceNumber]),
  );

  return {
    registrations: subscriptions.map((row) => {
      const paid = money.get(row._id.toString()) ?? { cash: 0, online: 0, total: 0 };
      const agent = row.agentId ? agentById.get(row.agentId.toString()) : null;
      const price = row.cycleTotal ?? 0;

      return {
        agentEmail: agent?.email ?? "",
        agentName: agent?.name ?? "Unknown",
        cashCollected: paid.cash,
        dueBy: row.dueBy?.toISOString() ?? null,
        hostelId: row.hostelId.toString(),
        hostelName: hostelById.get(row.hostelId.toString())?.name ?? "Unnamed hostel",
        hostelStatus: hostelById.get(row.hostelId.toString())?.status ?? "",
        invoiceNumber: invoiceBySubscription.get(row._id.toString()) ?? "",
        onlineCollected: paid.online,
        outstanding: Math.max(0, price - paid.total),
        paid: paid.total,
        planName: row.planName ?? "",
        price,
        registeredAt: row.createdAt?.toISOString() ?? null,
        subscriptionStatus: row.status,
      };
    }),
  };
}
