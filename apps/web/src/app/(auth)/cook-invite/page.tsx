import { Suspense } from "react";

import { CookInvitePageContent } from "@/app/_components/cook-invite-page";

export default function CookInvitePage() {
  return (
    <Suspense>
      <CookInvitePageContent />
    </Suspense>
  );
}
