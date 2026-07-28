import { redirectToWorkspaceScreen } from "@/app/_components/legacy-hostel-admin-redirect";

export default async function LegacyHostelAdminPaymentsPage() {
  return redirectToWorkspaceScreen("payments");
}
