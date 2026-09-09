import "server-only";

/**
 * The two references that cross the wire, and why both are derived rather than
 * generated.
 *
 * `external_ref` is unique per application on Softmato's side, and **a repeat
 * returns the invoice that already exists** rather than raising a second one.
 * That is the mechanism that makes double-billing impossible — but only if the
 * reference identifies the *thing being billed for* rather than the moment the
 * code ran.
 *
 *     invoiceExternalRef('SUB-2609-0001-4F2A')   // same answer, always
 *     `renewal-${Date.now()}`                    // a new invoice every retry
 *
 * A retried Pay-now, a crash between our write and theirs, a renewal job that
 * runs twice — all of them land on the same reference and therefore the same
 * invoice. The hostel is billed once.
 *
 * ## Why our own invoice number is the reference
 *
 * `SubscriptionInvoice.invoiceNumber` is allocated once, unique-indexed, and
 * never reissued. It already *is* the durable identity of one obligation, so
 * deriving the reference from it means there is no second identifier to keep
 * in sync — and the answer to "which Softmato invoice is this?" is a string
 * transformation rather than a lookup.
 *
 * The prefix is there so a Softmato admin reading a list of references can see
 * at a glance which product and which kind of billing it came from. HostelHub
 * bills residents too, one level down, and that money never touches this rail —
 * the prefix keeps the distinction visible if it ever does.
 */

const SUBSCRIPTION_PREFIX = "hh-sub";
const CUSTOMER_PREFIX = "hh-hostel";

/** `hh-sub:SUB-2609-0001-4F2A`. Stable for the life of the invoice. */
export function invoiceExternalRef(invoiceNumber: string): string {
  return `${SUBSCRIPTION_PREFIX}:${invoiceNumber}`;
}

/**
 * The customer, as Softmato files them.
 *
 * The **hostel**, not the owner's user account. The hostel is what holds the
 * plan, what the invoice is addressed to, and what survives the owner handing
 * the business to someone else — an owner-keyed reference would file the new
 * owner's payments under a second customer for the same property.
 */
export function customerExternalRef(hostelId: string): string {
  return `${CUSTOMER_PREFIX}:${hostelId}`;
}
