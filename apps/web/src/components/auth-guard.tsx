"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { checkAuthWithRefresh } from "@/lib/auth-check";

export function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    checkAuthWithRefresh()
      .then((r) => {
        if (r.ok) {
          setOk(true);
        } else {
          const next = encodeURIComponent(
            window.location.pathname + window.location.search,
          );
          router.replace(`/login?next=${next}`);
        }
      })
      .catch(() => {
        const next = encodeURIComponent(
          window.location.pathname + window.location.search,
        );
        router.replace(`/login?next=${next}`);
      });
  }, [router]);

  if (!ok) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="size-8 animate-spin rounded-full border-4 border-brand-teal border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
