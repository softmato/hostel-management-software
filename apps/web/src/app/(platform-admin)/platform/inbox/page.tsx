import { NotificationsPageContent } from "@/app/_components/notifications-page";

/**
 * Platform staff's personal notification feed — hostel approvals and service
 * provider applications waiting on them, chiefly. The header bell used to point
 * at the audit log, which records what everyone did rather than what this
 * person still has to do.
 */
export default function PlatformInboxPage() {
  return <NotificationsPageContent />;
}
