import {
  DEFAULT_EMAIL_CATEGORY,
  fromHeaderFor,
  replyToFor,
  resolveEmailIdentity,
  type EmailCategory,
} from "./identity";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * A file to send alongside the email. `content` is raw bytes; the sender
 * base64-encodes them, which is what Resend's API expects.
 */
export type EmailAttachment = {
  content: Uint8Array;
  /** Shown to the recipient — include the extension. */
  filename: string;
};

export type SendEmailInput = {
  attachments?: EmailAttachment[];
  /**
   * Which mailbox this goes out from. Templates carry their own — every
   * `EmailContent` sets one — so ordinary call sites spread the template and
   * never name a category. Pass it directly only for ad-hoc mail with no
   * template behind it.
   */
  category?: EmailCategory;
  to: string | string[];
  subject: string;
  html: string;
  /** Overrides the configured reply address for this one send. */
  replyTo?: string;
};

export type SendEmailResult =
  | { sent: true; id: string }
  | { sent: false; reason: "not_configured" | "send_failed"; detail?: string };

/**
 * Sends a transactional email through Resend (docs/EMAIL_SYSTEM.md).
 *
 * The `From` header is built per send from the platform owner's configured
 * identity and the message's category, so `billing@` and `alert@` mail carries
 * the right sender without any call site knowing how the address is assembled.
 *
 * Never throws: callers must not fail a business flow because email delivery
 * failed. Failures are logged and reported in the result so callers can
 * surface/queue them if needed. With no `RESEND_API_KEY` (local dev), the email
 * is logged instead of sent.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const category = input.category ?? DEFAULT_EMAIL_CATEGORY;
  const identity = await resolveEmailIdentity();
  const from = fromHeaderFor(category, identity);
  const replyTo = input.replyTo ?? replyToFor(category, identity);

  if (!apiKey || !from) {
    console.info(
      JSON.stringify({
        level: "info",
        action: "email_skipped",
        category,
        message: "Resend not configured (RESEND_API_KEY / EMAIL_DOMAIN); email not sent.",
        subject: input.subject,
        to: input.to,
      }),
    );
    return { sent: false, reason: "not_configured" };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(input.to) ? input.to : [input.to],
        subject: input.subject,
        html: input.html,
        ...(input.attachments?.length
          ? {
              attachments: input.attachments.map((attachment) => ({
                content: Buffer.from(attachment.content).toString("base64"),
                filename: attachment.filename,
              })),
            }
          : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error(
        JSON.stringify({
          level: "error",
          action: "email_send_failed",
          category,
          from,
          message: `Resend returned ${response.status}`,
          subject: input.subject,
        }),
      );
      return { sent: false, reason: "send_failed", detail };
    }

    const payload = (await response.json()) as { id?: string };
    console.info(
      JSON.stringify({
        level: "info",
        action: "email_sent",
        category,
        from,
        message: "Email dispatched via Resend.",
        subject: input.subject,
        emailId: payload.id ?? null,
      }),
    );
    return { sent: true, id: payload.id ?? "" };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        action: "email_send_failed",
        category,
        message: error instanceof Error ? error.message : "Unknown email error",
        subject: input.subject,
      }),
    );
    return {
      sent: false,
      reason: "send_failed",
      detail: error instanceof Error ? error.message : undefined,
    };
  }
}
