import { router } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

import { DocumentScreen } from "@/components/document-screen";
import { InfoNote } from "@/components/info-page";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAppSelector } from "@/hooks/redux";
import { useResource } from "@/hooks/use-resource";
import { getOwnProvider, type ProviderApplication } from "@/lib/provider-api";
import { providerStatusPanelFor } from "@/lib/provider-status";

/**
 * "Become a service provider" — the app's version of `/service-providers`.
 *
 * The pitch, the stat strip and the sections are the platform's configured copy,
 * shared with the website's hero. What is different is who is reading: this
 * screen is inside the app an approved provider will actually work from, so it
 * can say that plainly, recognise a provider who has already been approved
 * instead of inviting them to apply twice, and — since 2026-08-19 — take the
 * application itself rather than handing it to a browser.
 *
 * ## The apply block moved to the top
 *
 * It used to be `extra`, i.e. after the intro, the four stats and every section.
 * On a phone that is two screenfuls of scrolling before the one control on the
 * page. A tradesperson who opened this screen having already decided to apply had
 * to read the argument for applying in order to find the button. See
 * `InfoActions`.
 */
export default function ServiceProvidersScreen() {
  const account = useAppSelector((state) => state.auth.account);

  /*
   * Only asked when there is a session — the route reads the caller's own
   * `userId`, so signed out there is nothing to ask about. `null` from it is the
   * normal answer ("never applied"), not an error, and a failed lookup must not
   * strand someone who has never applied: it falls through to the ordinary CTA.
   */
  const application = useResource<ProviderApplication | null>(
    useCallback(
      () => (account ? getOwnProvider().catch(() => null) : Promise.resolve(null)),
      [account],
    ),
  );

  return (
    <DocumentScreen
      action={
        <ApplyBlock
          application={application.data}
          isApproved={Boolean(account?.isServiceProvider)}
          isSignedIn={Boolean(account)}
          loading={application.loading}
        />
      }
      icon="construct-outline"
      page="serviceProviders"
      webPath="service-providers"
      title="Service providers"
    />
  );
}

/**
 * Four states, and the third is the one a two-state check gets wrong.
 *
 * An approved provider must not be shown "Apply" — there is nothing left to
 * apply for and the server would 409 them. Someone with an application *under
 * review* must not be shown it either, for the same reason, but the honest thing
 * to tell them is different: they are waiting, not finished. Only a rejected
 * applicant may apply again, which is `isApplicationOpen` on the website and the
 * `ACTIVE_APPLICATION_STATUSES` check in the service.
 *
 * All four sentences come from `lib/provider-status.ts`, which is also what the
 * Profile tab's banner and the provider's own card tab read. They used to be
 * written out here, and this copy was the one that drifted: it promised jobs
 * "broadcast by hostels in your trades and area" to somebody deciding whether to
 * apply, and there is no broadcast anywhere in the product — a hostel admin
 * assigns a provider by name, which is the whole of the marketplace.
 */
function ApplyBlock({
  application,
  isApproved,
  isSignedIn,
  loading,
}: {
  application: ProviderApplication | null;
  isApproved: boolean;
  isSignedIn: boolean;
  loading: boolean;
}) {
  if (isSignedIn && loading) {
    // Inert rather than absent. The lookup resolves a beat after the first
    // frame, and a card that appears late shifts the page under whoever was
    // already reading it.
    return (
      <InfoNote title="Checking your account…">
        <Text variant="muted">One moment.</Text>
      </InfoNote>
    );
  }

  /*
   * The record when there is one, the token's flag when there is not.
   * `/auth/me` says whether this account is an approved provider on every
   * launch; the record lookup can be a beat behind it or have failed outright,
   * and offering the form in that gap is how somebody sends a second
   * application the server refuses.
   */
  const panel = providerStatusPanelFor(
    application?.status ?? (isApproved ? "APPROVED" : null),
    application?.rejectionReason,
  );

  return (
    <InfoNote
      title={panel.canApply && application ? "Apply again" : panel.title}
      tone="accent"
    >
      <Text className="leading-6" variant="muted">
        {panel.body}
      </Text>

      {panel.showJobs ? (
        <Button
          className="mt-1"
          label="Go to your jobs"
          onPress={() => router.push("/(provider)")}
        />
      ) : null}

      {panel.canApply ? (
        <View className="mt-1 gap-2">
          <Button
            label={
              application ? "Start a new application" : "Apply as a service provider"
            }
            onPress={() => router.push("/service-providers/apply")}
          />
        </View>
      ) : null}
    </InfoNote>
  );
}
