"use client";

import { AppErrorRecovery } from "@/components/app-error-recovery";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <AppErrorRecovery error={error} reset={reset} />;
}
