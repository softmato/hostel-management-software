import { HostelListingPageSkeleton } from "@/components/public-page-skeletons";

/*
 * Inside the (listing) group on purpose: it covers /hostels and nothing below it.
 * One level up it wrapped every hostel and city page in a Suspense boundary, so
 * those streamed a 200 before learning whether the hostel or the city existed.
 */
export default function Loading() {
  return <HostelListingPageSkeleton />;
}
