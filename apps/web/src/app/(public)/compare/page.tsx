import type { Metadata } from "next";

import { PublicComparePage } from "@/app/_components/public-compare-page";
import { staticPageMetadata } from "@/lib/seo-config";

export function generateMetadata(): Promise<Metadata> {
  return staticPageMetadata("compare");
}

export default function ComparePage() {
  return <PublicComparePage />;
}
