import { Schema, model, models } from "mongoose";

/**
 * One execution of a job that checks or ingests money (target §4.1, §10).
 *
 * Exists because of a specific failure the current state exhibits: the dunning
 * job returns a statistics object that **nothing reads**, so a cron that has
 * been throwing for three weeks is indistinguishable from one that ran and found
 * nothing to do. Both produce silence. Every scheduled finance job — and the
 * owner-triggered statement import, which is a reconciliation whether or not a
 * clock started it — writes a row here.
 *
 * `findings` is the point of the collection. Counters say a job ran; findings
 * say what it *saw*, and a drift finding is deliberately reported rather than
 * corrected (target §10.1): a balance that disagrees with its events means
 * something wrote where it should not have, and silently fixing the symptom
 * destroys the only evidence of the cause.
 */

const findingSchema = new Schema(
  {
    severity: {
      type: String,
      enum: ["INFO", "WARN", "ERROR"],
      default: "INFO",
      required: true,
    },
    /** Stable, SCREAMING_SNAKE, branched on by the dashboard. */
    code: { type: String, required: true, trim: true },
    entityId: { type: Schema.Types.ObjectId, default: null },
    entityType: { type: String, trim: true },
    detail: { type: String, trim: true },
  },
  { _id: false },
);

const reconciliationRunSchema = new Schema(
  {
    /** Null means a platform-wide run, not a missing value. */
    hostelId: { ref: "Hostel", default: null, type: Schema.Types.ObjectId },
    kind: {
      type: String,
      enum: ["LEDGER_DRIFT", "DUNNING", "GATEWAY_HEALTH", "STATEMENT_MATCH"],
      required: true,
    },

    startedAt: { default: Date.now, required: true, type: Date },
    finishedAt: Date,

    status: {
      type: String,
      enum: ["RUNNING", "OK", "WARN", "FAIL"],
      default: "RUNNING",
      required: true,
    },
    /** `{ scanned, matched, drifted, notified, errors }` — free-form per kind. */
    counters: { type: Schema.Types.Mixed, default: {} },
    findings: { type: [findingSchema], default: [] },

    /** Populated on FAIL. The reason the run stopped, not a finding it made. */
    errorDetail: { type: String, trim: true },
    /** What triggered it: `CRON`, or the user id of the person who clicked. */
    triggeredBy: { type: String, trim: true },
  },
  { timestamps: true },
);

reconciliationRunSchema.index({ kind: 1, startedAt: -1 });
reconciliationRunSchema.index({ hostelId: 1, kind: 1, startedAt: -1 });

export const ReconciliationRunModel =
  models.ReconciliationRun || model("ReconciliationRun", reconciliationRunSchema);
