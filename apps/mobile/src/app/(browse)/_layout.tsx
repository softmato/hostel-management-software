import { RoleTabs, type TabDef } from "@/components/role-tabs";

/**
 * The signed-in discovery shell.
 *
 * A `PUBLIC_USER` — someone with an account who is still looking for a hostel —
 * gets tabs like every other signed-in audience. The signed-out `(public)`
 * group stays a plain stack with its floating Log in pill (§0 shell contract),
 * because expo-router cannot switch one group between a stack and a tab
 * navigator at runtime. `resolveHome` picks the group; the screens themselves
 * are shared components, so the two cannot drift.
 *
 * **No Bookings, Messages or Saved tab.** There is no booking model, messaging
 * endpoint or favourites collection on the server.
 */
const TABS: readonly TabDef[] = [
  { icon: "home", label: "Home", name: "index" },
  { icon: "search", label: "Search", name: "search" },
  { icon: "git-compare", label: "Compare", name: "compare" },
  { icon: "person", label: "Profile", name: "profile" },
];

export default function BrowseLayout() {
  return <RoleTabs accent="PUBLIC" tabs={TABS} />;
}
