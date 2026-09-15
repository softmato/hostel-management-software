import type { Metadata } from "next";

import { CommunityPageContent } from "@/app/_components/community-page";
import { staticPageMetadata } from "@/lib/seo-config";

export function generateMetadata(): Promise<Metadata> {
  return staticPageMetadata("community");
}

export default function CommunityPage() {
  return <CommunityPageContent />;
}
