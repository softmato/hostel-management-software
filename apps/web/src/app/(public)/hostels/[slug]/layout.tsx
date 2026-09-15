import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { loadHostel, loadSearchPhotos } from "./load-hostel";

type LayoutProps = {
  children: ReactNode;
  params: Promise<{ slug: string }>;
};

/**
 * Settles whether the hostel exists before a byte is sent.
 *
 * `loading.tsx` beside this file wraps the page in a Suspense boundary, and a
 * streamed response has committed to 200 by the time the page learns the slug
 * is gone. Live, a removed hostel answered "200, noindex" — a soft 404 in Search
 * Console — and a failed database read would have rendered as a 200 error page.
 *
 * A layout renders outside its own segment's loading boundary, so both reads
 * happen here: a missing hostel is a real 404, a failed read a real 5xx, and
 * client-side navigation still shows the skeleton. The page and its metadata
 * get the same cached values.
 */
export default async function HostelLayout({ children, params }: LayoutProps) {
  const { slug } = await params;

  if (!(await loadHostel(slug))) {
    notFound();
  }

  await loadSearchPhotos(slug);

  return children;
}
