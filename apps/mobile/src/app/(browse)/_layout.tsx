import { RoleTabs, type TabDef } from "@/components/role-tabs";

/**
 * The discovery shell — the app's home for everyone who is not routed to a role
 * dashboard, signed in or not.
 *
 * There is no separate signed-out group any more. `resolveHome` sends a null
 * account here, and the only thing a session changes is the top card of the
 * Profile tab. See `constants/roles.ts` for what that replaced and why.
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
