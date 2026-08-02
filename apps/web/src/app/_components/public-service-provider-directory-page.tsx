import Link from "next/link";
import { BadgeCheck, Clock, MapPin, Wrench } from "lucide-react";

import {
  Breadcrumbs,
  PublicShell,
  SectionCard,
  StatusPill,
  humanize,
} from "@/app/_components/shared";

export type PublicProvider = {
  area: string;
  availability: string;
  category: string;
  city: string;
  description: string;
  experience: string;
  fullName: string;
  id: string;
  ratingSummary: { averageRating?: number; totalReviews?: number };
  verified: boolean;
};

export type ProviderDirectoryData = {
  countsByCategory: Record<string, number>;
  providers: PublicProvider[];
  total: number;
};

/** Matches `serviceProviderCategorySchema`; the labels are what a visitor reads. */
export const PROVIDER_CATEGORIES = [
  { label: "Plumber", value: "PLUMBER" },
  { label: "Electrician", value: "ELECTRICIAN" },
  { label: "Doctor / Clinic", value: "DOCTOR_CLINIC" },
  { label: "Internet technician", value: "INTERNET_TECHNICIAN" },
  { label: "Cleaner", value: "CLEANER" },
  { label: "Carpenter", value: "CARPENTER" },
  { label: "Painter", value: "PAINTER" },
  { label: "Water supplier", value: "WATER_SUPPLIER" },
  { label: "Appliance repair", value: "APPLIANCE_REPAIR" },
  { label: "Room repair", value: "ROOM_REPAIR" },
  { label: "Other", value: "OTHER" },
] as const;

export function categoryLabel(value: string) {
  return (
    PROVIDER_CATEGORIES.find((category) => category.value === value)?.label ??
    humanize(value.toLowerCase().replaceAll("_", "-"))
  );
}

function ProviderCard({ provider }: { provider: PublicProvider }) {
  return (
    <article className="app-card flex h-full flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-foreground">
            {provider.fullName}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {categoryLabel(provider.category)}
          </p>
        </div>
        <StatusPill tone="success">
          <BadgeCheck aria-hidden="true" className="size-3.5" />
          Verified
        </StatusPill>
      </div>

      {provider.description ? (
        <p className="line-clamp-3 text-sm text-muted-foreground">
          {provider.description}
        </p>
      ) : null}

      <dl className="mt-auto space-y-1.5 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
          <dt className="sr-only">Service area</dt>
          <dd className="truncate">
            {provider.area}
            {provider.city ? `, ${provider.city}` : ""}
          </dd>
        </div>
        {provider.availability ? (
          <div className="flex items-center gap-2">
            <Clock aria-hidden="true" className="size-3.5 shrink-0" />
            <dt className="sr-only">Availability</dt>
            <dd className="truncate">{provider.availability}</dd>
          </div>
        ) : null}
      </dl>

      {/* Phone numbers are never sent to the public directory — a hostel admin
          sees them inside the portal, where the request is authenticated. */}
      <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        Contact details are shared with hostel admins through their portal.
      </p>
    </article>
  );
}

export function PublicServiceProviderDirectoryPage({
  activeCategory,
  data,
  loadFailed,
}: {
  activeCategory?: string;
  data: ProviderDirectoryData;
  loadFailed: boolean;
}) {
  return (
    <PublicShell active="providers">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6 lg:px-8">
        <Breadcrumbs
          items={[{ href: "/", label: "Home" }, { label: "Service Providers" }]}
        />

        <header className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground sm:text-3xl">
              <Wrench aria-hidden="true" className="size-6" />
              Verified service providers
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Plumbers, electricians, clinics and more — each one reviewed by the platform
              before it appears here. Hostel admins can contact them from their portal.
            </p>
          </div>
          <Link
            className="inline-flex shrink-0 items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            href="/service-providers/register"
          >
            Register as a provider
          </Link>
        </header>

        <nav aria-label="Filter by category" className="mt-6 flex flex-wrap gap-2">
          <Link
            aria-current={activeCategory ? undefined : "page"}
            className={
              activeCategory
                ? "rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted"
                : "rounded-full border border-primary bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
            }
            href="/service-providers"
          >
            All ({data.total})
          </Link>
          {PROVIDER_CATEGORIES.map((category) => {
            const count = data.countsByCategory[category.value] ?? 0;
            const isActive = activeCategory === category.value;

            return (
              <Link
                aria-current={isActive ? "page" : undefined}
                className={
                  isActive
                    ? "rounded-full border border-primary bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                    : "rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted"
                }
                href={`/service-providers?category=${category.value}`}
                key={category.value}
              >
                {category.label}
                {count > 0 ? ` (${count})` : ""}
              </Link>
            );
          })}
        </nav>

        <div className="mt-6">
          {loadFailed ? (
            <SectionCard>
              <div className="p-8 text-center">
                <p className="text-sm font-medium text-foreground">
                  The provider directory could not be loaded.
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Refresh the page to try again.
                </p>
              </div>
            </SectionCard>
          ) : data.providers.length === 0 ? (
            <SectionCard>
              <div className="p-8 text-center">
                <p className="text-sm font-medium text-foreground">
                  {activeCategory
                    ? `No verified ${categoryLabel(activeCategory).toLowerCase()} listed yet.`
                    : "No verified providers listed yet."}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Providers appear here once the platform has checked their documents.{" "}
                  <Link className="underline" href="/service-providers/register">
                    Register as a provider
                  </Link>
                  .
                </p>
              </div>
            </SectionCard>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.providers.map((provider) => (
                <ProviderCard key={provider.id} provider={provider} />
              ))}
            </div>
          )}
        </div>
      </div>
    </PublicShell>
  );
}
