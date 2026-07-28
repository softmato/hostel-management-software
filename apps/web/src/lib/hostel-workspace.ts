import { cookies } from "next/headers";

import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-cookies";
import { verifyAccessToken } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { HostelModel } from "@hostel/db/models/Hostel";

type WorkspaceHostel = {
  id: string;
  name: string;
  slug: string;
};

function isAuthBypassed() {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_UI_PREVIEW === "true"
  );
}

/** Dev-only stand-in for "the hostels this session belongs to". */
async function previewHostels(): Promise<WorkspaceHostel[]> {
  await connectToDatabase();

  const hostels = await HostelModel.find({ isDeleted: { $ne: true } })
    .select("name slug")
    .limit(10)
    .lean<Array<{ _id: { toString(): string }; name: string; slug: string }>>();

  return hostels.map((hostel) => ({
    id: hostel._id.toString(),
    name: hostel.name,
    slug: hostel.slug,
  }));
}

/**
 * The hostels the signed-in staff member may open a workspace for. Returns an
 * empty list when there is no valid session — callers redirect to login rather
 * than leaking whether a slug exists.
 */
export async function listWorkspaceHostels(): Promise<WorkspaceHostel[]> {
  const store = await cookies();
  const token = store.get(ACCESS_TOKEN_COOKIE)?.value;

  let hostelIds: string[] = [];

  if (token) {
    try {
      const payload = await verifyAccessToken(token);
      hostelIds = payload.hostelIds ?? [];
    } catch {
      hostelIds = [];
    }
  }

  // proxy.ts skips auth in development / UI-preview mode, so the portal has to
  // stay browsable there without a session. Never in production.
  if (hostelIds.length === 0) {
    return isAuthBypassed() ? previewHostels() : [];
  }

  await connectToDatabase();

  const hostels = await HostelModel.find({
    _id: { $in: hostelIds },
    isDeleted: { $ne: true },
  })
    .select("name slug")
    .lean<Array<{ _id: { toString(): string }; name: string; slug: string }>>();

  return hostels.map((hostel) => ({
    id: hostel._id.toString(),
    name: hostel.name,
    slug: hostel.slug,
  }));
}

/** The slug the portal should open by default for this staff member. */
export async function defaultWorkspaceSlug(): Promise<string | null> {
  const hostels = await listWorkspaceHostels();

  return hostels[0]?.slug ?? null;
}

/**
 * Confirms `slug` belongs to a hostel this staff member is a member of. Used by
 * the tenant-scoped routes so one admin cannot open another hostel's workspace
 * by editing the URL.
 */
export async function canAccessWorkspace(slug: string): Promise<boolean> {
  const hostels = await listWorkspaceHostels();

  return hostels.some((hostel) => hostel.slug === slug);
}

/** Display name for the workspace switcher; null when out of scope. */
export async function workspaceHostelName(slug: string): Promise<string | null> {
  const hostels = await listWorkspaceHostels();

  return hostels.find((hostel) => hostel.slug === slug)?.name ?? null;
}
