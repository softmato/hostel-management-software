/**
 * Gateway health — Block 6 item 6.7 of docs/FINANCE_IMPLEMENTATION_PLAN.md.
 *
 * One distinction carries this whole module, and most of these tests are about
 * it: **residents trying to pay and failing is not the same as nobody trying.**
 * Every other screen shows those two identically — no settlements, invoices
 * staying open, nobody complaining yet — and an owner who cannot tell them apart
 * loses a month of rent to a broken merchant credential.
 *
 * The rest is about not becoming noise: a brand-new gateway is not "quiet", and
 * a daily job must not mail daily.
 */
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");

const mocks = vi.hoisted(() => ({
  hostelFind: vi.fn(),
  intentFind: vi.fn(),
  invoiceCount: vi.fn(),
  notify: vi.fn(),
  profileFindOne: vi.fn(),
  profileUpdateOne: vi.fn(),
  withRun: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/modules/finance/finance-notify", () => ({
  notifyGatewayUnhealthy: mocks.notify,
}));
vi.mock("@/modules/finance/gateway/intent.service", () => ({
  UNCONFIRMED_REASON: "never-confirmed-marker",
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
vi.mock("@hostel/db/models/Invoice", () => ({
  InvoiceModel: { countDocuments: mocks.invoiceCount },
}));
vi.mock("@hostel/db/models/PaymentIntent", () => ({
  PaymentIntentModel: { find: mocks.intentFind },
}));
vi.mock("@hostel/db/models/HostelPaymentProfile", async () => {
  const actual = await vi.importActual<
    typeof import("@hostel/db/models/HostelPaymentProfile")
  >("@hostel/db/models/HostelPaymentProfile");

  return {
    ...actual,
    HostelPaymentProfileModel: {
      findOne: mocks.profileFindOne,
      updateOne: mocks.profileUpdateOne,
    },
  };
});

const { getGatewayHealth, runGatewayHealthForHostel } = await import(
  "./gateway-health.service"
);

const NOW = new Date("2026-08-10T12:00:00.000Z");
/** Long enough ago that silence is meaningful rather than new. */
const LONG_ENABLED = new Date("2026-06-01T00:00:00.000Z");

function chain<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value), select: vi.fn().mockReturnThis() };
}

function withGateways(entries: Record<string, unknown>[]) {
  mocks.profileFindOne.mockReturnValue(chain({ gateways: entries }));
}

const esewa = {
  accountKind: "MERCHANT",
  enabledAt: LONG_ENABLED,
  merchantCode: "EPAYTEST",
  mode: "LIVE",
  provider: "ESEWA",
};

/** Intent rows as the counter reads them. */
function intents(rows: { failureReason?: string; status: string }[]) {
  mocks.intentFind.mockReturnValue(chain(rows));
}

beforeEach(() => {
  vi.clearAllMocks();
  withGateways([esewa]);
  intents([]);
  mocks.invoiceCount.mockResolvedValue(0);
  mocks.profileUpdateOne.mockResolvedValue({});
  mocks.notify.mockResolvedValue(undefined);
  // Runs the work and reports what it found, like the real recorder.
  mocks.withRun.mockImplementation(async (_options: unknown, work: (r: unknown) => unknown) => {
    const findings: unknown[] = [];
    const recorder = {
      count: vi.fn(),
      finding: (finding: unknown) => findings.push(finding),
      findings,
    };
    const result = await work(recorder);

    return { findings, result, runId: "run-1", status: findings.length ? "WARN" : "OK" };
  });
});

describe("telling broken apart from quiet", () => {
  /**
   * The case the module exists for. Six residents opened a checkout and none
   * completed — that is a merchant credential problem, not a slow month, and it
   * is invisible on every other screen.
   */
  it("calls it FAILING when residents tried and nothing settled", async () => {
    intents([
      { status: "EXPIRED" },
      { status: "EXPIRED" },
      { status: "FAILED" },
      { status: "EXPIRED" },
    ]);

    const [health] = await getGatewayHealth(hostelId, { now: NOW });

    expect(health!.status).toBe("FAILING");
    expect(health!.detail).toContain("4");
    expect(health!.detail).toContain("none completed");
  });

  /**
   * The same dashboard, the opposite cause. Nobody opened a checkout, so there
   * is nothing to conclude about whether it works.
   */
  it("calls it QUIET when nobody tried at all", async () => {
    mocks.invoiceCount.mockResolvedValue(12);

    const [health] = await getGatewayHealth(hostelId, { now: NOW });

    expect(health!.status).toBe("QUIET");
    expect(health!.detail).toContain("may be normal");
  });

  it("does not call a brand-new gateway quiet", async () => {
    // Enabled yesterday with no attempts is not quiet, it is new.
    withGateways([{ ...esewa, enabledAt: new Date("2026-08-09T00:00:00.000Z") }]);
    mocks.invoiceCount.mockResolvedValue(12);

    expect((await getGatewayHealth(hostelId, { now: NOW }))[0]!.status).toBe("HEALTHY");
  });

  it("does not call it quiet when there is nothing to pay", async () => {
    mocks.invoiceCount.mockResolvedValue(0);

    expect((await getGatewayHealth(hostelId, { now: NOW }))[0]!.status).toBe("HEALTHY");
  });

  it("is HEALTHY when payments are settling", async () => {
    intents([{ status: "SUCCEEDED" }, { status: "SUCCEEDED" }, { status: "EXPIRED" }]);

    const [health] = await getGatewayHealth(hostelId, { now: NOW });

    expect(health!.status).toBe("HEALTHY");
    expect(health!.succeeded).toBe(2);
  });

  it("is DEGRADED when most attempts fail but some get through", async () => {
    intents([
      { status: "SUCCEEDED" },
      { status: "EXPIRED" },
      { status: "FAILED" },
      { status: "EXPIRED" },
    ]);

    const [health] = await getGatewayHealth(hostelId, { now: NOW });

    expect(health!.status).toBe("DEGRADED");
    expect(health!.detail).toContain("1 of 4");
  });

  /**
   * An attempt nobody could confirm is the worst state to leave silent: money
   * may have left a resident's account and no record says so either way.
   */
  it("is FAILING when attempts could not be confirmed at all", async () => {
    intents([
      { failureReason: "never-confirmed-marker", status: "EXPIRED" },
      { failureReason: "never-confirmed-marker", status: "EXPIRED" },
    ]);

    const [health] = await getGatewayHealth(hostelId, { now: NOW });

    expect(health!.status).toBe("FAILING");
    expect(health!.unconfirmed).toBe(2);
    expect(health!.detail).toContain("could not be confirmed");
  });

  it("still flags unconfirmed attempts when payments are otherwise fine", async () => {
    intents([
      { status: "SUCCEEDED" },
      { status: "SUCCEEDED" },
      { status: "SUCCEEDED" },
      { failureReason: "never-confirmed-marker", status: "EXPIRED" },
    ]);

    expect((await getGatewayHealth(hostelId, { now: NOW }))[0]!.status).toBe("DEGRADED");
  });

  it("counts an attempt still in progress without calling it either outcome", async () => {
    intents([{ status: "CREATED" }, { status: "SUCCEEDED" }]);

    const [health] = await getGatewayHealth(hostelId, { now: NOW });

    expect(health!.attempts).toBe(2);
    expect(health!.succeeded).toBe(1);
    expect(health!.failed).toBe(0);
  });
});

describe("what gets checked at all", () => {
  it("ignores gateways that are not enabled", async () => {
    withGateways([{ ...esewa, enabledAt: null }]);

    expect(await getGatewayHealth(hostelId, { now: NOW })).toEqual([]);
  });

  it("ignores a provider whose adapter has not shipped", async () => {
    // Nothing can be failing about a checkout residents were never offered.
    withGateways([{ ...esewa, provider: "FONEPAY" }]);

    expect(await getGatewayHealth(hostelId, { now: NOW })).toEqual([]);
  });

  it("reports each live provider separately", async () => {
    withGateways([esewa, { ...esewa, merchantCode: null, provider: "KHALTI" }]);
    intents([{ status: "SUCCEEDED" }]);

    expect(
      (await getGatewayHealth(hostelId, { now: NOW })).map((row) => row.provider),
    ).toEqual(["ESEWA", "KHALTI"]);
  });

  it("counts open invoices once for the hostel, not once per provider", async () => {
    withGateways([esewa, { ...esewa, merchantCode: null, provider: "KHALTI" }]);

    await getGatewayHealth(hostelId, { now: NOW });

    expect(mocks.invoiceCount).toHaveBeenCalledTimes(1);
  });
});

describe("the daily run", () => {
  it("records a finding for anything that is not healthy", async () => {
    intents([{ status: "EXPIRED" }, { status: "EXPIRED" }]);

    const summary = await runGatewayHealthForHostel(hostelId, { now: NOW });

    expect(summary.findings).toBe(1);
    expect(summary.status).toBe("WARN");
  });

  /** QUIET may genuinely be nobody paying, so it must not cry wolf. */
  it("files a quiet gateway as INFO", async () => {
    mocks.invoiceCount.mockResolvedValue(5);

    await runGatewayHealthForHostel(hostelId, { now: NOW });

    expect(await findingOf(0)).toMatchObject({
      code: "GATEWAY_QUIET",
      severity: "INFO",
    });
  });

  /** FAILING is somebody's rent, and reads as a warning on the run row. */
  it("files a failing gateway as WARN", async () => {
    intents([{ status: "EXPIRED" }]);

    await runGatewayHealthForHostel(hostelId, { now: NOW });

    expect(await findingOf(0)).toMatchObject({
      code: "GATEWAY_FAILING",
      severity: "WARN",
    });
  });

  it("stores the verdict and the sentence behind it", async () => {
    intents([{ status: "EXPIRED" }]);

    await runGatewayHealthForHostel(hostelId, { now: NOW });

    expect(mocks.profileUpdateOne.mock.calls[0]![1].$set).toMatchObject({
      "gateways.$[slot].healthStatus": "FAILING",
    });
    expect(
      mocks.profileUpdateOne.mock.calls[0]![1].$set["gateways.$[slot].healthDetail"],
    ).toContain("none completed");
  });

  it("tells the owner when a provider starts failing", async () => {
    intents([{ status: "EXPIRED" }]);

    const summary = await runGatewayHealthForHostel(hostelId, { now: NOW });

    expect(summary.notified).toBe(1);
    expect(mocks.notify.mock.calls[0]![0]).toMatchObject({
      provider: "ESEWA",
      status: "FAILING",
    });
  });

  /**
   * A daily job that mails daily stops being read by the second week, and the
   * fortnight it matters is the one nobody opens it.
   */
  it("does not mail again the same day for an unchanged problem", async () => {
    withGateways([
      {
        ...esewa,
        healthNotifiedAt: new Date("2026-08-10T06:00:00.000Z"),
        healthStatus: "FAILING",
      },
    ]);
    intents([{ status: "EXPIRED" }]);

    expect((await runGatewayHealthForHostel(hostelId, { now: NOW })).notified).toBe(0);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("mails again once a day has passed and it is still broken", async () => {
    withGateways([
      {
        ...esewa,
        healthNotifiedAt: new Date("2026-08-08T06:00:00.000Z"),
        healthStatus: "FAILING",
      },
    ]);
    intents([{ status: "EXPIRED" }]);

    expect((await runGatewayHealthForHostel(hostelId, { now: NOW })).notified).toBe(1);
  });

  it("mails immediately when a problem gets worse, throttle or not", async () => {
    withGateways([
      {
        ...esewa,
        healthNotifiedAt: new Date("2026-08-10T11:00:00.000Z"),
        healthStatus: "DEGRADED",
      },
    ]);
    intents([{ status: "EXPIRED" }]);

    expect((await runGatewayHealthForHostel(hostelId, { now: NOW })).notified).toBe(1);
  });

  it("never mails about a recovery", async () => {
    // Nobody needs telling their payments started working, and it would double
    // the volume of a mailbox that has to stay worth opening.
    withGateways([{ ...esewa, healthStatus: "FAILING" }]);
    intents([{ status: "SUCCEEDED" }]);

    const summary = await runGatewayHealthForHostel(hostelId, { now: NOW });

    expect(summary.notified).toBe(0);
    expect(mocks.profileUpdateOne.mock.calls[0]![1].$set).toMatchObject({
      "gateways.$[slot].healthStatus": "HEALTHY",
    });
  });

  it("never mails about a quiet gateway", async () => {
    mocks.invoiceCount.mockResolvedValue(9);

    expect((await runGatewayHealthForHostel(hostelId, { now: NOW })).notified).toBe(0);
  });
});

/** The nth finding the run recorded, reaching through the stubbed `withRun`. */
async function findingOf(index: number) {
  const run = await mocks.withRun.mock.results[0]!.value;

  return run.findings[index];
}
