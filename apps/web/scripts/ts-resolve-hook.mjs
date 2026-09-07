/**
 * Lets `node --experimental-transform-types` load this repo's TypeScript.
 *
 * The source uses extensionless relative imports (`from "../index"`), which is
 * what every bundler in the project expects and what Node's ESM resolver
 * refuses. Rather than rewrite 40 files to suit one script, this hook retries a
 * failed resolution with `.ts` and `/index.ts` appended — the same two guesses
 * TypeScript itself makes.
 *
 * It also resolves the `@/` alias, which is how the app imports everything
 * under `src/` and which Node knows nothing about. Without it a script can
 * import a leaf module and nothing that module itself depends on — which rules
 * out importing anything from `modules/`, and that is where the code a script
 * would want to exercise actually lives.
 *
 * Used by `scripts/send-test-emails.ts` and `scripts/score-evidence-engines.ts`.
 * Not part of the app.
 */
import { pathToFileURL } from "node:url";
import path from "node:path";

/** `apps/web/src`, resolved from this file rather than the process's cwd. */
const SRC = path.resolve(import.meta.dirname, "..", "src");

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const target = path.join(SRC, specifier.slice(2));

    for (const suffix of [".ts", ".tsx", "/index.ts", ""]) {
      try {
        return await next(pathToFileURL(target + suffix).href, context);
      } catch {
        // Try the next shape.
      }
    }
  }

  try {
    return await next(specifier, context);
  } catch (error) {
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
      throw error;
    }

    for (const suffix of [".ts", "/index.ts"]) {
      try {
        return await next(specifier + suffix, context);
      } catch {
        // Try the next shape.
      }
    }

    throw error;
  }
}
