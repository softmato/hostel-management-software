import { Suspense } from "react";

import { CancelDeletionPageContent } from "@/app/_components/cancel-deletion-page";

export default function CancelDeletionPage() {
  return (
    <Suspense>
      <CancelDeletionPageContent />
    </Suspense>
  );
}
