import { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { notifyGatewayUnhealthy } from "@/modules/finance/finance-notify";
import { withRun } from "@/modules/finance/reconciliation/run-recorder";
import { UNCONFIRMED_REASON } from "@/modules/finance/gateway/intent.service";
import { hasProvider } from "@/modules/finance/gateway/registry";
import { HostelModel } from "@hostel/db/models/Hostel";
import {
  enabledGateways,
  type GatewayConfig,
  type GatewayHealthStatus,
  type GatewayProviderName,
  HostelPaymentProfileModel,
} from "@hostel/db/models/HostelPaymentProfile";
import { InvoiceModel } from "@hostel/db/models/Invoice";
import { PaymentIntentModel } from "@hostel/db/models/PaymentIntent";

/**
 * Gateway health (target §6.5, plan item 6.7).
 *
 * **The failure this exists to catch: a broken checkout is indistinguishable
 * from a quiet month.** Both look identical on every other screen — no
 * settlements, invoices staying open, nobody complaining yet. An owner discovers
 * it when a resident finally rings to say the payment button has not worked since
 * the 3rd, by which point a month of rent is late for a reason nobody caused.
 *
 * The signal that separates them is **attempts**. Residents opening checkouts
 * that never complete is broken; nobody opening one is quiet. Those are
 * different numbers, and every verdict below turns on which of them is zero.
 *
 * Deliberately not an uptime check. Pinging the provider proves the provider
 * answers us, which is not the question — a gateway can be reachable and still
 * be failing every resident because a merchant code changed, a key was rotated
 * at the bank, or a callback URL was never registered.
 */

/** How far back the counts look. Long enough to smooth a slow week. */
const WINDOW_DAYS = 7;

/**
 * How long a hostel must have been live before silence means anything.
 *
 * A gateway switched on yesterday with no attempts is not quiet, it is new.
 */
const SETTLING_IN_DAYS = 7;

/** Below this, attempts are happening but too many are failing. */
const DEGRADED_SUCCESS_RATE = 0.5;

/** Re-alerting cadence while a provider stays unhealthy. */
const RENOTIFY_HOURS = 24;

export type GatewayHealth = {
  attempts: number;
  detail: string;
  expired: number;
  failed: number;
  lastEventAt: string | null;
  openInvoices: number;
  provider: GatewayProviderName;
  status: GatewayHealthStatus;
  succeeded: number;
  /** Attempts we tried to confirm and never could. Each one needs a human. */
  unconfirmed: number;
};

type IntentCounts = {
  attempts: number;
  expired: number;
  failed: number;
  succeeded: number;
  unconfirmed: number;
};

/**
 * The verdict, and the sentence an owner reads.
 *
 * The text matters as much as the status: "no payments this week" is a fact an
 * owner can misread as their residents being late. "Six residents tried to pay
 * and none succeeded" is not misreadable.
 */
function verdict(
  counts: IntentCounts,
  context: { enabledForDays: number; openInvoices: number },
): { detail: string; status: GatewayHealthStatus } {
  if (counts.unconfirmed > 0 && counts.succeeded === 0) {
    return {
      detail: `${counts.unconfirmed} payment ${plural(counts.unconfirmed, "attempt")} could not be confirmed with the provider at all. Check the merchant details.`,
      status: "FAILING",
    };
  }

  if (counts.attempts > 0 && counts.succeeded === 0) {
    // The case this module exists for. Residents tried; nothing worked.
    return {
      detail: `${counts.attempts} ${plural(counts.attempts, "resident")} started a payment in the last ${WINDOW_DAYS} days and none completed.`,
      status: "FAILING",
    };
  }

  const rate = counts.attempts > 0 ? counts.succeeded / counts.attempts : 1;

  if (counts.attempts > 0 && rate < DEGRADED_SUCCESS_RATE) {
    return {
      detail: `Only ${counts.succeeded} of ${counts.attempts} payment attempts completed in the last ${WINDOW_DAYS} days.`,
      status: "DEGRADED",
    };
  }

  if (counts.unconfirmed > 0) {
    return {
      detail: `${counts.unconfirmed} payment ${plural(counts.unconfirmed, "attempt")} could not be confirmed. Payments are otherwise going through.`,
      status: "DEGRADED",
    };
  }

  if (counts.succeeded > 0) {
    return {
      detail: `${counts.succeeded} ${plural(counts.succeeded, "payment")} settled in the last ${WINDOW_DAYS} days.`,
      status: "HEALTHY",
    };
  }

  // No attempts at all. Only worth mentioning once the hostel has been live long
  // enough for silence to be surprising, and only if there is something to pay.
  if (context.openInvoices > 0 && context.enabledForDays >= SETTLING_IN_DAYS) {
    return {
      detail: `No resident has used this to pay in the last ${WINDOW_DAYS} days, and ${context.openInvoices} ${plural(context.openInvoices, "invoice")} ${context.openInvoices === 1 ? "is" : "are"} unpaid. That may be normal, or the button may not be reaching them.`,
      status: "QUIET",
    };
  }

  return { detail: "Nothing to report.", status: "HEALTHY" };
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

async function countIntents(
  hostelId: Types.ObjectId | string,
  provider: GatewayProviderName,
  since: Date,
): Promise<IntentCounts> {
  const rows = await PaymentIntentModel.find({
    createdAt: { $gte: since },
    hostelId,
    provider,
  })
    .select("failureReason status")
    .lean<{ failureReason?: string; status: string }[]>();

  const counts: IntentCounts = {
    attempts: rows.length,
    expired: 0,
    failed: 0,
    succeeded: 0,
    unconfirmed: 0,
  };

  for (const row of rows) {
    if (row.status === "SUCCEEDED") counts.succeeded += 1;
    else if (row.status === "FAILED") counts.failed += 1;
    else if (row.status === "EXPIRED") counts.expired += 1;

    // Written by the sweep when it gave up asking. Distinct from a clean expiry:
    // nobody knows what happened to these, which is the state that needs a
    // person rather than a counter. Compared against the exported constant, not
    // a phrase, so rewording the message cannot silently stop the count.
    if (row.failureReason === UNCONFIRMED_REASON) {
      counts.unconfirmed += 1;
    }
  }

  // A row still `CREATED` is counted in `attempts` and in none of the outcomes,
  // which is correct: the resident may be on the provider's screen right now.
  return counts;
}

export async function getGatewayHealth(
  hostelId: Types.ObjectId | string,
  options: { now?: Date } = {},
): Promise<GatewayHealth[]> {
  await connectToDatabase();

  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);

  const profile = await HostelPaymentProfileModel.findOne({ hostelId })
    .select("gateways")
    .lean<{ gateways?: GatewayConfig[] } | null>();

  const live = enabledGateways(profile).filter((entry) => hasProvider(entry.provider));

  if (live.length === 0) {
    return [];
  }

  // One count for the hostel, not one per provider: an unpaid invoice is unpaid
  // regardless of which checkout the resident would have used.
  const openInvoices = await InvoiceModel.countDocuments({
    hostelId,
    status: { $in: ["OPEN", "OVERDUE", "PARTIAL"] },
  });

  return Promise.all(
    live.map(async (entry) => {
      const counts = await countIntents(hostelId, entry.provider, since);
      const enabledForDays = entry.enabledAt
        ? (now.getTime() - new Date(entry.enabledAt).getTime()) / 86_400_000
        : 0;
      const { detail, status } = verdict(counts, { enabledForDays, openInvoices });

      return {
        ...counts,
        detail,
        lastEventAt: entry.lastEventAt
          ? new Date(entry.lastEventAt).toISOString()
          : null,
        openInvoices,
        provider: entry.provider,
        status,
      };
    }),
  );
}

/**
 * Records the verdict, and tells the owner when it is worth telling them.
 *
 * Notification is throttled two ways, because a daily job that mails daily stops
 * being read by the second week: a *worsening* status always notifies, and an
 * unchanged bad one waits a day. A recovery is never mailed — nobody needs to be
 * told their payments started working, and it would double the volume.
 */
async function recordHealth(
  hostelId: Types.ObjectId | string,
  entry: GatewayConfig,
  health: GatewayHealth,
  now: Date,
): Promise<{ notified: boolean }> {
  const previous = entry.healthStatus ?? "UNKNOWN";
  const bad = health.status === "DEGRADED" || health.status === "FAILING";
  const worsened = SEVERITY[health.status] > SEVERITY[previous];
  const stale =
    !entry.healthNotifiedAt ||
    now.getTime() - new Date(entry.healthNotifiedAt).getTime() >
      RENOTIFY_HOURS * 3_600_000;
  const notify = bad && (worsened || stale);

  await HostelPaymentProfileModel.updateOne(
    { hostelId },
    {
      $set: {
        "gateways.$[slot].healthCheckedAt": now,
        "gateways.$[slot].healthDetail": health.detail,
        "gateways.$[slot].healthStatus": health.status,
        ...(notify ? { "gateways.$[slot].healthNotifiedAt": now } : {}),
      },
    },
    { arrayFilters: [{ "slot.provider": health.provider }] },
  );

  if (notify) {
    await notifyGatewayUnhealthy({
      detail: health.detail,
      hostelId,
      provider: health.provider,
      status: health.status,
    });
  }

  return { notified: notify };
}

const SEVERITY: Record<GatewayHealthStatus, number> = {
  DEGRADED: 2,
  FAILING: 3,
  HEALTHY: 0,
  QUIET: 1,
  UNKNOWN: 0,
};

export type GatewayHealthSummary = {
  checked: number;
  findings: number;
  hostelId: string;
  notified: number;
  runId: string;
  status: "FAIL" | "OK" | "WARN";
};

export async function runGatewayHealthForHostel(
  hostelId: Types.ObjectId | string,
  options: { now?: Date; triggeredBy?: string } = {},
): Promise<GatewayHealthSummary> {
  await connectToDatabase();

  const now = options.now ?? new Date();

  const { findings, result, runId, status } = await withRun(
    { hostelId, kind: "GATEWAY_HEALTH", triggeredBy: options.triggeredBy ?? "CRON" },
    async (recorder) => {
      const profile = await HostelPaymentProfileModel.findOne({ hostelId })
        .select("gateways")
        .lean<{ gateways?: GatewayConfig[] } | null>();

      const report = await getGatewayHealth(hostelId, { now });
      let notified = 0;

      for (const health of report) {
        const entry = (profile?.gateways ?? []).find(
          (candidate) => candidate.provider === health.provider,
        );

        recorder.count("checked");

        if (health.status !== "HEALTHY") {
          recorder.finding({
            code: `GATEWAY_${health.status}`,
            detail: `${health.provider}: ${health.detail}`,
            entityType: "HostelPaymentProfile",
            // QUIET may well be nothing. FAILING is somebody's rent.
            severity: health.status === "QUIET" ? "INFO" : "WARN",
          });
        }

        if (entry) {
          const outcome = await recordHealth(hostelId, entry, health, now);

          if (outcome.notified) notified += 1;
        }
      }

      return { checked: report.length, notified };
    },
  );

  return {
    checked: result.checked,
    findings: findings.length,
    hostelId: hostelId.toString(),
    notified: result.notified,
    runId,
    status,
  };
}

/** Daily entry point: every hostel, each with its own run row. */
export async function runGatewayHealth(
  options: { now?: Date; triggeredBy?: string } = {},
): Promise<GatewayHealthSummary[]> {
  await connectToDatabase();

  const hostels = await HostelModel.find({ isDeleted: { $ne: true } })
    .select("_id")
    .lean<{ _id: Types.ObjectId }[]>();

  const summaries: GatewayHealthSummary[] = [];

  for (const hostel of hostels) {
    try {
      summaries.push(await runGatewayHealthForHostel(hostel._id, options));
    } catch {
      // One hostel's failure must not stop the other forty. `withRun` has
      // already recorded the FAIL row with the message.
      summaries.push({
        checked: 0,
        findings: 0,
        hostelId: hostel._id.toString(),
        notified: 0,
        runId: "",
        status: "FAIL",
      });
    }
  }

  return summaries;
}
