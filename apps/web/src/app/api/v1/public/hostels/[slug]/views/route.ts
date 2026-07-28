import type { NextRequest } from "next/server";

import { loadApiPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { rateLimitPublicForm } from "@/lib/rate-limit";
import {
  VISITOR_COOKIE,
  VISITOR_COOKIE_MAX_AGE_SECONDS,
  recordHostelPageView,
  resolveVisitorKey,
} from "@/modules/hostels/hostel-view.service";

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

export const runtime = "nodejs";

/**
 * Counts a visit to a hostel's public page and, in the same round trip, answers
 * "has this person browsed enough that we should offer them the one-time
 * resident profile?" — so the page needs no second request to decide.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const rateLimited = rateLimitPublicForm(request, {
      limit: 60,
      namespace: "hostel-page-view",
    });

    if (rateLimited) {
      return rateLimited;
    }

    const { slug } = await context.params;
    const principal = await loadApiPrincipal(request);
    const { isNew, visitorKey } = resolveVisitorKey(
      request.cookies.get(VISITOR_COOKIE)?.value,
    );

    const result = await recordHostelPageView({
      hostelRef: slug,
      referrer: request.headers.get("referer"),
      userAgent: request.headers.get("user-agent"),
      userId: principal?.userId,
      visitorKey,
    });

    const response = successResponse(result, "View recorded");

    if (isNew) {
      response.cookies.set(VISITOR_COOKIE, visitorKey, {
        httpOnly: true,
        maxAge: VISITOR_COOKIE_MAX_AGE_SECONDS,
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    }

    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
