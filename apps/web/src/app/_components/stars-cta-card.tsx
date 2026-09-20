"use client";

import type { ReactNode } from "react";

import { StarsBackground } from "@/components/animate-ui/components/backgrounds/stars";
import { cn } from "@/lib/utils";

type StarsCtaCardProps = {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

/**
 * The public site's high-emphasis callout treatment.
 *
 * Keeping the stars inside their own inert layer lets callers retain normal
 * links and editable content while every public CTA gets the same branded
 * treatment.
 */
export function StarsCtaCard({
  children,
  className,
  contentClassName,
}: StarsCtaCardProps) {
  return (
    <section
      className={cn(
        "relative isolate overflow-hidden rounded-2xl border border-brand-teal/60 shadow-sm",
        className,
      )}
    >
      <StarsBackground
        aria-hidden
        className="absolute inset-0 z-0 h-full w-full bg-[radial-gradient(ellipse_at_bottom,_#087d47_0%,_#023a25_72%)]"
        factor={0.025}
        pointerEvents={false}
        speed={65}
        starColor="#d6ffe6"
      />
      <div className={cn("relative z-10", contentClassName)}>{children}</div>
    </section>
  );
}
