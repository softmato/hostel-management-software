"use client";

import { useEffect, useState } from "react";

import { browserApi } from "@/lib/browser-api";

type IdentityShape = {
  identity: { hasProfile: boolean; residentId: string | null } | null;
};

/**
 * Whether the signed-in account already holds a resident ID card.
 *
 * Applying to be a service provider or registering a hostel re-issues that same
 * card under the new role once the platform approves it, so both flows warn
 * before submitting — but only for the people who actually have a card to lose.
 *
 * `undefined` means "still looking"; callers should not block a submit on it.
 * A failed lookup resolves to `false`: an unnecessary warning is worse than a
 * missing one here, because the submit itself is unaffected either way.
 */
export function useHasResidentIdCard() {
  const [hasCard, setHasCard] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let isMounted = true;

    void browserApi<IdentityShape>("/api/v1/users/resident-identity")
      .catch(() => null)
      .then((data) => {
        if (!isMounted) {
          return;
        }

        const identity = data?.identity;
        setHasCard(Boolean(identity?.hasProfile && identity.residentId));
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return hasCard;
}
