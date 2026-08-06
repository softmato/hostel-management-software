import type { Metadata } from "next";

import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  // Reached from an emailed link carrying a single-use token — never indexed.
  robots: { follow: false, index: false },
  title: "Reset password",
};

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
