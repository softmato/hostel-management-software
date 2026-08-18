import * as Haptics from "expo-haptics";
import { useCallback, useMemo } from "react";

import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import type { PublicHostel } from "@/lib/public-api";
import { refreshedSnapshots, savedSnapshot } from "@/lib/saved-hostels";
import { refreshSaved, toggleSaved, unsaveHostel } from "@/store/slices/savedSlice";

/**
 * The favourites list, and the one way to change it.
 *
 * Every heart in the app goes through `toggle`, so the snapshot written on save
 * is built one way — a second call site that stored an id and left the strings
 * off would render a blank card in the Favourites row and only on a device that
 * had saved that hostel.
 *
 * There is deliberately **no toast**. A heart fills and the phone taps back;
 * a message per tap on a row of six cards is noise, and the "kept on this
 * device" caveat belongs on the section header where it is always visible rather
 * than in something that disappears.
 */
export function useSavedHostels() {
  const dispatch = useAppDispatch();
  const items = useAppSelector((state) => state.saved.items);

  const ids = useMemo(() => new Set(items.map((item) => item.id)), [items]);

  const toggle = useCallback(
    (hostel: PublicHostel) => {
      void Haptics.selectionAsync();
      dispatch(toggleSaved(savedSnapshot(hostel)));
    },
    [dispatch],
  );

  /**
   * Unsaving from the Favourites row, which holds snapshots rather than
   * listings.
   *
   * Separate from `toggle` because that one takes a `PublicHostel` and builds a
   * snapshot from its photos, location and pricing before it can even decide it
   * is removing something. A stored favourite has none of those fields, so
   * calling `toggle` with a stub cast to `PublicHostel` would throw on the way
   * to deleting it.
   */
  const remove = useCallback(
    (id: string) => {
      void Haptics.selectionAsync();
      dispatch(unsaveHostel(id));
    },
    [dispatch],
  );

  /**
   * Folds fresher prices and photos into whatever is already saved.
   *
   * Safe to call from an effect on every payload: `refreshedSnapshots` returns
   * `null` unless something actually differs, so an unchanged catalogue
   * dispatches nothing and writes nothing to disk.
   */
  const sync = useCallback(
    (hostels: PublicHostel[]) => {
      const next = refreshedSnapshots(items, hostels);

      if (next) {
        dispatch(refreshSaved(next));
      }
    },
    [dispatch, items],
  );

  return { ids, items, remove, sync, toggle };
}
