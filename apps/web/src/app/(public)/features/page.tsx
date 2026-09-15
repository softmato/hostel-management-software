import type { Metadata } from "next";

import { FeaturesHubPage } from "@/app/_components/public-software-pages";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbJsonLd, itemListJsonLd } from "@/lib/json-ld";
import {
  loadSeo,
  resolveModulePages,
  resolveSeoPage,
  staticPageMetadata,
} from "@/lib/seo-config";

export function generateMetadata(): Promise<Metadata> {
  return staticPageMetadata("features", { eyebrow: "Features" });
}

export default async function FeaturesPage() {
  const { config, fill, seo } = await loadSeo();
  const modules = resolveModulePages(seo, config.plans, fill);
  const { description, title } = resolveSeoPage(seo, "features", fill);

  return (
    <>
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Features", path: "/features" },
          ]),
          itemListJsonLd(
            title,
            modules.map((entry) => ({ name: entry.headline, path: `/features/${entry.slug}` })),
          ),
        ]}
      />
      <FeaturesHubPage description={description} modules={modules} title={title} />
    </>
  );
}
