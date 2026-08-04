import type { Metadata } from "next";

import { CommunityPageContent } from "@/app/_components/community-page";

export const metadata: Metadata = {
  title: "Community post",
  description: "A post from the HostelHub community.",
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
