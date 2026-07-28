"use client";

import { usePathname } from "next/navigation";
import { useCallback } from "react";

import { hostelAdminHref } from "@/lib/portal-nav";

const WORKSPACE_PATH = /^\/([^/]+)\/admin(?:\/|$)/;

/**
 * Rewrites legacy `/hostel-admin/...` links to the workspace the user is
 * currently in (`/{hostel-slug}/admin/...`). Outside a workspace the link is
 * left alone — the legacy route redirects to the right slug server-side.
 */
export function useWorkspaceHref() {
  const pathname = usePathname();
  const slug = pathname?.match(WORKSPACE_PATH)?.[1];

  return useCallback(
    (href: string) => (slug ? hostelAdminHref(slug, href) : href),
    [slug],
  );
}
