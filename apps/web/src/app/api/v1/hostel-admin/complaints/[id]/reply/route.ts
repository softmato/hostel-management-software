import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { replyToComplaint } from "@/modules/complaints/complaint.service";
import { complaintReplySchema } from "@/modules/complaints/complaint.validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelCapability(request, "updateComplaints");
    const { id } = await context.params;
    const input = complaintReplySchema.parse(await request.json());
    const result = await replyToComplaint(id, input, principal);

    return successResponse(result, "Complaint reply saved", { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
