import type { Metadata } from "next";

import { PublicPrivacyPage } from "@/app/_components/public-privacy-page";
import { staticPageMetadata } from "@/lib/seo-config";

export function generateMetadata(): Promise<Metadata> {
  return staticPageMetadata("privacy");
}

export default function PrivacyPage() {
  return <PublicPrivacyPage />;
}
