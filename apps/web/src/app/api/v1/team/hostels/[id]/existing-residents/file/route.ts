import { fieldTeamExistingResidents } from "@/modules/residents/existing-residents.routes";

export const runtime = "nodejs";

/** Reads an uploaded Excel or CSV file onto the list. */
export const { POST } = fieldTeamExistingResidents.file;
