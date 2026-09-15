import type { Metadata } from "next";

import { staticPageMetadata } from "@/lib/seo-config";

import { LoginForm } from "./login-form";

/** The (auth) group is noindex; this page opts back in. */
export async function generateMetadata(): Promise<Metadata> {
  return { ...(await staticPageMetadata("login")), robots: { follow: true, index: true } };
}

export default function LoginPage() {
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

  return <LoginForm googleClientId={googleClientId} />;
}
