/**
 * Ledger model guarantees — Block 2 item 2.1 of
 * docs/FINANCE_IMPLEMENTATION_PLAN.md (target §4.1, ADR-2).
 *
 * Two things are asserted here, both at the **model** layer rather than the
 * service layer, because both are the last line of defence:
 *
 * 1. **The unique indexes are declared as specified.** They are the fraud
 *    controls — transaction-ID reuse and screenshot reuse are stopped by the
 *    database, not by a check somebody has to remember. What can go wrong in
 *    code is the declaration: a mistyped field, a missing partial filter that
 *    makes the index collide on nulls, a unique flag left off.
 * 2. **The immutability rule holds.** A settled event's financial fields cannot
 *    be rewritten by any path — `save()` or `updateOne`/`findOneAndUpdate`.
 *
 * Enforcement of the indexes themselves is MongoDB's job and was verified
 * against a live server (see the item note); asserting it here would make the
 * suite require a database.
 */
import { describe, expect, it } from "vitest";

import {
  FROZEN_EVENT_FIELDS,
  frozenFieldsTouchedOnSave,
  PaymentEventModel,
  updateViolatesImmutability,
} from "@hostel/db/models/PaymentEvent";
import { INVOICE_STATUSES, InvoiceModel } from "@hostel/db/models/Invoice";
import { InvoiceBalanceModel } from "@hostel/db/models/InvoiceBalance";
import { ReceiptCounterModel } from "@hostel/db/models/ReceiptCounter";

type IndexSpec = [Record<string, number>, Record<string, unknown> | undefined];

function indexesOf(model: { schema: { indexes(): IndexSpec[] } }) {
  return model.schema.indexes();
}

function findIndex(model: { schema: { indexes(): IndexSpec[] } }, keys: string[]) {
  return indexesOf(model).find(
    ([spec]) =>
      Object.keys(spec).length === keys.length && keys.every((key) => key in spec),
  );
}

describe("PaymentEvent indexes — the fraud controls", () => {
  it("makes idempotencyKey unique platform-wide", () => {
    const index = findIndex(PaymentEventModel, ["idempotencyKey"]);

    expect(index?.[1]).toMatchObject({ unique: true });
  });

  // Kills transaction-ID reuse across months (half of current §7.2).
  it("makes {hostelId, provider, providerTxnId} unique where a txn id exists", () => {
    const index = findIndex(PaymentEventModel, ["hostelId", "provider", "providerTxnId"]);

    expect(index?.[1]).toMatchObject({
      partialFilterExpression: { providerTxnId: { $type: "string" } },
      unique: true,
    });
  });

  // Kills screenshot reuse — and is hostel-scoped, because comparing evidence
  // across hostels is a privacy leak (target §8.1).
  it("makes {hostelId, evidenceHash} unique where a hash exists", () => {
    const index = findIndex(PaymentEventModel, ["hostelId", "evidenceHash"]);

    expect(index?.[1]).toMatchObject({
      partialFilterExpression: { evidenceHash: { $type: "string" } },
      unique: true,
    });
  });

  /**
   * Without the partial filters above, every event lacking a txn id or hash
   * would collide with every other one — the index would reject legitimate
   * cash entries and unverified claims. This is the mistake worth a test.
   */
  it.each([
    ["providerTxnId", ["hostelId", "provider", "providerTxnId"]],
    ["evidenceHash", ["hostelId", "evidenceHash"]],
  ] as const)("does not let nulls collide on %s", (_field, keys) => {
    const index = findIndex(PaymentEventModel, [...keys]);

    expect(index?.[1]?.partialFilterExpression).toBeDefined();
  });

  it("indexes the read paths the ledger actually uses", () => {
    expect(findIndex(PaymentEventModel, ["invoiceId", "status"])).toBeDefined();
    expect(
      findIndex(PaymentEventModel, ["hostelId", "status", "occurredAt"]),
    ).toBeDefined();
    expect(findIndex(PaymentEventModel, ["referenceCode"])).toBeDefined();
  });
});

describe("Invoice indexes", () => {
  /**
   * The double-billing control. Partial on `status != VOID` so a voided invoice
   * can be reissued for the same period — the correction path that replaces the
   * unrestricted PATCH (target §9.2).
   */
  it("prevents double-billing while allowing a voided invoice to be reissued", () => {
    const index = findIndex(InvoiceModel, ["hostelId", "residentId", "period", "kind"]);
    const statuses = (
      index?.[1]?.partialFilterExpression as { status: { $in: string[] } }
    ).status.$in;

    expect(index?.[1]).toMatchObject({ unique: true });
    expect(statuses).not.toContain("VOID");
  });

  /**
   * Every non-VOID status must occupy the period. Derived from the enum in the
   * model for exactly this reason: a hand-written list would let a newly added
   * status escape the unique index, and the failure mode of that is billing a
   * resident twice.
   *
   * `$in` rather than the `$ne: "VOID"` of target §4.1 — MongoDB rejects `$ne`
   * in a partial filter expression outright, so that index cannot be built.
   * Caught by building it against a live server, not by reading the schema.
   */
  it("covers every status except VOID, with no hand-maintained list", () => {
    const index = findIndex(InvoiceModel, ["hostelId", "residentId", "period", "kind"]);
    const statuses = (
      index?.[1]?.partialFilterExpression as { status: { $in: string[] } }
    ).status.$in;

    expect([...statuses].sort()).toEqual(
      INVOICE_STATUSES.filter((status) => status !== "VOID")
        .slice()
        .sort(),
    );
  });

  // One-off invoices carry no period, and Mongo treats every null as equal —
  // without this they would all collide with each other.
  it("excludes period-less invoices from the uniqueness rule", () => {
    const index = findIndex(InvoiceModel, ["hostelId", "residentId", "period", "kind"]);

    expect(index?.[1]?.partialFilterExpression).toMatchObject({
      period: { $type: "string" },
    });
  });
});

describe("InvoiceBalance and ReceiptCounter", () => {
  it("holds at most one balance per invoice", () => {
    expect(InvoiceBalanceModel.schema.path("invoiceId").options.unique).toBe(true);
  });

  // Per hostel per kind per period, so concurrent approvals get distinct numbers
  // from one atomic $inc rather than racing a string-sorted findOne (current
  // §5.5). `kind` joined the key in 2.5: reference codes need the same atomic
  // allocation, and a second collection would be a second chance to get the race
  // wrong — but their sequence must not share a row with the receipt sequence.
  it("holds one sequence per hostel, kind and period", () => {
    const index = findIndex(ReceiptCounterModel, ["hostelId", "kind", "period"]);

    expect(index?.[1]).toMatchObject({ unique: true });
  });
});

describe("settled-event immutability — save()", () => {
  it("freezes exactly the financial fields named in target §4.1", () => {
    expect([...FROZEN_EVENT_FIELDS]).toEqual([
      "amount",
      "direction",
      "invoiceId",
      "confirmation",
    ]);
  });

  it.each([...FROZEN_EVENT_FIELDS])(
    "refuses to rewrite %s on an already-settled event",
    (field) => {
      expect(frozenFieldsTouchedOnSave("SETTLED", [field])).toEqual([field]);
    },
  );

  /**
   * The transition that must stay legal: a PENDING event sets `confirmation`
   * and `settledAt` as it settles. Blocking that would make settlement
   * impossible, so the rule keys on the status the document was *loaded* with.
   */
  it("allows a pending event to settle", () => {
    expect(
      frozenFieldsTouchedOnSave("PENDING", ["status", "confirmation", "settledAt"]),
    ).toEqual([]);
  });

  it("allows the one permitted write to a settled event", () => {
    // Pointing at the event that reversed it touches no financial field.
    expect(frozenFieldsTouchedOnSave("SETTLED", ["reversedByEventId"])).toEqual([]);
  });

  it("allows non-financial edits to a settled event", () => {
    expect(
      frozenFieldsTouchedOnSave("SETTLED", ["rawPayload", "reviewedAt", "updatedAt"]),
    ).toEqual([]);
  });

  it("ignores a brand-new event, which has no history to protect", () => {
    expect(frozenFieldsTouchedOnSave(undefined, ["amount"])).toEqual([]);
  });
});

describe("settled-event immutability — update queries", () => {
  it.each([...FROZEN_EVENT_FIELDS])("refuses an unfiltered $set of %s", (field) => {
    expect(updateViolatesImmutability({ _id: "x" }, { $set: { [field]: 1 } })).toBe(true);
  });

  // The evasion this guard exists for: an update whose filter never mentions
  // status can still match a settled event.
  it("refuses a $set that omits status from the filter", () => {
    expect(updateViolatesImmutability({ hostelId: "h" }, { $set: { amount: 0 } })).toBe(
      true,
    );
  });

  it("refuses a top-level assignment as well as a $set", () => {
    expect(updateViolatesImmutability({ _id: "x" }, { amount: 0 })).toBe(true);
  });

  it("refuses an $inc, which moves money just as surely", () => {
    expect(updateViolatesImmutability({ _id: "x" }, { $inc: { amount: 500 } })).toBe(
      true,
    );
  });

  it("refuses an update explicitly targeting settled events", () => {
    expect(
      updateViolatesImmutability({ status: "SETTLED" }, { $set: { amount: 0 } }),
    ).toBe(true);
  });

  // The claim-then-settle pattern: pinning status to PENDING cannot match a
  // settled event, so it is safe and is how settlement actually happens.
  it("allows an update pinned to a non-settled status", () => {
    expect(
      updateViolatesImmutability(
        { _id: "x", status: "PENDING" },
        { $set: { confirmation: "MANUAL_REVIEW", status: "SETTLED" } },
      ),
    ).toBe(false);
  });

  it("allows updates that touch no financial field", () => {
    expect(
      updateViolatesImmutability(
        { _id: "x" },
        { $set: { reversedByEventId: "y", reviewedAt: new Date() } },
      ),
    ).toBe(false);
  });

  it("allows an empty update", () => {
    expect(updateViolatesImmutability({ _id: "x" }, null)).toBe(false);
  });
});
