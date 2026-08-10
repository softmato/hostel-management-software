/**
 * Tier C scoring — Block 4 item 4.2 of docs/FINANCE_IMPLEMENTATION_PLAN.md
 * (target §7).
 *
 * A pure module, so per plan §8.4 it has no excuse for representative tests.
 * The two failure modes worth writing against pull in opposite directions:
 * a floor set too low buries the owner in implausible suggestions until they
 * approve without reading, and one set too high makes the reconcile screen no
 * faster than the review queue it replaces. Both are asserted below.
 */
import { describe, expect, it } from "vitest";

import {
  type MatchCandidate,
  SUGGESTION_FLOOR,
  explain,
  nameSimilarity,
  rankCandidates,
  scoreCandidate,
} from "@/modules/finance/matching/scoring";

const AUGUST = new Date(2026, 7, 12, 20, 31);

function candidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    dueDate: new Date(2026, 7, 5),
    invoiceId: "inv-1",
    outstanding: 8000,
    period: "2026-08",
    referenceCode: "RUP-4821-P",
    residentId: "res-1",
    residentName: "Suman Tamang",
    ...overrides,
  };
}

function input(overrides: Partial<Parameters<typeof scoreCandidate>[0]> = {}) {
  return {
    amount: 8000,
    counterpartyName: "S. TAMANG",
    occurredAt: AUGUST,
    ...overrides,
  };
}

describe("name similarity", () => {
  it("treats a name as identical to itself", () => {
    expect(nameSimilarity("Suman Tamang", "suman tamang")).toBe(1);
  });

  it("ignores token order — providers reorder given and family names", () => {
    expect(nameSimilarity("Tamang Suman", "Suman Tamang")).toBe(1);
  });

  it("scores an initial against its word, but well below a full match", () => {
    const initialled = nameSimilarity("S. TAMANG", "Suman Tamang");

    expect(initialled).toBeGreaterThan(0.6);
    expect(initialled).toBeLessThan(0.9);
  });

  it("tolerates a transliteration difference", () => {
    expect(nameSimilarity("Anita Shresth", "Anita Shrestha")).toBeGreaterThan(0.9);
  });

  it("does not connect two different people who share a surname only", () => {
    expect(nameSimilarity("Bishal Rai", "Anita Rai")).toBeLessThan(0.6);
  });

  it("returns zero when either side is missing", () => {
    expect(nameSimilarity(null, "Suman Tamang")).toBe(0);
    expect(nameSimilarity("Suman Tamang", "")).toBe(0);
  });

  it("does not match unrelated names that share letters", () => {
    expect(nameSimilarity("Ram Bahadur", "Mira Thapa")).toBeLessThan(0.6);
  });
});

describe("scoring a candidate", () => {
  it("suggests the obvious case — right name, exact amount", () => {
    const scored = scoreCandidate(input(), candidate());

    expect(scored).not.toBeNull();
    expect(scored?.confidence).toBe("HIGH");
    expect(scored?.signals).toContain("AMOUNT_EXACT");
    expect(scored?.signals).toContain("NAME_SIMILAR");
  });

  it("produces the sentence from target §7, in words", () => {
    const scored = scoreCandidate(input(), candidate());

    expect(scored?.why).toBe(
      "matches Suman Tamang — name similar, owes exactly this amount, paid around the due date",
    );
  });

  it("refuses to suggest on the amount alone", () => {
    const scored = scoreCandidate(
      input({ counterpartyName: "Ram Bahadur" }),
      candidate({ dueDate: null }),
    );

    expect(scored).toBeNull();
  });

  it("refuses to suggest on a shared surname alone", () => {
    const scored = scoreCandidate(
      input({ amount: 3175, counterpartyName: "Bishal Rai" }),
      candidate({ dueDate: null, outstanding: 12000, residentName: "Anita Rai" }),
    );

    expect(scored).toBeNull();
  });

  it("ranks a code naming this very invoice above everything else", () => {
    const scored = scoreCandidate(
      input({
        amount: 20000,
        counterpartyName: null,
        referencedInvoice: { invoiceId: "inv-1", residentId: "res-1" },
      }),
      candidate({ dueDate: null }),
    );

    expect(scored?.signals).toContain("REFERENCE_SAME_INVOICE");
    expect(scored?.confidence).toBe("HIGH");
    expect(scored?.why).toContain("carries this invoice's reference code");
  });

  it("credits the resident's other invoice, but less strongly", () => {
    const scored = scoreCandidate(
      input({
        amount: 20000,
        counterpartyName: null,
        referencedInvoice: { invoiceId: "inv-other", residentId: "res-1" },
      }),
      candidate({ dueDate: null }),
    );

    expect(scored?.signals).toContain("REFERENCE_SAME_RESIDENT");
  });

  it("does not let one resident's code vouch for an unrelated candidate", () => {
    const scored = scoreCandidate(
      input({
        amount: 20000,
        counterpartyName: null,
        referencedInvoice: { invoiceId: "inv-other", residentId: "res-someone-else" },
      }),
      candidate({ dueDate: null }),
    );

    expect(scored).toBeNull();
  });

  it("never awards a score below the floor", () => {
    const scored = scoreCandidate(input(), candidate());

    expect(scored!.score).toBeGreaterThanOrEqual(SUGGESTION_FLOOR);
  });
});

describe("ranking", () => {
  const residents = [
    candidate({ invoiceId: "inv-1", residentId: "res-1", residentName: "Suman Tamang" }),
    candidate({
      invoiceId: "inv-2",
      outstanding: 8000,
      residentId: "res-2",
      residentName: "Sunita Tamang",
    }),
    candidate({
      invoiceId: "inv-3",
      outstanding: 12000,
      residentId: "res-3",
      residentName: "Bishal Rai",
    }),
  ];

  it("puts the best explanation first and drops the implausible", () => {
    const ranked = rankCandidates(input(), residents);

    expect(ranked[0]?.candidate.residentName).toBe("Suman Tamang");
    expect(ranked.map((one) => one.candidate.residentId)).not.toContain("res-3");
  });

  it("caps the list, so the screen asks for a decision rather than a survey", () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      candidate({ invoiceId: `inv-${index}`, residentId: `res-${index}` }),
    );

    expect(rankCandidates(input(), many)).toHaveLength(3);
  });

  it("is deterministic when two candidates score identically", () => {
    const tied = [
      candidate({ invoiceId: "inv-b", residentId: "res-b", residentName: "Suman Tamang" }),
      candidate({ invoiceId: "inv-a", residentId: "res-a", residentName: "Suman Tamang" }),
    ];

    expect(rankCandidates(input(), tied).map((one) => one.candidate.invoiceId)).toEqual(
      rankCandidates(input(), [...tied].reverse()).map((one) => one.candidate.invoiceId),
    );
  });
});

describe("explanations", () => {
  it("says 'name similar' rather than 'name matches' when it is only similar", () => {
    expect(explain(candidate(), ["NAME_SIMILAR"])).toBe(
      "matches Suman Tamang — name similar",
    );
    expect(explain(candidate(), ["NAME_EXACT"])).toBe(
      "matches Suman Tamang — name matches",
    );
  });

  it("names the amount owed when it is only close", () => {
    expect(explain(candidate(), ["AMOUNT_CLOSE"])).toContain("owes 8,000");
  });
});
