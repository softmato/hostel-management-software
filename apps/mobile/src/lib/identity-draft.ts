import AsyncStorage from "@react-native-async-storage/async-storage";

import type { IdentityDraft } from "@/lib/id-card";

/**
 * The ID card form as it stood a second after the last change, kept on the
 * phone so a closed app, a crash or a stray back swipe costs nothing.
 *
 * Keyed by account: two people signing in on one phone never see each other's
 * half-filled KYC. Photo and signature are already uploaded by the time they
 * appear here, so only their handles and local previews are kept. Cleared the
 * moment the server accepts the save.
 */
export type IdentityDraftSnapshot = {
  draft: IdentityDraft;
  index: number;
  interestsText: string;
  photoAssetId: string | null;
  photoUri: string | null;
  sharingEnabled: boolean;
  signatureAssetId: string | null;
  signatureUri: string | null;
};

function keyFor(accountId: string): string {
  return `hh_identity_draft_${accountId}`;
}

export async function saveIdentityDraft(accountId: string, snapshot: IdentityDraftSnapshot) {
  try {
    await AsyncStorage.setItem(keyFor(accountId), JSON.stringify(snapshot));
  } catch {
    // The form on screen is still intact; a missed autosave is not worth a toast.
  }
}

export async function readIdentityDraft(accountId: string): Promise<IdentityDraftSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(accountId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;

    // A value from an older shape of this form must not hydrate it half-way.
    return parsed !== null &&
      typeof parsed === "object" &&
      "draft" in parsed &&
      typeof (parsed as IdentityDraftSnapshot).index === "number"
      ? (parsed as IdentityDraftSnapshot)
      : null;
  } catch {
    return null;
  }
}

export async function clearIdentityDraft(accountId: string) {
  try {
    await AsyncStorage.removeItem(keyFor(accountId));
  } catch {
    // See `saveIdentityDraft`.
  }
}
