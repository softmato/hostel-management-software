"use client";

import {
  AlertCircle as AlertIcon,
  ArrowRight,
  BadgeCheck,
  BedDouble,
  Bus,
  CheckCircle2,
  ChevronRight,
  Dumbbell,
  GraduationCap,
  KeyRound,
  MapPin,
  PhoneCall,
  Pill,
  ShieldCheck,
  Star,
  Stethoscope,
  Trees,
  Users,
  Utensils,
  Wifi,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { HostelMap } from "@/components/maps/hostel-map";
import { MediaLightbox, type LightboxItem } from "@/components/media-lightbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { maybePromptForResidentProfile } from "@/components/resident-identity";
import { browserApi } from "@/lib/browser-api";
import { photosOfKind } from "@/lib/hostel-photos";
import type { NearbyPlaceType } from "@/lib/maps/types";
import { cn } from "@/lib/utils";

import { Breadcrumbs, PublicShell, StatusPill, formatMoney, humanize } from "./shared";
import {
  DEFAULT_HOSTEL_IMAGE,
  formatHostelAddress,
  mapPublicHostelToSummary,
  roomTypeLabel,
  type PublicHostel,
} from "./public-hostel-data";

const GALLERY_PAGE_SIZE = 12;

/**
 * Nearby points of interest, in the order a hostel seeker actually cares about
 * them. Anything not listed here (type "other") is dropped rather than shown
 * under a meaningless heading. Data comes from the cached OpenStreetMap/Places
 * lookup on the hostel document — see lib/maps/nearby.ts.
 */
const NEARBY_GROUPS: Array<{
  icon: LucideIcon;
  label: string;
  type: NearbyPlaceType;
}> = [
  { icon: GraduationCap, label: "Colleges & schools", type: "college" },
  { icon: Stethoscope, label: "Hospitals & clinics", type: "hospital" },
  { icon: Pill, label: "Pharmacies", type: "pharmacy" },
  { icon: Bus, label: "Bus stops", type: "bus_stop" },
  { icon: Utensils, label: "Restaurants & cafes", type: "restaurant" },
  { icon: Trees, label: "Parks", type: "park" },
  { icon: Dumbbell, label: "Gyms", type: "gym" },
];

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
}

/** Sunday-first, matching how the hostel admin configures the routine. */
const ROUTINE_DAYS = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const;

const ROUTINE_MEALS = [
  { label: "Breakfast", type: "BREAKFAST" },
  { label: "Lunch", type: "LUNCH" },
  { label: "Snacks", type: "SNACKS" },
  { label: "Dinner", type: "DINNER" },
] as const;

type RoomCard = {
  bedsPerRoom?: number;
  features: string[];
  image: string;
  mealInclusion?: string;
  photos: string[];
  rent: number;
  rooms?: number;
  seats: number;
  slug: string;
  type: string;
};

function roomSlug(roomType: string) {
  return roomType.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function titleCaseDay(day: string) {
  return day.charAt(0) + day.slice(1).toLowerCase();
}

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
  // The gallery grows on demand — a hostel can have dozens of photos and
  // dropping them all on the page at once is what made this feel heavy.
  const [visiblePhotos, setVisiblePhotos] = useState(GALLERY_PAGE_SIZE);
  const [lightbox, setLightbox] = useState<{ index: number; items: LightboxItem[] } | null>(
    null,
  );
  const [openRoom, setOpenRoom] = useState<RoomCard | null>(null);

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

  // Counting the visit powers the hostel admin's listing stats, and the same
  // response tells us whether this visitor has browsed enough hostels to be
  // worth offering the fill-once resident profile.
  useEffect(() => {
    if (!slug) {
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const result = await browserApi<{
          prompt: { reason: "BROWSING" | null; shouldCollectProfile: boolean };
        }>(`/api/v1/public/hostels/${encodeURIComponent(slug)}/views`, {
          method: "POST",
        });

        if (result.prompt.shouldCollectProfile) {
          maybePromptForResidentProfile("BROWSING");
        }
      } catch {
        // Analytics must never break the page.
      }
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [slug]);

  const hostelSummary = hostel ? mapPublicHostelToSummary(hostel) : null;

  // The hero is a taster, not the archive: three exteriors, three interiors and
  // one shot of each room type. Everything else lives in the Photos tab.
  const images = useMemo(() => {
    const exterior = photosOfKind(hostel?.photos, "EXTERIOR").slice(0, 3);
    const interior = photosOfKind(hostel?.photos, "INTERIOR").slice(0, 3);
    const roomTypesSeen = new Set<string>();
    const oneRoomEach = photosOfKind(hostel?.photos, "ROOM").filter((photo) => {
      const key = photo.roomType ?? "";
      if (roomTypesSeen.has(key)) {
        return false;
      }
      roomTypesSeen.add(key);
      return true;
    });

    const urls = [...exterior, ...interior, ...oneRoomEach]
      .map((photo) => photo.url ?? "")
      .filter(Boolean);

    return urls.length ? urls : [DEFAULT_HOSTEL_IMAGE];
  }, [hostel]);

  /** Every uploaded photo, cover order, for the Photos tab and the lightbox. */
  const galleryPhotos = useMemo(
    () => (hostel?.photos ?? []).filter((photo) => Boolean(photo.url)),
    [hostel],
  );

  const lightboxItems = useMemo(
    () =>
      galleryPhotos.map((photo) => ({
        caption: photo.alt || undefined,
        kind: "image" as const,
        src: photo.url ?? "",
      })),
    [galleryPhotos],
  );

  /**
   * A room shows its own shots only — the shared fallback chain is fine for
   * picking one cover image, but a "Single Room" gallery must not quietly fill
   * up with every other room type's photos.
   */
  const roomPhotos = useCallback(
    (roomType: string, fallbackIndex: number) => {
      const own = photosOfKind(hostel?.photos, "ROOM", roomType)
        .map((photo) => photo.url ?? "")
        .filter(Boolean);

      return own.length ? own : [images[fallbackIndex % images.length]];
    },
    [hostel, images],
  );

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "rooms", label: "Rooms & Pricing" },
    { id: "facilities", label: "Facilities" },
    { id: "photos", label: `Photos (${galleryPhotos.length})` },
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

  // Bucket the cached points of interest by kind, closest first, dropping any
  // group with nothing in it. Plain const rather than a memo: this runs after
  // the early returns above, where a hook would be a rules-of-hooks violation,
  // and it is a single pass over at most a couple of dozen places.
  const nearbyGroups = NEARBY_GROUPS.map((group) => ({
    ...group,
    places: (hostel.nearbyPlaces ?? [])
      .filter((place) => place.type === group.type)
      .sort((a, b) => a.distance - b.distance),
  })).filter((group) => group.places.length > 0);

  // Only ever show the hostel's real number (set in the profile tab) — no
  // placeholder phone on the public site.
  // Phone only — a hostel's email is never published on the public site.
  const contactPhone = hostel.contact?.phone || "";

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
  const rooms: RoomCard[] =
    roomConfigurations.length > 0
      ? roomConfigurations.map((config, index) => {
          const photos = roomPhotos(config.roomType, index);

          return {
            bedsPerRoom: config.bedsPerRoom,
            features: hostel.facilities.slice(0, 2),
            image: photos[0],
            mealInclusion: config.mealInclusion,
            photos,
            rent: config.monthlyRent || baseRent,
            rooms: config.rooms,
            seats: config.vacantBeds,
            slug: roomSlug(config.roomType),
            type: roomTypeLabel(config.roomType),
          };
        })
      : (hostel.roomTypes.length > 0 ? hostel.roomTypes : ["Room"]).map(
          (roomType, index, list) => {
            const photos = roomPhotos(roomType, index);

            return {
              features: hostel.facilities.slice(0, 2),
              image: photos[0],
              photos,
              rent:
                list.length <= 1
                  ? baseRent
                  : Math.round(
                      baseRent + ((maxRent - baseRent) / (list.length - 1)) * index,
                    ),
              seats: hostel.capacitySummary?.vacantBeds ?? hostelSummary.vacancy,
              slug: roomSlug(roomType),
              type: roomTypeLabel(roomType),
            };
          },
        );

  const facilities = (
    hostel.facilities.length > 0 ? hostel.facilities : ["Published profile"]
  ).map((facility) => ({
    detail: "Available",
    icon: iconForFacility(facility),
    label: facility,
  }));

  // The old Food Details card is gone; these ride along as chips on the
  // routine header, where they actually add context to the menu.
  const foodFacts = [
    hostel.food?.mealsPerDay ? `${hostel.food.mealsPerDay} meals a day` : null,
    hostel.food?.hasVeg ? "Veg" : null,
    hostel.food?.hasNonVeg ? "Non-veg" : null,
    hostel.food?.notes,
  ].filter((detail): detail is string => Boolean(detail));

  // The weekly routine as day rows by meal column. Days with nothing set are
  // dropped so a half-filled routine still reads cleanly.
  const routineMeals = hostel.foodRoutine?.meals ?? [];
  const foodRoutineRows = ROUTINE_DAYS.map((day) => ({
    day,
    meals: ROUTINE_MEALS.map((meal) => ({
      ...meal,
      menu: routineMeals.find(
        (entry) => entry.dayOfWeek === day && entry.mealType === meal.type,
      ),
    })),
  })).filter((row) => row.meals.some((meal) => meal.menu));

  // Noted meals and the month end treat read the same way to a visitor, so
  // they share one strip — only the badge tells them apart.
  const foodSpecials = [
    ...routineMeals
      .filter((meal) => Boolean(meal.note))
      .map((meal) => ({
        id: `${meal.dayOfWeek}:${meal.mealType}`,
        isMonthEnd: false,
        items: meal.items,
        label: `Every ${humanize(meal.dayOfWeek)} · ${
          ROUTINE_MEALS.find((entry) => entry.type === meal.mealType)?.label ??
          humanize(meal.mealType)
        }`,
        note: meal.note,
      })),
    ...(hostel.foodRoutine?.monthEndSpecial
      ? [
          {
            id: "month-end",
            isMonthEnd: true,
            items: hostel.foodRoutine.monthEndSpecial.items,
            label: "Last day of every month",
            note: hostel.foodRoutine.monthEndSpecial.note,
          },
        ]
      : []),
  ];

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
              </button>
            ))}
            {galleryPhotos.length > images.length ? (
              // The overflow tile is the way into the full set — it opens the
              // Photos tab instead of swapping the hero image.
              <button
                className="relative h-16 overflow-hidden rounded-md border-2 border-transparent bg-muted transition md:h-20"
                onClick={() => handleTabClick("photos")}
                type="button"
              >
                <span
                  className="absolute inset-0 bg-cover bg-center"
                  style={{
                    backgroundImage: `url("${galleryPhotos[images.length]?.url ?? images[0]}")`,
                  }}
                />
                <span className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/65 text-xs font-bold text-white transition hover:bg-slate-950/50">
                  +{galleryPhotos.length - images.length}
                  <span className="font-medium">more</span>
                </span>
              </button>
            ) : null}
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
            {contactPhone ? (
              <a
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-brand-teal bg-surface text-sm font-bold text-brand-teal transition hover:bg-brand-teal/5"
                href={`tel:${contactPhone}`}
              >
                <PhoneCall className="size-4" /> {contactPhone}
              </a>
            ) : (
              <Link
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-brand-teal bg-surface text-sm font-bold text-brand-teal transition hover:bg-brand-teal/5"
                href={`/inquiry?hostel=${hostel.slug}`}
              >
                <PhoneCall className="size-4" /> Contact Hostel
              </Link>
            )}
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
              <span className="text-xs font-bold text-muted-foreground">
                {rooms.length} room {rooms.length === 1 ? "type" : "types"}
              </span>
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
                    <button
                      className="mt-4 inline-flex h-9 w-full items-center justify-center gap-1 rounded-md border border-brand-teal text-xs font-bold text-brand-teal transition hover:bg-brand-teal hover:text-white"
                      onClick={() => setOpenRoom(room)}
                      type="button"
                    >
                      See Details <ArrowRight className="size-3.5" />
                    </button>
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

          <section
            className="rounded-lg border border-border bg-surface p-4 shadow-sm md:p-5"
            id="hostel-photos"
          >
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="text-xl font-extrabold text-foreground">Photos</h2>
              <span className="text-xs font-bold text-muted-foreground">
                {galleryPhotos.length} uploaded by the hostel
              </span>
            </div>
            {galleryPhotos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This hostel has not uploaded photos yet.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {galleryPhotos.slice(0, visiblePhotos).map((photo, index) => (
                    <button
                      className="group relative aspect-4/3 overflow-hidden rounded-md border border-border bg-muted"
                      key={photo.id ?? `${photo.url}-${index}`}
                      onClick={() => setLightbox({ index, items: lightboxItems })}
                      type="button"
                    >
                      {/* Native lazy loading keeps the rest of the set off the
                          wire until the visitor scrolls to it. next/image is
                          not an option: photo hosts are not in remotePatterns. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt={photo.alt || `${hostelSummary.name} photo ${index + 1}`}
                        className="size-full object-cover transition group-hover:scale-[1.03]"
                        decoding="async"
                        loading="lazy"
                        src={photo.url}
                      />
                      {photo.kind ? (
                        <span className="absolute left-2 top-2 rounded bg-slate-950/60 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                          {photo.kind === "ROOM" && photo.roomType
                            ? roomTypeLabel(photo.roomType)
                            : humanize(photo.kind)}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
                {visiblePhotos < galleryPhotos.length ? (
                  <button
                    className="mt-4 inline-flex h-10 items-center justify-center rounded-lg border border-brand-teal px-5 text-sm font-bold text-brand-teal transition hover:bg-brand-teal/5"
                    onClick={() =>
                      setVisiblePhotos((count) => count + GALLERY_PAGE_SIZE)
                    }
                    type="button"
                  >
                    Load {Math.min(GALLERY_PAGE_SIZE, galleryPhotos.length - visiblePhotos)}{" "}
                    more photos
                  </button>
                ) : null}
              </>
            )}
          </section>

          {/* The routine gets the full main column; rules and reviews live in
              the sidebar next to the photos, under the contact card. */}
          <section className="grid gap-5" id="hostel-overview">
            {foodRoutineRows.length > 0 ? (
              <article
                className="rounded-lg border border-border bg-surface p-5 shadow-sm"
                id="hostel-food-routine"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-extrabold text-foreground">Food Routine</h2>
                  {foodFacts.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {foodFacts.map((fact) => (
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-bold text-muted-foreground"
                          key={fact}
                        >
                          <CheckCircle2 className="size-3.5 text-brand-teal" />
                          {fact}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="mt-4 overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[640px] border-collapse text-sm">
                    <thead>
                      <tr className="bg-muted/50 text-left">
                        <th className="w-28 px-4 py-3 font-bold text-foreground">Day</th>
                        {ROUTINE_MEALS.map((meal) => (
                          <th
                            className="px-4 py-3 font-bold text-foreground"
                            key={meal.type}
                          >
                            {meal.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {foodRoutineRows.map((row) => (
                        <tr className="border-t border-border align-top" key={row.day}>
                          <td className="px-4 py-3 font-bold text-foreground">
                            {titleCaseDay(row.day)}
                          </td>
                          {row.meals.map((meal) => (
                            <td className="px-4 py-3" key={meal.type}>
                              {meal.menu ? (
                                <>
                                  <span className="font-medium text-foreground">
                                    {meal.menu.items.join(", ")}
                                  </span>
                                  <span className="mt-1 block text-xs font-medium text-muted-foreground">
                                    {meal.menu.timing}
                                  </span>
                                  {meal.menu.note ? (
                                    <span className="mt-1 block text-xs font-medium text-brand-teal">
                                      {meal.menu.note}
                                    </span>
                                  ) : null}
                                </>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {foodSpecials.length > 0 ? (
                  <div className="mt-5">
                    <h3 className="text-sm font-extrabold text-foreground">
                      Special meals
                    </h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {foodSpecials.map((special) => (
                        <div
                          className="rounded-lg border border-border bg-muted/30 p-3"
                          key={special.id}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-extrabold text-foreground">
                              {special.items.join(", ")}
                            </span>
                            {special.isMonthEnd ? (
                              <span className="rounded-full bg-brand-teal-soft/70 px-2 py-0.5 text-[10px] font-bold uppercase text-brand-teal">
                                Month end
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs font-medium text-muted-foreground">
                            {special.label}
                          </p>
                          {special.note ? (
                            <p className="mt-1 text-xs font-medium text-brand-teal">
                              {special.note}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            ) : null}
          </section>

          <section
            className="rounded-lg border border-border bg-surface p-5 shadow-sm"
            id="hostel-location"
          >
            <h2 className="text-xl font-extrabold text-foreground">Location</h2>
            <p className="mt-1 text-sm font-medium text-muted-foreground">{address}</p>
            <div className="mt-4 grid gap-4 md:grid-cols-[1fr_280px]">
              <div className="min-h-44 overflow-hidden rounded-lg border border-border">
                {hostel.coordinates ? (
                  <div className="h-72 w-full md:h-full">
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
              <div className="space-y-3">
                {nearbyGroups.length > 0 ? (
                  <>
                    <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                      What&apos;s nearby
                    </p>
                    {nearbyGroups.map((group) => {
                      const Icon = group.icon;

                      return (
                        <div key={group.type}>
                          <p className="flex items-center gap-2 text-sm font-extrabold text-foreground">
                            <Icon className="size-4 shrink-0 text-brand-teal" />
                            {group.label}
                            <span className="text-xs font-semibold text-muted-foreground">
                              {group.places.length}
                            </span>
                          </p>
                          <ul className="mt-1 space-y-0.5 pl-6">
                            {group.places.slice(0, 3).map((place) => (
                              <li
                                className="flex items-baseline justify-between gap-2 text-xs font-medium text-muted-foreground"
                                key={`${place.name}-${place.distance}`}
                              >
                                <span className="truncate text-foreground">
                                  {place.name}
                                </span>
                                <span className="shrink-0 tabular-nums">
                                  {formatDistance(place.distance)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </>
                ) : (
                  [
                    "Campus area access",
                    "Public transport nearby",
                    "Food and pharmacy within walking distance",
                  ].map((item) => (
                    <p
                      className="flex items-start gap-2 text-sm font-medium text-muted-foreground"
                      key={item}
                    >
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-teal" />
                      {item}
                    </p>
                  ))
                )}
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

          <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
            <h2 className="text-lg font-extrabold text-foreground">Contact the hostel</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Call or email the hostel directly — the inquiry form is optional.
            </p>
            {contactPhone ? (
              <a
                className="mt-4 flex items-center gap-3 rounded-lg border border-border p-3 transition hover:border-brand-teal"
                href={`tel:${contactPhone}`}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-brand-teal-soft/70 text-brand-teal">
                  <PhoneCall className="size-5" />
                </span>
                <span>
                  <span className="block text-xs font-semibold text-muted-foreground">
                    Phone
                  </span>
                  <span className="block text-base font-extrabold text-foreground">
                    {contactPhone}
                  </span>
                </span>
              </a>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                Phone contact appears once the hostel admin adds a number.
              </p>
            )}
            <Link
              className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-lg border border-brand-teal text-sm font-bold text-brand-teal transition hover:bg-brand-teal/5"
              href={`/inquiry?hostel=${hostel.slug}`}
            >
              Send an inquiry instead
            </Link>
          </section>

          <section
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
          </section>

          <section
            className="rounded-lg border border-border bg-surface p-5 shadow-sm"
            id="hostel-reviews"
          >
            <h2 className="text-lg font-extrabold text-foreground">What Students Say</h2>
            <div className="mt-4 grid gap-5 sm:grid-cols-[120px_1fr]">
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
          </section>
        </aside>
      </section>

      <Sheet
        onOpenChange={(open) => {
          if (!open) setOpenRoom(null);
        }}
        open={Boolean(openRoom)}
      >
        <SheetContent className="w-full sm:max-w-lg" side="right">
          {openRoom ? (
            <>
              <SheetHeader className="border-b border-border">
                <SheetTitle>{openRoom.type}</SheetTitle>
                <SheetDescription>
                  {formatMoney(openRoom.rent)} / month · {hostelSummary.name}
                </SheetDescription>
              </SheetHeader>

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
                <div className="grid grid-cols-2 gap-2">
                  {openRoom.photos.map((photo, index) => (
                    <button
                      className="aspect-4/3 overflow-hidden rounded-md border border-border bg-muted"
                      key={`${photo}-${index}`}
                      onClick={() =>
                        setLightbox({
                          index,
                          items: openRoom.photos.map((src) => ({
                            kind: "image" as const,
                            src,
                            title: openRoom.type,
                          })),
                        })
                      }
                      type="button"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt={`${openRoom.type} photo ${index + 1}`}
                        className="size-full object-cover"
                        decoding="async"
                        loading="lazy"
                        src={photo}
                      />
                    </button>
                  ))}
                </div>

                <dl className="space-y-3 text-sm">
                  {(
                    [
                      ["Monthly rent", formatMoney(openRoom.rent)],
                      ["Vacant beds", String(openRoom.seats)],
                      [
                        "Beds per room",
                        openRoom.bedsPerRoom ? String(openRoom.bedsPerRoom) : "",
                      ],
                      ["Rooms of this type", openRoom.rooms ? String(openRoom.rooms) : ""],
                      ["Meals", openRoom.mealInclusion ?? ""],
                    ] as const
                  )
                    .filter(([, value]) => Boolean(value))
                    .map(([label, value]) => (
                      <div className="flex items-start justify-between gap-4" key={label}>
                        <dt className="font-medium text-muted-foreground">{label}</dt>
                        <dd className="text-right font-bold text-foreground">{value}</dd>
                      </div>
                    ))}
                </dl>

                {openRoom.features.length > 0 ? (
                  <div className="space-y-2 text-sm font-medium text-muted-foreground">
                    {openRoom.features.map((feature) => (
                      <p className="flex items-center gap-2" key={feature}>
                        <CheckCircle2 className="size-4 text-brand-teal" />
                        {feature}
                      </p>
                    ))}
                  </div>
                ) : null}

                {contactPhone ? (
                  <a
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-teal text-sm font-bold text-white transition hover:brightness-105"
                    href={`tel:${contactPhone}`}
                  >
                    <PhoneCall className="size-4" /> Call about this room
                  </a>
                ) : (
                  <Link
                    className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-brand-teal text-sm font-bold text-white transition hover:brightness-105"
                    href={`/inquiry?hostel=${hostel.slug}&room=${openRoom.slug}`}
                  >
                    Ask about this room
                  </Link>
                )}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      {lightbox ? (
        <MediaLightbox
          index={lightbox.index}
          items={lightbox.items}
          onClose={() => setLightbox(null)}
          onIndexChange={(next) =>
            setLightbox((current) => (current ? { ...current, index: next } : current))
          }
        />
      ) : null}
    </PublicShell>
  );
}
