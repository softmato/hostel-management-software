/**
 * One rule for picking hostel imagery, used by every surface that shows a
 * photo.
 *
 * Each photo has a home: EXTERIOR is the hostel's first look (listing cards,
 * cover), INTERIOR fills the public gallery, and a ROOM photo belongs to one
 * entry of `roomConfigurations`. A surface always leads with the photos that
 * live there; anything else the admin uploaded then queues up behind as a
 * fallback, so a hostel with only room shots still looks photographed
 * everywhere. Only when nothing at all has been uploaded do we fall back to
 * the stock image.
 */

export type HostelPhotoKind = "EXTERIOR" | "INTERIOR" | "ROOM";

export type HostelPhoto = {
  alt?: string;
  id?: string;
  kind?: HostelPhotoKind | string;
  roomType?: string;
  url?: string;
};

/** Preference order per surface: the surface's own kind leads. */
const FALLBACK_ORDER: Record<HostelPhotoKind, HostelPhotoKind[]> = {
  EXTERIOR: ["EXTERIOR", "INTERIOR", "ROOM"],
  INTERIOR: ["INTERIOR", "EXTERIOR", "ROOM"],
  ROOM: ["ROOM", "INTERIOR", "EXTERIOR"],
};

function kindOf(photo: HostelPhoto): HostelPhotoKind {
  return photo.kind === "EXTERIOR" || photo.kind === "ROOM" ? photo.kind : "INTERIOR";
}

export function photosOfKind(
  photos: readonly HostelPhoto[] | undefined,
  kind: HostelPhotoKind,
  roomType?: string,
) {
  return (photos ?? []).filter(
    (photo) =>
      Boolean(photo.url) &&
      kindOf(photo) === kind &&
      (kind !== "ROOM" || !roomType || photo.roomType === roomType),
  );
}

/**
 * Photos for one surface, best first: its own kind, then everything else in
 * fallback order. Never empty unless nothing was uploaded at all.
 *
 * @param roomType narrows the leading ROOM photos to a single room type.
 */
export function resolveHostelPhotos(
  photos: readonly HostelPhoto[] | undefined,
  surface: HostelPhotoKind,
  roomType?: string,
): HostelPhoto[] {
  const seen = new Set<string>();
  const resolved: HostelPhoto[] = [];

  const push = (candidates: HostelPhoto[]) => {
    for (const photo of candidates) {
      const url = photo.url ?? "";
      if (url && !seen.has(url)) {
        seen.add(url);
        resolved.push(photo);
      }
    }
  };

  // The room type's own shots lead; other room types' shots still beat nothing.
  if (surface === "ROOM" && roomType) {
    push(photosOfKind(photos, "ROOM", roomType));
  }

  for (const kind of FALLBACK_ORDER[surface]) {
    push(photosOfKind(photos, kind));
  }

  return resolved;
}

export function resolveHostelPhotoUrls(
  photos: readonly HostelPhoto[] | undefined,
  surface: HostelPhotoKind,
  roomType?: string,
): string[] {
  return resolveHostelPhotos(photos, surface, roomType)
    .map((photo) => photo.url ?? "")
    .filter(Boolean);
}

/**
 * True when the admin has uploaded nothing at all — the trigger for the
 * "please upload photos" snackbar across the admin portal.
 */
export function hasNoHostelPhotos(photos: readonly HostelPhoto[] | undefined) {
  return (photos ?? []).every((photo) => !photo.url);
}
