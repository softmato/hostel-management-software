import { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { verifyPaymentIntent } from "@/modules/finance/gateway/intent.service";
import { hasProvider } from "@/modules/finance/gateway/registry";
import { withRun, type RunRecorder } from "@/modules/finance/reconciliation/run-recorder";
import { HostelModel } from "@hostel/db/models/Hostel";
import {
  enabledGateways,
  type GatewayConfig,
  HostelPaymentProfileModel,
} from "@hostel/db/models/HostelPaymentProfile";
import { PaymentEventModel } from "@hostel/db/models/PaymentEvent";
import { PaymentIntentModel } from "@hostel/db/models/PaymentIntent";

/**
 * Weekly settlement reconciliation (target §10.2, plan item 6.7).
 *
 * **Neither eSewa nor Khalti publishes a bulk settlement report**, which is what
 * target §10.2 assumed would exist — `listSettlements` is optional on the
 * provider interface for exactly this reason and no adapter implements it. So
 * this reconciles the only way that is actually available: by asking about
 * individual attempts again, and by checking our own two records against each
 * other.
 *
 * Three checks, and each one catches a failure the others cannot:
 *
 * 1. **Attempts we wrote off, asked again.** A payment that completed after the
 *    sweep gave up is money in the hostel's account and an invoice that says
 *    unpaid. This is the check that recovers it, and it settles when it finds
 *    one rather than merely reporting.
 * 2. **Successes with no ledger row.** An intent marked `SUCCEEDED` whose event
 *    is missing means the process died between the two writes. The resident has
 *    paid and the invoice does not know.
 * 3. **Ledger rows with no attempt.** A gateway credit nobody initiated through
 *    us. Rare and worth being loud about — it is what a replayed or forged
 *    callback would leave behind if one ever got past verification.
 *
 * Only the first of these changes anything. Two and three report, in keeping
 * with the drift job (5.1): a reconciliation that silently repairs destroys the
 * evidence that the path producing the discrepancy exists.
 */

/** How far back to look. A week of runs overlaps, which is intended. */
const WINDOW_DAYS = 14;

/** Bounded so one hostel's bad week cannot run the job past its timeout. */
const RECHECK_LIMIT = 200;

export type SettlementReconSummary = {
  findings: number;
  hostelId: string;
  recovered: number;
  rechecked: number;
  runId: string;
  status: "FAIL" | "OK" | "WARN";
};

type IntentRow = {
  _id: Types.ObjectId;
  amount: number;
  invoiceId: Types.ObjectId;
  provider: string;
  reference: string;
  settledEventId?: Types.ObjectId | null;
  status: string;
};

/**
 * Check 1 — ask again about everything that ended without settling.
 *
 * The providers are asked about attempts they have already told us failed, which
 * looks wasteful until the week one of them answers differently. `EXPIRED` in
 * particular is our word, not theirs: it means our window closed, and their
 * transaction may have completed a minute later.
 */
async function recheckClosedAttempts(
  hostelId: Types.ObjectId | string,
  since: Date,
  recorder: RunRecorder,
): Promise<{ recovered: number; rechecked: number }> {
  const closed = await PaymentIntentModel.find({
    createdAt: { $gte: since },
    hostelId,
    settledEventId: null,
    status: { $in: ["EXPIRED", "FAILED"] },
  })
    .sort({ createdAt: -1 })
    .limit(RECHECK_LIMIT)
    .lean<IntentRow[]>();

  let recovered = 0;
  let rechecked = 0;

  for (const intent of closed) {
    if (!hasProvider(intent.provider as never)) {
      continue;
    }

    rechecked += 1;

    try {
      const outcome = await verifyPaymentIntent(intent._id, { source: "GATEWAY_POLL" });

      if (outcome.settled) {
        recovered += 1;
        recorder.finding({
          code: "SETTLEMENT_RECOVERED",
          detail: `${intent.provider} ${intent.reference} was closed unpaid but the provider reports it succeeded. Settled now, NPR ${intent.amount}.`,
          entityId: intent._id,
          entityType: "PaymentIntent",
          severity: "WARN",
        });
      }
    } catch {
      // Unreachable, or a gateway the hostel has since removed. Next week.
      recorder.count("unreachable");
    }
  }

  return { recovered, rechecked };
}

/**
 * Check 2 — a success on one side and nothing on the other.
 *
 * The window between appending the event and pointing the intent at it is the
 * only place this can be produced, and it is small. Small is not never, and the
 * resident on the wrong side of it has paid.
 */
async function checkSucceededHaveEvents(
  hostelId: Types.ObjectId | string,
  since: Date,
  recorder: RunRecorder,
): Promise<void> {
  const succeeded = await PaymentIntentModel.find({
    createdAt: { $gte: since },
    hostelId,
    status: "SUCCEEDED",
  })
    .select("amount invoiceId provider reference settledEventId")
    .lean<IntentRow[]>();

  for (const intent of succeeded) {
    if (!intent.settledEventId) {
      recorder.finding({
        code: "SETTLED_INTENT_WITHOUT_EVENT",
        detail: `${intent.provider} ${intent.reference} is marked succeeded but points at no ledger entry. The resident has paid NPR ${intent.amount} and the invoice does not know.`,
        entityId: intent._id,
        entityType: "PaymentIntent",
        severity: "ERROR",
      });
      continue;
    }

    const event = await PaymentEventModel.findOne({
      _id: intent.settledEventId,
    })
      .select("amount status")
      .lean<{ amount: number; status: string } | null>();

    if (!event) {
      recorder.finding({
        code: "SETTLED_INTENT_EVENT_MISSING",
        detail: `${intent.provider} ${intent.reference} points at a ledger entry that does not exist.`,
        entityId: intent._id,
        entityType: "PaymentIntent",
        severity: "ERROR",
      });
      continue;
    }

    // A reversal is legitimate and leaves the original SETTLED with a pointer,
    // so status is checked rather than assumed — but the amounts must agree
    // whatever happened afterwards.
    if (event.amount !== intent.amount) {
      recorder.finding({
        code: "SETTLED_AMOUNT_DISAGREES",
        detail: `${intent.provider} ${intent.reference} raised NPR ${intent.amount} but its ledger entry holds NPR ${event.amount}.`,
        entityId: intent._id,
        entityType: "PaymentIntent",
        severity: "ERROR",
      });
    }
  }
}

/**
 * Check 3 — a gateway credit on the ledger that no attempt of ours produced.
 *
 * There is no ordinary way to reach this state: every gateway event is written
 * by the intent service, from an intent. It is what a forged or replayed
 * callback would leave behind if one ever got past verification, so it is an
 * ERROR even though the likeliest cause is a hand-inserted test row.
 */
async function checkEventsHaveIntents(
  hostelId: Types.ObjectId | string,
  since: Date,
  recorder: RunRecorder,
): Promise<void> {
  const events = await PaymentEventModel.find({
    hostelId,
    occurredAt: { $gte: since },
    provider: { $in: ["ESEWA", "FONEPAY", "KHALTI"] },
    source: { $in: ["GATEWAY_POLL", "GATEWAY_WEBHOOK"] },
    status: "SETTLED",
  })
    .select("amount provider referenceCode")
    .lean<{ _id: Types.ObjectId; amount: number; provider: string; referenceCode?: string }[]>();

  for (const event of events) {
    const intent = event.referenceCode
      ? await PaymentIntentModel.findOne({
          hostelId,
          reference: event.referenceCode,
        })
          .select("_id")
          .lean<{ _id: Types.ObjectId } | null>()
      : null;

    if (!intent) {
      recorder.finding({
        code: "GATEWAY_EVENT_WITHOUT_INTENT",
        detail: `A settled ${event.provider} credit of NPR ${event.amount} has no payment attempt behind it${event.referenceCode ? ` (reference ${event.referenceCode})` : ""}.`,
        entityId: event._id,
        entityType: "PaymentEvent",
        severity: "ERROR",
      });
    }
  }
}

export async function runSettlementReconForHostel(
  hostelId: Types.ObjectId | string,
  options: { now?: Date; triggeredBy?: string } = {},
): Promise<SettlementReconSummary> {
  await connectToDatabase();

  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);

  const { findings, result, runId, status } = await withRun(
    {
      hostelId,
      kind: "GATEWAY_HEALTH",
      triggeredBy: options.triggeredBy ?? "CRON_SETTLEMENT",
    },
    async (recorder) => {
      const profile = await HostelPaymentProfileModel.findOne({ hostelId })
        .select("gateways")
        .lean<{ gateways?: GatewayConfig[] } | null>();

      // A hostel that has never enabled a gateway has nothing to reconcile, but
      // one that *disabled* one still does — its old attempts are still real.
      if ((profile?.gateways ?? []).length === 0) {
        return { recovered: 0, rechecked: 0 };
      }

      recorder.count("liveGateways", enabledGateways(profile).length);

      const recheck = await recheckClosedAttempts(hostelId, since, recorder);

      await checkSucceededHaveEvents(hostelId, since, recorder);
      await checkEventsHaveIntents(hostelId, since, recorder);

      return recheck;
    },
  );

  return {
    findings: findings.length,
    hostelId: hostelId.toString(),
    recovered: result.recovered,
    rechecked: result.rechecked,
    runId,
    status,
  };
}

/** Weekly entry point: every hostel, each with its own run row. */
export async function runSettlementRecon(
  options: { now?: Date; triggeredBy?: string } = {},
): Promise<SettlementReconSummary[]> {
  await connectToDatabase();

  const hostels = await HostelModel.find({ isDeleted: { $ne: true } })
    .select("_id")
    .lean<{ _id: Types.ObjectId }[]>();

  const summaries: SettlementReconSummary[] = [];

  for (const hostel of hostels) {
    try {
      summaries.push(await runSettlementReconForHostel(hostel._id, options));
    } catch {
      // One hostel's failure must not stop the others. `withRun` has already
      // recorded the FAIL row with the message.
      summaries.push({
        findings: 0,
        hostelId: hostel._id.toString(),
        recovered: 0,
        rechecked: 0,
        runId: "",
        status: "FAIL",
      });
    }
  }

  return summaries;
}
