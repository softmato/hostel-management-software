import { router } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

import { DocumentScreen } from "@/components/document-screen";
import { MockupCarousel } from "@/components/mockup-carousel";
import { MockupImage } from "@/components/mockup-image";
import { IconPoint } from "@/components/step-flow";
import { Button } from "@/components/ui/button";
import { Lottie } from "@/components/ui/lottie";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useAppSelector } from "@/hooks/redux";
import { useResource } from "@/hooks/use-resource";
import { MOCKUPS, type Mockup } from "@/lib/portal-mockups";
import { listOwnHostelApplications, type OwnHostelApplication } from "@/lib/registration-api";

/**
 * "Register your hostel" — the app's version of the website's owner landing page.
 *
 * The features, the stat strip and the closing pitch are the platform's
 * configured copy, so this screen and `/register-hostel` say the same things about
 * the same product.
 *
 * ## The screenshots came across (2026-09-14)
 *
 * This screen used to leave out the website's carousel and feature images as
 * desktop furniture. That held while they were icon placeholders; they are real
 * screens of the product now, and an owner deciding whether to sign up is better
 * served by seeing the dashboard than by reading about it. What stayed out is the
 * furniture: no scrambling wordmark, no self-advancing slides. The carousel sits
 * under the apply button, not above it, and a section's picture only loads when
 * that section is opened.
 *
 * ## The form is in the app now
 *
 * This screen used to end in `WebBrowser.openBrowserAsync`, on the argument that
 * the application "asks for ownership papers, so it opens on the web where those
 * files are". `register-hostel/apply.tsx` explains at length why that was wrong
 * about where the papers are. What is left here is the pitch — and the pitch now
 * leads with the button rather than burying it under itself.
 *
 * ## And it answers "what happened to mine?"
 *
 * An owner who has already applied gets the status of their application in place
 * of a second invitation to file one. On the website that lives behind
 * `HostelStatusView`; here it is the same `/public/hostel-applications/
 * my-applications` read, which is the whole reason the application is filed
 * through the authenticated client.
 */
export default function RegisterHostelScreen() {
  const account = useAppSelector((state) => state.auth.account);

  const applications = useResource<OwnHostelApplication[]>(
    useCallback(
      () =>
        account ? listOwnHostelApplications().catch(() => []) : Promise.resolve([]),
      [account],
    ),
  );

  const latest = applications.data?.[0] ?? null;

  return (
    <DocumentScreen
      action={
        <ApplyBlock
          isSignedIn={Boolean(account)}
          latest={latest}
          loading={Boolean(account) && applications.loading}
        />
      }
      comingSoon="More about hosting with us is being designed — it arrives in an upcoming update."
      media={<MockupCarousel slides={SLIDES} title="See it before you sign up" />}
      page="registerHostel"
      sectionMedia={(index) =>
        SECTION_MOCKUPS[index] ? <MockupImage mockup={SECTION_MOCKUPS[index]} /> : null
      }
      webPath="register-hostel"
      title="Register your hostel"
    />
  );
}

/** Every portal screen, in the order an owner meets them — same list as the website. */
const SLIDES: { label: string; mockup: Mockup }[] = [
  { label: "Hostel dashboard", mockup: MOCKUPS.wardenDashboard },
  { label: "Rooms & beds", mockup: MOCKUPS.wardenRooms },
  { label: "Resident registration", mockup: MOCKUPS.residentRegister },
  { label: "Identity check", mockup: MOCKUPS.residentVerify },
  { label: "Fee schedule & reconcile", mockup: MOCKUPS.wardenFinance },
  { label: "Transactions", mockup: MOCKUPS.wardenTransactions },
  { label: "Payment setup", mockup: MOCKUPS.wardenPaymentSetup },
  { label: "Resident portal", mockup: MOCKUPS.residentPortal },
  { label: "Resident fees", mockup: MOCKUPS.residentFees },
  { label: "Resident ID card", mockup: MOCKUPS.residentProfile },
  { label: "Guardian portal", mockup: MOCKUPS.guardianPortal },
  { label: "Your public hostel page", mockup: MOCKUPS.appCommunity },
  { label: "Found on the map", mockup: MOCKUPS.appMap },
];

/**
 * The screen beside each configured section, by position — the website's
 * `featureChrome` order, so section 3 shows the same picture in both places.
 */
const SECTION_MOCKUPS: readonly Mockup[] = [
  MOCKUPS.wardenDashboard,
  MOCKUPS.wardenRooms,
  MOCKUPS.residentRegister,
  MOCKUPS.residentVerify,
  MOCKUPS.wardenFinance,
  MOCKUPS.wardenPaymentSetup,
  MOCKUPS.wardenTransactions,
  MOCKUPS.residentPortal,
  MOCKUPS.residentFees,
  MOCKUPS.residentProfile,
  MOCKUPS.guardianPortal,
  MOCKUPS.appCommunity,
  MOCKUPS.appMap,
  MOCKUPS.appHome,
];

/** One animation, one line, one action — the ID card invitation's shape (`IdCardPrompt`). */
function ApplyBlock({
  isSignedIn,
  latest,
  loading,
}: {
  isSignedIn: boolean;
  latest: OwnHostelApplication | null;
  loading: boolean;
}) {
  if (loading) {
    // The block's own shape, so the page does not shift when the lookup lands.
    return (
      <View className="items-center gap-3">
        <Skeleton height={140} radius={70} width={140} />
        <Skeleton height={22} width="70%" />
        <Skeleton height={14} width="85%" />
        <Skeleton className="mt-2" height={48} />
      </View>
    );
  }

  const pending = latest && latest.status !== "REJECTED" ? latest : null;

  return (
    <View className="gap-5">
      <View className="items-center gap-3">
        <Lottie
          loop={false}
          size={150}
          source={require("../../../assets/lottie/hostel-register.lottie")}
        />
        <Text className="text-center" variant="title">
          {pending ? STATUS_TITLE[pending.status] : "Bring your hostel online"}
        </Text>
        <Text className="text-center" variant="muted">
          {pending
            ? statusBody(pending)
            : latest?.rejectionReason
              ? `Your last application wasn't approved: ${latest.rejectionReason} Fix it and send it again.`
              : "Five short steps, all of them here in the app."}
        </Text>
      </View>

      {pending ? null : (
        <View className="gap-3">
          <IconPoint
            delay={250}
            icon="camera-outline"
            text="Photograph your ID with this phone — no scanner needed."
          />
          <IconPoint
            delay={400}
            icon="document-text-outline"
            text="Start your house rules from a template and change what doesn't apply."
          />
          <IconPoint
            delay={550}
            icon="cloud-done-outline"
            text="Your progress saves as you go, so you can finish later."
          />
        </View>
      )}

      <View className="gap-2">
        {pending ? (
          <Button
            label="Register another hostel"
            onPress={() => router.push("/register-hostel/apply")}
            variant="outline"
          />
        ) : (
          <>
            <Button
              label={
                isSignedIn
                  ? "Start your registration"
                  : "Sign in and start your registration"
              }
              onPress={() => router.push("/register-hostel/apply")}
            />
            <Button
              label="Browse hostels first"
              onPress={() => router.push("/(browse)/search")}
              variant="ghost"
            />
          </>
        )}
      </View>
    </View>
  );
}

const STATUS_TITLE: Record<string, string> = {
  APPROVED: "Your hostel is approved",
  INFO_REQUESTED: "The review team needs something",
  PENDING: "Your application is under review",
};

/**
 * `INFO_REQUESTED` is the one status that is *actionable*, so it names what was
 * asked for rather than saying "check your email". A list of requested documents
 * with no note attached would be a dead end, which is why the note comes first
 * when there is one.
 */
function statusBody(application: OwnHostelApplication): string {
  if (application.status === "INFO_REQUESTED") {
    const documents = application.requestedDocuments
      .map((document) => document.documentType)
      .join(", ");

    return [
      application.infoRequestNote,
      documents ? `They asked for: ${documents}.` : "",
      "Reply to the email they sent you with the files attached.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (application.status === "APPROVED") {
    return `${application.hostelName} has been approved. Your owner login and dashboard are in the email we sent.`;
  }

  return `${application.hostelName} is with the platform team. They usually decide within a couple of days, and email you either way.`;
}
