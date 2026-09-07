import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * A half-finished payment claim, kept across a leave and a return.
 *
 * ## Why the form outlives the screen
 *
 * The submit screen offers `Save and exit` after a failed submit, and that
 * sentence has to be true. The failure it follows is the one most likely to
 * repeat immediately — a phone that has just lost signal in a stairwell — so the
 * useful answer is "come back in ten minutes", and a resident who takes it must
 * not find an empty form and a dropzone. Retyping a ten-digit transaction id off
 * a receipt is the single most error-prone thing on the screen; asking for it
 * twice is how a wrong id gets filed.
 *
 * ## The asset id is the file
 *
 * A local `file://` uri is not durable — the OS may sweep the cache between two
 * launches, and on Android a picked document's uri is a grant that expires. The
 * *upload*, though, has already happened by the time there is anything worth
 * saving: the bytes are in storage under an asset id that stays valid. So a
 * restored draft re-attaches by id and lets the read run again, which costs one
 * cheap server call and comes back with the same verdicts rather than a
 * remembered guess at them. The preview uri is saved too, purely so the
 * thumbnail is there on the first frame; nothing breaks when it is stale.
 *
 * ## AsyncStorage, not SecureStore
 *
 * An amount, a wallet name and a transaction id the resident is about to send to
 * their hostel anyway. `lib/session.ts` keeps SecureStore for the two tokens,
 * and widening that habit to ordinary form state is how the secure store stops
 * meaning anything.
 */
export type ClaimDraft = {
  amount?: string;
  method?: string;
  note?: string;
  proofAssetId?: string;
  proofMimeType?: string;
  proofName?: string;
  proofPreview?: string;
  proofSize?: number;
  transactionCode?: string;
};

/** Per invoice: two invoices can be half-claimed at once and must not collide. */
function keyFor(invoiceId: string): string {
  return `hh_claim_draft_${invoiceId}`;
}

/**
 * Never throws.
 *
 * Every caller is a side effect on a screen that has a more important job — a
 * failed submit, a successful one, a mount. A storage error is not worth taking
 * any of those down for, and the only cost of losing a draft is the typing the
 * draft was saving.
 */
export async function saveClaimDraft(invoiceId: string, draft: ClaimDraft) {
  try {
    await AsyncStorage.setItem(keyFor(invoiceId), JSON.stringify(draft));
  } catch {
    // Nothing to do and nothing to say: the form on screen is still intact.
  }
}

export async function readClaimDraft(invoiceId: string): Promise<ClaimDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(invoiceId));

    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);

    // A hand-edited or half-written value must not hydrate a form with numbers
    // in the string fields.
    return parsed !== null && typeof parsed === "object" ? (parsed as ClaimDraft) : null;
  } catch {
    return null;
  }
}

/**
 * Dropped the moment the claim lands.
 *
 * Including when the server answers `created: false`: the proof is on file, so
 * a draft restored onto the next visit would offer to submit something that has
 * already been submitted — which is exactly the doubt this screen works hardest
 * to avoid.
 */
export async function clearClaimDraft(invoiceId: string) {
  try {
    await AsyncStorage.removeItem(keyFor(invoiceId));
  } catch {
    // See `saveClaimDraft`.
  }
}
