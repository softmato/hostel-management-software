import { loadSiteConfig } from "@/lib/site-config-server";
import { renderIdCardPng } from "@/lib/platform-id-card.server";
import { siteUrl } from "@/lib/site";
import type { IdCardData, PlatformIdCardType } from "@/lib/platform-id-card";
import {
  getResidentIdentity,
  getResidentIdentityQr,
  readResidentIdentityPhoto,
} from "@/modules/users/resident-identity.service";
import { idCardIssuedEmail } from "@hostel/shared/email/templates/account/id-card-issued";
import { sendEmail } from "@hostel/shared/email/sender";

/**
 * Emails a holder their platform ID card as a PNG.
 *
 * Called when a card is first issued (a resident completes their profile) and
 * again whenever an approval re-issues it under a new variant — hostel owner or
 * service provider. The variant is passed in by the caller because it follows
 * from what was just approved, not from anything stored on the identity.
 *
 * Nothing here is allowed to fail the flow that triggered it: approving a hostel
 * must not roll back because an image could not be encoded or Resend was down.
 * Every step is best-effort and the whole thing is caught at the end.
 */

const CARD_LABELS: Record<PlatformIdCardType, string> = {
  HOSTEL_OWNER: "Hostel Owner",
  RESIDENT: "Resident",
  SERVICE_PROVIDER: "Service Provider",
};

/** Card date format, matching the in-app renderer's. */
function formatIssuedOn(value: string | null) {
  const date = value ? new Date(value) : new Date();

  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** Photo bytes for the card, or null when there is no usable photo. */
async function readPhotoBytes(userId: string) {
  try {
    const photo = await readResidentIdentityPhoto(userId);

    return Buffer.from(await new Response(photo.body).arrayBuffer());
  } catch {
    // No photo, or storage is unavailable — the card falls back to initials.
    return null;
  }
}

/** The share QR as PNG bytes, decoded from the data URL the identity mints. */
async function readQrBytes(userId: string) {
  try {
    const { qrDataUrl } = await getResidentIdentityQr(userId);
    const base64 = qrDataUrl?.split(",")[1];

    return base64 ? Buffer.from(base64, "base64") : null;
  } catch {
    return null;
  }
}

export async function sendIdCardEmail(userId: string, cardType: PlatformIdCardType) {
  try {
    const { identity, profile } = await getResidentIdentity(userId);
    const recipient = profile?.primaryEmail || identity.accountEmail;

    // Without a card or somewhere to send it there is nothing to do — and this
    // is a routine state, not a failure (an owner may never have made a card).
    if (!recipient || !identity.residentId || !identity.hasProfile) {
      return { sent: false as const, reason: "no_card" as const };
    }

    const [{ identity: siteIdentity }, photo, qr] = await Promise.all([
      loadSiteConfig(),
      readPhotoBytes(userId),
      readQrBytes(userId),
    ]);

    const cardLabel = CARD_LABELS[cardType];
    // The same role line the in-app card prints, so the emailed PNG and the one
    // on screen never disagree about what the holder does.
    const roleLine =
      identity.cardRole ||
      profile?.courseOrDesignation ||
      profile?.institution ||
      cardLabel;
    const data: IdCardData = {
      bloodGroup:
        profile?.bloodGroup && profile.bloodGroup !== "UNKNOWN" ? profile.bloodGroup : null,
      brandName: siteIdentity.siteName,
      cardType,
      dateOfBirth: profile?.dateOfBirth ?? null,
      email: profile?.primaryEmail ?? identity.accountEmail,
      fullName: profile?.fullName ?? identity.accountName,
      issuedOn: formatIssuedOn(identity.updatedAt),
      phone: profile?.primaryPhone ?? null,
      residentId: identity.residentId,
      role: roleLine,
      siteLabel: new URL(siteUrl()).host,
    };

    const [front, back] = await Promise.all([
      renderIdCardPng(data, "front", { photo, qr }),
      renderIdCardPng(data, "back", { photo, qr }),
    ]);

    if (!front) {
      return { sent: false as const, reason: "render_failed" as const };
    }

    const slug = identity.residentId.toLowerCase();

    await sendEmail({
      attachments: [
        { content: front, filename: `${slug}-card-front.png` },
        ...(back ? [{ content: back, filename: `${slug}-card-back.png` }] : []),
      ],
      to: recipient,
      ...idCardIssuedEmail({
        cardLabel,
        holderName: data.fullName,
        residentId: identity.residentId,
        siteName: siteIdentity.siteName,
      }),
    });

    return { sent: true as const };
  } catch (error) {
    console.error(
      JSON.stringify({
        action: "id_card_email_failed",
        cardType,
        level: "error",
        message: error instanceof Error ? error.message : "Unknown failure",
      }),
    );

    return { sent: false as const, reason: "error" as const };
  }
}
