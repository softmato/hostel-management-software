import { MapPin } from "lucide-react";
import Link from "next/link";

import { PLATFORM_NAME } from "@hostel/shared/brand/brand";

import type { CityIndexEntry } from "@/lib/hostel-locations";
import type { LocationPage } from "@/lib/location-pages";

import { OwnerCallout, SeoChip, SeoCrumbs, SeoFaq } from "./public-seo-blocks";
import { HostelCard, PublicShell } from "./shared";

/**
 * The body of a `/hostels/in/...` page. A server component: every word, card
 * and link is in the first response, which is the whole point of these pages.
 * The copy arrives already computed by `loadLocationPage`.
 */

export function PublicLocationPage({ page }: { page: LocationPage }) {
  return (
    <PublicShell active="browse">
      <div className="mx-auto w-full max-w-[1360px] px-4 pb-20 pt-8 sm:px-6">
        <SeoCrumbs items={page.crumbs} />

        <header className="max-w-3xl">
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
            <MapPin className="size-4" />
            Hostels in Nepal
          </p>
          <h1 className="mt-2 font-heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {page.heading}
          </h1>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">{page.intro}</p>
        </header>

        <div className="mt-8 flex flex-wrap gap-2">
          {page.typeLinks.map((link) => (
            <SeoChip key={link.href} {...link} />
          ))}
        </div>
        {page.areaLinks.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Areas
            </span>
            {page.areaLinks.map((link) => (
              <SeoChip key={link.href} {...link} />
            ))}
          </div>
        ) : null}

        <section aria-label={page.heading} className="mt-10">
          {page.hostels.length ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {page.hostels.map((hostel) => (
                <HostelCard hostel={hostel} key={hostel.id} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-surface px-6 py-12 text-center">
              <p className="font-heading text-lg font-bold text-foreground">
                No verified hostels listed here yet
              </p>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                New hostels in {page.placeName} appear on this page as soon as they are verified.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Link
                  className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90"
                  href="/hostels"
                >
                  Browse all hostels
                </Link>
                <Link
                  className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground transition hover:border-primary/50"
                  href="/map"
                >
                  Open the hostel map
                </Link>
              </div>
            </div>
          )}
        </section>

        <SeoFaq entries={page.faq} title={`Questions about hostels in ${page.placeName}`} />

        <section className="mt-16 grid gap-4 lg:grid-cols-2">
          {page.otherCities.length ? (
            <div className="rounded-2xl border border-border bg-surface p-6">
              <h2 className="font-heading text-lg font-bold text-foreground">
                Hostels in other cities
              </h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {page.otherCities.map((link) => (
                  <SeoChip key={link.href} {...link} />
                ))}
              </div>
            </div>
          ) : null}
          <OwnerCallout
            body={`List it on ${PLATFORM_NAME} to be found here, and run residents, rent, food and safety from one app.`}
            title={`Run a hostel in ${page.city.name}?`}
          />
        </section>
      </div>
    </PublicShell>
  );
}

/** `/hostels/in` — every city, with what is listed in each. */
export function PublicCitiesPage({ cities }: { cities: CityIndexEntry[] }) {
  const total = cities.reduce((sum, city) => sum + city.count, 0);

  return (
    <PublicShell active="browse">
      <div className="mx-auto w-full max-w-[1360px] px-4 pb-20 pt-8 sm:px-6">
        <SeoCrumbs
          items={[
            { name: "Home", path: "/" },
            { name: "Hostels", path: "/hostels" },
            { name: "By city", path: "/hostels/in" },
          ]}
        />

        <header className="max-w-3xl">
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
            <MapPin className="size-4" />
            Hostels in Nepal
          </p>
          <h1 className="mt-2 font-heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Hostels in Nepal by City
          </h1>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            {total
              ? `${total} verified ${total === 1 ? "hostel is" : "hostels are"} listed on ${PLATFORM_NAME} across Nepal. Pick a city to see its boys, girls and co-living hostels, with photos, rent, facilities and reviews.`
              : `Verified hostels across Nepal are listed on ${PLATFORM_NAME} as they join. Pick a city to see what is there.`}
          </p>
        </header>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cities.map((city) => (
            <Link
              className="group rounded-2xl border border-border bg-surface p-5 transition hover:border-primary/50 hover:shadow-sm"
              href={`/hostels/in/${city.slug}`}
              key={city.slug}
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-heading text-lg font-bold text-foreground group-hover:text-primary">
                  Hostels in {city.name}
                </h2>
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
                  {city.count}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {city.count
                  ? `${city.types.BOYS} boys · ${city.types.GIRLS} girls · ${city.types.CO_LIVING} co-living`
                  : "No hostels listed yet"}
              </p>
              {city.areas.some((area) => area.count > 0) ? (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {city.areas
                    .filter((area) => area.count > 0)
                    .slice(0, 5)
                    .map((area) => area.name)
                    .join(", ")}
                </p>
              ) : null}
            </Link>
          ))}
        </div>

        <section className="mt-16 max-w-2xl">
          <OwnerCallout
            body={`List it on ${PLATFORM_NAME} to be found by students and parents across Nepal, and run residents, rent, food and safety from one app.`}
            title="Run a hostel?"
          />
        </section>
      </div>
    </PublicShell>
  );
}
