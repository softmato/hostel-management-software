import { redirectToWorkspaceScreen } from "@/app/_components/legacy-hostel-admin-redirect";

/** Booking bells and emails link here; it lands on the hostel's own workspace. */
export default async function LegacyHostelAdminBookingsPage() {
  return redirectToWorkspaceScreen("bookings");
}
