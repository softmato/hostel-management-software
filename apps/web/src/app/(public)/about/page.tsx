import type { Metadata } from "next";

import { PublicAboutPage } from "@/app/_components/public-about-page";
import { staticPageMetadata } from "@/lib/seo-config";

export function generateMetadata(): Promise<Metadata> {
  return staticPageMetadata("about");
}

export default function AboutPage() {
  return <PublicAboutPage />;
}
