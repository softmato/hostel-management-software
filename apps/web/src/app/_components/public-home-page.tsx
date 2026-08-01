"use client";

import {
  ArrowRight,
  Bath,
  BookOpen,
  Cctv,
  CheckCircle2,
  Droplet,
  Headphones,
  Home,
  LockKeyhole,
  MessageSquare,
  MoreHorizontal,
  Search,
  ShieldCheck,
  Shirt,
  SquareParking,
  Star,
  Tag,
  User,
  UserRound,
  Users,
  Utensils,
  Wifi,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { useSiteConfig } from "@/components/site-config-provider";
import { checkAuthWithRefresh } from "@/lib/auth-check";
import { landingPathForRole } from "@/lib/route-access";
import { Role } from "@/lib/roles";

import { cn } from "@/lib/utils";
import type { HostelSummary } from "./public-hostel-types";
import { HostelCard, PublicShell, StatusPill, formatMoney } from "./shared";
import { FACILITY_STATS, HOSTEL_TYPE_STATS } from "./public-home-content";

const PUBLIC_HERO_IMAGE =
  "https://images.unsplash.com/photo-1555854877-bab0e564b8d5?auto=format&fit=crop&w=1600&q=80";

const DASHBOARD_ROLES = new Set([
  Role.SUPERADMIN,
  Role.PLATFORM_MODERATOR,
  Role.HOSTEL_ADMIN,
  Role.WARDEN,
  Role.RESIDENT,
  Role.GUARDIAN,
]);

const BUDGET_THRESHOLD = 8000;

const HOSTEL_TYPE_ICONS: Record<string, { icon: LucideIcon; tone: string }> = {
  boys: { icon: User, tone: "bg-emerald-50 text-emerald-600" },
  girls: { icon: UserRound, tone: "bg-rose-50 text-rose-600" },
  "co-living": { icon: Users, tone: "bg-role-platform-soft text-role-platform" },
};

const FACILITY_ICONS: Record<string, LucideIcon> = {
  "Attached Bathroom": Bath,
  CCTV: Cctv,
  "Food Included": Utensils,
  Generator: Zap,
  "Hot Water": Droplet,
  Laundry: Shirt,
  Parking: SquareParking,
  "Study Room": BookOpen,
  WiFi: Wifi,
};

/** Icon names an admin can type in Website Config → Site Content → Trust Points. */
const TRUST_ICONS_BY_NAME: Record<string, LucideIcon> = {
  headphones: Headphones,
  lock: LockKeyhole,
  shield: ShieldCheck,
  star: Star,
  tag: Tag,
  users: Users,
  wallet: Tag,
};

const TRUST_ICON_FALLBACKS: LucideIcon[] = [
  ShieldCheck,
  Tag,
  LockKeyhole,
  Star,
  Users,
  Headphones,
];

function pluralHostels(count: number) {
  return `${count} ${count === 1 ? "hostel" : "hostels"}`;
}

function SectionHeading({
  title,
  subtitle,
  action,
  actionHref,
}: {
  title: string;
  subtitle: string;
  action?: string;
  actionHref?: string;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-xl font-extrabold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
      {action && actionHref ? (
        <Link
          className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-brand-teal hover:underline"
          href={actionHref}
        >
          {action} <ArrowRight className="size-3.5" />
        </Link>
      ) : null}
    </div>
  );
}

/**
 * One row of hostel cards. Every row on this page is a slice of the same
 * server-rendered set, so they share one empty treatment — a row that simply
 * renders nothing reads as a broken page.
 */
function HostelRow({
  emptyLabel,
  hostels,
}: {
  emptyLabel: string;
  hostels: HostelSummary[];
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {hostels.length === 0 ? (
        <div className="col-span-full rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        hostels.map((hostel) => <HostelCard hostel={hostel} key={hostel.id} />)
      )}
    </div>
  );
}

function PublicHomePageContent({ hostels }: { hostels: HostelSummary[] }) {
  const router = useRouter();
  const { features, hero, identity, locations, social, trustPoints } = useSiteConfig();
  const cityOptions = locations.map((location) => location.city);
  const [searchVal, setSearchVal] = useState("");
  const [selectedCity, setSelectedCity] = useState(cityOptions[0] ?? "Kathmandu");

  useEffect(() => {
    async function redirectIfDashboardRole() {
      try {
        const response = await checkAuthWithRefresh();
        if (!response.ok) return;
        const payload = await response.json().catch(() => null);
        if (!payload?.success) return;
        const role = payload.data.user.role as Role;
        if (DASHBOARD_ROLES.has(role)) {
          const path = landingPathForRole(role);
          if (path) router.replace(path);
        }
      } catch {
        // not authenticated — stay on page
      }
    }
    void redirectIfDashboardRole();
  }, [router]);

  const byRating = useMemo(
    () => [...hostels].sort((a, b) => b.rating - a.rating || b.reviews - a.reviews),
    [hostels],
  );

  const featuredHostels = byRating.slice(0, 4);

  const popularHostels = useMemo(
    () => byRating.filter((hostel) => hostel.city === selectedCity).slice(0, 4),
    [byRating, selectedCity],
  );

  const budgetHostels = useMemo(
    () =>
      hostels
        .filter((hostel) => hostel.price > 0 && hostel.price <= BUDGET_THRESHOLD)
        .sort((a, b) => a.price - b.price)
        .slice(0, 4),
    [hostels],
  );

  // "Newly listed" is the tail of the API's own ordering (newest first), so it
  // needs no extra field on the hostel.
  const newlyListedHostels = hostels.slice(0, 4);

  // The category tiles carry counts. Those have to be counted, not asserted —
  // a tile promising "125 hostels" that opens onto three is worse than no tile.
  const typeCounts = useMemo(() => {
    const counts = new Map<HostelSummary["type"], number>();
    for (const hostel of hostels) {
      counts.set(hostel.type, (counts.get(hostel.type) ?? 0) + 1);
    }
    return counts;
  }, [hostels]);

  const facilityCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const hostel of hostels) {
      for (const facility of new Set(hostel.facilities)) {
        counts.set(facility, (counts.get(facility) ?? 0) + 1);
      }
    }
    return counts;
  }, [hostels]);

  const heroHostel = featuredHostels[0];

  // Footer links follow the owner's feature flags — a surface that is switched
  // off in Website Config shouldn't still be advertised down here.
  const socialLinks: Array<[string, string]> = (
    [
      ["Facebook", social.facebook],
      ["Instagram", social.instagram],
      ["YouTube", social.youtube],
      ["TikTok", social.tiktok],
      ["LinkedIn", social.linkedin],
      ["Website", social.website],
    ] satisfies Array<[string, string]>
  ).filter(([, href]) => Boolean(href));

  const footerGroups = [
    {
      links: [
        ["Browse hostels", "/hostels"],
        ...(features.compare ? [["Compare hostels", "/compare"]] : []),
        ...(features.inquiries ? [["Send inquiry", "/inquiry"]] : []),
      ],
      title: "Explore",
    },
    {
      links: [
        ...(features.publicRegistration
          ? [["Hostel registration", "/hostels/register"]]
          : []),
        ...(features.serviceProviderSignup
          ? [["Service providers", "/service-providers/register"]]
          : []),
        ["Pricing", "/pricing"],
      ],
      title: "Partners",
    },
    {
      links: [
        ["About us", "/#about"],
        ["Contact", "/#contact"],
        ["Login", "/login"],
      ],
      title: "Company",
    },
  ];

  return (
    <PublicShell>
      <section className="relative w-full overflow-hidden bg-background -mt-16">
        {/* Right side background image with smooth fade on the left */}
        <div className="absolute right-0 top-0 hidden h-full w-[54%] lg:block">
          <div
            className="h-full w-full bg-cover bg-center"
            style={{ backgroundImage: `url("${PUBLIC_HERO_IMAGE}")` }}
          />
          {/* Fading overlay from white to transparent (left-to-right) */}
          <div className="absolute inset-y-0 left-0 w-48 bg-gradient-to-r from-background via-background/80 to-transparent" />

          {/* Slider Dots */}
          <div className="absolute bottom-10 left-[45%] flex gap-2">
            <span className="size-2 rounded-full bg-background" />
            <span className="size-2 rounded-full bg-background/40" />
          </div>
        </div>

        <div className="mx-auto relative z-10 grid min-h-[75vh] max-w-[1448px] gap-10 px-6 pt-32 pb-12 lg:grid-cols-[0.88fr_1fr] lg:items-center">
          <div className="py-10">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3.5 py-1.5 text-xs font-semibold text-foreground shadow-sm">
              <ShieldCheck className="size-4 text-brand-teal" />
              Trusted by Students & Families
            </span>
            <h1 className="mt-8 max-w-xl font-heading text-5xl lg:text-[56px] font-extrabold leading-[1.15] text-foreground">
              {hero.headline}
            </h1>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
              {hero.subheadline}
            </p>
            <div className="mt-8 flex max-w-lg items-center gap-2 rounded-lg border border-border bg-card p-1.5 shadow-md focus-within:border-brand-teal focus-within:ring-2 focus-within:ring-brand-teal/15 transition">
              <Search className="ml-3 size-5 text-muted-foreground" />
              <input
                className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                onChange={(e) => setSearchVal(e.target.value)}
                placeholder={hero.searchPlaceholder}
                value={searchVal}
              />
              <Link
                className="rounded-md bg-brand-teal px-7 py-3 text-sm font-bold text-white hover:brightness-105 transition shrink-0"
                href={{
                  pathname: "/hostels",
                  query: searchVal ? { search: searchVal } : {},
                }}
              >
                Search
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-6 text-xs font-bold text-foreground">
              {[
                { label: "Verified Hostels", icon: CheckCircle2 },
                { label: "Trusted by Students", icon: CheckCircle2 },
                { label: "Easy & Secure", icon: CheckCircle2 },
              ].map((item) => (
                <span className="inline-flex items-center gap-1.5" key={item.label}>
                  <item.icon className="size-4 text-brand-teal" />
                  {item.label}
                </span>
              ))}
            </div>
          </div>

          <div className="relative flex justify-end lg:pr-8 py-10">
            {/* Overlay card matching the reference image */}
            <div className="rounded-xl border border-border/80 bg-card/95 backdrop-blur-sm p-4 shadow-2xl flex gap-4 w-[320px] mt-36 transition hover:scale-[1.01]">
              <div
                className="size-24 rounded-lg bg-cover bg-center shrink-0 shadow-sm"
                style={{
                  backgroundImage: `url("${heroHostel?.image ?? PUBLIC_HERO_IMAGE}")`,
                }}
              />
              <div className="flex-1 flex flex-col justify-between py-0.5 min-w-0">
                <div>
                  <h4
                    className="font-bold text-sm text-foreground truncate"
                    title={heroHostel?.name ?? "Verified hostel"}
                  >
                    {heroHostel?.name ?? "Verified hostel"}
                  </h4>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                    <Star className="size-3 fill-warning text-warning" />
                    <span className="font-bold text-foreground">
                      {heroHostel?.rating ? heroHostel.rating.toFixed(1) : "New"}
                    </span>
                    <span className="text-muted-foreground font-normal">
                      ({heroHostel?.reviews ?? 0})
                    </span>
                    <StatusPill
                      tone="success"
                      className="ml-auto text-[8px] py-0 px-1 rounded-sm font-bold"
                    >
                      Verified
                    </StatusPill>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground font-semibold truncate">
                    {heroHostel
                      ? `${heroHostel.area}, ${heroHostel.city}`
                      : "Published hostels appear here"}
                  </p>
                </div>
                <p className="mt-1 font-bold text-foreground text-xs">
                  {heroHostel ? formatMoney(heroHostel.price) : "NPR --"}{" "}
                  <span className="font-normal text-[10px] text-muted-foreground">
                    / month
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Featured verified hostels */}
      <section className="mx-auto max-w-[1448px] px-6 pb-12 pt-4">
        <SectionHeading
          action="View all hostels"
          actionHref="/hostels"
          subtitle="Top-rated and verified hostels for students"
          title="Featured Verified Hostels"
        />
        <HostelRow
          emptyLabel="No hostels are published yet. Check back soon."
          hostels={featuredHostels}
        />
      </section>

      {/* Popular near you */}
      <section className="bg-surface py-12">
        <div className="mx-auto max-w-[1448px] px-6">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-extrabold text-foreground">
                Popular in {selectedCity}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Explore the most loved hostels in your chosen city
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {cityOptions.map((city) => (
                <button
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-xs font-bold transition",
                    city === selectedCity
                      ? "border-brand-teal bg-brand-teal text-white"
                      : "border-border bg-card text-foreground hover:border-brand-teal/40",
                  )}
                  key={city}
                  onClick={() => setSelectedCity(city)}
                  type="button"
                >
                  {city}
                </button>
              ))}
              <Link
                className="inline-flex items-center gap-1 pl-2 text-xs font-bold text-brand-teal hover:underline"
                href="/hostels"
              >
                View all <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </div>
          <HostelRow
            emptyLabel={`No hostels listed in ${selectedCity} yet.`}
            hostels={popularHostels}
          />
        </div>
      </section>

      {/* Browse by hostel type */}
      <section className="mx-auto max-w-[1448px] px-6 py-12">
        <SectionHeading
          action="View all types"
          actionHref="/hostels"
          subtitle="Find the perfect space that suits your lifestyle"
          title="Browse by Hostel Type"
        />
        <div className="grid gap-4 sm:grid-cols-3">
          {HOSTEL_TYPE_STATS.map((item) => {
            const meta = HOSTEL_TYPE_ICONS[item.type];
            const Icon = meta.icon;
            return (
              <Link
                className="group flex items-start justify-between gap-3 rounded-xl border border-border/80 bg-surface p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-teal/40 hover:shadow-md"
                href={{ pathname: "/hostels", query: { type: item.type } }}
                key={item.type}
              >
                <div className="flex items-start gap-4">
                  <span
                    className={cn(
                      "flex size-12 shrink-0 items-center justify-center rounded-xl",
                      meta.tone,
                    )}
                  >
                    <Icon className="size-6" />
                  </span>
                  <div>
                    <p className="font-extrabold text-sm text-foreground">{item.label}</p>
                    <p className="text-[11px] font-bold text-muted-foreground">
                      {pluralHostels(typeCounts.get(item.type) ?? 0)}
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground max-w-[180px]">
                      {item.description}
                    </p>
                  </div>
                </div>
                <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-brand-teal" />
              </Link>
            );
          })}
        </div>
      </section>

      {/* Budget friendly picks */}
      <section className="bg-surface py-12">
        <div className="mx-auto max-w-[1448px] px-6">
          <SectionHeading
            action="View all"
            actionHref="/hostels"
            subtitle={`Great hostels under ${formatMoney(BUDGET_THRESHOLD)}/month`}
            title="Budget-Friendly Picks"
          />
          <HostelRow
            emptyLabel={`No hostels under ${formatMoney(BUDGET_THRESHOLD)} a month right now.`}
            hostels={budgetHostels}
          />
        </div>
      </section>

      {/* Newly listed */}
      <section className="mx-auto max-w-[1448px] px-6 py-12">
        <SectionHeading
          action="View all"
          actionHref="/hostels"
          subtitle="Recently added hostels"
          title="Newly Listed"
        />
        <HostelRow
          emptyLabel="No hostels are published yet. Check back soon."
          hostels={newlyListedHostels}
        />
      </section>

      {/* Browse by facility */}
      <section className="bg-surface py-12">
        <div className="mx-auto max-w-[1448px] px-6">
          <SectionHeading
            action="View all facilities"
            actionHref="/hostels"
            subtitle="Find hostels with the facilities you need"
            title="Browse by Facility"
          />
          <div className="flex flex-wrap gap-3">
            {FACILITY_STATS.map((facility) => {
              const Icon = FACILITY_ICONS[facility.label] ?? Wifi;
              return (
                <Link
                  className="flex min-w-[120px] flex-1 items-center gap-3 rounded-xl border border-border/80 bg-card px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-teal/40 hover:shadow-md"
                  href={{ pathname: "/hostels", query: { facility: facility.label } }}
                  key={facility.label}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-teal-soft/40 text-brand-teal">
                    <Icon className="size-4" />
                  </span>
                  <div>
                    <p className="text-xs font-bold text-foreground">{facility.label}</p>
                    <p className="text-[10px] font-semibold text-muted-foreground">
                      {pluralHostels(facilityCounts.get(facility.label) ?? 0)}
                    </p>
                  </div>
                </Link>
              );
            })}
            <Link
              className="flex size-[52px] shrink-0 items-center justify-center rounded-xl border border-border/80 bg-card text-muted-foreground shadow-sm transition hover:border-brand-teal/40 hover:text-brand-teal"
              href="/hostels"
            >
              <MoreHorizontal className="size-5" />
            </Link>
          </div>
        </div>
      </section>

      {/* Why students trust HostelHub */}
      <section className="bg-muted/40 py-14">
        <div className="mx-auto max-w-[1448px] px-6 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-teal text-white">
            <ShieldCheck className="size-6" />
          </span>
          <h2 className="mt-4 font-heading text-2xl font-extrabold text-foreground sm:text-3xl">
            Why students trust {identity.siteName}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            We prioritise your safety, comfort, and peace of mind.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {trustPoints.map((point, index) => {
              const Icon =
                TRUST_ICONS_BY_NAME[point.icon.toLowerCase()] ??
                TRUST_ICON_FALLBACKS[index % TRUST_ICON_FALLBACKS.length];
              return (
                <div
                  className="rounded-xl border border-border/80 bg-card p-5 text-left shadow-sm"
                  key={point.title}
                >
                  <span className="flex size-11 items-center justify-center rounded-full bg-brand-teal-soft/40 text-brand-teal">
                    <Icon className="size-5" />
                  </span>
                  <p className="mt-4 text-sm font-extrabold text-foreground">
                    {point.title}
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    {point.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto mb-12 mt-12 max-w-[1448px] px-6">
        <div className="rounded-xl border border-border/80 bg-surface p-8 shadow-sm">
          <h2 className="text-xl font-extrabold text-foreground">How it works</h2>
          <p className="mt-1 text-sm text-muted-foreground font-medium">
            Simple steps to find your perfect hostel
          </p>

          <div className="mt-8 flex flex-col lg:flex-row items-center justify-between gap-8">
            {/* Steps */}
            <div className="flex flex-1 flex-col sm:flex-row items-center justify-between gap-4 w-full">
              {[
                {
                  step: "1",
                  title: "Search",
                  desc: "Search hostels by name, area, or campus location.",
                  icon: Search,
                },
                {
                  step: "2",
                  title: "Compare",
                  desc: "Compare fees, facilities, reviews and vacancy.",
                  icon: Users,
                },
                {
                  step: "3",
                  title: "Inquire",
                  desc: "Send inquiry to hostels you are interested in.",
                  icon: MessageSquare,
                },
                {
                  step: "4",
                  title: "Connect",
                  desc: "Hostel will respond and help with next steps.",
                  icon: UserRound,
                },
              ].map((item, index) => (
                <div key={item.step} className="flex items-center gap-4 w-full">
                  <div className="flex items-center gap-4 flex-1">
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-brand-teal border border-border">
                      <item.icon className="size-5" />
                    </span>
                    <div className="space-y-0.5">
                      <p className="font-extrabold text-sm text-foreground">
                        {item.step}. {item.title}
                      </p>
                      <p className="text-[11px] leading-normal text-muted-foreground max-w-[160px] font-medium">
                        {item.desc}
                      </p>
                    </div>
                  </div>
                  {index < 3 && (
                    <ArrowRight className="hidden lg:block size-4 text-muted-foreground/35 shrink-0 mx-2" />
                  )}
                </div>
              ))}
            </div>

            {/* Provider Card */}
            <Link
              className="w-full lg:w-[350px] rounded-xl border border-dashed border-brand-teal/40 bg-brand-teal-soft/10 p-5 flex items-start gap-4 shrink-0 transition hover:border-brand-teal hover:bg-brand-teal-soft/20"
              href="/service-providers/register"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand-teal-soft/30 text-brand-teal border border-brand-teal/10">
                <Users className="size-5" />
              </span>
              <div className="flex-1 space-y-3">
                <div>
                  <p className="font-extrabold text-sm text-foreground">
                    Are you a Service Provider?
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed font-medium">
                    Register as a service provider and grow your business with us.
                  </p>
                </div>
                <span className="inline-flex rounded-md bg-brand-teal px-4.5 py-2 text-xs font-bold text-white transition">
                  Register Now
                </span>
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <div className="bg-[#0f766e] py-8 text-white">
        <div className="mx-auto max-w-[1448px] px-6 grid grid-cols-2 md:grid-cols-4 gap-8 text-center divide-x divide-white/10">
          {[
            { value: "500+", label: "Verified Hostels" },
            { value: "10,000+", label: "Happy Students" },
            { value: "50+", label: "Cities Covered" },
            { value: "4.6 ★", label: "Average Rating" },
          ].map((item, index) => (
            <div
              key={item.label}
              className={cn("space-y-1.5", index === 0 ? "" : "pl-4 md:pl-0")}
            >
              <p className="text-3xl font-extrabold tracking-tight">{item.value}</p>
              <p className="text-xs font-medium text-teal-100/90">{item.label}</p>
            </div>
          ))}
        </div>
      </div>

      <footer className="border-t border-border bg-surface">
        <div className="mx-auto grid max-w-[1448px] gap-10 px-6 py-10 lg:grid-cols-[1.2fr_2fr_0.9fr]">
          <div>
            <Link
              href="/"
              className="flex items-center gap-2 font-heading text-2xl font-bold text-brand-teal"
            >
              <Home className="size-7 fill-brand-teal/10" />
              {identity.siteName}
            </Link>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {identity.tagline ||
                "A Nepal-focused hostel discovery and operations platform for students, families, hostel teams, and trusted service partners."}
            </p>
            {socialLinks.length > 0 ? (
              <div className="mt-5 flex flex-wrap gap-3 text-sm font-semibold text-muted-foreground">
                {socialLinks.map(([label, href]) => (
                  <a
                    className="transition hover:text-brand-teal"
                    href={href}
                    key={label}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    {label}
                  </a>
                ))}
              </div>
            ) : null}
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            {footerGroups.map((group) => (
              <div key={group.title}>
                <p className="text-sm font-extrabold text-foreground">{group.title}</p>
                <div className="mt-4 space-y-3">
                  {group.links.map(([label, href]) => (
                    <Link
                      className="block text-sm font-medium text-muted-foreground transition hover:text-brand-teal"
                      href={href}
                      key={label}
                    >
                      {label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div>
            <p className="text-sm font-extrabold text-foreground">Contact</p>
            <div className="mt-4 space-y-3 text-sm font-medium text-muted-foreground">
              {identity.supportPhone ? (
                <a
                  className="block transition hover:text-brand-teal"
                  href={`tel:${identity.supportPhone.replace(/\s/g, "")}`}
                >
                  {identity.supportPhone}
                </a>
              ) : null}
              {identity.supportEmail ? (
                <a
                  className="block transition hover:text-brand-teal"
                  href={`mailto:${identity.supportEmail}`}
                >
                  {identity.supportEmail}
                </a>
              ) : null}
              {identity.address ? <p>{identity.address}</p> : null}
            </div>
          </div>
        </div>
        <div className="border-t border-border">
          <div className="mx-auto flex max-w-[1448px] flex-col gap-3 px-6 py-5 text-xs font-medium text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>Copyright 2026 {identity.siteName}. All rights reserved.</p>
            <div className="flex gap-4">
              <Link className="hover:text-brand-teal" href="/privacy">
                Privacy
              </Link>
              <Link className="hover:text-brand-teal" href="/terms">
                Terms
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </PublicShell>
  );
}

export function PublicHomePage({ hostels }: { hostels: HostelSummary[] }) {
  return (
    <Suspense fallback={null}>
      <PublicHomePageContent hostels={hostels} />
    </Suspense>
  );
}
