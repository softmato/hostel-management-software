import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import {
  createFeeSchedule,
  listFeeSchedules,
} from "@/modules/finance/fee-schedule.service";
import {
  feeScheduleCreateSchema,
  feeScheduleListQuerySchema,
} from "@/modules/finance/fee-schedule.validation";
import { resolveAdminHostelId } from "@/modules/hostels/hostel.service";

export const runtime = "nodejs";

/**
 * The rate card (target §3.3 / §11.9, plan item 3.2).
 *
 * The full history, newest first — not only the open row. A closed schedule is
 * how "what was this resident's rent in March?" gets an answer, which the bare
 * `Resident.monthlyFee` it replaces never had.
 */
export async function GET(request: NextRequest) {
  try {
    const principal = await requireHostelCapability(request, "viewPayments");
    const query = feeScheduleListQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const hostelId = resolveAdminHostelId(principal, query.hostelId);

    return successResponse(
      { schedules: await listFeeSchedules(hostelId) },
      "Fee schedules",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * Opens a new schedule and closes the current one the day before it starts.
 *
 * There is deliberately no PUT: a schedule is never edited (target §3.3). An
 * edit would silently rewrite the basis of every invoice already issued from it,
 * which is the behaviour of the bulk fee-setter this replaces.
 */
export async function POST(request: NextRequest) {
  try {
    const principal = await requireHostelCapability(request, "manageFeeSchedule");
    const input = feeScheduleCreateSchema.parse(await request.json());
    const hostelId = resolveAdminHostelId(principal, input.hostelId);

    return successResponse(
      { schedule: await createFeeSchedule(hostelId, input, principal) },
      "Rate card updated",
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
