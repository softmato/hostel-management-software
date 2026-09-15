import type { Metadata } from "next";

import { SoftwarePage } from "@/app/_components/public-software-pages";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbJsonLd, faqJsonLd, softwareApplicationJsonLd } from "@/lib/json-ld";
import {
  loadSeo,
  resolveModulePages,
  resolveSeoPage,
  resolveSoftwarePage,
  staticPageMetadata,
} from "@/lib/seo-config";

/**
 * The page for "hostel management system", "hostel software Nepal" and every
 * owner who is ready to choose one. `/hostel-management-system` redirects here.
 */
export function generateMetadata(): Promise<Metadata> {
  return staticPageMetadata("software", { eyebrow: "For hostel owners" });
}

export default async function HostelManagementSoftwarePage() {
  const { config, fill, seo } = await loadSeo();
  const page = resolveSoftwarePage(seo, fill);
  const modules = resolveModulePages(seo, config.plans, fill);

  return (
    <>
      <JsonLd
        data={[
          softwareApplicationJsonLd({
            description: resolveSeoPage(seo, "software", fill).description,
            features: modules.map((entry) => entry.headline),
            monthlyPrices: config.plans.plans.map((plan) => plan.monthly),
          }),
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Hostel management software", path: "/hostel-management-software" },
          ]),
          faqJsonLd(page.faq),
        ]}
      />
      <SoftwarePage
        comparisons={seo.comparisons.map((comparison) => ({
          href: `/vs/${comparison.slug}`,
          name: comparison.name,
        }))}
        modules={modules}
        page={page}
        plans={config.plans.plans}
      />
    </>
  );
}
