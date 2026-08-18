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
 *
 * **Community is a tab here and a pushed screen everywhere else.** Every other
 * role reaches it from a More menu, but this audience has no More menu and the
 * feed is one of the two things a browsing account can actually *do* — the other
 * being search. Same `CommunityBoard` either way.
 *
 * The Profile tab draws the account's own picture rather than a person glyph, so
 * the tab that means "you" looks like you. `avatar` is what asks for that; the
 * `icon` beside it is still the fallback for an account with no image.
 */
const TABS: readonly TabDef[] = [
  { icon: "home", label: "Home", name: "index" },
  { icon: "search", label: "Search", name: "search" },
  { icon: "people", label: "Community", name: "community" },
  { icon: "git-compare", label: "Compare", name: "compare" },
  { avatar: true, icon: "person", label: "Profile", name: "profile" },
];

export default function BrowseLayout() {
  return <RoleTabs accent="PUBLIC" tabs={TABS} />;
}
