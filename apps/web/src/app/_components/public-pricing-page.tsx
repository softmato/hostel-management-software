"use client";

/* eslint-disable @typescript-eslint/no-unused-vars */

import {
  AlertCircle,
  AlertCircle as AlertIcon,
  ArrowRight,
  BadgeCheck,
  BedDouble,
  Bell,
  Building2,
  Calendar,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  Eye,
  FileCheck2,
  FileText,
  Filter,
  Grid2X2,
  Heart,
  HelpCircle,
  Home,
  KeyRound,
  List,
  LockKeyhole,
  Mail,
  MapPin,
  MessageSquare,
  Moon,
  MoreVertical,
  Phone,
  PhoneCall,
  Plus,
  QrCode,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Trash2,
  Upload,
  User,
  UserRound,
  Users,
  Utensils,
  Wifi,
  WalletCards,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState, type ReactNode } from "react";

import { useSiteConfig } from "@/components/site-config-provider";
import { cn } from "@/lib/utils";
import {
  AnimatedPage,
  Breadcrumbs,
  FormField,
  HostelCard,
  HostelListCard,
  MetricCard,
  NepalBannerGraphic,
  PublicShell,
  SectionCard,
  StatusPill,
  TableView,
  formatMoney,
  humanize,
  metricIcons,
  type AuthMode,
  type PortalKind,
} from "./shared";

function PublicPricingPageContent() {
  // Plans come from Platform → Website Config → Pricing Plans, so the owner can
  // change tiers without a deploy.
  const { identity, pricing } = useSiteConfig();
  const siteName = identity.siteName;

  const plans = pricing.map((plan) => ({
    ctaHref: plan.ctaHref,
    ctaLabel: plan.ctaLabel,
    desc: plan.description,
    features: plan.features,
    name: plan.name,
    period: plan.period,
    popular: plan.highlighted,
    price: plan.price,
  }));

  // FAQ collapses state
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(0);

  const faqs = [
    {
      q: "Can I change my plan later?",
      a: "Yes, you can upgrade or downgrade your plan at any time. Changes will be reflected in your next billing cycle. If you upgrade, the features will be unlocked immediately.",
    },
    {
      q: "Is there a contract or lock-in period?",
      a: "No, there's no long-term contract. You can cancel your subscription at any time without any termination charges.",
    },
    {
      q: "Do you offer training and support?",
      a: "Yes, all plans include onboarding guidance and 24/7 support via chat, email, and phone. Enterprise plans also include custom training sessions.",
    },
  ];

  return (
    <PublicShell active="pricing">
      <section className="mx-auto max-w-[1240px] px-6 py-12 text-center space-y-12">
        <div className="space-y-4">
          <h1 className="text-4xl font-extrabold text-foreground leading-tight">
            Choose the Right Plan for Your Hostel
          </h1>
          <p className="mx-auto max-w-2xl text-muted-foreground text-sm">
            Simple, transparent pricing built to support hostels of all sizes across
            Nepal.
          </p>
          <div className="flex flex-wrap justify-center gap-6 text-xs font-semibold text-foreground pt-2">
            <span className="flex items-center gap-1.5">
              <Check className="size-4 text-brand-teal" /> No setup fees
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="size-4 text-brand-teal" /> Cancel anytime
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="size-4 text-brand-teal" /> Trusted by 10,000+ hostels
            </span>
          </div>
        </div>

        {/* Pricing Cards Grid */}
        <div className="grid gap-6 md:grid-cols-3">
          {plans.map((plan) => (
            <SectionCard
              className={cn(
                "relative flex flex-col justify-between hover:shadow-lg transition-shadow duration-300",
                plan.popular ? "ring-2 ring-brand-teal" : "",
              )}
              key={plan.name}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-teal px-3 py-1 text-[10px] font-bold text-white uppercase tracking-wider flex items-center gap-1">
                  &#9733; Most Popular
                </span>
              )}
              <div className="p-6 text-left flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center">
                    <h3 className="text-xl font-bold text-foreground">{plan.name}</h3>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground min-h-[36px]">
                    {plan.desc}
                  </p>
                  <p className="mt-5 text-3xl font-extrabold text-foreground">
                    {plan.price}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      {plan.period}
                    </span>
                  </p>
                  <ul className="mt-6 space-y-3 text-xs text-muted-foreground border-t border-border/40 pt-5">
                    {plan.features.map((item) => (
                      <li className="flex items-start gap-2" key={item}>
                        <Check className="size-4 text-brand-teal shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <Link
                  className={cn(
                    "mt-8 inline-flex w-full justify-center rounded-lg py-3 text-sm font-semibold shadow transition-all duration-200",
                    plan.popular
                      ? "bg-brand-teal text-white hover:brightness-110"
                      : "bg-surface border border-brand-teal text-brand-teal hover:bg-brand-teal/5",
                  )}
                  href={{
                    pathname: plan.ctaHref,
                    query: { plan: plan.name.toLowerCase() },
                  }}
                >
                  {plan.ctaLabel}
                </Link>
              </div>
            </SectionCard>
          ))}
        </div>

        {/* Feature comparison table */}
        <div className="space-y-6 pt-10 text-left">
          <h3 className="text-xl font-bold text-foreground">Compare Plans</h3>
          <div className="border border-border rounded-xl bg-surface overflow-hidden shadow-sm">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                {/* Column headers follow the configured plans so this table can
                    never drift from the cards above it. */}
                <tr className="bg-muted border-b border-border text-foreground font-bold">
                  <th className="p-4 w-[40%]">Features & Modules</th>
                  {plans.map((plan) => (
                    <th className="p-4" key={plan.name}>
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 text-muted-foreground">
                {[
                  [`Public Hostel Listing on ${siteName}`, true, true, true],
                  ["Resident Management & Room Allocation", true, true, true],
                  ["Fee Tracking & Payments Receipts", true, true, true],
                  ["Food Menu Management", true, true, true],
                  ["Complaints & Feedback Pipeline", true, true, true],
                  ["Maintenance & Service Providers", true, true, true],
                  ["Reports & Advanced Analytics", true, true, true],
                  ["Guardian portal Access", true, true, true],
                  ["Custom Branding & Subdomains", false, false, true],
                  ["Priority Onboarding & Multi-warden Roles", false, true, true],
                ].map(([label, ...tiers]) => (
                  <tr key={label as string} className="hover:bg-muted/50">
                    <td className="p-4 font-medium text-foreground">{label as string}</td>
                    {plans.map((plan, index) => (
                      <td className="p-4" key={plan.name}>
                        {tiers[index] ? (
                          <Check className="size-4.5 text-brand-teal" />
                        ) : (
                          "-"
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Frequently Asked Questions */}
        <div className="space-y-6 pt-10 text-left max-w-3xl mx-auto">
          <h3 className="text-xl font-bold text-foreground text-center">
            Frequently Asked Questions
          </h3>
          <div className="space-y-3">
            {faqs.map((faq, idx) => (
              <div
                className="border border-border rounded-lg bg-surface overflow-hidden"
                key={idx}
              >
                <button
                  onClick={() => setOpenFaqIdx(openFaqIdx === idx ? null : idx)}
                  className="w-full flex items-center justify-between p-4 font-semibold text-foreground text-sm hover:bg-muted/50 transition text-left"
                >
                  <span>{faq.q}</span>
                  {openFaqIdx === idx ? (
                    <ChevronUp className="size-4" />
                  ) : (
                    <ChevronDown className="size-4" />
                  )}
                </button>
                {openFaqIdx === idx && (
                  <div className="px-4 pb-4 text-xs text-muted-foreground leading-relaxed border-t border-border/40 pt-3 bg-muted/30">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Bottom CTA Card */}
        <div className="rounded-xl border border-brand-teal/20 bg-brand-teal/5 p-6 md:p-8 flex flex-col md:flex-row justify-between items-center gap-6 text-left">
          <div>
            <h4 className="font-bold text-lg text-foreground">
              Ready to grow your hostel with {siteName}?
            </h4>
            <p className="text-xs text-muted-foreground mt-1 max-w-xl">
              Join thousands of hostel owners across Nepal who trust {siteName} to manage
              room inventory, track resident monthly fees, issue digital notices, and
              publish listings.
            </p>
          </div>
          <Link
            className="rounded-lg bg-brand-teal px-6 py-3 text-xs font-bold text-white shadow hover:brightness-115 transition whitespace-nowrap"
            href="/hostels/register"
          >
            Start Your Registration &rarr;
          </Link>
        </div>
      </section>
    </PublicShell>
  );
}

export function PublicPricingPage() {
  return (
    <Suspense fallback={null}>
      <PublicPricingPageContent />
    </Suspense>
  );
}
