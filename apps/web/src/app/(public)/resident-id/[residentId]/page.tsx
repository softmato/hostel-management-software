import type { Metadata } from "next";

import { ResidentIdSharePage } from "@/app/_components/resident-id-share-page";

type PageParams = {
  params: Promise<{ residentId: string }>;
};

export const metadata: Metadata = {
  title: "Resident ID",
  description: "Share your HostelHub resident ID with a hostel.",
  // A resident ID is personal to one account — it has no business in search.
  robots: { index: false, follow: false },
};

export default async function ResidentIdPage({ params }: PageParams) {
  const { residentId } = await params;

  return <ResidentIdSharePage residentId={residentId} />;
}
