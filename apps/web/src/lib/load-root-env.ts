import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Makes the repo-root `.env` actually reach the running app.
 *
 * `docs/ENVIRONMENT.md` says to keep one `.env` at the repo root, and the
 * standalone scripts under `apps/web/scripts/` do read it. Next does not: it
 * loads env files from the **project directory** (`apps/web`), so the root file
 * was invisible to every route handler.
 *
 * The previous version of this file tried to fix that by calling
 * `loadEnvConfig(repoRoot)` a second time. That is a no-op. `@next/env`
 * memoises its result and returns the cached environment on any later call
 * regardless of the directory passed, so once Next had loaded `apps/web`, the
 * root file was never read. Nothing failed loudly — variables defined in both
 * places (the majority) looked fine, and the handful that lived only at the
 * root were simply absent, which is how an R2 bucket name can be configured,
 * committed, documented and still undefined at runtime.
 *
 * So the root file is parsed directly here, and **only fills variables that are
 * not already set**. That keeps the precedence everyone expects — a real
 * environment variable beats `apps/web/.env.local`, which beats the root
 * `.env` — while making the root file a working base rather than a decoy.
 *
 * Imported from `instrumentation.ts` so it runs once at server start, before
 * any handler reads `process.env`. Importing it from a couple of library
 * modules, as before, made the timing depend on which module a given route
 * happened to pull in first.
 */

/** Minimal `KEY=value` parsing: comments, blank lines, optional quotes. */
export function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim().replace(/^export\s+/, "");

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

/**
 * Applies parsed values, skipping anything already present.
 *
 * The skip is the whole contract: a real environment variable set by the host,
 * and `apps/web/.env.local`, must both outrank the root file. Exported so a
 * test can assert that rather than trusting the one-line `if`.
 */
export function fillMissing(values: Record<string, string>): string[] {
  const filled: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      filled.push(key);
    }
  }

  return filled;
}

function findRepoRoot(): string | null {
  // `next dev` runs with cwd at apps/web; a script may run from the repo root.
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd(), "../.."),
  ];

  return candidates.find((dir) => existsSync(path.join(dir, ".env"))) ?? null;
}

let loaded = false;

export function loadRootEnv(): string[] {
  if (loaded) {
    return [];
  }

  loaded = true;

  const repoRoot = findRepoRoot();

  if (!repoRoot) {
    return [];
  }

  try {
    return fillMissing(parseEnvFile(readFileSync(path.join(repoRoot, ".env"), "utf8")));
  } catch {
    // A missing or unreadable root .env is legitimate — a deployment sets real
    // environment variables and has no file at all.
    return [];
  }
}

loadRootEnv();
