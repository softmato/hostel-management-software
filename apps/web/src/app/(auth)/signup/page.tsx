import type { Metadata } from "next";

import { staticPageMetadata } from "@/lib/seo-config";

import { SignupForm } from "./signup-form";

/** The (auth) group is noindex; this page opts back in. */
export async function generateMetadata(): Promise<Metadata> {
  return { ...(await staticPageMetadata("signup")), robots: { follow: true, index: true } };
}

export default function SignupPage() {
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

  return <SignupForm googleClientId={googleClientId} />;
}
