import { Schema, model, models } from "mongoose";

/**
 * Which optional emails an address has turned off.
 *
 * Keyed by the **address**, not the account, on purpose: a resident can be on
 * our lists with an email and no login, and the unsubscribe link in the mail is
 * the only thing they hold. The signed-in settings screen writes to every
 * address the account receives mail at (`email-preference.service.ts`).
 *
 * No row means every optional email is on. Mandatory mail — sign-in codes,
 * credentials, receipts, SOS, billing — never reads this.
 */
const emailPreferenceSchema = new Schema(
  {
    email: { lowercase: true, required: true, trim: true, type: String, unique: true },
    /** `EmailTopic` values; a deny-list, so a topic added later reaches everyone. */
    mutedTopics: { default: [], type: [String] },
  },
  { timestamps: true },
);

export const EmailPreferenceModel =
  models.EmailPreference || model("EmailPreference", emailPreferenceSchema);
