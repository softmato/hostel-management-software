"use client";

import { PublicShell } from "@/app/_components/shared";
import { Building2, Shield, Users, Target, Eye, Heart } from "lucide-react";

const values = [
  {
    icon: Shield,
    title: "Trust & Transparency",
    content:
      "We believe every student deserves honest, verified information about their accommodation. Every listing on HostelHub goes through a verification process to ensure accuracy.",
  },
  {
    icon: Users,
    title: "Student First",
    content:
      "Everything we build starts with the student experience — from easy search and comparison tools to seamless communication with hostel teams.",
  },
  {
    icon: Target,
    title: "Innovation",
    content:
      "We are modernising Nepal&apos;s hostel ecosystem with digital tools for payments, complaints, food feedback, and real-time vacancy tracking.",
  },
  {
    icon: Eye,
    title: "Accountability",
    content:
      "Hostel admins, wardens, and platform owners are held to clear standards. Our audit-logged system ensures every action is traceable.",
  },
  {
    icon: Heart,
    title: "Community",
    content:
      "HostelHub connects not just students to hostels, but also families, guardians, and local service providers into one trusted network.",
  },
  {
    icon: Building2,
    title: "Local First",
    content:
      "Built for Nepal, by a team that understands the local landscape. We design for Nepali students, hostel culture, and the unique needs of the valley.",
  },
];

export function PublicAboutPage() {
  return (
    <PublicShell>
      <div className="mx-auto max-w-3xl px-6 py-20">
        {/* Header */}
        <div className="mb-16 text-center">
          <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-primary/10">
            <Building2 className="size-7 text-primary" />
          </div>
          <h1 className="font-heading text-4xl font-bold tracking-tight text-foreground">
            About HostelHub
          </h1>
          <p className="mt-3 text-muted-foreground">
            Our mission, our values, and the team behind Nepal&apos;s hostel platform
          </p>
          <div className="mx-auto mt-4 h-px max-w-xs bg-border" />
        </div>

        {/* Intro */}
        <div className="mb-14 text-sm leading-relaxed text-muted-foreground">
          <p>
            HostelHub was founded with a simple goal — make finding and managing student
            accommodation in Nepal easy, transparent, and trustworthy. What started as a
            directory has grown into a full-featured platform serving students, hostel
            owners, wardens, and guardians across the country.
          </p>
          <p className="mt-4">
            Today, HostelHub powers hundreds of verified hostel listings, processes
            thousands of inquiries every month, and provides hostel teams with modern
            tools to manage rooms, residents, payments, food quality, and safety.
          </p>
          <p className="mt-4">
            We are headquartered in Kathmandu, Nepal, and our team is passionate about
            using technology to solve real problems for students and hostel operators
            alike.
          </p>
        </div>

        {/* Values */}
        <h2 className="mb-8 font-heading text-2xl font-bold text-foreground">
          Our Values
        </h2>
        <div className="space-y-10">
          {values.map(({ icon: Icon, title, content }) => (
            <section key={title}>
              <div className="mb-3 flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="size-4.5 text-primary" />
                </span>
                <h3 className="font-heading text-lg font-semibold text-foreground">
                  {title}
                </h3>
              </div>
              <p className="ml-12 text-sm leading-relaxed text-muted-foreground">
                {content}
              </p>
            </section>
          ))}
        </div>

        {/* Contact */}
        <div className="mt-16 rounded-xl border border-border bg-muted/50 p-6 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">Want to know more?</p>
          <p className="mt-1">
            Reach out at{" "}
            <a className="text-primary hover:underline" href="mailto:hello@hostelhub.com">
              hello@hostelhub.com
            </a>{" "}
            or visit our office in Kathmandu, Nepal.
          </p>
        </div>
      </div>
    </PublicShell>
  );
}
