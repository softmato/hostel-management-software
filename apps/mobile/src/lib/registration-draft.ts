import AsyncStorage from "@react-native-async-storage/async-storage";

import type { HostelForm } from "@/lib/hostel-registration";
import type { ProviderForm } from "@/lib/provider-registration";

/**
 * The hostel and service-provider applications as they stood a second after
 * the last change, kept on the phone so a closed app, a crash or a stray back
 * swipe costs nothing. The same arrangement as `identity-draft.ts`.
 *
 * Keyed by account, so two people signing in on one phone never see each
 * other's half-filled application. Attachments are already uploaded by the
 * time they appear here, so only their URLs are kept. Cleared the moment the
 * server accepts the application.
 */
export type RegistrationDrafts = {
  hostel: { form: HostelForm; index: number };
  provider: { form: ProviderForm; index: number };
};

type DraftKind = keyof RegistrationDrafts;

function keyFor(kind: DraftKind, accountId: string): string {
  return `hh_${kind}_registration_draft_${accountId}`;
}

export async function saveRegistrationDraft<K extends DraftKind>(
  kind: K,
  accountId: string,
  snapshot: RegistrationDrafts[K],
) {
  try {
    await AsyncStorage.setItem(keyFor(kind, accountId), JSON.stringify(snapshot));
  } catch {
    // The form on screen is still intact; a missed autosave is not worth a toast.
  }
}

export async function readRegistrationDraft<K extends DraftKind>(
  kind: K,
  accountId: string,
): Promise<RegistrationDrafts[K] | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(kind, accountId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;

    // A value from an older shape of this form must not hydrate it half-way.
    return parsed !== null &&
      typeof parsed === "object" &&
      "form" in parsed &&
      typeof (parsed as RegistrationDrafts[K]).index === "number"
      ? (parsed as RegistrationDrafts[K])
      : null;
  } catch {
    return null;
  }
}

export async function clearRegistrationDraft(kind: DraftKind, accountId: string) {
  try {
    await AsyncStorage.removeItem(keyFor(kind, accountId));
  } catch {
    // See `saveRegistrationDraft`.
  }
}
