import type { Metadata } from "next";

import { PublicBlogPage } from "@/app/_components/public-blog-page";

/**
 * Unlinked and unindexed until the posts are real.
 *
 * The six articles this renders are placeholders — invented titles and dates,
 * stock photography, and no detail routes behind them. The header entry has
 * been removed and the sitemap never listed the page, so `noindex` closes the
 * last door: a search engine that reaches it some other way should not put
 * fabricated articles in front of anyone under the platform's name.
 *
 * Delete this `robots` block and restore the header entry together, once there
 * is something here worth reading.
 */
export const metadata: Metadata = {
  description: "Guides and updates for hostel owners, residents and parents in Nepal.",
  robots: { follow: false, index: false },
  title: "Blog",
};

export default function BlogPage() {
  return <PublicBlogPage />;
}
