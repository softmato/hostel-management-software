import { Suspense } from "react";

import { PlatformSettingChangeConfirmPageContent } from "@/app/_components/platform-setting-change-confirm-page";

export default function PlatformSettingChangeConfirmPage() {
  return (
    <Suspense>
      <PlatformSettingChangeConfirmPageContent />
    </Suspense>
  );
}
