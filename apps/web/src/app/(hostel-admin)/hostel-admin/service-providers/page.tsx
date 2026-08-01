import { redirectToWorkspaceScreen } from "@/app/_components/legacy-hostel-admin-redirect";

export default async function LegacyHostelAdminServiceProvidersPage() {
  // Service Providers is now part of the Maintenance screen.
  return redirectToWorkspaceScreen("maintenance");
}
