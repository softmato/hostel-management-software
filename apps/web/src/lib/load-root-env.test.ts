import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fillMissing, parseEnvFile } from "@/lib/load-root-env";

/**
 * The bug this guards against was silent and cost a working deployment.
 *
 * Next loads env files from `apps/web`, not the repo root, so the root `.env`
 * that this project documents as the single place to configure things was never
 * read by a route handler. The previous fix called `@next/env`'s
 * `loadEnvConfig` a second time with the root directory — but that function
 * memoises and ignores the directory on any later call, so it did nothing.
 *
 * Nothing failed loudly, because most variables were duplicated into
 * `apps/web/.env.local` and looked fine. Only the handful defined *solely* at
 * the root were missing, which is how `R2_BUCKET_PUBLIC` could be set,
 * committed and documented while being `undefined` at runtime.
 */
describe("parseEnvFile", () => {
  it("reads plain assignments", () => {
    expect(parseEnvFile("FOO=bar\nBAZ=qux")).toEqual({ BAZ: "qux", FOO: "bar" });
  });

  it("skips comments and blank lines", () => {
    expect(parseEnvFile("# a comment\n\nFOO=bar\n   # indented\n")).toEqual({ FOO: "bar" });
  });

  it("strips matched surrounding quotes", () => {
    expect(parseEnvFile(`A="one"\nB='two'\nC=three`)).toEqual({
      A: "one",
      B: "two",
      C: "three",
    });
  });

  it("keeps everything after the first '=' intact", () => {
    // Mongo connection strings and base64 keys both contain '=' and '&'.
    const parsed = parseEnvFile(
      "MONGODB_URI=mongodb+srv://u:p@h/db?retryWrites=true&w=majority\nKEY=abc==",
    );

    expect(parsed.MONGODB_URI).toBe("mongodb+srv://u:p@h/db?retryWrites=true&w=majority");
    expect(parsed.KEY).toBe("abc==");
  });

  it("ignores lines that are not assignments", () => {
    expect(parseEnvFile("just some prose\nFOO=bar\n=novalue\n1BAD=x")).toEqual({
      FOO: "bar",
    });
  });

  it("accepts an optional export prefix", () => {
    expect(parseEnvFile("export FOO=bar")).toEqual({ FOO: "bar" });
  });
});

describe("fillMissing", () => {
  const touched = ["TEST_ROOT_ONLY", "TEST_ALREADY_SET", "TEST_EMPTY"];
  const snapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of touched) {
      snapshot[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of touched) {
      if (snapshot[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = snapshot[key];
      }
    }
  });

  it("sets a variable that is not already present", () => {
    const filled = fillMissing({ TEST_ROOT_ONLY: "from-root" });

    expect(process.env.TEST_ROOT_ONLY).toBe("from-root");
    expect(filled).toContain("TEST_ROOT_ONLY");
  });

  it("never overrides a variable that is already set", () => {
    // This is the precedence that keeps apps/web/.env.local — and a real
    // environment variable on the host — authoritative over the root file.
    process.env.TEST_ALREADY_SET = "from-env-local";

    const filled = fillMissing({ TEST_ALREADY_SET: "from-root" });

    expect(process.env.TEST_ALREADY_SET).toBe("from-env-local");
    expect(filled).not.toContain("TEST_ALREADY_SET");
  });

  it("treats an explicitly empty value as set and leaves it alone", () => {
    // `FOO=` in .env.local is a deliberate "off", not an absence.
    process.env.TEST_EMPTY = "";

    fillMissing({ TEST_EMPTY: "from-root" });

    expect(process.env.TEST_EMPTY).toBe("");
  });
});
