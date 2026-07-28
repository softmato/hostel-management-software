import { redirectToWorkspaceScreen } from "@/app/_components/legacy-hostel-admin-redirect";

export default async function LegacyHostelAdminServiceProvidersPage() {
  return redirectToWorkspaceScreen("service-providers");
}
