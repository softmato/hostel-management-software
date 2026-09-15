import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicLocationPage } from "@/app/_components/public-location-page";
import { JsonLd } from "@/components/json-ld";
import { loadLocationPage, locationJsonLd } from "@/lib/location-pages";
import { NOINDEX, pageMetadata } from "@/lib/seo";

type PageParams = {
  params: Promise<{ city: string }>;
};

/** "Hostels in Kathmandu" — see `lib/location-pages.ts` for how the page is written. */
export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { city } = await params;
  const page = await loadLocationPage(city);

  if (!page) {
    return { robots: NOINDEX, title: "Place not found" };
  }

  return pageMetadata({
    description: page.description,
    eyebrow: "Hostels in Nepal",
    noindex: page.noindex,
    path: page.path,
    title: page.title,
  });
}

export default async function CityHostelsPage({ params }: PageParams) {
  const { city } = await params;
  const page = await loadLocationPage(city);

  if (!page) {
    notFound();
  }

  return (
    <>
      <JsonLd data={locationJsonLd(page)} />
      <PublicLocationPage page={page} />
    </>
  );
}
