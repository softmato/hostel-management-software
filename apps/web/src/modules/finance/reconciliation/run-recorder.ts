import type { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { ReconciliationRunModel } from "@hostel/db/models/ReconciliationRun";

/**
 * The only way a finance job returns (§5.4).
 *
 * Target §4.1 puts it plainly — "every scheduled job writes one of these. Every
 * job. No exceptions" — and the way to make that true is to leave no other exit.
 * {@link withRun} opens the row, runs the work, records counters and findings,
 * and closes it; a throw closes it as `FAIL` with the message, so a job that
 * dies leaves a louder trace than one that succeeds, rather than none at all.
 *
 * The status is **derived from the findings**, not chosen by the caller. A job
 * that reports three drift findings and then declares itself OK is exactly the
 * self-assessment this collection exists to remove.
 */

export type RunKind =
  | "DUNNING"
  | "GATEWAY_HEALTH"
  | "LEDGER_DRIFT"
  | "STATEMENT_MATCH";

export type RunFinding = {
  code: string;
  detail?: string;
  entityId?: Types.ObjectId | string | null;
  entityType?: string;
  severity?: "ERROR" | "INFO" | "WARN";
};

/**
 * The handle a job writes through. Counters accumulate; findings append.
 *
 * Passed in rather than returned so a job that throws halfway has still recorded
 * everything it learned up to that point — a partial run whose findings were
 * discarded on the way out is worse than no run, because the failure looks
 * clean.
 */
export type RunRecorder = {
  count(name: string, by?: number): void;
  finding(finding: RunFinding): void;
  /** Live view, for a job that branches on what it has already found. */
  readonly findings: RunFinding[];
};

export type RunResult<T> = {
  /** What the job found, so a caller can summarise without re-reading the row. */
  findings: RunFinding[];
  result: T;
  runId: string;
  status: "FAIL" | "OK" | "WARN";
};

export async function withRun<T>(
  options: {
    hostelId?: Types.ObjectId | string | null;
    kind: RunKind;
    triggeredBy?: string;
  },
  work: (recorder: RunRecorder) => Promise<T>,
): Promise<RunResult<T>> {
  await connectToDatabase();

  const counters: Record<string, number> = {};
  const findings: RunFinding[] = [];
  const recorder: RunRecorder = {
    count(name, by = 1) {
      counters[name] = (counters[name] ?? 0) + by;
    },
    finding(finding) {
      findings.push({ severity: "INFO", ...finding });
    },
    findings,
  };

  const run = await ReconciliationRunModel.create({
    hostelId: options.hostelId ?? null,
    kind: options.kind,
    startedAt: new Date(),
    status: "RUNNING",
    triggeredBy: options.triggeredBy ?? "CRON",
  });

  try {
    const result = await work(recorder);
    const status = statusFor(findings);

    await ReconciliationRunModel.updateOne(
      { _id: run._id },
      {
        $set: {
          counters,
          findings: normalizeFindings(findings),
          finishedAt: new Date(),
          status,
        },
      },
    );

    return { findings, result, runId: run._id.toString(), status };
  } catch (error) {
    await ReconciliationRunModel.updateOne(
      { _id: run._id },
      {
        $set: {
          counters,
          errorDetail: error instanceof Error ? error.message : String(error),
          findings: normalizeFindings(findings),
          finishedAt: new Date(),
          status: "FAIL",
        },
      },
    );

    throw error;
  }
}

/** WARN for anything worth a human's attention, FAIL only for a thrown job. */
export function statusFor(findings: RunFinding[]): "FAIL" | "OK" | "WARN" {
  return findings.some(
    (finding) => finding.severity === "ERROR" || finding.severity === "WARN",
  )
    ? "WARN"
    : "OK";
}

function normalizeFindings(findings: RunFinding[]) {
  // Bounded: a drift job against a broken hostel could find thousands, and a
  // document that cannot be saved would lose the run entirely. The counters
  // still carry the true total.
  return findings.slice(0, 200).map((finding) => ({
    code: finding.code,
    detail: finding.detail ?? "",
    entityId: finding.entityId ?? null,
    entityType: finding.entityType ?? "",
    severity: finding.severity ?? "INFO",
  }));
}
