import { Schema } from "mongoose";

/**
 * Shared schema pieces for the finance collections.
 *
 * These exist so the integrality rule of ADR-1 is written once. A fractional
 * amount reaching storage voids the property the whole ledger design rests on —
 * that summing an append-only log of whole rupees is exact — so it is enforced
 * at the schema layer, where no service can forget it.
 */

/** Whole NPR rupees, zero or more. */
export const wholeRupees = {
  min: 0,
  type: Number,
  validate: {
    message: "{PATH} must be a whole number of rupees.",
    validator: Number.isInteger,
  },
};

/** Whole NPR rupees, strictly positive — an event that moves nothing is a bug. */
export const positiveWholeRupees = {
  min: 1,
  type: Number,
  validate: {
    message: "{PATH} must be a whole number of rupees greater than zero.",
    validator: (value: number) => Number.isInteger(value) && value > 0,
  },
};

/**
 * Whole NPR rupees that may be negative.
 *
 * For invoice **lines** only, and only because target §9.4 applies credit as a
 * line with a negative amount — a discount that is visible on the document
 * rather than an invisible reduction of the header total. `totalAmount` itself
 * stays non-negative: an invoice that owes less than nothing is a refund, and a
 * refund is not an invoice.
 */
export const signedWholeRupees = {
  type: Number,
  validate: {
    message: "{PATH} must be a whole number of rupees.",
    validator: Number.isInteger,
  },
};

export const currencyField = { default: "NPR", type: String };

export const BED_TYPE_VALUES = [
  "SINGLE",
  "DOUBLE_SHARING",
  "TRIPLE_SHARING",
  "FOUR_SHARING",
  "DORMITORY",
] as const;

/**
 * An error the API layer already knows how to render: `handleRouteError`
 * duck-types on `status` + `errorCode`, so a model-layer guard surfaces as a
 * proper response instead of a 500 with no explanation.
 */
export class FinanceModelError extends Error {
  errorCode: string;
  status: number;

  constructor(message: string, errorCode: string, status = 500) {
    super(message);
    this.name = "FinanceModelError";
    this.errorCode = errorCode;
    this.status = status;
  }
}
