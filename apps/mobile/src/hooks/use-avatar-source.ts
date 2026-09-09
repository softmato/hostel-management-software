import { useCallback } from "react";

import { useAppSelector } from "@/hooks/redux";
import { avatarPhotoSource } from "@/lib/avatar";
import { API_BASE_URL } from "@/lib/api";

/**
 * Turns a stored `User.image` into something `<Avatar>` can actually load.
 *
 * A face is the one piece of a person the app draws in a dozen places — the
 * account's own header, a resident's record, a roster row — so this is a hook
 * that returns a *function* rather than a resolved source. A screen with one
 * avatar calls it once; a list calls it per row, inside the `map`, where a hook
 * cannot go.
 *
 * The token comes from the store rather than each caller, because forgetting it
 * fails the same silent way a missing origin does: an empty circle with an
 * initial in it, indistinguishable from somebody who never uploaded a photo.
 *
 * ```tsx
 * const avatarSource = useAvatarSource();
 * const photo = avatarSource(resident.account?.image);
 *
 * <Avatar headers={photo?.headers} name={fullName} uri={photo?.uri} />
 * ```
 */
export function useAvatarSource() {
  const token = useAppSelector((state) => state.auth.accessToken);

  return useCallback(
    (image: string | null | undefined) =>
      avatarPhotoSource(image, { baseUrl: API_BASE_URL, token }),
    [token],
  );
}
