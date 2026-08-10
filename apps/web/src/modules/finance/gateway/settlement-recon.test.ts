/**
 * Weekly settlement reconciliation — Block 6 item 6.7 of
 * docs/FINANCE_IMPLEMENTATION_PLAN.md (target §10.2).
 *
 * The recheck is the part that recovers money, and the first test is the reason
 * the job exists: an attempt that completed after our sweep gave up is cash in
 * the hostel's account against an invoice that says unpaid, and nothing else in
 * the system will ever notice.
 *
 * The two cross-checks only report. A reconciliation that silently repairs
 * destroys the evidence that the path producing the discrepancy exists — the
 * same rule the drift job (5.1) is built on.
 */
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");
const intentId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0d1");
const eventId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0e1");

const mocks = vi.hoisted(() => ({
  eventFind: vi.fn(),
  eventFindOne: vi.fn(),
  hostelFind: vi.fn(),
  intentFind: vi.fn(),
  intentFindOne: vi.fn(),
  profileFindOne: vi.fn(),
  verify: vi.fn(),
  withRun: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/modules/finance/gateway/intent.service", () => ({
  verifyPaymentIntent: mocks.verify,
}));
vi.mock("@/modules/finance/gateway/registry", () => ({
  hasProvider: (provider: string) => provider !== "FONEPAY",
}));
vi.mock("@/modules/finance/reconciliation/run-recorder", () => ({
  withRun: mocks.withRun,
}));
vi.mock("@hostel/db/models/Hostel", () => ({
  HostelModel: { find: mocks.hostelFind },
}));
vi.mock("@hostel/db/models/PaymentEvent", () => ({
  PaymentEventModel: { find: mocks.eventFind, findOne: mocks.eventFindOne },
}));
vi.mock("@hostel/db/models/PaymentIntent", () => ({
  PaymentIntentModel: { find: mocks.intentFind, findOne: mocks.intentFindOne },
}));
vi.mock("@hostel/db/models/HostelPaymentProfile", async () => {
  const actual = await vi.importActual<
    typeof import("@hostel/db/models/HostelPaymentProfile")
  >("@hostel/db/models/HostelPaymentProfile");

  return { ...actual, HostelPaymentProfileModel: { findOne: mocks.profileFindOne } };
});

const { runSettlementReconForHostel } = await import("./settlement-recon.service");

const NOW = new Date("2026-08-10T12:00:00.000Z");

function chain<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
    limit: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
  };
}

const closedIntent = {
  _id: intentId,
  amount: 12000,
  invoiceId: new Types.ObjectId(),
  provider: "ESEWA",
  reference: "EDU-0001-F-1",
  settledEventId: null,
  status: "EXPIRED",
};

/**
 * Queues the three finds in the order the service issues them.
 *
 * Resets first: a test calling this after `beforeEach` would otherwise append to
 * the existing queue and get the empty results set up there.
 */
function queue(options: {
  closed?: unknown[];
  events?: unknown[];
  succeeded?: unknown[];
}) {
  mocks.intentFind.mockReset();
  mocks.intentFind
    .mockReturnValueOnce(chain(options.closed ?? []))
    .mockReturnValueOnce(chain(options.succeeded ?? []));
  mocks.eventFind.mockReset();
  mocks.eventFind.mockReturnValue(chain(options.events ?? []));
}

async function findings() {
  return (await mocks.withRun.mock.results[0]!.value).findings;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profileFindOne.mockReturnValue(
    chain({ gateways: [{ enabledAt: NOW, merchantCode: "EPAYTEST", provider: "ESEWA" }] }),
  );
  queue({});
  mocks.eventFindOne.mockReturnValue(chain(null));
  mocks.intentFindOne.mockReturnValue(chain({ _id: intentId }));
  mocks.verify.mockResolvedValue({ eventId: null, settled: false, status: "FAILED" });
  mocks.withRun.mockImplementation(
    async (_options: unknown, work: (r: unknown) => unknown) => {
      const collected: unknown[] = [];
      const recorder = {
        count: vi.fn(),
        finding: (finding: unknown) => collected.push(finding),
        findings: collected,
      };
      const result = await work(recorder);

      return {
        findings: collected,
        result,
        runId: "run-1",
        status: collected.length ? "WARN" : "OK",
      };
    },
  );
});

describe("asking again about attempts we closed", () => {
  /**
   * `EXPIRED` is our word, not the provider's: it means our window closed, and
   * their transaction may have completed a minute later.
   */
  it("settles a payment that succeeded after we gave up", async () => {
    queue({ closed: [closedIntent] });
    mocks.verify.mockResolvedValue({
      eventId: eventId.toString(),
      settled: true,
      status: "SUCCEEDED",
    });

    const summary = await runSettlementReconForHostel(hostelId, { now: NOW });

    expect(summary.recovered).toBe(1);
    expect(await findings()).toContainEqual(
      expect.objectContaining({ code: "SETTLEMENT_RECOVERED", severity: "WARN" }),
    );
  });

  it("says nothing when the provider still reports a failure", async () => {
    queue({ closed: [closedIntent] });

    const summary = await runSettlementReconForHostel(hostelId, { now: NOW });

    expect(summary.rechecked).toBe(1);
    expect(summary.recovered).toBe(0);
    expect(await findings()).toEqual([]);
  });

  it("skips a provider whose adapter has been removed", async () => {
    queue({ closed: [{ ...closedIntent, provider: "FONEPAY" }] });

    expect((await runSettlementReconForHostel(hostelId, { now: NOW })).rechecked).toBe(0);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("keeps going when one attempt cannot be reached", async () => {
    queue({ closed: [closedIntent, { ...closedIntent, _id: new Types.ObjectId() }] });
    mocks.verify
      .mockRejectedValueOnce(new Error("ETIMEDOUT"))
      .mockResolvedValueOnce({ eventId: null, settled: false, status: "FAILED" });

    expect((await runSettlementReconForHostel(hostelId, { now: NOW })).rechecked).toBe(2);
  });

  it("looks back a fortnight, so weekly runs overlap", async () => {
    await runSettlementReconForHostel(hostelId, { now: NOW });

    const query = mocks.intentFind.mock.calls[0]![0];
    const days = (NOW.getTime() - query.createdAt.$gte.getTime()) / 86_400_000;

    expect(days).toBe(14);
    expect(query.status).toEqual({ $in: ["EXPIRED", "FAILED"] });
  });
});

describe("a success on one side and nothing on the other", () => {
  const succeeded = {
    _id: intentId,
    amount: 12000,
    invoiceId: new Types.ObjectId(),
    provider: "ESEWA",
    reference: "EDU-0001-F-1",
    settledEventId: eventId,
    status: "SUCCEEDED",
  };

  it("is an ERROR when a settled attempt points at no ledger entry", async () => {
    // The resident has paid and the invoice does not know.
    queue({ succeeded: [{ ...succeeded, settledEventId: null }] });

    await runSettlementReconForHostel(hostelId, { now: NOW });

    expect(await findings()).toContainEqual(
      expect.objectContaining({
        code: "SETTLED_INTENT_WITHOUT_EVENT",
        severity: "ERROR",
      }),
    );
  });

  it("is an ERROR when the ledger entry it points at is gone", async () => {
    queue({ succeeded: [succeeded] });
    mocks.eventFindOne.mockReturnValue(chain(null));

    await runSettlementReconForHostel(hostelId, { now: NOW });

    expect(await findings()).toContainEqual(
      expect.objectContaining({ code: "SETTLED_INTENT_EVENT_MISSING" }),
    );
  });

  it("is an ERROR when the amounts disagree", async () => {
    queue({ succeeded: [succeeded] });
    mocks.eventFindOne.mockReturnValue(chain({ amount: 1200, status: "SETTLED" }));

    await runSettlementReconForHostel(hostelId, { now: NOW });

    expect(await findings()).toContainEqual(
      expect.objectContaining({ code: "SETTLED_AMOUNT_DISAGREES" }),
    );
  });

  it("says nothing when the two agree", async () => {
    queue({ succeeded: [succeeded] });
    mocks.eventFindOne.mockReturnValue(chain({ amount: 12000, status: "SETTLED" }));

    await runSettlementReconForHostel(hostelId, { now: NOW });

    expect(await findings()).toEqual([]);
  });

  /** A reversal leaves the original settled with a pointer; that is legitimate. */
  it("does not flag a reversed payment whose amounts still agree", async () => {
    queue({ succeeded: [succeeded] });
    mocks.eventFindOne.mockReturnValue(chain({ amount: 12000, status: "SETTLED" }));

    await runSettlementReconForHostel(hostelId, { now: NOW });

    expect(await findings()).toEqual([]);
  });
});

describe("a gateway credit nobody initiated", () => {
  const orphan = {
    _id: eventId,
    amount: 12000,
    provider: "ESEWA",
    referenceCode: "EDU-9999-Z-1",
  };

  /**
   * There is no ordinary way to reach this: every gateway event is written by
   * the intent service, from an intent. It is what a forged or replayed callback
   * would leave behind if one ever got past verification.
   */
  it("is an ERROR when a settled gateway credit has no attempt behind it", async () => {
    queue({ events: [orphan] });
    mocks.intentFindOne.mockReturnValue(chain(null));

    await runSettlementReconForHostel(hostelId, { now: NOW });

    expect(await findings()).toContainEqual(
      expect.objectContaining({
        code: "GATEWAY_EVENT_WITHOUT_INTENT",
        severity: "ERROR",
      }),
    );
  });

  it("says nothing when the attempt is there", async () => {
    queue({ events: [orphan] });
    mocks.intentFindOne.mockReturnValue(chain({ _id: intentId }));

    await runSettlementReconForHostel(hostelId, { now: NOW });

    expect(await findings()).toEqual([]);
  });

  it("only looks at settled gateway credits", async () => {
    await runSettlementReconForHostel(hostelId, { now: NOW });

    expect(mocks.eventFind.mock.calls[0]![0]).toMatchObject({
      source: { $in: ["GATEWAY_POLL", "GATEWAY_WEBHOOK"] },
      status: "SETTLED",
    });
  });
});

describe("hostels with nothing to reconcile", () => {
  it("does no work for a hostel that never configured a gateway", async () => {
    mocks.profileFindOne.mockReturnValue(chain({ gateways: [] }));

    const summary = await runSettlementReconForHostel(hostelId, { now: NOW });

    expect(summary.rechecked).toBe(0);
    expect(mocks.intentFind).not.toHaveBeenCalled();
  });

  /** A disabled gateway's old attempts are still real money. */
  it("still reconciles a hostel that turned its gateway off", async () => {
    mocks.profileFindOne.mockReturnValue(
      chain({ gateways: [{ enabledAt: null, provider: "ESEWA" }] }),
    );
    queue({ closed: [closedIntent] });

    expect((await runSettlementReconForHostel(hostelId, { now: NOW })).rechecked).toBe(1);
  });
});
