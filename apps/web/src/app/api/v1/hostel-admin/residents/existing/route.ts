import { hostelStaffExistingResidents } from "@/modules/residents/existing-residents.routes";

export const runtime = "nodejs";

export const { DELETE, GET, PUT } = hostelStaffExistingResidents.list;
