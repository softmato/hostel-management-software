import {
  ctaButton,
  emailLayout,
  escapeHtml,
  monthName,
  paragraph,
  type EmailContent,
} from "../layout";

/**
 * How this resident signs in, which is the one thing the mail cannot guess.
 *
 * `EXISTING_ACCOUNT` — the intake found an account that already belongs to them
 * and promoted it, so their password or Google sign-in is unchanged and there is
 * nothing to activate.
 *
 * `ACTIVATION_CODE` — nobody could be linked: registered phone-only, or with an
 * address that belongs to no account. Residents are **never** sent credentials
 * (`linkResidentAccount`), so the honest sentence is that the hostel will hand
 * them a code, not a promise of a login that does not exist.
 */
export type ResidentSignIn = "ACTIVATION_CODE" | "EXISTING_ACCOUNT";

/**
 * The confirmation a resident gets the moment a hostel registers them.
 *
 * ## Why this exists alongside `residentLinkedEmail`
 *
 * That one is sent only when an account was found and promoted, and it is about
 * the *portal*: sign in as you always did. So a resident registered at the desk
 * with no platform account — which is most of them, on the day they arrive —
 * received nothing at all. They had just handed over a deposit and an admission
 * fee and been given a bed, and the product's entire record of it was a row on
 * somebody else's screen.
 *
 * This is the record of the arrangement: which hostel, which room, from when,
 * what the rent is, what was charged today and what they owe for their first
 * month. It is the thing a resident goes looking for in three weeks when they
 * cannot remember what they agreed to, and the thing they can forward to whoever
 * is paying for them.
 *
 * ## Every figure is optional and every one is dropped rather than guessed
 *
 * A hostel that charges no admission fee, takes no deposit, or has not priced
 * the room type yet is a real hostel, not an error. A line that said
 * "Admission fee: NPR 0" over the first is worse than no line, and one that
 * printed a rent nobody has set would be a claim about money that is false.
 */
export function residentRegisteredEmail(input: {
  admissionFee?: number | null;
  currency?: string;
  dashboardUrl: string;
  depositAmount?: number | null;
  /** The first month's rent, when the intake managed to invoice it. */
  firstMonth?: {
    amount: number;
    dueDate?: Date | null;
    /** `2026-09`. */
    period: string;
    prorated: boolean;
    referenceCode?: string | null;
  } | null;
  hostelName: string;
  monthlyRent?: number | null;
  moveInDate: Date;
  residentName: string;
  roomNumber?: string | null;
  roomType: string;
  signIn: ResidentSignIn;
}): EmailContent {
  const currency = input.currency ?? "NPR";
  const money = (value: number) =>
    `${escapeHtml(currency)} ${value.toLocaleString("en-US")}`;

  const facts = [
    `Hostel: <strong>${escapeHtml(input.hostelName)}</strong>`,
    `Room: <strong>${escapeHtml(
      [input.roomType.replaceAll("_", " "), input.roomNumber]
        .filter(Boolean)
        .join(" · "),
    )}</strong>`,
    `Moving in: <strong>${escapeHtml(input.moveInDate.toDateString())}</strong>`,
    input.monthlyRent
      ? `Monthly rent: <strong>${money(input.monthlyRent)}</strong>`
      : "",
    input.admissionFee
      ? `Admission fee: <strong>${money(input.admissionFee)}</strong>`
      : "",
    input.depositAmount
      ? `Deposit: <strong>${money(input.depositAmount)}</strong>`
      : "",
  ].filter(Boolean);

  /*
   * The first month is its own paragraph rather than another bullet, because it
   * is the only figure in the mail that is *owed* — the rest describe the
   * arrangement. A part month is named as one: an amount well under the monthly
   * rent, unexplained, reads as a mistake, and the resident's first act would be
   * to query a bill that is correct.
   */
  const firstMonth = input.firstMonth
    ? paragraph(
        [
          `Your rent for <strong>${escapeHtml(monthName(input.firstMonth.period))}</strong> is <strong>${money(input.firstMonth.amount)}</strong>`,
          input.firstMonth.prorated
            ? ", counted from the day you move in rather than a whole month"
            : "",
          input.firstMonth.dueDate
            ? `, due <strong>${escapeHtml(input.firstMonth.dueDate.toDateString())}</strong>`
            : "",
          ".",
          input.firstMonth.referenceCode
            ? ` Quote <strong>${escapeHtml(input.firstMonth.referenceCode)}</strong> when you pay, so the hostel can match your transfer to it.`
            : "",
        ].join(""),
      )
    : "";

  const signIn =
    input.signIn === "EXISTING_ACCOUNT"
      ? paragraph(
          "Nothing to activate and no new password to remember — sign in the way you always do, with the same email and password or with Google, and you will land on your resident dashboard.",
        )
      : paragraph(
          "To see this in the app, ask the hostel for your activation code — they can issue it from your record. We never send passwords by email.",
        );

  return {
    category: "info",
    subject: `You are registered at ${input.hostelName}`,
    html: emailLayout({
      heading: "You are registered",
      bodyHtml: [
        paragraph(
          `Hi ${escapeHtml(input.residentName)}, <strong>${escapeHtml(input.hostelName)}</strong> has registered you as a resident. Here is what was agreed.`,
        ),
        `<ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.7;">${facts
          .map((fact) => `<li>${fact}</li>`)
          .join("")}</ul>`,
        firstMonth,
        signIn,
        ctaButton(input.dashboardUrl, "Open my dashboard"),
        paragraph(
          "From there you can see your rent and payments, your meals, notices from the hostel, and raise complaints. If anything above is wrong, tell the hostel before you pay.",
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    }),
  };
}
