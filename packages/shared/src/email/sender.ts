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
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
};

export type SendEmailResult =
  | { sent: true; id: string }
  | { sent: false; reason: "not_configured" | "send_failed"; detail?: string };

/**
 * Resolves the Resend "From" header. Precedence:
 *   1. EMAIL_FROM — used verbatim (already a full `Name <email>` header).
 *   2. RESEND_FROM_EMAIL — if it already contains `<`, used verbatim; otherwise
 *      combined with the optional RESEND_FROM_NAME into `Name <email>`.
 * Returns null when no sender is configured (local dev → email is logged, not sent).
 */
function fromAddress(): string | null {
  const explicit = process.env.EMAIL_FROM?.trim();
  if (explicit) {
    return explicit;
  }

  const email = process.env.RESEND_FROM_EMAIL?.trim();
  if (!email) {
    return null;
  }

  if (email.includes("<")) {
    return email;
  }

  const name = process.env.RESEND_FROM_NAME?.trim();
  return name ? `${name} <${email}>` : email;
}

/**
 * Sends a transactional email through Resend (EMAIL_SYSTEM.md).
 *
 * Never throws: callers must not fail a business flow because email delivery
 * failed. Failures are logged and reported in the result so callers can
 * surface/queue them if needed. When RESEND_API_KEY / EMAIL_FROM are not
 * configured (local dev), the email is logged instead of sent.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = fromAddress();

  if (!apiKey || !from) {
    console.info(
      JSON.stringify({
        level: "info",
        action: "email_skipped",
        message: "Resend not configured (RESEND_API_KEY / EMAIL_FROM); email not sent.",
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
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error(
        JSON.stringify({
          level: "error",
          action: "email_send_failed",
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
