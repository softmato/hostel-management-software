/** A rejected form must say what is wrong with it, not that it is wrong. */
import { describe, expect, it } from "vitest";

import { readApiError, readValidationIssues } from "@/lib/api-contract";

function rejection(issues: unknown, errorCode = "VALIDATION_ERROR") {
  return {
    response: {
      data: { details: { issues }, errorCode, message: "Validation failed", success: false },
    },
  };
}

describe("readValidationIssues", () => {
  it("reads the schema's own sentence, untouched", () => {
    const error = rejection([
      { message: "Enter the 10-digit mobile number your eSewa account uses.", path: "refundAccount.number" },
    ]);

    expect(readValidationIssues(error)).toEqual([
      "Enter the 10-digit mobile number your eSewa account uses.",
    ]);
  });

  it("names the field when Zod's own wording does not", () => {
    const error = rejection([
      { message: "Invalid input", path: "refundAccount.holderName" },
      { message: "Too small: expected string to have >=1 characters", path: "roomType" },
    ]);

    expect(readValidationIssues(error)).toEqual([
      "Holder Name: Invalid input",
      "Room Type: Too small: expected string to have >=1 characters",
    ]);
  });

  it("drops empty messages, repeats and non-validation failures", () => {
    expect(readValidationIssues(rejection([{ message: "  ", path: "a" }, null]))).toEqual([]);
    expect(
      readValidationIssues(rejection([{ message: "Say why.", path: "a" }, { message: "Say why.", path: "b" }])),
    ).toEqual(["Say why."]);
    expect(readValidationIssues(rejection([{ message: "Say why." }], "BOOKING_CLOSED"))).toEqual([]);
    expect(readValidationIssues(rejection("not a list"))).toEqual([]);
    expect(readValidationIssues(new Error("offline"))).toEqual([]);
  });
});

describe("readApiError", () => {
  it("shows the issues rather than the envelope's 'Validation failed'", () => {
    const error = rejection([
      { message: "Enter the name on the account.", path: "refundAccount.holderName" },
      { message: "Enter the 10-digit mobile number your Khalti account uses.", path: "refundAccount.number" },
      { message: "Accept the refund policy to book.", path: "acceptPolicy" },
    ]);

    // Two of the three: a toast nobody reads to the end helps nobody.
    expect(readApiError(error)).toBe(
      "Enter the name on the account. Enter the 10-digit mobile number your Khalti account uses.",
    );
  });

  it("still prefers the server's message on every other failure", () => {
    const error = { response: { data: { errorCode: "HOLD_ENDED", message: "That hold has ended.", success: false } } };

    expect(readApiError(error)).toBe("That hold has ended.");
  });
});
