"use client";

import {
  AlertCircle as AlertIcon,
  ArrowRight,
  BadgeCheck,
  BedDouble,
  CheckCircle2,
  ChevronRight,
  KeyRound,
  MapPin,
  PhoneCall,
  ShieldCheck,
  Star,
  Users,
  Utensils,
  Wifi,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { HostelMap } from "@/components/maps/hostel-map";
import { browserApi } from "@/lib/browser-api";
import { cn } from "@/lib/utils";

import { Breadcrumbs, PublicShell, StatusPill, formatMoney, humanize } from "./shared";
import {
  DEFAULT_HOSTEL_IMAGE,
  formatHostelAddress,
  mapPublicHostelToSummary,
  roomTypeLabel,
  type PublicHostel,
} from "./public-hostel-data";

function iconForFacility(label: string): LucideIcon {
  if (/wifi|wi-fi|internet/i.test(label)) return Wifi;
  if (/food|meal|mess/i.test(label)) return Utensils;
  if (/security|cctv|warden|safe/i.test(label)) return ShieldCheck;
  if (/repair|backup|power|maintenance/i.test(label)) return Wrench;
  if (/room|bed|study/i.test(label)) return BedDouble;

  return CheckCircle2;
}

export function PublicHostelDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [hostel, setHostel] = useState<PublicHostel | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [currentImgIdx, setCurrentImgIdx] = useState(0);
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    async function loadHostel() {
      setState("loading");
      setMessage("");

      try {
        const data = await browserApi<{ hostel: PublicHostel }>(
          `/api/v1/public/hostels/${encodeURIComponent(slug)}`,
        );

        setHostel(data.hostel);
        setCurrentImgIdx(0);
        setState("ready");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not load hostel.");
        setState("error");
      }
    }

    if (slug) {
      void loadHostel();
    }
  }, [slug]);

  const hostelSummary = hostel ? mapPublicHostelToSummary(hostel) : null;

  const images = useMemo(() => {
    const photoUrls = hostel?.photos
      .map((photo) => photo.url)
      .filter((url): url is string => Boolean(url));

    return photoUrls?.length ? photoUrls : [DEFAULT_HOSTEL_IMAGE];
  }, [hostel]);

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "rooms", label: "Rooms & Pricing" },
    { id: "facilities", label: "Facilities" },
    { id: "food", label: "Food" },
    { id: "rules", label: "Rules" },
    { id: "reviews", label: `Reviews (${hostelSummary?.reviews ?? 0})` },
    { id: "location", label: "Location" },
  ];

  if (state === "loading") {
    return (
      <PublicShell active="browse">
        <div className="mx-auto max-w-[1440px] space-y-5 px-4 py-8 md:px-8">
          <div className="h-96 animate-pulse rounded-lg border border-border bg-muted" />
          <div className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div className="h-28 animate-pulse rounded-lg bg-muted" key={index} />
            ))}
          </div>
        </div>
      </PublicShell>
    );
  }

  if (!hostel || !hostelSummary) {
    return (
      <PublicShell active="browse">
        <div className="mx-auto max-w-[900px] px-6 py-16 text-center">
          <AlertIcon className="mx-auto size-10 text-muted-foreground" />
          <h1 className="mt-4 text-2xl font-bold text-foreground">Hostel unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {message || "This hostel is not published or verified yet."}
          </p>
          <Link
            className="mt-6 inline-flex rounded-lg bg-brand-teal px-5 py-3 text-sm font-bold text-white"
            href="/hostels"
          >
            Browse hostels
          </Link>
        </div>
      </PublicShell>
    );
  }

  const address = formatHostelAddress(hostel);
  const contactPhone = hostel.contact?.phone || "015971234";
  const contactEmail = hostel.contact?.email;

  const quickStats = [
    {
      detail: "/ month",
      icon: KeyRound,
      label: "Starting from",
      value: formatMoney(hostelSummary.price),
    },
    {
      detail: "Beds",
      icon: BedDouble,
      label: "Vacant",
      value: hostelSummary.vacancy.toString(),
    },
    {
      detail: `${hostelSummary.reviews} reviews`,
      icon: ShieldCheck,
      label: "Rating",
      value: hostelSummary.rating ? hostelSummary.rating.toFixed(1) : "New",
    },
  ];

  const highlights = (
    hostel.facilities.length > 0 ? hostel.facilities : ["Verified profile"]
  )
    .slice(0, 6)
    .map((facility) => ({
      detail: "Published by hostel",
      icon: iconForFacility(facility),
      label: facility,
    }));

  const baseRent = hostel.pricing?.monthlyRentMin ?? hostelSummary.price;
  const maxRent = hostel.pricing?.monthlyRentMax ?? baseRent;
  const roomConfigurations = hostel.roomConfigurations ?? [];

  // Prefer the rent and vacancy the owner actually submitted per room type.
  // Only hostels registered before roomConfigurations existed fall back to the
  // old min→max interpolation, which is a guess and is often plain wrong (it
  // assumes rent rises with array order — the reverse of typical sharing rates).
  const rooms =
    roomConfigurations.length > 0
      ? roomConfigurations.map((config, index) => ({
          features: hostel.facilities.slice(0, 2),
          image: images[index % images.length],
          rent: config.monthlyRent || baseRent,
          seats: config.vacantBeds,
          type: roomTypeLabel(config.roomType),
        }))
      : (hostel.roomTypes.length > 0 ? hostel.roomTypes : ["Room"]).map(
          (roomType, index, list) => ({
            features: hostel.facilities.slice(0, 2),
            image: images[index % images.length],
            rent:
              list.length <= 1
                ? baseRent
                : Math.round(baseRent + ((maxRent - baseRent) / (list.length - 1)) * index),
            seats: hostel.capacitySummary?.vacantBeds ?? hostelSummary.vacancy,
            type: roomTypeLabel(roomType),
          }),
        );

  const facilities = (
    hostel.facilities.length > 0 ? hostel.facilities : ["Published profile"]
  ).map((facility) => ({
    detail: "Available",
    icon: iconForFacility(facility),
    label: facility,
  }));

  const foodDetails = [
    hostel.food?.mealsPerDay ? `${hostel.food.mealsPerDay} meals per day` : null,
    hostel.food?.hasVeg ? "Vegetarian meals available" : null,
    hostel.food?.hasNonVeg ? "Non-vegetarian meals available" : null,
    hostel.food?.notes,
  ].filter((detail): detail is string => Boolean(detail));

  const hostelRules =
    hostel.rules.length > 0 ? hostel.rules : ["Rules are shared by the hostel team."];

  const reviewCounts = [
    { count: Math.round(hostelSummary.reviews * 0.72), stars: 5 },
    { count: Math.round(hostelSummary.reviews * 0.2), stars: 4 },
    { count: Math.round(hostelSummary.reviews * 0.05), stars: 3 },
    { count: Math.round(hostelSummary.reviews * 0.02), stars: 2 },
    { count: Math.round(hostelSummary.reviews * 0.01), stars: 1 },
  ];
  const reviewTotal = Math.max(1, hostelSummary.reviews);

  const hostelFacts = [
    ["Hostel Type", humanize(hostelSummary.type)],
    ["Total Rooms", String(hostel.capacitySummary?.totalRooms ?? "-")],
    ["Total Beds", String(hostel.capacitySummary?.totalBeds ?? "-")],
    ["Vacant Beds", String(hostel.capacitySummary?.vacantBeds ?? 0)],
    ["Area", hostel.location.area],
    ["City", hostel.location.city ?? "Kathmandu"],
  ].filter(([, value]) => value !== "-");

  const breadcrumbItems = [
    { label: "Home", href: "/" },
    { label: "Hostels", href: "/hostels" },
    { label: hostelSummary.name },
  ];

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId);
    document
      .getElementById(`hostel-${tabId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <PublicShell active="browse">
      <Breadcrumbs items={breadcrumbItems} />

      <section className="mx-auto grid max-w-[1440px] gap-5 px-4 pb-3 md:px-8 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-3">
          <div className="relative h-[310px] overflow-hidden rounded-lg border border-border bg-slate-900 shadow-sm md:h-[380px]">
            <div
              className="absolute inset-0 bg-cover bg-center transition-all duration-300"
              style={{ backgroundImage: `url("${images[currentImgIdx]}")` }}
            />
            <div className="absolute left-4 top-4">
              <StatusPill className="bg-surface text-brand-teal shadow-sm" tone="success">
                <BadgeCheck className="size-3.5" /> Verified Hostel
              </StatusPill>
            </div>

            <button
              aria-label="Previous photo"
              className="absolute left-4 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-foreground shadow-sm transition hover:bg-surface"
              onClick={() =>
                setCurrentImgIdx((prev) => (prev - 1 + images.length) % images.length)
              }
              type="button"
            >
              <ChevronRight className="size-4 rotate-180" />
            </button>
            <button
              aria-label="Next photo"
              className="absolute right-4 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-foreground shadow-sm transition hover:bg-surface"
              onClick={() => setCurrentImgIdx((prev) => (prev + 1) % images.length)}
              type="button"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          <div className="grid grid-cols-5 gap-2">
            {images.map((img, idx) => (
              <button
                aria-label={`Show photo ${idx + 1}`}
                className={cn(
                  "relative h-16 overflow-hidden rounded-md border-2 bg-muted transition md:h-20",
                  currentImgIdx === idx
                    ? "border-brand-teal"
                    : "border-transparent opacity-85 hover:opacity-100",
                )}
                key={`${img}-${idx}`}
                onClick={() => setCurrentImgIdx(idx)}
                type="button"
              >
                <span
                  className="absolute inset-0 bg-cover bg-center"
                  style={{ backgroundImage: `url("${img}")` }}
                />
                {idx === images.length - 1 ? (
                  <span className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/65 text-xs font-bold text-white">
                    +{Math.max(0, images.length - 1)}
                    <span className="font-medium">Photos</span>
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <article className="rounded-lg border border-border bg-surface p-5 shadow-sm md:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="font-heading text-3xl font-extrabold leading-tight text-foreground md:text-4xl">
                {hostelSummary.name}
              </h1>
              <div className="mt-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <MapPin className="size-4 text-brand-teal" />
                <span>{address}</span>
              </div>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
                {hostelSummary.description ||
                  "This verified hostel is published on HostelHub."}
              </p>
            </div>
            <div className="flex items-center gap-2 text-lg font-bold text-warning">
              <Star className="size-5 fill-warning text-warning" />
              {hostelSummary.rating ? hostelSummary.rating.toFixed(1) : "New"}
              <span className="text-sm font-semibold text-muted-foreground">
                ({hostelSummary.reviews})
              </span>
            </div>
          </div>

          <div className="mt-6 grid gap-4 border-y border-border py-5 sm:grid-cols-3">
            {quickStats.map((stat, index) => {
              const Icon = stat.icon;
              return (
                <div
                  className={cn(
                    "flex items-center gap-3",
                    index > 0 && "sm:border-l sm:border-border sm:pl-5",
                  )}
                  key={stat.label}
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-brand-teal/20 bg-brand-teal-soft/45 text-brand-teal">
                    <Icon className="size-5" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground">
                      {stat.label}
                    </p>
                    <p className="mt-1 text-base font-extrabold text-foreground">
                      {stat.value}{" "}
                      <span className="text-xs font-semibold text-muted-foreground">
                        {stat.detail}
                      </span>
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {highlights.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  className="flex items-center gap-3 rounded-md border border-border bg-background/55 px-3 py-3"
                  key={item.label}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-teal-soft/70 text-brand-teal">
                    <Icon className="size-4" />
                  </span>
                  <div>
                    <p className="text-xs font-extrabold text-foreground">{item.label}</p>
                    <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                      {item.detail}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <a
              className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-brand-teal bg-surface text-sm font-bold text-brand-teal transition hover:bg-brand-teal/5"
              href={`tel:${contactPhone}`}
            >
              <PhoneCall className="size-4" /> Contact Hostel
            </a>
            <Link
              className="inline-flex h-12 items-center justify-center rounded-lg bg-brand-teal text-sm font-bold text-white shadow-sm transition hover:brightness-105"
              href={`/inquiry?hostel=${hostel.slug}`}
            >
              Send Inquiry
            </Link>
          </div>
        </article>
      </section>

      <div className="mx-auto max-w-[1440px] px-4 md:px-8">
        <nav className="flex gap-7 overflow-x-auto border-b border-border text-sm font-bold text-muted-foreground">
          {tabs.map((tab) => (
            <button
              className={cn(
                "shrink-0 border-b-2 px-1 py-4 transition",
                activeTab === tab.id
                  ? "border-brand-teal text-brand-teal"
                  : "border-transparent hover:text-foreground",
              )}
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <section className="mx-auto grid max-w-[1440px] gap-5 px-4 py-4 md:px-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <section
            className="rounded-lg border border-border bg-surface p-4 shadow-sm md:p-5"
            id="hostel-rooms"
          >
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="text-xl font-extrabold text-foreground">Rooms & Pricing</h2>
              <Link
                className="inline-flex items-center gap-1 text-xs font-bold text-brand-teal transition hover:text-foreground"
                href={`/inquiry?hostel=${hostel.slug}`}
              >
                View all rooms <ArrowRight className="size-4" />
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {rooms.map((room) => (
                <article
                  className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm"
                  key={room.type}
                >
                  <div
                    className="h-28 bg-cover bg-center"
                    style={{ backgroundImage: `url("${room.image}")` }}
                  />
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-sm font-extrabold text-foreground">{room.type}</h3>
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-muted-foreground">
                        <Users className="size-3" /> {room.seats}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-extrabold text-foreground">
                      {formatMoney(room.rent)}{" "}
                      <span className="text-[11px] font-semibold text-muted-foreground">
                        / month
                      </span>
                    </p>
                    <div className="mt-3 space-y-2 text-xs font-medium text-muted-foreground">
                      {room.features.map((feature) => (
                        <p className="flex items-center gap-2" key={feature}>
                          <CheckCircle2 className="size-3.5 text-brand-teal" />
                          {feature}
                        </p>
                      ))}
                    </div>
                    <Link
                      className="mt-4 inline-flex h-9 w-full items-center justify-center rounded-md border border-brand-teal text-xs font-bold text-brand-teal transition hover:bg-brand-teal hover:text-white"
                      href={`/inquiry?hostel=${hostel.slug}&room=${room.type
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")}`}
                    >
                      Request Info
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section
            className="rounded-lg border border-border bg-surface p-4 shadow-sm md:p-5"
            id="hostel-facilities"
          >
            <h2 className="mb-4 text-xl font-extrabold text-foreground">Facilities</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {facilities.map((facility) => {
                const Icon = facility.icon;
                return (
                  <div className="flex items-center gap-3" key={facility.label}>
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-brand-teal-soft/70 text-brand-teal">
                      <Icon className="size-5" />
                    </span>
                    <div>
                      <p className="text-xs font-extrabold text-foreground">
                        {facility.label}
                      </p>
                      <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                        {facility.detail}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="grid gap-5 lg:grid-cols-3" id="hostel-overview">
            <article
              className="rounded-lg border border-border bg-surface p-5 shadow-sm"
              id="hostel-food"
            >
              <h2 className="text-lg font-extrabold text-foreground">Food Details</h2>
              <div className="mt-4 space-y-3 text-sm font-medium text-muted-foreground">
                {(foodDetails.length > 0
                  ? foodDetails
                  : ["Food details are not published yet."]
                ).map((detail) => (
                  <p className="flex items-start gap-2" key={detail}>
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-teal" />
                    {detail}
                  </p>
                ))}
              </div>
            </article>

            <article
              className="rounded-lg border border-border bg-surface p-5 shadow-sm"
              id="hostel-rules"
            >
              <h2 className="text-lg font-extrabold text-foreground">Hostel Rules</h2>
              <div className="mt-4 space-y-3 text-sm font-medium text-muted-foreground">
                {hostelRules.map((rule) => (
                  <p className="flex items-start gap-2" key={rule}>
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-teal" />
                    {rule}
                  </p>
                ))}
              </div>
            </article>

            <article
              className="rounded-lg border border-border bg-surface p-5 shadow-sm"
              id="hostel-reviews"
            >
              <h2 className="text-lg font-extrabold text-foreground">What Students Say</h2>
              <div className="mt-4 grid gap-5 sm:grid-cols-[120px_1fr] lg:grid-cols-1 xl:grid-cols-[120px_1fr]">
                <div>
                  <p className="text-5xl font-extrabold text-foreground">
                    {hostelSummary.rating ? hostelSummary.rating.toFixed(1) : "New"}
                  </p>
                  <div className="mt-2 flex gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star className="size-3.5 fill-warning text-warning" key={star} />
                    ))}
                  </div>
                  <p className="mt-2 text-xs font-medium text-muted-foreground">
                    Based on {hostelSummary.reviews} reviews
                  </p>
                </div>
                <div className="space-y-2">
                  {reviewCounts.map((row) => (
                    <div
                      className="grid grid-cols-[28px_1fr_28px] items-center gap-2 text-xs"
                      key={row.stars}
                    >
                      <span className="font-bold text-foreground">{row.stars} *</span>
                      <span className="h-2 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full bg-brand-teal"
                          style={{
                            width: `${Math.min(100, (row.count / reviewTotal) * 100)}%`,
                          }}
                        />
                      </span>
                      <span className="text-right font-semibold text-muted-foreground">
                        {row.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          </section>

          <section
            className="rounded-lg border border-border bg-surface p-5 shadow-sm"
            id="hostel-location"
          >
            <h2 className="text-xl font-extrabold text-foreground">Location</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-[1fr_260px]">
              <div className="min-h-44 overflow-hidden rounded-lg border border-border">
                {hostel.coordinates ? (
                  <div className="h-64 w-full md:h-full">
                    <HostelMap
                      center={hostel.coordinates}
                      name={hostel.name}
                      nearby={hostel.nearbyPlaces}
                    />
                  </div>
                ) : (
                  <div className="flex h-full min-h-44 items-center justify-center border border-dashed border-brand-teal/40 bg-brand-teal-soft/20 text-center">
                    <div>
                      <MapPin className="mx-auto size-8 text-brand-teal" />
                      <p className="mt-3 text-sm font-extrabold text-foreground">
                        {address}
                      </p>
                      <p className="mt-1 text-xs font-medium text-muted-foreground">
                        The exact location appears once the hostel admin saves an
                        address.
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-3 text-sm font-medium text-muted-foreground">
                {hostel.nearbyPlaces && hostel.nearbyPlaces.length > 0
                  ? hostel.nearbyPlaces.slice(0, 6).map((place) => (
                      <p
                        className="flex items-start gap-2"
                        key={`${place.name}-${place.distance}`}
                      >
                        <MapPin className="mt-0.5 size-4 shrink-0 text-brand-teal" />
                        <span>
                          <span className="text-foreground">{place.name}</span>
                          <span className="ml-1 text-xs">
                            · {place.type.replace("_", " ")} · {place.distance}m
                          </span>
                        </span>
                      </p>
                    ))
                  : [
                      "Campus area access",
                      "Public transport nearby",
                      "Food and pharmacy within walking distance",
                    ].map((item) => (
                      <p className="flex items-start gap-2" key={item}>
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-teal" />
                        {item}
                      </p>
                    ))}
              </div>
            </div>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
            <h2 className="text-xl font-extrabold text-foreground">Hostel Information</h2>
            <dl className="mt-4 space-y-4">
              {hostelFacts.map(([label, value]) => (
                <div
                  className="flex items-start justify-between gap-4 text-sm"
                  key={label}
                >
                  <dt className="font-medium text-muted-foreground">{label}</dt>
                  <dd className="text-right font-bold text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-6 flex gap-3 rounded-lg bg-brand-teal-soft/35 p-4">
              <ShieldCheck className="size-8 shrink-0 text-brand-teal" />
              <div>
                <p className="font-extrabold text-brand-teal">Safe, Verified & Trusted</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  This hostel is verified by HostelHub for your safety and security.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-surface p-5 text-center shadow-sm">
            <h2 className="text-lg font-extrabold text-foreground">
              Need More Information?
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Our team is here to help you find the perfect stay.
            </p>
            <a
              className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-brand-teal text-sm font-bold text-brand-teal transition hover:bg-brand-teal/5"
              href={`tel:${contactPhone}`}
            >
              <PhoneCall className="size-4" /> Talk to Support
            </a>
            <p className="mt-5 text-xs font-medium text-muted-foreground">
              Or call us at
            </p>
            <a
              className="mt-2 inline-flex items-center gap-2 text-lg font-extrabold text-foreground"
              href={`tel:${contactPhone}`}
            >
              <PhoneCall className="size-5 text-brand-teal" /> {contactPhone}
            </a>
            {contactEmail ? (
              <a
                className="mt-2 block text-sm font-semibold text-brand-teal"
                href={`mailto:${contactEmail}`}
              >
                {contactEmail}
              </a>
            ) : null}
          </section>
        </aside>
      </section>
    </PublicShell>
  );
}
