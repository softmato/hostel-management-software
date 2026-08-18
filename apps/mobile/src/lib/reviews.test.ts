import { describe, expect, it } from "vitest";

import {
  canReview,
  emptyReviewDraft,
  hasReviewErrors,
  MAX_COMMENT,
  REVIEW_CATEGORIES,
  reviewGateReason,
  scoredCategoryCount,
  toReviewInput,
  validateReview,
} from "@/lib/reviews";

describe("REVIEW_CATEGORIES", () => {
  /*
   * Order and labels come from the web's form. `safetyRating` is presented as
   * "Security" there — renaming it would make one field read as two different
   * questions depending on which client the resident opened.
   */
  it("keeps the web's six categories, in its order", () => {
    expect(REVIEW_CATEGORIES.map((category) => category.label)).toEqual([
      "Food",
      "Cleanliness",
      "Security",
      "Room",
      "Location",
      "Management",
    ]);
  });

  it("labels safetyRating as Security, as the web does", () => {
    expect(REVIEW_CATEGORIES.find((c) => c.key === "safetyRating")?.label).toBe(
      "Security",
    );
  });
});

describe("validateReview", () => {
  it("requires an overall score", () => {
    const errors = validateReview(emptyReviewDraft());

    expect(errors.overallRating).toBeTruthy();
    expect(hasReviewErrors(errors)).toBe(true);
  });

  it("passes on an overall score alone — the rest are optional", () => {
    const errors = validateReview({ ...emptyReviewDraft(), overallRating: 4 });

    expect(hasReviewErrors(errors)).toBe(false);
  });

  it("holds the star bounds", () => {
    expect(
      validateReview({ ...emptyReviewDraft(), overallRating: 6 }).overallRating,
    ).toBeTruthy();
    expect(
      validateReview({ ...emptyReviewDraft(), overallRating: 1 }).overallRating,
    ).toBeUndefined();
    expect(
      validateReview({ ...emptyReviewDraft(), overallRating: 5 }).overallRating,
    ).toBeUndefined();
  });

  it("holds the comment cap", () => {
    const errors = validateReview({
      ...emptyReviewDraft(),
      comment: "c".repeat(MAX_COMMENT + 1),
      overallRating: 3,
    });

    expect(errors.comment).toContain(String(MAX_COMMENT));
  });
});

describe("toReviewInput", () => {
  it("sends only the overall score when nothing else was tapped", () => {
    expect(toReviewInput({ ...emptyReviewDraft(), overallRating: 4 })).toEqual({
      overallRating: 4,
    });
  });

  /*
   * `0` is the form's "not scored". Sending it would fail `starRating`'s `min(1)`
   * and reject the whole review, so an untouched star row has to become an absent
   * key — which is also what the merge in `createResidentReview` expects.
   */
  it("omits an unscored category rather than sending 0", () => {
    const payload = toReviewInput({ ...emptyReviewDraft(), overallRating: 4 });

    for (const { key } of REVIEW_CATEGORIES) {
      expect(key in payload).toBe(false);
    }
  });

  it("keeps every category that was scored", () => {
    const payload = toReviewInput({
      ...emptyReviewDraft(),
      foodRating: 2,
      overallRating: 4,
      safetyRating: 5,
    });

    expect(payload).toEqual({ foodRating: 2, overallRating: 4, safetyRating: 5 });
  });

  it("trims the comment and omits a blank one", () => {
    expect(
      toReviewInput({ ...emptyReviewDraft(), comment: "  Good food.  ", overallRating: 3 })
        .comment,
    ).toBe("Good food.");
    expect(
      "comment" in toReviewInput({ ...emptyReviewDraft(), comment: "   ", overallRating: 3 }),
    ).toBe(false);
  });
});

describe("scoredCategoryCount", () => {
  it("counts only the optional categories, not the overall score", () => {
    expect(scoredCategoryCount({ ...emptyReviewDraft(), overallRating: 5 })).toBe(0);
    expect(
      scoredCategoryCount({
        ...emptyReviewDraft(),
        foodRating: 1,
        overallRating: 5,
        roomRating: 3,
      }),
    ).toBe(2);
  });
});

describe("canReview", () => {
  /*
   * `createResidentReview` throws `REVIEW_NOT_ALLOWED` (403) for anything else, so
   * this is what decides whether the form is drawn — a resident should not fill in
   * seven ratings and a comment before being told no.
   */
  it("allows current and past residents only", () => {
    expect(canReview("ACTIVE")).toBe(true);
    expect(canReview("MOVED_OUT")).toBe(true);
    expect(canReview("PENDING")).toBe(false);
    expect(canReview("SUSPENDED")).toBe(false);
  });
});

describe("reviewGateReason", () => {
  it("explains a pending stay without blaming the resident", () => {
    expect(reviewGateReason("PENDING")).toContain("not activated");
  });

  it("points a suspended resident at the office", () => {
    expect(reviewGateReason("SUSPENDED")).toContain("office");
  });

  it("falls back to something true for any other status", () => {
    expect(reviewGateReason("SOMETHING_NEW")).toContain("current and past residents");
  });
});
