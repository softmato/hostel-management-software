import { ResidentCheckoutPageContent } from "@/app/_components/resident-checkout-page";

export default async function ResidentCheckoutPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;

  return <ResidentCheckoutPageContent reference={decodeURIComponent(reference)} />;
}
