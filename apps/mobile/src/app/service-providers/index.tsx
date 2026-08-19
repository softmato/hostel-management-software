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
  if (isApproved) {
    /*
     * The website has no provider dashboard by design — this app is it — so the
     * honest thing to show is not "apply" but where the work is.
     */
    return (
      <InfoNote title="You are an approved provider" tone="accent">
        <Text className="leading-6" variant="muted">
          Jobs broadcast by hostels in your trades and area arrive in this app.
          There is nothing else to apply for.
        </Text>
        <Button
          className="mt-1"
          label="Go to your jobs"
          onPress={() => router.push("/(provider)")}
        />
      </InfoNote>
    );
  }

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

  if (application && application.status !== "REJECTED") {
    return (
      <InfoNote title={PENDING_TITLE[application.status]} tone="accent">
        <Text className="leading-6" variant="muted">
          {PENDING_BODY[application.status]}
        </Text>
      </InfoNote>
    );
  }

  return (
    <InfoNote
      title={application ? "Apply again" : "Apply to join"}
      tone="accent"
    >
      <Text className="leading-6" variant="muted">
        {application?.rejectionReason
          ? `Your last application wasn't approved: ${application.rejectionReason} Correct it and send it again.`
          : "Five short steps, right here in the app — your trades, where you work, and a photo of yourself for your provider ID card."}
      </Text>
      <View className="mt-1 gap-2">
        <Button
          label={application ? "Start a new application" : "Apply as a service provider"}
          onPress={() => router.push("/service-providers/apply")}
        />
      </View>
    </InfoNote>
  );
}

/** The three statuses that mean "there is nothing for you to do here". */
const PENDING_TITLE: Record<string, string> = {
  APPROVED: "You're approved",
  HIDDEN: "Your listing is hidden",
  INACTIVE: "Your listing is inactive",
  PENDING_APPROVAL: "Your application is under review",
};

const PENDING_BODY: Record<string, string> = {
  APPROVED:
    "Your listing is live. Jobs broadcast by hostels in your trades and area arrive in this app.",
  HIDDEN:
    "The platform has temporarily hidden your listing, so no new jobs are being broadcast to you. Contact support if that is unexpected.",
  INACTIVE:
    "Your listing is marked inactive and is not receiving new jobs. Contact support to reactivate it.",
  PENDING_APPROVAL:
    "The platform team is checking your details and documents. It usually takes about two days, and you'll be emailed either way.",
};
