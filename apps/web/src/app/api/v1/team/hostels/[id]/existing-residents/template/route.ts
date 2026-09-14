import { fieldTeamExistingResidents } from "@/modules/residents/existing-residents.routes";

export const runtime = "nodejs";

/** The blank Excel file, with this hostel's room types on its help sheet. */
export const { GET } = fieldTeamExistingResidents.template;
