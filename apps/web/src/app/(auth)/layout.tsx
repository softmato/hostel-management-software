import type { Metadata } from "next";

import { NOINDEX } from "@/lib/seo";

/**
 * Invites, activations, email verification, password resets and deletion
 * cancels are single-use links for one person, so the group stays out of search.
 * Log in and Sign up opt back in on their own pages — someone typing
 * "hostelpalika login" should land on the real thing.
 */
export const metadata: Metadata = { robots: NOINDEX };

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
