import { PlatformConfigPlanServicePageContent } from "@/app/_components/platform-config-plan-service-page";

/**
 * Nothing is resolved on the server: the catalogue this reads is the admin's
 * own draft, loaded client-side with the rest of the site config, so an unknown
 * slug is answered by the screen rather than by a 404 from a build-time list.
 */
export default async function PlatformConfigPlanServicePage({
  params,
}: {
  params: Promise<{ service: string }>;
}) {
  const { service } = await params;

  return <PlatformConfigPlanServicePageContent slug={service} />;
}
