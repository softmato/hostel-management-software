import type { Metadata } from "next";

import { PublicPlansPricingPage } from "@/app/_components/public-plans-pricing-page";

export const metadata: Metadata = {
  title: "Plans & Pricing",
  description:
    "Every module and service on the platform, what plan it comes with, and what each plan costs monthly or annually.",
  alternates: { canonical: "/plans-pricing" },
};

export default function PlansPricingPage() {
  return <PublicPlansPricingPage />;
}

