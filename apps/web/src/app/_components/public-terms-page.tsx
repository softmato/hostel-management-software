"use client";

import { PublicShell } from "@/app/_components/shared";
import { LegalBody } from "@/components/legal-body";
import { useSiteConfig } from "@/components/site-config-provider";
import {
  FileText,
  UserCheck,
  Home,
  CreditCard,
  Ban,
  AlertTriangle,
  Scale,
  Mail,
} from "lucide-react";

const buildSections = (siteName: string) => [
  {
    icon: FileText,
    title: "Acceptance of Terms",
    content: [
      `By accessing or using ${siteName}, you agree to be bound by these Terms & Regulations.`,
      "If you do not agree with any part of these terms, you must not use the platform.",
      `${siteName} reserves the right to update these terms at any time. Users will be notified of material changes via email or platform notice.`,
      "Continued use of the platform after changes constitutes acceptance of the updated terms.",
    ],
  },
  {
    icon: UserCheck,
    title: "User Accounts & Responsibilities",
    content: [
      "You must provide accurate, current, and complete information when creating an account.",
      "You are solely responsible for maintaining the confidentiality of your login credentials.",
      "Sharing your account with unauthorised individuals is strictly prohibited.",
      `You must notify ${siteName} immediately of any unauthorised use of your account.`,
      "Each user may hold only one active account unless otherwise authorised.",
      `Users must be at least 16 years of age to create an account on ${siteName}.`,
    ],
  },
  {
    icon: Home,
    title: "Hostel Listing Rules",
    content: [
      "All hostel listings must include accurate and up-to-date information including pricing, availability, and facilities.",
      "Photos submitted must be genuine representations of the property — stock photos or misleading imagery are prohibited.",
      "Hostel admins are responsible for keeping room inventory, pricing, and vacancy status current.",
      "Any form of discriminatory listing criteria based on caste, religion, gender, or ethnicity is strictly forbidden.",
      `${siteName} reserves the right to remove or suspend listings that violate these rules.`,
    ],
  },
  {
    icon: CreditCard,
    title: "Payments & Financial Terms",
    content: [
      `All fee payments processed through ${siteName} are subject to the stated service charges.`,
      `${siteName} uses third-party payment processors and is not liable for any issues arising from their services.`,
      `Refund policies are determined by individual hostels — ${siteName} does not guarantee refunds.`,
      "Platform owners and hostel admins are responsible for accurate financial reporting and tax compliance.",
      "Any disputes regarding payments must be raised within 14 days of the transaction date.",
    ],
  },
  {
    icon: Ban,
    title: "Prohibited Activities",
    content: [
      "Using the platform for any unlawful purpose or in violation of any applicable laws.",
      "Attempting to gain unauthorised access to any part of the platform, user accounts, or systems.",
      "Uploading or transmitting viruses, malware, or any code designed to disrupt the platform.",
      `Harassing, threatening, or abusing other users, hostel staff, or ${siteName} personnel.`,
      "Engaging in any activity that interferes with or disrupts the platform's services.",
      "Using bots, scrapers, or automated tools to extract data without prior written consent.",
    ],
  },
  {
    icon: AlertTriangle,
    title: "Limitation of Liability",
    content: [
      `${siteName} is provided &ldquo;as is&rdquo; without warranties of any kind, either express or implied.`,
      "We do not guarantee that the platform will be uninterrupted, secure, or error-free at all times.",
      `${siteName} is not responsible for the actions, conduct, or content of hostel admins, residents, or guardians.`,
      `In no event shall ${siteName} be liable for any indirect, incidental, or consequential damages.`,
      `The total liability of ${siteName} for any claims shall not exceed the fees paid by you in the preceding 12 months.`,
    ],
  },
  {
    icon: Scale,
    title: "Dispute Resolution",
    content: [
      "Any disputes arising from these terms shall first be attempted to be resolved through informal negotiation.",
      "If a dispute cannot be resolved informally, it shall be settled by binding arbitration in Kathmandu, Nepal.",
      "Users agree to resolve disputes on an individual basis — class actions are waived to the extent permitted by law.",
      "These terms are governed by the laws of Nepal, without regard to its conflict of law provisions.",
    ],
  },
  {
    icon: Mail,
    title: "Contact & Support",
    content: [
      "For questions about these terms, contact us at support@hostelhub.com.",
      `Legal notices should be sent to: ${siteName} Legal, Kathmandu, Nepal.`,
      "Response times for legal inquiries are typically within 5–7 business days.",
      "For urgent platform issues, use the in-app support system for fastest resolution.",
    ],
  },
];

export function PublicTermsPage() {
  const { legal } = useSiteConfig();
  const siteName = useSiteConfig().identity.siteName;
  const sections = buildSections(siteName);
  const customBody = legal.terms.body.trim();

  return (
    <PublicShell>
      <div className="mx-auto max-w-3xl px-6 py-20">
        {/* Header */}
        <div className="mb-16 text-center">
          <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-primary/10">
            <Scale className="size-7 text-primary" />
          </div>
          <h1 className="font-heading text-4xl font-bold tracking-tight text-foreground">
            Terms &amp; Regulations
          </h1>
          <p className="mt-3 text-muted-foreground">
            Last updated: {legal.terms.updatedAt || "July 11, 2026"}
          </p>
          <div className="mx-auto mt-4 h-px max-w-xs bg-border" />
        </div>

        {/* Intro */}
        <div className="mb-14 text-sm leading-relaxed text-muted-foreground">
          <p>
            Welcome to {siteName}. These Terms &amp; Regulations (&ldquo;Terms&rdquo;)
            govern your access to and use of the {siteName} platform, including any related
            services, content, and functionality offered through our website and mobile
            applications.
          </p>
          <p className="mt-4">
            Please read these terms carefully before using the platform. Depending on your
            role — hostel admin, resident, guardian, or service provider — additional
            role-specific terms may apply.
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
          <p className="font-semibold text-foreground">Have questions?</p>
          <p className="mt-1">
            Reach out to our support team at{" "}
            <a
              className="text-primary hover:underline"
              href="mailto:support@hostelhub.com"
            >
              support@hostelhub.com
            </a>{" "}
            or use the in-app support system.
          </p>
        </div>
      </div>
    </PublicShell>
  );
}
