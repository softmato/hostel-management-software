import { Suspense } from "react";

import { ResidentActivationPageContent } from "@/app/_components/resident-activation-page";

export default function ResidentActivationPage() {
  return (
    <Suspense>
      <ResidentActivationPageContent />
    </Suspense>
  );
}
