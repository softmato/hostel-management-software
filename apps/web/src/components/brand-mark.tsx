import { PLATFORM_NAME } from "@hostel/shared/brand/brand";
import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * The HP mark. Height comes from `className`; width follows the art.
 *
 * `adaptive` swaps in the white-H variant under `.dark` — only for surfaces that
 * follow the theme. The hard-coded light screens (auth, activation) leave it off,
 * or a dark-mode visitor would get a white H on a white page.
 */
export function BrandMark({ adaptive = false, className }: { adaptive?: boolean; className?: string }) {
  const size = cn("h-7 w-auto shrink-0", className);

  return (
    <>
      <Image
        alt={PLATFORM_NAME}
        className={cn(size, adaptive && "dark:hidden")}
        height={571}
        priority
        src="/brand/hostelpalika-mark.png"
        width={892}
      />
      {adaptive ? (
        <Image
          alt=""
          aria-hidden
          className={cn(size, "hidden dark:block")}
          height={571}
          src="/brand/hostelpalika-mark-light.png"
          width={892}
        />
      ) : null}
    </>
  );
}
