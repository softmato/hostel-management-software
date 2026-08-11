import { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { ResidentModel } from "@hostel/db/models/Resident";

/**
 * The residents whose money a hostel-facing screen may count.
 *
 * Deleting a resident is soft, so **their invoices stay in the ledger** — which
 * is correct, because an audit trail may not lose rows. What is not correct is
 * every reader deciding for itself whether those rows count, which is what was
 * happening: the payments matrix excluded them, the month picker's badge
 * included them, and the same August read "1 resident" and "2 needing
 * attention" on one screen.
 *
 * This has now been the same bug three times — the dashboard's resident count,
 * the matrix's resurrected rows, and the picker badge — so the rule gets one
 * home rather than a fourth reimplementation.
 *
 * **Deleted, not moved out.** A resident who left still owes what they owe and
 * must keep appearing until it is settled or written off; only `isDeleted`
 * removes someone from the product. Filtering on `status` here would quietly
 * erase real debt.
 */
export async function countableResidentIds(
  hostelId: Types.ObjectId | string,
): Promise<Types.ObjectId[]> {
  await connectToDatabase();

  const residents = await ResidentModel.find({ hostelId, isDeleted: { $ne: true } })
    .select("_id")
    .lean<{ _id: Types.ObjectId }[]>();

  return residents.map((resident) => resident._id);
}
