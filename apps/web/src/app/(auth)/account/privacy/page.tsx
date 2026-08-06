import { AccountDeletionPanel } from "@/app/_components/account-deletion-panel";
import { SiteName } from "@/components/site-config-provider";

export const metadata = {
  title: "Privacy & your data",
};

/**
 * Reachable by any signed-in account regardless of role — a moved-out resident
 * is a PUBLIC user, and they are exactly who needs this page most. The panel
 * itself decides what the account is allowed to do.
 */
export default function AccountPrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-12">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground">Privacy &amp; your data</h1>
        <p className="text-sm text-muted-foreground">
          Control what <SiteName /> keeps about you.
        </p>
      </header>
      <AccountDeletionPanel />
    </main>
  );
}
