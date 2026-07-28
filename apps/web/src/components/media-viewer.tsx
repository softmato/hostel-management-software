"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { MediaLightbox, type LightboxItem } from "@/components/media-lightbox";

/**
 * The app-wide media viewer.
 *
 * Any screen can hand it a set of images or videos and an index; the overlay
 * itself is mounted once at the root and portals to `document.body`, so a
 * thumbnail buried in a scrolling panel opens the same full-screen viewer as
 * one on a public page. Screens that need their own inline instance can still
 * render {@link MediaLightbox} directly.
 */

type MediaViewerContextValue = {
  close: () => void;
  /** Opens the viewer on `items[index]`. A single item is fine. */
  open: (items: LightboxItem[], index?: number) => void;
};

const MediaViewerContext = createContext<MediaViewerContextValue | null>(null);

export function MediaViewerProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<LightboxItem[]>([]);
  const [index, setIndex] = useState(0);

  const open = useCallback((next: LightboxItem[], startIndex = 0) => {
    const usable = next.filter((item) => Boolean(item.src));

    if (usable.length === 0) {
      return;
    }

    setItems(usable);
    setIndex(Math.min(Math.max(startIndex, 0), usable.length - 1));
  }, []);

  const close = useCallback(() => setItems([]), []);

  const value = useMemo(() => ({ close, open }), [close, open]);

  return (
    <MediaViewerContext.Provider value={value}>
      {children}
      {items.length > 0 ? (
        <MediaLightbox
          index={index}
          items={items}
          onClose={close}
          onIndexChange={setIndex}
        />
      ) : null}
    </MediaViewerContext.Provider>
  );
}

export function useMediaViewer() {
  const context = useContext(MediaViewerContext);

  if (!context) {
    throw new Error("useMediaViewer must be used inside <MediaViewerProvider>.");
  }

  return context;
}
