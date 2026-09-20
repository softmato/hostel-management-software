import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  PDF_LIB_ROUTES,
  XLSX_ROUTES,
} from "@/lib/output-tracing";

/**
 * The tripwire under `output-tracing.ts`.
 *
 * `next.config.ts` drops `pdf-lib` and `xlsx` from every function bundle and
 * hands them back to a list of route globs. A route that reaches one of those
 * packages **without** being on the list builds green and 500s the first time
 * somebody asks it for a document — there is nothing at build time that knows
 * the include list is wrong.
 *
 * So this walks the real import graph the way `@vercel/nft` does — every
 * `from "…"`, `import("…")` and `require("…")` in `src`, following the `@/`
 * alias and relative paths — and fails with the exact glob that is missing.
 *
 * It is deliberately its own crude resolver rather than a call into a bundler:
 * the question is only "does this route's subtree mention the package", which a
 * regex answers, and over-reporting is the safe direction. A route this flags
 * that genuinely cannot render a document still only costs its bundle the
 * library.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HEAVY = ["pdf-lib", "xlsx"] as const;
const SPEC = /from\s+"([^"]+)"|import\("([^"]+)"\)|require\("([^"]+)"\)/g;

type Heavy = (typeof HEAVY)[number];

function sourceFiles() {
  const out: string[] = [];

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) {
        out.push(full.replaceAll("\\", "/"));
      }
    }
  };

  walk(SRC);

  return out;
}

function resolveSpec(spec: string, from: string, known: Set<string>) {
  const base = spec.startsWith("@/")
    ? `${SRC.replaceAll("\\", "/")}/${spec.slice(2)}`
    : spec.startsWith(".")
      ? path.resolve(path.dirname(from), spec).replaceAll("\\", "/")
      : null;

  if (!base) {
    return null;
  }

  return (
    [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`, base].find(
      (candidate) => known.has(candidate),
    ) ?? null
  );
}

/** One regex character that has to survive into the pattern as itself. */
const LITERAL = new Set([".", "+", "^", "$", "{", "}", "(", ")", "|", "[", "]", "?"]);

/** A route glob to a RegExp: a single star is one path segment, a double star is any number. */
function globToRegExp(glob: string) {
  const body = glob
    .split("/")
    .map((part) =>
      part === "**"
        ? "@@ANY@@"
        : [...part]
            .map((char) =>
              char === "*" ? "[^/]*" : LITERAL.has(char) ? "\\" + char : char,
            )
            .join(""),
    )
    .join("/")
    .replaceAll("/@@ANY@@", "(?:/.*)?")
    .replaceAll("@@ANY@@", ".*");

  return new RegExp(`^${body}$`);
}

function routesReaching(): Record<Heavy, string[]> {
  const files = sourceFiles();
  const known = new Set(files);
  const sources = new Map(files.map((file) => [file, fs.readFileSync(file, "utf8")]));

  const edges = new Map<string, string[]>();
  const direct = new Map<string, Set<Heavy>>();

  for (const [file, source] of sources) {
    const out: string[] = [];

    for (const match of source.matchAll(SPEC)) {
      const spec = match[1] ?? match[2] ?? match[3] ?? "";

      if ((HEAVY as readonly string[]).includes(spec)) {
        const hit = direct.get(file) ?? new Set<Heavy>();

        hit.add(spec as Heavy);
        direct.set(file, hit);
        continue;
      }

      const resolved = resolveSpec(spec, file, known);

      if (resolved) {
        out.push(resolved);
      }
    }

    edges.set(file, out);
  }

  const found: Record<Heavy, string[]> = { "pdf-lib": [], xlsx: [] };

  for (const file of files) {
    if (!file.endsWith("/route.ts")) {
      continue;
    }

    const seen = new Set<string>();
    const stack = [file];
    const reached = new Set<Heavy>();

    while (stack.length > 0) {
      const current = stack.pop()!;

      if (seen.has(current)) {
        continue;
      }

      seen.add(current);

      for (const heavy of direct.get(current) ?? []) {
        reached.add(heavy);
      }

      stack.push(...(edges.get(current) ?? []));
    }

    const route = file.slice(`${SRC.replaceAll("\\", "/")}/app`.length, -"/route.ts".length);

    for (const heavy of reached) {
      found[heavy].push(route);
    }
  }

  return found;
}

describe("output file tracing allowlists", () => {
  const reaching = routesReaching();

  it.each([
    ["pdf-lib", PDF_LIB_ROUTES],
    ["xlsx", XLSX_ROUTES],
  ] as const)("covers every route that reaches %s", (heavy, globs) => {
    const patterns = globs.map(globToRegExp);
    const uncovered = reaching[heavy].filter(
      (route) => !patterns.some((pattern) => pattern.test(route)),
    );

    // A route here would ship without the library and 500 on its first document.
    // Add its prefix to the matching list in `output-tracing.ts`.
    expect(uncovered).toEqual([]);
  });

  it("finds the document routes at all, so a broken walk cannot pass silently", () => {
    expect(reaching["pdf-lib"]).toContain("/api/v1/resident/finance/receipts/[id]/pdf");
    expect(reaching.xlsx).toContain("/api/v1/hostel-admin/residents/existing/file");
  });

  it("has no glob that matches nothing — the `[id]` character-class trap", () => {
    const routes = [...reaching["pdf-lib"], ...reaching.xlsx];
    const dead = [...PDF_LIB_ROUTES, ...XLSX_ROUTES].filter((glob) => {
      const pattern = globToRegExp(glob);

      return !routes.some((route) => pattern.test(route));
    });

    expect(dead).toEqual([]);
  });
});
