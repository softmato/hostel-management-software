import { Redirect } from "expo-router";

import { BrandSplash } from "@/components/brand-splash";
import { resolveHome } from "@/constants/roles";
import { useAppSelector } from "@/hooks/redux";

/**
 * The boot gate.
 *
 * This is the app's initial route, and it renders the same brand splash the
 * native one shows — so the handover is seamless and there is nothing to see
 * while we decide. The decision itself is synchronous: `resolveHome` is a pure
 * function of the cached account, with no awaits and no network.
 *
 * That is the whole no-flash trick. Anything that awaits here — a `/auth/me`
 * call, a permissions check — pushes a blank or wrong screen in front of the
 * user on every cold start.
 *
 * Hiding the splash is **not** this screen's job, though it used to be: a deep
 * link mounts its own route and never renders the gate, so the hide would never
 * fire and the splash would sit over the app forever. `_layout.tsx` owns it,
 * because it is the one component every route mounts under.
 */
export default function BootGate() {
  const { account, isReady, isResidentActivated } = useAppSelector((state) => state.auth);

  if (!isReady) {
    return <BrandSplash />;
  }

  return (
    <Redirect
      href={resolveHome(
        account
          ? {
              isApprovedProvider: account.isServiceProvider,
              // `null` means "not checked yet" — treat as activated so a
              // resident with a working session is not bounced to the QR
              // screen on a cold offline start. `revalidateSession` corrects it.
              isResidentActivated: isResidentActivated ?? true,
              mustChangePassword: account.mustChangePassword,
              role: account.role,
            }
          : null,
      )}
    />
  );
}
