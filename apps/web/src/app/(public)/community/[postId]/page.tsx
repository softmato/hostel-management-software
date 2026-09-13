import type { Metadata } from "next";

import { CommunityPageContent } from "@/app/_components/community-page";
import { PLATFORM_NAME } from "@hostel/shared/brand/brand";

export const metadata: Metadata = {
  title: "Community post",
  description: `A post from the ${PLATFORM_NAME} community.`,
};

/** Permalink for a single post — what the share button hands out. */
export default async function CommunityPostPage({
  params,
}: {
  params: Promise<{ postId: string }>;
}) {
  const { postId } = await params;

  return <CommunityPageContent initialPostId={postId} />;
}
