import { TeamHostelResidentsPage } from "@/app/_components/team-hostel-residents-page";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ published?: string }>;
};

export default async function TeamHostelResidentsRoute({ params, searchParams }: Props) {
  const { id } = await params;
  const { published } = await searchParams;

  return <TeamHostelResidentsPage hostelId={id} justPublished={published === "1"} />;
}
