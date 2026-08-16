"use client";

import { PublicShell } from "@/app/_components/shared";
import { LegalBody } from "@/components/legal-body";
import { useSiteConfig } from "@/components/site-config-provider";
import { Shield, Lock, Eye, Database, Mail, Globe, MapPin } from "lucide-react";

/**
 * The built-in policy, shown when a platform admin has not authored their own
 * under Platform → Config → Legal.
 *
 * **Every line here must describe something the code actually does.** This text
 * previously promised four things that did not exist — deletion from account
 * settings, a data export, a cookie preferences page, and a 30-day deletion
 * window when the code uses 60 — and never mentioned that the mobile app
 * collects location at all. A privacy policy that overstates is worse than a
 * short one, because each unkept promise is the part someone relies on.
 *
 * If you change what the platform collects or retains, change this too.
 */
const buildSections = (siteName: string) => [
  {
    icon: Database,
    title: "Information We Collect",
    content: [
      "Personal information you provide when creating an account (name, email, phone number, role).",
      "Hostel details, photos, pricing, and facility information submitted by hostel admins.",
      "Resident data including room assignments, fee records, food preferences, and complaint history.",
      "Guardian information provided for resident emergency contacts and account linking.",
      "Payment evidence you upload — screenshots or receipts — which are stored privately and readable only by you and your hostel's staff.",
      "Identity documents you choose to add to your resident profile, encrypted at rest.",
      "If your hostel uses attendance tracking and you consent, whether you were inside or outside the hostel each day. See 'Location & Attendance' below.",
      "Usage data such as page visits, feature interactions, and device information to improve our service.",
    ],
  },
  {
    icon: Eye,
    title: "How We Use Your Information",
    content: [
      `To operate, maintain, and improve the ${siteName} platform and all its features.`,
      "To facilitate communication between hostel admins, residents, and guardians.",
      "To process payments, generate receipts, and manage financial records.",
      "To send service-related notifications, updates, and important account information.",
      "To detect, prevent, and address technical issues, fraud, or abuse of the platform.",
    ],
  },
  {
    icon: MapPin,
    title: "Location & Attendance",
    content: [
      "Attendance tracking is optional. It runs only in the mobile app, only if your hostel has enabled it, and only after you have explicitly consented — the server refuses location data from an account that has not.",
      "Your coordinates are never stored. The app sends a reading, the server converts it into a single answer — inside the hostel, or outside — and discards the position. There is no map, no route and no location history to retrieve, because none is kept.",
      "One reading per day is retained. A later reading replaces an earlier one rather than adding to it.",
      "Your hostel's staff and any guardian you have linked can see the daily inside/outside status. They cannot see where you were.",
      "You can withdraw consent at any time, and you can delete your attendance history from the app, which removes those daily records outright.",
    ],
  },
  {
    icon: Shield,
    title: "Data Sharing & Disclosure",
    content: [
      "We do not sell your personal information to third parties.",
      "Hostel-relevant resident data is shared only with the respective hostel administration.",
      "Guardian accounts receive limited, privacy-first access to resident information.",
      "We may share anonymised, aggregated data for analytics and platform improvement.",
      "We will disclose information if required by law or to protect the rights and safety of our users.",
    ],
  },
  {
    icon: Lock,
    title: "Data Security",
    content: [
      "All data transmitted between your device and our servers is encrypted using TLS/SSL protocols.",
      "Passwords are hashed and salted — we never store plain-text passwords.",
      "Payment evidence and identity documents are stored in private storage with no public address. They are reachable only through a link that we generate for an authorised viewer and that expires after fifteen minutes.",
      "The personal details on your resident profile are encrypted before they are written to our database.",
      "Each hostel's data is isolated from every other hostel's. A request for a record belonging to another hostel is answered as though it does not exist.",
      "Access to personal data is restricted to authorised personnel only.",
      "We regularly review and update our security practices to maintain data integrity.",
      "In the event of a data breach, affected users will be notified within 72 hours.",
    ],
  },
  {
    icon: Mail,
    title: "Your Rights & Choices",
    content: [
      "You can review and update the personal details on your profile at any time while signed in.",
      "You can request account deletion from Privacy & your data in your account. What that does depends on who you are: a public user or a moved-out resident is closed immediately; a guardian's account is returned to a normal public account; a hostel owner's request is reviewed by us first, and their account stays active until it is approved.",
      "A resident who is still living in a hostel cannot delete their account, because the hostel needs an accurate record of who is in residence. Ask your hostel to complete your move-out first.",
      "Once a deletion starts, the account is closed at once and permanently erased 60 days later. During those 60 days you can cancel using the link in the confirmation email — you cannot sign in to cancel, which is why the link exists.",
      "Erasure removes your account, profile, notifications, devices, sessions and any attendance records. Payment and receipt records are kept, because a hostel's financial history cannot develop gaps — but they hold only amounts and dates, with nothing left linking them to you. Posts and comments you wrote stay in the conversation as anonymous.",
      "You can opt out of non-essential communications via your notification preferences.",
      "You have the right to file a complaint with your local data protection authority.",
    ],
  },
  {
    icon: Globe,
    title: "Cookies & Tracking",
    content: [
      "We set four cookies, all of them our own and all essential: two that keep you signed in, one that stops a single visitor inflating a hostel's view count, and one that limits how often search can call our language model.",
      "None of them can be read by JavaScript in your browser, and none is used for advertising.",
      "We use no third-party analytics, advertising or tracking cookies, so there is nothing here to opt out of and no consent banner to click through.",
      "You may block cookies in your browser settings, but signing in will not work without the session cookies.",
    ],
  },
];

export function PublicPrivacyPage() {
  const { identity, legal } = useSiteConfig();
  const siteName = identity.siteName;
  const supportEmail = identity.supportEmail;
  const sections = buildSections(siteName);
  const customBody = legal.privacy.body.trim();

  return (
    <PublicShell>
      <div className="mx-auto max-w-3xl px-6 py-20">
        {/* Header */}
        <div className="mb-16 text-center">
          <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-primary/10">
            <Shield className="size-7 text-primary" />
          </div>
          <h1 className="font-heading text-4xl font-bold tracking-tight text-foreground">
            Privacy Policy
          </h1>
          <p className="mt-3 text-muted-foreground">
            Last updated: {legal.privacy.updatedAt || "July 11, 2026"}
          </p>
          <div className="mx-auto mt-4 h-px max-w-xs bg-border" />
        </div>

        {/* Intro */}
        <div className="mb-14 text-sm leading-relaxed text-muted-foreground">
          <p>
            {siteName} (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;us&rdquo;) is
            committed to protecting your privacy. This Privacy Policy explains how we
            collect, use, disclose, and safeguard your information when you use our hostel
            management platform.
          </p>
          <p className="mt-4">
            By using {siteName}, you agree to the collection and use of information in
            accordance with this policy. If you do not agree, please discontinue use of
            the platform.
          </p>
        </div>

        {/* Sections — admin-authored copy replaces the built-in text when set. */}
        <div className="space-y-12">
          {customBody ? <LegalBody body={customBody} /> : null}
          {customBody
            ? null
            : sections.map(({ icon: Icon, title, content }) => (
                <section key={title}>
                  <div className="mb-4 flex items-center gap-3">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
                      <Icon className="size-4.5 text-primary" />
                    </span>
                    <h2 className="font-heading text-lg font-semibold text-foreground">
                      {title}
                    </h2>
                  </div>
                  <ul className="ml-12 space-y-2.5">
                    {content.map((item) => (
                      <li
                        key={item}
                        className="flex items-start gap-3 text-sm leading-relaxed text-muted-foreground"
                      >
                        <span className="mt-1.5 block size-1.5 shrink-0 rounded-full bg-primary/40" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
        </div>

        {/* Contact */}
        <div className="mt-16 rounded-xl border border-border bg-muted/50 p-6 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">Questions about this policy?</p>
          <p className="mt-1">
            {supportEmail ? (
              <>
                Contact our Data Protection team at{" "}
                <a
                  className="text-primary hover:underline"
                  href={`mailto:${supportEmail}`}
                >
                  {supportEmail}
                </a>
              </>
            ) : (
              "Contact our Data Protection team through the in-app support system."
            )}
          </p>
        </div>
      </div>
    </PublicShell>
  );
}
