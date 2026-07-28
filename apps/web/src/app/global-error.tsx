"use client";

import { AppErrorRecovery } from "@/components/app-error-recovery";

import "./globals.css";

/**
 * Last line of defence: this catches failures in the root layout itself — the
 * layer `error.tsx` cannot reach — which is exactly where a stale portal-shell
 * chunk blows up. It replaces the whole document, so it renders its own
 * html/body.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <AppErrorRecovery error={error} reset={reset} />
      </body>
    </html>
  );
}
