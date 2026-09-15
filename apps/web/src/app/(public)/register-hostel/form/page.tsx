import type { Metadata } from "next";

import { PublicHostelRegistrationPage } from "@/app/_components/public-hostel-registration-page";
import { AuthGuard } from "@/components/auth-guard";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = {
  // A signed-in form step; /register-hostel is the page search should show.
  robots: NOINDEX,
  title: "Register your hostel",
};

export default function RegisterHostelFormPage() {
  return (
    <AuthGuard>
      <PublicHostelRegistrationPage />
    </AuthGuard>
  );
}
