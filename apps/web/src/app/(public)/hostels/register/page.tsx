import type { Metadata } from "next";

import { PublicHostelRegistrationPage } from "@/app/_components/public-hostel-registration-page";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = {
  // The same form as /register-hostel/form, kept for old links.
  robots: NOINDEX,
  title: "Register your hostel",
};

export default function HostelRegistrationPage() {
  return <PublicHostelRegistrationPage />;
}
