/**
 * The matching ladder — Block 4 item 4.2 of docs/FINANCE_IMPLEMENTATION_PLAN.md
 * (target §7).
 *
 * `classifyCredit` is pure, so these tests run against constructed context
 * rather than mocked models. What they defend is the line between B and C:
 * everything at B settles with no human in the loop, so a case that reaches B
 * without a valid reference code naming an invoice of this hostel is money moved
 * onto the wrong person's account by software nobody asked.
 */
import { describe, expect, it } from "vitest";

import {
  type LadderClaim,
  type LadderInvoice,
  type MatchContext,
  classifyCredit,
  findOrphanClaims,
  normalizeTxnId,
} from "@/modules/finance/matching/ladder.service";
import { generateReferenceCode } from "@/modules/finance/reference-code";
import type { StatementRow } from "@/modules/finance/statements/parsers/types";

const SUMAN_CODE = generateReferenceCode("RUP", 4821);
const ANITA_CODE = generateReferenceCode("RUP", 5000);

function invoice(overrides: Partial<LadderInvoice> = {}): LadderInvoice {
  return {
    bedLabel: "Dormitory",
    dueDate: new Date(2026, 7, 5),
    invoiceId: "inv-suman",
    outstanding: 8000,
    period: "2026-08",
    referenceCode: SUMAN_CODE,
    residentId: "res-suman",
    residentName: "Suman Tamang",
    totalAmount: 8000,
    ...overrides,
  };
}

function claim(overrides: Partial<LadderClaim> = {}): LadderClaim {
  return {
    amount: 12000,
    eventId: "evt-claim",
    invoiceId: "inv-bishal",
    occurredAt: new Date(2026, 7, 6),
    period: "2026-08",
    residentId: "res-bishal",
    residentName: "Bishal Rai",
    transactionCode: "9910233",
    ...overrides,
  };
}

function context(overrides: Partial<MatchContext> = {}): MatchContext {
  const invoices = overrides.openInvoices ?? [invoice()];
  const claims = overrides.claims ?? [];

  return {
    claims,
    claimsByTxnId: new Map(
      claims
        .filter((one) => normalizeTxnId(one.transactionCode) !== "")
        .map((one) => [normalizeTxnId(one.transactionCode), one]),
    ),
    invoicesByCode: new Map(
      invoices
        .filter((one) => one.referenceCode)
        .map((one) => [one.referenceCode!, one]),
    ),
    openInvoices: invoices,
    ...overrides,
  };
}

function row(overrides: Partial<StatementRow> = {}): StatementRow {
  return {
    amount: 8000,
    counterpartyName: "S. TAMANG",
    direction: "CREDIT",
    occurredAt: new Date(2026, 7, 4),
    providerTxnId: "ESW4471192",
    raw: {},
    remarks: null,
    rowNumber: 1,
    ...overrides,
  };
}

describe("Tier B — auto-settles", () => {
  it("matches a reference code in the remark", () => {
    const result = classifyCredit(row({ remarks: `${SUMAN_CODE} august rent` }), context());

    expect(result.tier).toBe("B");
    expect(result.tier === "B" && result.invoice.residentId).toBe("res-suman");
  });

  it("matches the spaced, lower-case form a resident actually types", () => {
    const spaced = SUMAN_CODE.replace(/-/g, " ").toLowerCase();
    const result = classifyCredit(row({ remarks: `rent ${spaced}` }), context());

    expect(result.tier).toBe("B");
  });

  it("also reads the code from the counterparty field", () => {
    const result = classifyCredit(
      row({ counterpartyName: SUMAN_CODE, remarks: null }),
      context(),
    );

    expect(result.tier).toBe("B");
  });

  it("settles a part payment — 'exact, or ≤ outstanding'", () => {
    const result = classifyCredit(
      row({ amount: 5000, remarks: SUMAN_CODE }),
      context(),
    );

    expect(result.tier).toBe("B");
  });

  it("does NOT settle more than the invoice owes", () => {
    // Overpayment needs a credit balance (target §9.4, item 5.3). Until that
    // exists, the excess must reach a human rather than be clamped away.
    const result = classifyCredit(
      row({ amount: 20000, remarks: SUMAN_CODE }),
      context(),
    );

    expect(result.tier).toBe("C");
  });

  it("does NOT settle a mistyped code — the check character is the whole point", () => {
    const mistyped = SUMAN_CODE.slice(0, -1) + (SUMAN_CODE.endsWith("A") ? "B" : "A");
    const result = classifyCredit(row({ remarks: mistyped }), context());

    expect(result.tier).not.toBe("B");
  });

  it("does NOT settle a valid code belonging to another hostel", () => {
    const otherHostel = generateReferenceCode("XYZ", 12);
    const result = classifyCredit(row({ remarks: otherHostel }), context());

    expect(result.tier).not.toBe("B");
  });

  it("does NOT settle when the remark carries two valid codes", () => {
    // Two months paid at once (target §16.2) needs a split this block does not
    // implement. Guessing which invoice gets the money is worse than asking.
    const result = classifyCredit(
      row({ amount: 16000, remarks: `${SUMAN_CODE} and ${ANITA_CODE}` }),
      context({
        openInvoices: [
          invoice(),
          invoice({
            invoiceId: "inv-anita",
            referenceCode: ANITA_CODE,
            residentId: "res-anita",
            residentName: "Anita Shrestha",
          }),
        ],
      }),
    );

    expect(result.tier).not.toBe("B");
  });

  it("does NOT settle prose that happens to contain a valid-looking run", () => {
    const result = classifyCredit(
      row({ counterpartyName: null, remarks: "AUGUST RENT PAYMENT THANK YOU" }),
      context(),
    );

    expect(result.tier).not.toBe("B");
  });
});

describe("Tier C — suggests, never settles", () => {
  it("pairs a statement row with the claim that named its transaction id", () => {
    const result = classifyCredit(
      row({ amount: 12000, counterpartyName: "B. RAI", providerTxnId: "9910233" }),
      context({ claims: [claim()] }),
    );

    expect(result.tier).toBe("C");
    expect(result.tier === "C" && result.claim?.eventId).toBe("evt-claim");
  });

  it("matches a transaction id typed with spaces or dashes", () => {
    const result = classifyCredit(
      row({ amount: 12000, providerTxnId: "9910233" }),
      context({ claims: [claim({ transactionCode: "991-0233 " })] }),
    );

    expect(result.tier === "C" && result.claim?.eventId).toBe("evt-claim");
  });

  it("says so when the claim's amount disagrees with the real credit", () => {
    const result = classifyCredit(
      row({ amount: 800, providerTxnId: "9910233" }),
      context({ claims: [claim({ amount: 8000 })] }),
    );

    expect(result.why).toContain("8,000");
  });

  it("does not collapse every code-less claim onto one key", () => {
    const claims = [
      claim({ eventId: "evt-a", transactionCode: null }),
      claim({ eventId: "evt-b", transactionCode: null }),
    ];
    const result = classifyCredit(row({ providerTxnId: "" }), context({ claims }));

    expect(result.tier === "C" && result.claim).toBeUndefined();
  });

  it("suggests on name and amount when there is no code at all", () => {
    const result = classifyCredit(row(), context());

    expect(result.tier).toBe("C");
    expect(result.why).toContain("Suman Tamang");
  });
});

describe("Tier D — orphan money", () => {
  it("returns unmatched when nothing plausibly fits", () => {
    const result = classifyCredit(
      row({ amount: 3175, counterpartyName: "PRAKASH ADHIKARI", providerTxnId: "x" }),
      context(),
    );

    expect(result.tier).toBe("D");
  });

  it("names the payer in the reason, since that is all the owner has", () => {
    const result = classifyCredit(
      row({ amount: 3175, counterpartyName: "PRAKASH ADHIKARI" }),
      context(),
    );

    expect(result.why).toContain("PRAKASH ADHIKARI");
  });
});

describe("Tier E — claims with no money behind them", () => {
  const rows = [row({ providerTxnId: "ESW1" }), row({ amount: 800, providerTxnId: "ESW2" })];

  it("flags a claim whose transaction id appears nowhere in the statement", () => {
    const orphans = findOrphanClaims(
      context({ claims: [claim({ occurredAt: new Date(2026, 7, 2) })] }),
      rows,
      new Date(2026, 7, 14),
    );

    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.why).toContain("closest real credit");
  });

  it("does not flag a claim the statement was cut before", () => {
    const orphans = findOrphanClaims(
      context({ claims: [claim({ occurredAt: new Date(2026, 7, 20) })] }),
      rows,
      new Date(2026, 7, 14),
    );

    expect(orphans).toHaveLength(0);
  });

  it("does not flag a claim whose transaction is in the statement", () => {
    const orphans = findOrphanClaims(
      context({ claims: [claim({ transactionCode: "ESW1" })] }),
      rows,
      new Date(2026, 7, 14),
    );

    expect(orphans).toHaveLength(0);
  });
});
