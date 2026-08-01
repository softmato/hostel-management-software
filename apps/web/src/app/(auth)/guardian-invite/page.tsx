import { Suspense } from "react";

import { GuardianInvitePageContent } from "@/app/_components/guardian-invite-page";

export default function GuardianInvitePage() {
  return (
    <Suspense>
      <GuardianInvitePageContent />
    </Suspense>
  );
}
