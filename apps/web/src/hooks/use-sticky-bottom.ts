"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * Sticky-*after*-you've-seen-it, for a rail taller than the viewport.
 *
 * A plain `position: sticky; top: X` pins an element the moment it reaches the
 * top, which for a tall rail means everything below its first screenful is
 * unreachable — the sponsor cards past the fold would never be seen. This
 * inverts that: the rail scrolls with the page until its *bottom* edge meets
 * the bottom of the viewport, and only then sticks.
 *
 * The mechanism is a negative `top`. `sticky` pins when the element's top
 * would cross `top` px from the viewport top, so setting
 * `top = viewportHeight - elementHeight - gap` (a negative number whenever the
 * element is taller than the screen) delays the pin by exactly the overflow.
 * A rail shorter than the viewport gets the ordinary positive offset and pins
 * at the top like anything else.
 *
 * The offset is remeasured on resize and whenever the rail's own content
 * changes height — sponsor cards arrive from the network after first paint, and
 * an offset computed against an empty rail would pin far too early.
 */
export function useStickyBottom({ gap = 24, top = 24 } = {}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(top);

  const measure = useCallback(() => {
    const element = ref.current;

    if (!element) {
      return;
    }

    const overflow = element.offsetHeight + gap - window.innerHeight;

    // Positive overflow means the rail does not fit; pin that much later.
    setOffset(overflow > 0 ? -overflow : top);
  }, [gap, top]);

  // Layout effect, not effect: the offset is a style the first paint needs, and
  // computing it after paint shows the rail pinned at the wrong place for a frame.
  useLayoutEffect(() => {
    measure();

    const element = ref.current;
    const observer = element ? new ResizeObserver(measure) : null;

    observer?.observe(element!);
    window.addEventListener("resize", measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  return { ref, style: { position: "sticky" as const, top: offset } };
}
