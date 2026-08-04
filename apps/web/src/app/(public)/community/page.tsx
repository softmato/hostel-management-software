import type { Metadata } from "next";

import { CommunityPageContent } from "@/app/_components/community-page";

export const metadata: Metadata = {
  title: "Community",
  description:
    "Ask questions, share photos and videos, and hear from people actually living in hostels across Nepal.",
  alternates: { canonical: "/community" },
};

export default function CommunityPage() {
  return <CommunityPageContent />;
}
