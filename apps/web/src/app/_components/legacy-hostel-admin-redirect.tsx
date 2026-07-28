import { redirect } from "next/navigation";

import { defaultWorkspaceSlug } from "@/lib/hostel-workspace";

/**
 * Bridges the pre-tenant URLs (`/hostel-admin/payments`) to the tenant-scoped
 * ones (`/green-view-hostel/admin/payments`). Bookmarks, emailed links and the
 * post-login landing path all still resolve.
 */
export async function redirectToWorkspaceScreen(screen: string): Promise<never> {
  const slug = await defaultWorkspaceSlug();

  redirect(slug ? `/${slug}/admin/${screen}` : "/login?next=/hostel-admin/dashboard");
}
