import type { Metadata } from "next";

import {
  PublicServiceProviderDirectoryPage,
  type ProviderDirectoryData,
} from "@/app/_components/public-service-provider-directory-page";
import { listPublicServiceProviders } from "@/modules/service-providers/service-provider.service";
import { publicServiceProviderListQuerySchema } from "@/modules/service-providers/service-provider.validation";

export const metadata: Metadata = {
  title: "Verified Service Providers",
  description:
    "Browse plumbers, electricians, clinics and other verified service providers available to hostels across Nepal.",
  alternates: { canonical: "/service-providers" },
};

const EMPTY: ProviderDirectoryData = { countsByCategory: {}, providers: [], total: 0 };

type DirectoryPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Read on the server so the directory is crawlable — it is a public marketing
 * surface, not a portal screen. A failed read renders the error state rather
 * than taking the page down.
 */
export default async function ServiceProviderDirectoryPage({
  searchParams,
}: DirectoryPageProps) {
  const params = await searchParams;
  const query = publicServiceProviderListQuerySchema.safeParse({
    area: typeof params.area === "string" ? params.area : undefined,
    category: typeof params.category === "string" ? params.category : undefined,
    city: typeof params.city === "string" ? params.city : undefined,
  });
  const parsed = query.success ? query.data : {};

  let data = EMPTY;
  let loadFailed = false;

  try {
    data = await listPublicServiceProviders(parsed);
  } catch {
    loadFailed = true;
  }

  return (
    <PublicServiceProviderDirectoryPage
      activeCategory={parsed.category}
      data={data}
      loadFailed={loadFailed}
    />
  );
}
