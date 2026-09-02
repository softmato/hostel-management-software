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
 *
 * ## It is opt-in, and `development` is not the opt-in
 *
 * This used to return `true` for `NODE_ENV === "development"` as well, which
 * meant the guard was off in *every* local run rather than in the preview runs
 * it was written for. Signed out entirely, `localhost:3000/platform/dashboard`
 * rendered the superadmin portal — and so did `/hostel-admin`, `/resident` and
 * `/guardian`. Two things follow from that, and both are bad. Nobody developing
 * against the app ever exercised the redirect they ship to users, so a
 * regression in it is invisible until production. And the local build behaves
 * unlike the deployed one precisely where "who is allowed in" is decided, which
 * is the last place a difference should live.
 *
 * So the flag is now the only way in. A designer who wants the old behaviour
 * sets `NEXT_PUBLIC_UI_PREVIEW=true`; everybody else develops against the same
 * rules production enforces.
 */
export function isAuthBypassEnabled(): boolean {
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  return process.env.NEXT_PUBLIC_UI_PREVIEW === "true";
}
