import type { Metadata } from "next";

import { RegistrationTrackSheet } from "@/app/_components/registration-track-sheet";
import { PORTAL_ROBOTS } from "@/lib/seo";

/** Guarded by `protectedRouteRules` (superadmins and the field team); everyone else is sent home. */
export const metadata: Metadata = {
  robots: PORTAL_ROBOTS,
  title: "Hostel Registration Track Sheet",
};

export default function HostelRegistrationTrackSheetPage() {
  return <RegistrationTrackSheet />;
}
