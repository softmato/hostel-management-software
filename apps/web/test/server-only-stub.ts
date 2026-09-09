/**
 * A no-op stand-in for the `server-only` package under Vitest.
 *
 * The real package throws on import. That is exactly what it is for — it is a
 * build-time tripwire, and the error is what stops a module carrying the
 * Softmato client secret from being pulled into a client bundle.
 *
 * Vitest is neither bundle, so the tripwire has nothing to catch here and would
 * only fail every suite that reaches a server module. The guard still holds
 * where it matters: `next build` resolves the real package and refuses the
 * build.
 */
export {};
