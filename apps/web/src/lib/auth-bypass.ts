/**
 * The one place that decides whether the portal route guard is switched off.
 *
 * `NEXT_PUBLIC_UI_PREVIEW` exists so a designer can click through
 * `/platform`, `/hostel-admin`, `/{slug}/admin`, `/resident` and `/guardian`
 * without seeding an account for every role. That is a useful thing to have and
 * a catastrophic thing to leave reachable in production: the flag skips the
 * guard for every protected portal at once.
 *
 * **`NODE_ENV === "production"` therefore wins over the flag, always.** It is a
 * `NEXT_PUBLIC_` variable, which means it is inlined at build time and lives in
 * the same Vercel environment list as every other key — one stray copy from a
 * preview environment into production would otherwise open every portal shell
 * to anonymous visitors. A preview build that genuinely wants the bypass runs
 * with `NODE_ENV` set to something other than `production`, which is what
 * `next dev` and `next build` for a non-production target already do.
 *
 * The API layer is unaffected either way — every route handler authenticates
 * its own request — so the blast radius of the flag is the rendered shell
 * rather than the data. That is the reason this is a guard and not an incident.
 */
export function isAuthBypassEnabled(): boolean {
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  return (
    process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_UI_PREVIEW === "true"
  );
}
