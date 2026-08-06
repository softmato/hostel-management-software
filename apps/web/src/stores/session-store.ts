import { create } from "zustand";

import type { Role } from "@/lib/roles";

/**
 * The last known answer from `/api/v1/auth/me`, cached for the tab's lifetime.
 *
 * The public header is rendered by `PublicShell`, which lives inside each
 * *page* rather than the route-group layout — so every navigation unmounts and
 * remounts it. With per-component state that meant re-asking who you are on
 * every click, and drawing the signed-out navigation until the answer came
 * back. Holding it here means a remount paints the correct header immediately
 * and the refetch only confirms it.
 *
 * `status` distinguishes "not asked yet" from "asked, nobody is signed in", so
 * a first paint can hold back role-dependent chrome instead of guessing.
 */
export type SessionUser = {
  email: string | null;
  id: string;
  image: string | null;
  /** Approved service provider — derived server-side; there is no such role. */
  isServiceProvider: boolean;
  name: string;
  role: Role;
  userResidentId: string | null;
};

type SessionStore = {
  clear: () => void;
  setUser: (user: SessionUser | null) => void;
  status: "resolved" | "unknown";
  user: SessionUser | null;
};

export const useSessionStore = create<SessionStore>((set) => ({
  clear: () => set({ status: "resolved", user: null }),
  setUser: (user) => set({ status: "resolved", user }),
  status: "unknown",
  user: null,
}));
