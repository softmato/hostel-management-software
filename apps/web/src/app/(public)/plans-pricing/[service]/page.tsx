import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getService } from "@/app/_components/plans-catalog";
import { PublicServiceDetailPage } from "@/app/_components/public-service-detail-page";
import { loadSiteConfig } from "@/lib/site-config-server";
import { DEFAULT_PLANS } from "@/modules/platform-config/plans.defaults";

type PageParams = {
  params: Promise<{ service: string }>;
};

/**
 * The catalogue is owner-editable, so the set of service pages is not known at
 * build time: a service added in Platform → Website Config → Plans & Pricing has
 * to resolve on the first request rather than wait for a deploy. The shipped
 * catalogue is still prerendered — it needs no database to enumerate and covers
 * every slug the sitemap and the cards point at on a fresh install — and
 * anything beyond it renders on demand under the public layout's revalidation.
 * A slug that is in neither is still a 404, never an empty page.
 */
export const dynamicParams = true;

export function generateStaticParams() {
  return DEFAULT_PLANS.services.map((service) => ({ service: service.slug }));
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { service: slug } = await params;
  const { plans: catalog } = await loadSiteConfig();
  const service = getService(catalog, slug);

  if (!service) {
    return { title: "Service not found" };
  }

  return {
    title: service.name,
    description: service.blurb,
    alternates: { canonical: `/plans-pricing/${service.slug}` },
  };
}

export default async function ServiceDetailPage({ params }: PageParams) {
  const { service: slug } = await params;
  const { plans: catalog } = await loadSiteConfig();
  const service = getService(catalog, slug);

  if (!service) {
    notFound();
  }

  return <PublicServiceDetailPage catalog={catalog} service={service} />;
}
