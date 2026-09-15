import {
  ctaButton,
  detailsTable,
  emailLayout,
  escapeHtml,
  greeting,
  paragraph,
  smallPrint,
  textLink,
  type EmailContent,
} from "../layout";
import { formatRupees } from "../billing/subscription-invoice";
import { PLATFORM_NAME } from "../../../brand/brand";

/**
 * What an owner gets when our own field team registered them.
 *
 * There is no queue and no waiting in this one, because there was none: an
 * agent sat with them, checked the papers, and the listing went live on the
 * spot. So this email is a confirmation rather than an acknowledgement, and it
 * must not borrow the "we'll review this shortly" language of the public path —
 * the owner would be left waiting for a second email that is never coming.
 *
 * When money is still owed it says so in the same breath as the good news, and
 * this is the email that carries *Pay now*: it is the first one that knows what
 * is actually left after the agent collected. Burying a balance under a
 * celebration is how a due goes unpaid until it becomes a suspension nobody saw
 * coming.
 */
export function hostelRegisteredByTeamEmail(input: {
  agentName?: string;
  amountPaid: number;
  /** The hostel's plan billing page, where a balance is paid. */
  billingUrl?: string;
  dueBy?: string | null;
  hostelName: string;
  listingUrl: string;
  outstanding: number;
  ownerName?: string;
  planName: string;
}): EmailContent {
  const owes = input.outstanding > 0;

  return {
    category: "info",
    subject: `${input.hostelName} is live on ${PLATFORM_NAME}`,
    html: emailLayout({
      bodyHtml: [
        greeting(input.ownerName),
        paragraph(
          input.agentName
            ? `<strong>${escapeHtml(input.agentName)}</strong> from our team registered <strong>${escapeHtml(input.hostelName)}</strong> with you. It is published and visible to students looking for a place to stay.`
            : `<strong>${escapeHtml(input.hostelName)}</strong> is registered, published and visible to students looking for a place to stay.`,
        ),
        detailsTable([
          { label: "Plan", value: input.planName },
          {
            label: "Paid today",
            value: input.amountPaid > 0 ? formatRupees(input.amountPaid) : "",
          },
          ...(owes
            ? [
                {
                  emphasis: true,
                  label: "Balance due",
                  value: formatRupees(input.outstanding),
                },
                { label: "Due date", value: input.dueBy ?? "" },
              ]
            : []),
        ]),
        ...(owes && input.billingUrl
          ? [
              ctaButton(input.billingUrl, "Pay now"),
              smallPrint(
                `Your listing stays live while you pay. ${textLink(input.listingUrl, "View your listing")}`,
              ),
            ]
          : [
              paragraph(
                owes
                  ? "You can pay the balance from your dashboard. Your listing stays live in the meantime."
                  : "Your plan is paid in full. Nothing more is due.",
              ),
              ctaButton(input.listingUrl, "View your listing"),
            ]),
      ].join("\n"),
      heading: "Your listing is live",
      preheader: owes
        ? `${input.hostelName} is published. ${formatRupees(input.outstanding)} is still due${input.dueBy ? ` by ${input.dueBy}` : ""}.`
        : `${input.hostelName} is published and your plan is paid in full.`,
    }),
  };
}
