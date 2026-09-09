import { describe, expect, it } from "vitest";

import { classify } from "@/modules/billing/softmato/transaction";

/**
 * Which payment statuses turn a service on.
 *
 * Exactly one does. What this file guards is the default: an unrecognised
 * status must not fall through to "settled", because the cost of the two
 * mistakes is not symmetric. Reading a real payment as unfinished shows an
 * owner a wrong screen for a few seconds; reading an unfinished one as settled
 * publishes a hostel for free.
 */

describe("provisioning", () => {
  it("settles only on SUCCEEDED", () => {
    expect(classify("SUCCEEDED")).toBe("settled");
  });

  it("treats a status added to the API later as not settled", () => {
    expect(classify("SOME_FUTURE_STATUS")).toBe("not_completed");
  });
});

describe("the states that are not failures", () => {
  it("holds a reconciliation as under review, never as failed", () => {
    /*
     * Softmato and the provider disagree and a human is looking. Telling the
     * owner their payment failed and inviting them to try again is how one
     * person pays twice.
     */
    expect(classify("RECONCILIATION_REQUIRED")).toBe("under_review");
  });

  it("reads CREATED and PENDING as still in flight", () => {
    expect(classify("CREATED")).toBe("pending");
    expect(classify("PENDING")).toBe("pending");
  });
});

describe("the endings", () => {
  it.each(["FAILED", "CANCELLED", "EXPIRED", "REFUNDED", "REVERSED"])(
    "reads %s as not completed",
    (status) => {
      expect(classify(status)).toBe("not_completed");
    },
  );
});

describe("the webhook and the read agree", () => {
  it("accepts the lowercase form a payload may carry", () => {
    /*
     * `TransactionView.status` is uppercase and `WebhookPayload.status` is a
     * loose string. One classifier serves both paths precisely so neither can
     * drift into treating a status differently from the other.
     */
    expect(classify("succeeded")).toBe("settled");
  });
});
