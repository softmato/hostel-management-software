import { NextResponse, type NextRequest } from "next/server";

import { loadSiteConfig } from "@/lib/site-config-server";

export const dynamic = "force-dynamic";

/**
 * The one link the team's QR codes and the install banner point at.
 *
 * - Android: the uploaded APK when there is one (the browser starts the
 *   download straight away), else the Play listing.
 * - iPhone/iPad: there is no App Store build yet, so the home page with
 *   `?install=ios`, which opens the Add to Home Screen sheet.
 * - Anything else (a laptop that opened the link): the Play listing.
 *
 * A redirect rather than a page, so the stored URLs can change without any
 * printed QR going stale.
 */
export async function GET(request: NextRequest) {
  const agent = request.headers.get("user-agent") ?? "";
  const { apps } = await loadSiteConfig();

  if (/iPhone|iPad|iPod/i.test(agent)) {
    return NextResponse.redirect(new URL("/?install=ios", request.url));
  }

  const target =
    (/Android/i.test(agent) && apps.androidApkUrl) || apps.androidPlayUrl || "/";

  return NextResponse.redirect(new URL(target, request.url));
}
