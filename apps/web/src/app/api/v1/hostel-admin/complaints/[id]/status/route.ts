import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { updateComplaintStatus } from "@/modules/complaints/complaint.service";
import { complaintStatusUpdateSchema } from "@/modules/complaints/complaint.validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelCapability(request, "updateComplaints");
    const { id } = await context.params;
    const input = complaintStatusUpdateSchema.parse(await request.json());
    const result = await updateComplaintStatus(id, input, principal);

    return successResponse(result, "Complaint status updated");
  } catch (error) {
    return handleRouteError(error);
  }
}
