import { fieldTeamExistingResidents } from "@/modules/residents/existing-residents.routes";

export const runtime = "nodejs";
// Adding a long list runs the billing for every unpaid month.
export const maxDuration = 300;

export const { POST } = fieldTeamExistingResidents.add;
