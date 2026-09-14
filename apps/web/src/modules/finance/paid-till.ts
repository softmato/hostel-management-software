/**
 * True when this month was already paid to the hostel before it joined us
 * (`Resident.paidTill`, docs/EXISTING_RESIDENTS.md).
 *
 * Period keys are zero-padded `YYYY-MM`, so a string comparison is a month
 * comparison. Its own file so the billing run and the Payments matrix — a read
 * that must not import the write path — share one rule and cannot disagree
 * about who is skipped.
 */
export function paidBeforeJoining(
  paidTill: string | null | undefined,
  period: string,
): boolean {
  return Boolean(paidTill) && period <= (paidTill as string);
}
