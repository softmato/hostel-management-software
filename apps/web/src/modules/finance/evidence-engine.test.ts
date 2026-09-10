import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { evidenceEngineMode } from "@/modules/finance/evidence-engine";

/**
 * Which engine is live, proved rather than assumed.
 *
 * This resolver had no test at all for the whole life of the feature, and the
 * defect that cost the most was precisely a resolver defect: production ran an
 * engine that could not run there, every local run stayed green, and nothing
 * anywhere reported which engine was answering. The truth table below is small
 * enough to read in one go and is the only place that says, in an executable
 * form, what a given set of credentials resolves to.
 */

const KEYS = [
  "EVIDENCE_ENGINE",
  "GCP_VISION_SA_KEY",
  "GEMINI_API_KEYS",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("evidenceEngineMode — an explicit setting", () => {
  it.each(["gemini", "shadow", "tesseract", "vision", "vision+gemini"])(
    "honours %s",
    (mode) => {
      process.env.EVIDENCE_ENGINE = mode;

      expect(evidenceEngineMode()).toBe(mode);
    },
  );

  it("is case-insensitive, because an env file is typed by a human", () => {
    process.env.EVIDENCE_ENGINE = "Vision+Gemini";

    expect(evidenceEngineMode()).toBe("vision+gemini");
  });

  /*
   * A typo must not silently select an engine nobody chose. Falling through to
   * the credential-based resolution means `EVIDENCE_ENGINE=vison` reads receipts
   * with whatever is configured rather than reading none of them.
   */
  it("ignores a value that is not a mode and resolves from credentials", () => {
    process.env.EVIDENCE_ENGINE = "vison";
    process.env.GEMINI_API_KEYS = "key-1";

    expect(evidenceEngineMode()).toBe("gemini");
  });
});

describe("evidenceEngineMode — resolved from credentials", () => {
  it("prefers the pair when both are credentialled", () => {
    process.env.GCP_VISION_SA_KEY = "{}";
    process.env.GEMINI_API_KEYS = "key-1";

    expect(evidenceEngineMode()).toBe("vision+gemini");
  });

  it("is vision alone when there is no Gemini key to fall back to", () => {
    process.env.GCP_VISION_SA_KEY = "{}";

    expect(evidenceEngineMode()).toBe("vision");
  });

  it("is gemini when Vision has no credential", () => {
    process.env.GEMINI_API_KEYS = "key-1";

    expect(evidenceEngineMode()).toBe("gemini");
  });

  it("falls all the way to tesseract when nothing is configured", () => {
    expect(evidenceEngineMode()).toBe("tesseract");
  });

  /*
   * An empty variable is how a key gets "removed" from a dashboard without being
   * deleted, and a whitespace-only one is what a bad paste leaves behind. Either
   * would otherwise resolve to an engine that immediately answers
   * `not-configured` on every receipt.
   */
  it("does not count a blank Gemini key as a credential", () => {
    process.env.GEMINI_API_KEYS = "   ";

    expect(evidenceEngineMode()).toBe("tesseract");
  });

  it("does not count a blank Vision key as a credential", () => {
    process.env.GCP_VISION_SA_KEY = "";
    process.env.GEMINI_API_KEYS = "key-1";

    expect(evidenceEngineMode()).toBe("gemini");
  });
});
