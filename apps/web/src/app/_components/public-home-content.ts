/**
 * Static copy for the home page's category tiles and trust points.
 *
 * The hostels themselves are never hard-coded here — every card and every count
 * on the home page is derived from `GET /api/v1/public/hostels`, the same source
 * the listing page reads. What lives here is wording that has no database home.
 */
import type { HostelSummary } from "@/app/_components/public-hostel-types";

export const CITY_OPTIONS = [
  "Kathmandu",
  "Pokhara",
  "Lalitpur",
  "Bhaktapur",
  "Biratnagar",
];

export const HOSTEL_TYPE_STATS: Array<{
  type: HostelSummary["type"];
  label: string;
  description: string;
}> = [
  {
    description: "Safe, comfortable and affordable accommodation for boys.",
    label: "Boys Hostels",
    type: "boys",
  },
  {
    description: "Secure and friendly spaces for female students.",
    label: "Girls Hostels",
    type: "girls",
  },
  {
    description: "Modern co-living spaces to live, study and grow together.",
    label: "Co-living Spaces",
    type: "co-living",
  },
];

export const FACILITY_STATS: Array<{ label: string }> = [
  { label: "WiFi" },
  { label: "Food Included" },
  { label: "Laundry" },
  { label: "Parking" },
  { label: "Attached Bathroom" },
  { label: "Hot Water" },
  { label: "Study Room" },
  { label: "CCTV" },
  { label: "Generator" },
];

export const TRUST_POINTS = [
  {
    description: "All hostels are verified for authenticity and quality.",
    title: "Verified Hostels",
  },
  {
    description: "No hidden charges. What you see is what you pay.",
    title: "Transparent Pricing",
  },
  {
    description: "24/7 support and safety-first approach for every student.",
    title: "Safe & Secure",
  },
  {
    description: "Real reviews from students like you to help you decide.",
    title: "Student Reviews",
  },
  {
    description: "Parents trust us for their child's safety and well-being.",
    title: "Trusted by Families",
  },
  {
    description: "Friendly support team ready to help you anytime.",
    title: "Dedicated Support",
  },
];
