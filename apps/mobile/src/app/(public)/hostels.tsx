import { HostelBrowser } from "@/components/hostel-browser";

/** Browse, pushed from the signed-out home — so it keeps its back button. */
export default function PublicHostelsScreen() {
  return <HostelBrowser compareHref="/compare" showBack />;
}
