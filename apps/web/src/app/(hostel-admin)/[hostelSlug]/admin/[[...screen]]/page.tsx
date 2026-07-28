import { notFound, redirect } from "next/navigation";

import { HOSTEL_ADMIN_SCREENS } from "@/app/_components/hostel-admin-screens";

type HostelAdminWorkspacePageProps = {
  params: Promise<{ hostelSlug: string; screen?: string[] }>;
};

export default async function HostelAdminWorkspacePage({
  params,
}: HostelAdminWorkspacePageProps) {
  const { hostelSlug, screen } = await params;

  if (!screen || screen.length === 0) {
    redirect(`/${hostelSlug}/admin/dashboard`);
  }

  if (screen.length > 1) {
    notFound();
  }

  const render = HOSTEL_ADMIN_SCREENS[screen[0]];

  if (!render) {
    notFound();
  }

  return render(hostelSlug);
}
