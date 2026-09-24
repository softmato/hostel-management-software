import { detailsTable, type DetailRow } from "../layout";

/** `Rs 1,000` — the way every booking email prints money. */
export function rupees(amount: number) {
  return `Rs ${amount.toLocaleString("en-IN")}`;
}

/** `1 hour`, `12 hours`. */
export function hoursWord(hours: number) {
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

export type BookingFacts = {
  code: string;
  fee: number;
  hostelName: string;
  monthlyRent: number;
  roomType: string;
};

/** The booking in five rows. `emphasis` picks the one figure the email is about. */
export function bookingFactsTable(
  facts: BookingFacts,
  extra: DetailRow[] = [],
  emphasis: "fee" | null = "fee",
) {
  return detailsTable([
    { label: "Booking", value: facts.code },
    { label: "Hostel", value: facts.hostelName },
    { label: "Room type", value: facts.roomType },
    { label: "Monthly rent", value: rupees(facts.monthlyRent) },
    { emphasis: emphasis === "fee", label: "Booking fee", value: rupees(facts.fee) },
    ...extra,
  ]);
}

export type RefundLadderRow = {
  fromDay: number;
  refund: number;
  refundPercent: number;
  throughDay: number;
};

/**
 * The refund policy as rows of rupees, for a booking nobody has confirmed yet.
 * Printed in the invoice email so the terms travel with the money.
 */
export function refundLadderTable(input: {
  fee: number;
  noShowRefund: number;
  rows: RefundLadderRow[];
}) {
  return detailsTable([
    { label: "Cancel before the hostel says yes", value: rupees(input.fee) },
    { label: "Hostel says no or does not answer", value: rupees(input.fee) },
    ...input.rows.map((row) => ({
      label:
        row.fromDay === row.throughDay
          ? `Cancel on day ${row.fromDay} after the hostel says yes`
          : `Cancel on days ${row.fromDay}–${row.throughDay} after the hostel says yes`,
      value: `${rupees(row.refund)} (${row.refundPercent}%)`,
    })),
    { label: "Never move in", value: rupees(input.noShowRefund) },
  ]);
}
