import type { Types } from "mongoose";

import { HostelSettingsModel } from "@hostel/db/models/HostelSettings";

export type CommunitySettings = {
  enabled: boolean;
  profanityFilterEnabled: boolean;
};

/** Platform position when a hostel has never touched its settings. */
export const COMMUNITY_DEFAULTS: CommunitySettings = {
  enabled: true,
  profanityFilterEnabled: true,
};

/**
 * Never throws: the feed must not go down because a settings read failed, so a
 * missing or malformed document falls back to the shipped defaults.
 */
export async function getCommunitySettings(
  hostelId: Types.ObjectId | string,
): Promise<CommunitySettings> {
  try {
    const record = await HostelSettingsModel.findOne({ hostelId })
      .select("community")
      .lean<{ community?: Partial<CommunitySettings> } | null>();

    return {
      enabled: record?.community?.enabled ?? COMMUNITY_DEFAULTS.enabled,
      profanityFilterEnabled:
        record?.community?.profanityFilterEnabled ??
        COMMUNITY_DEFAULTS.profanityFilterEnabled,
    };
  } catch {
    return COMMUNITY_DEFAULTS;
  }
}
