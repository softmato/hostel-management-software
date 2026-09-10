import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ERASED_MODEL_NAMES,
  RETAINED_BY_HOSTEL_ID,
} from "@/modules/hostels/hostel-purge.service";

const MODELS_DIR = path.resolve(__dirname, "../../../../../packages/db/src/models");

/**
 * A schema field, not a mention. `hostelIds: [...]` (an array on a document that
 * belongs to someone else) and a `hostelId` inside a doc comment both have to
 * miss, or this test fails on models the purge is right to leave alone.
 */
const SCALAR_HOSTEL_ID = /^\s+hostelId:\s*\{/m;

function modelsWithHostelId() {
  return fs
    .readdirSync(MODELS_DIR)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => ({
      name: file.replace(/\.ts$/, ""),
      source: fs.readFileSync(path.join(MODELS_DIR, file), "utf8"),
    }))
    .filter((entry) => SCALAR_HOSTEL_ID.test(entry.source))
    .map((entry) => entry.name);
}

/**
 * The purge deletes by an explicit list of models, which means a model added
 * later is silently skipped — its rows survive a hostel that no longer exists,
 * and nothing fails to say so.
 *
 * So the list is checked against the schemas themselves rather than trusted. A
 * new collection carrying a `hostelId` fails this suite until somebody decides,
 * on purpose, whether a purge erases it or keeps it and why.
 */
describe("hostel purge registry", () => {
  it("covers every model that carries a hostelId", () => {
    const covered = new Set([
      ...ERASED_MODEL_NAMES,
      ...Object.keys(RETAINED_BY_HOSTEL_ID),
    ]);
    const missing = modelsWithHostelId().filter((name) => !covered.has(name));

    expect(
      missing,
      `These models carry a hostelId but the purge neither erases nor deliberately retains them. Add each to ERASED_BY_HOSTEL_ID, or to RETAINED_BY_HOSTEL_ID with a reason: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("finds the models directory it is asserting about", () => {
    // If the relative path above ever breaks, the filter above returns an empty
    // list and the first test passes for the wrong reason.
    expect(modelsWithHostelId().length).toBeGreaterThan(50);
  });

  it("does not list a model as both erased and retained", () => {
    const both = ERASED_MODEL_NAMES.filter(
      (name) => name in RETAINED_BY_HOSTEL_ID,
    );

    expect(both).toEqual([]);
  });

  it("gives every retained model a reason", () => {
    for (const [name, reason] of Object.entries(RETAINED_BY_HOSTEL_ID)) {
      expect(reason.trim().length, `${name} is retained without a reason`).toBeGreaterThan(
        20,
      );
    }
  });
});
