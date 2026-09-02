import { Redirect } from "expo-router";

import { BrandSplash } from "@/components/brand-splash";
import { type HomeRoute, resolveHome } from "@/constants/roles";
import { useAppSelector } from "@/hooks/redux";

/**
 * The wall in front of a role's tab group.
 *
 * ## Why the boot gate was not enough
 *
 * `index.tsx` decides where a launch *lands*, and for a long time that was
 * mistaken for deciding who may *be* there. It is not the same question. The
 * gate only runs on a launch that starts at `/`: a deep link, a notification, a
 * `router.push` from anywhere, or the back stack after a sign-out all mount a
 * group route directly, and every group layout accepted whoever arrived. So a
 * resident who reached `/(admin)` got the admin tab bar, and a signed-out
 * session that still had `(cook)` on its stack kept it.
 *
 * Nothing behind those screens would have answered them — every endpoint
 * authenticates its own request, and the panels come back empty or 403 — but a
 * portal that renders for the wrong person is a security answer given by
 * accident rather than on purpose, and it is exactly the shape of bug that
 * survives until someone screenshots a warden's tab bar on a resident's phone.
 *
 * ## It is the same decision, asked in the other direction
 *
 * The gate computes `resolveHome` and navigates there. This computes the same
 * `resolveHome` and asks whether it is *here*. One function, so a role that
 * lands somewhere can always stay there and the two can never disagree — the
 * failure mode of a second, hand-written table of who-may-see-what is that it
 * drifts from the first and starts redirecting people away from their own home.
 *
 * A `PUBLIC` account and a signed-out visitor both resolve to `(browse)`, which
 * is why `(browse)` needs no gate: it is where everyone who belongs nowhere else
 * is sent, and turning somebody away from it would leave them nowhere at all.
 */
export function RoleGate({
  children,
  group,
}: {
  children: React.ReactNode;
  /** The group this gate stands in front of, as `resolveHome` names it. */
  group: HomeRoute;
}) {
  const { account, isReady, isResidentActivated } = useAppSelector((state) => state.auth);

  /*
   * Nothing is decided until the cached session is restored. Rendering the
   * splash rather than the children is the difference between a held frame and
   * a flash of somebody else's dashboard — and rendering a *redirect* here
   * would be worse still, throwing every legitimate owner of this group out to
   * `(browse)` for the tick before their account loads.
   */
  if (!isReady) {
    return <BrandSplash />;
  }

  const home = resolveHome(
    account
      ? {
          isApprovedProvider: account.isServiceProvider,
          // Same reading as the boot gate: `null` is "not checked yet", not
          // "not activated", so an offline cold start does not bounce a
          // resident with a working session out to the QR screen.
          isResidentActivated: isResidentActivated ?? true,
          role: account.role,
        }
      : null,
  );

  if (home !== group) {
    return <Redirect href={home} />;
  }

  return <>{children}</>;
}
