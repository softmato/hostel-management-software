import { Suspense } from "react";

import { PlatformAdminInvitePageContent } from "@/app/_components/platform-admin-invite-page";

export default function PlatformAdminInvitePage() {
  return (
    <Suspense>
      <PlatformAdminInvitePageContent />
    </Suspense>
  );
}
