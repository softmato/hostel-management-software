import { redirectToWorkspaceScreen } from "@/app/_components/legacy-hostel-admin-redirect";

type HostelAdminScreenPageProps = {
  params: Promise<{
    screen: string;
  }>;
};

export default async function HostelAdminScreenPage({
  params,
}: HostelAdminScreenPageProps) {
  const { screen } = await params;

  return redirectToWorkspaceScreen(screen);
}
