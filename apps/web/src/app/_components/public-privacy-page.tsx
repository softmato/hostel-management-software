"use client";

import { PublicShell } from "@/app/_components/shared";
import { LegalBody } from "@/components/legal-body";
import { useSiteConfig } from "@/components/site-config-provider";
import { Shield, Lock, Eye, Database, Mail, Globe } from "lucide-react";

const buildSections = (siteName: string) => [
  {
    icon: Database,
    title: "Information We Collect",
    content: [
      "Personal information you provide when creating an account (name, email, phone number, role).",
      "Hostel details, photos, pricing, and facility information submitted by hostel admins.",
      "Resident data including room assignments, fee records, food preferences, and complaint history.",
      "Guardian information provided for resident emergency contacts and account linking.",
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
      "Access to personal data is restricted to authorised personnel only.",
      "We regularly review and update our security practices to maintain data integrity.",
      "In the event of a data breach, affected users will be notified within 72 hours.",
    ],
  },
  {
    icon: Mail,
    title: "Your Rights & Choices",
    content: [
      "You may access, update, or delete your personal information at any time through your account settings.",
      "Residents may request a copy of all data stored by their hostel admin.",
      "You can opt out of non-essential communications via your notification preferences.",
      "Account deletion requests are processed within 30 days of verification.",
      "You have the right to file a complaint with your local data protection authority.",
    ],
  },
  {
    icon: Globe,
    title: "Cookies & Tracking",
    content: [
      "We use essential cookies to maintain your session and keep you logged in.",
      "Analytics cookies help us understand how the platform is used and where to improve.",
      "You may disable cookies in your browser settings, though some features may not function as intended.",
      "We do not use third-party tracking cookies for advertising purposes.",
      "Cookie preferences can be managed at any time from your account settings page.",
    ],
  },
];

export function PublicPrivacyPage() {
  const { legal } = useSiteConfig();
  const siteName = useSiteConfig().identity.siteName;
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
            Contact our Data Protection team at{" "}
            <a
              className="text-primary hover:underline"
              href="mailto:privacy@hostelhub.com"
            >
              privacy@hostelhub.com
            </a>
          </p>
        </div>
      </div>
    </PublicShell>
  );
}
