import type { Metadata } from "next";

import { PublicHostelRegistrationLandingPage } from "@/app/_components/public-hostel-registration-landing-page";
import { staticPageMetadata } from "@/lib/seo-config";

export function generateMetadata(): Promise<Metadata> {
  return staticPageMetadata("registerHostel");
}

export default function RegisterHostelPage() {
  return <PublicHostelRegistrationLandingPage />;
}
