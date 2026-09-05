import { describe, expect, it } from "vitest";

import {
  CLAIM_BODY_LIMIT,
  claimBody,
  claimNotice,
} from "@/lib/claim-notification";

describe("claimBody", () => {
  it("leaves a short line exactly as written", () => {
    expect(claimBody("Your hostel will confirm it shortly.")).toBe(
      "Your hostel will confirm it shortly.",
    );
  });

  it("collapses the whitespace a multi-line notice carries", () => {
    expect(claimBody("  That file\n  cannot   be used.  ")).toBe(
      "That file cannot be used.",
    );
  });

  it("cuts a long refusal at its first sentence rather than mid-word", () => {
    // The real wording of the wrong-direction refusal: the first sentence names
    // the problem, the second is the remedy — which is on the screen the tap
    // leads to anyway.
    const refusal =
      "That receipt shows money coming into your account, not a payment you made. Please upload the receipt for the payment you sent to the hostel — the one showing the money leaving your account.";

    expect(claimBody(refusal)).toBe(
      "That receipt shows money coming into your account, not a payment you made.",
    );
  });

  it("never returns more than the limit", () => {
    const long = `${"word ".repeat(80)}end.`;

    expect(claimBody(long).length).toBeLessThanOrEqual(CLAIM_BODY_LIMIT);
  });

  it("marks a cut it had to make on a word boundary", () => {
    const noSentenceEnd = "alpha ".repeat(60).trim();
    const body = claimBody(noSentenceEnd);

    expect(body.endsWith("…")).toBe(true);
    // Cut between words, not through one: the last word is a whole "alpha",
    // never a fragment of it.
    expect(body.slice(0, -1).trimEnd().split(" ").at(-1)).toBe("alpha");
  });

  it("does not treat a decimal point as the end of a sentence", () => {
    const text = `Rs 12.50 was read from a receipt ${"and more text ".repeat(12)}here.`;
    const body = claimBody(text);

    expect(body).not.toBe("Rs 12.");
    expect(body.length).toBeLessThanOrEqual(CLAIM_BODY_LIMIT);
  });
});

describe("claimNotice", () => {
  const outcome = {
    body: "Please upload the receipt from the app you paid with.",
    title: "That file cannot be used as proof",
    tone: "failure" as const,
  };

  it("routes the tap at the invoice the claim was about", () => {
    // `/invoice/{id}` is a shape `resolvePushPath` already understands, so this
    // needs no new routing rule to be tappable.
    expect(claimNotice(outcome, "6a97efc759c934c13af28bdc")?.path).toBe(
      "/invoice/6a97efc759c934c13af28bdc",
    );
  });

  it("carries the tone through", () => {
    expect(claimNotice(outcome, "inv-1")?.tone).toBe("failure");
    expect(
      claimNotice({ body: "Done.", title: "Submitted", tone: "success" }, "inv-1")?.tone,
    ).toBe("success");
  });

  it("posts nothing when there is no invoice to return to", () => {
    // A notification that does nothing when tapped teaches the resident that
    // ours are not worth tapping.
    expect(claimNotice(outcome, null)).toBeNull();
    expect(claimNotice(outcome, undefined)).toBeNull();
    expect(claimNotice(outcome, "   ")).toBeNull();
  });

  it("shortens the body it was handed", () => {
    const long = {
      ...outcome,
      body: `${"a very long explanation ".repeat(10)}end.`,
    };

    expect(claimNotice(long, "inv-1")!.body.length).toBeLessThanOrEqual(
      CLAIM_BODY_LIMIT,
    );
  });
});
