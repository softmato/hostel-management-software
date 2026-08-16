/**
 * Lets `node --experimental-transform-types` load this repo's TypeScript.
 *
 * The source uses extensionless relative imports (`from "../index"`), which is
 * what every bundler in the project expects and what Node's ESM resolver
 * refuses. Rather than rewrite 40 files to suit one script, this hook retries a
 * failed resolution with `.ts` and `/index.ts` appended — the same two guesses
 * TypeScript itself makes.
 *
 * Used by `scripts/send-test-emails.ts`. Not part of the app.
 */
export async function resolve(specifier, context, next) {
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
