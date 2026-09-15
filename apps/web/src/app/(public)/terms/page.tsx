import type { Metadata } from "next";

import { PublicTermsPage } from "@/app/_components/public-terms-page";
import { staticPageMetadata } from "@/lib/seo-config";

export function generateMetadata(): Promise<Metadata> {
  return staticPageMetadata("terms");
}

export default function TermsPage() {
  return <PublicTermsPage />;
}
