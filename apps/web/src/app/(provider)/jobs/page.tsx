import type { Metadata } from "next";

import { ProviderJobsPage } from "@/app/_components/provider-jobs-page";

export const metadata: Metadata = {
  description: "Maintenance jobs hostels have assigned to you.",
  // Nothing here is useful to a search engine — it is one signed-in account's
  // work list, and it renders empty for everybody else.
  robots: { follow: false, index: false },
  title: "Your jobs",
};

export default function JobsPage() {
  return <ProviderJobsPage />;
}
