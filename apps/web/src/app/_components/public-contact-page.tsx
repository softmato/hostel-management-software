"use client";

import { PublicShell } from "@/app/_components/shared";
import {
  useSiteConfig,
  type PublicSiteConfig,
} from "@/components/site-config-provider";
import { Mail, Phone, MapPin, Clock, MessageSquare, HelpCircle } from "lucide-react";

type SiteIdentity = PublicSiteConfig["identity"];

const buildContactMethods = (identity: SiteIdentity) => [
  {
    icon: Mail,
    title: "Email",
    details: [identity.supportEmail].filter(Boolean),
    description: "We respond within 24 hours on business days.",
  },
  {
    icon: Phone,
    title: "Phone",
    details: [identity.supportPhone].filter(Boolean),
    description: "Available Monday to Friday, 9 AM — 5 PM NPT.",
  },
  {
    icon: MapPin,
    title: "Office",
    details: [identity.address].filter(Boolean),
    description: "Walk-ins welcome during business hours.",
  },
  {
    icon: Clock,
    title: "Business Hours",
    details: ["Sunday — Friday: 9 AM — 5 PM", "Saturday: Closed"],
    description: "Nepal Time (NPT, UTC+5:45).",
  },
];

const buildFaqs = (siteName: string) => [
  {
    question: "How do I create an account?",
    answer:
      "Click the Sign Up button on the top right corner of any page. Fill in your details, verify your email or phone via OTP, and you are ready to go.",
  },
  {
    question: "How do I list my hostel?",
    answer:
      "Navigate to the Register Hostel page and fill out the registration form. Our team will review and verify your listing within 2–3 business days.",
  },
  {
    question: "Can I update my personal information?",
    answer:
      "Yes, you can update your name, email, phone, and profile photo from your account settings after logging in.",
  },
  {
    question: "How do I report an issue with a hostel?",
    answer:
      "Use the inquiry system on the hostel detail page, or reach out to our support team directly via email or phone.",
  },
  {
    question: `Is my data secure on ${siteName}?`,
    answer:
      "Absolutely. We use encryption for all data in transit and at rest, and we never share your personal information with third parties without your consent.",
  },
];

export function PublicContactPage() {
  // Support channels come from Platform → Website Config → Site Identity.
  const { identity } = useSiteConfig();
  const contactMethods = buildContactMethods(identity);
  const faqs = buildFaqs(identity.siteName);

  return (
    <PublicShell>
      <div className="mx-auto max-w-3xl px-6 py-20">
        {/* Header */}
        <div className="mb-16 text-center">
          <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-primary/10">
            <MessageSquare className="size-7 text-primary" />
          </div>
          <h1 className="font-heading text-4xl font-bold tracking-tight text-foreground">
            Contact Us
          </h1>
          <p className="mt-3 text-muted-foreground">
            We are here to help — get in touch with the {identity.siteName} team
          </p>
          <div className="mx-auto mt-4 h-px max-w-xs bg-border" />
        </div>

        {/* Contact Methods */}
        <div className="mb-16 grid gap-6 sm:grid-cols-2">
          {contactMethods.map(({ icon: Icon, title, details, description }) => (
            <div
              key={title}
              className="rounded-xl border border-border bg-surface p-5 shadow-sm"
            >
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 mb-4">
                <Icon className="size-5 text-primary" />
              </span>
              <h3 className="font-heading font-semibold text-foreground">{title}</h3>
              <ul className="mt-2 space-y-1">
                {details.map((detail) => (
                  <li key={detail} className="text-sm font-medium text-primary">
                    {detail}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>

        {/* FAQ */}
        <h2 className="mb-6 font-heading text-2xl font-bold text-foreground">
          Frequently Asked Questions
        </h2>
        <div className="space-y-4">
          {faqs.map(({ question, answer }) => (
            <details
              key={question}
              className="group rounded-xl border border-border bg-surface p-5 shadow-sm open:shadow-md"
            >
              <summary className="flex cursor-pointer items-center justify-between gap-4 text-sm font-semibold text-foreground">
                <span className="flex items-center gap-2">
                  <HelpCircle className="size-4 text-primary shrink-0" />
                  {question}
                </span>
                <span className="shrink-0 text-muted-foreground transition group-open:rotate-180">
                  ▼
                </span>
              </summary>
              <p className="mt-3 ml-6 text-sm leading-relaxed text-muted-foreground">
                {answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </PublicShell>
  );
}
