import type { NextRequest } from "next/server";

import { afterResponse } from "@/lib/after-response";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { recordListingAppearances } from "@/modules/hostels/hostel-impression.service";
import { listPublicHostels } from "@/modules/hostels/hostel.service";
import { publicHostelListQuerySchema } from "@/modules/hostels/hostel.validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const query = publicHostelListQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const result = await listPublicHostels(query);

    // Every card in this list is one search appearance for its hostel — the
    // number the owner's performance report shows beside page views.
    afterResponse(() =>
      recordListingAppearances(result.hostels.map((hostel) => hostel.id)),
    );

    return successResponse(result, "Public hostels loaded");
  } catch (error) {
    return handleRouteError(error);
  }
}
