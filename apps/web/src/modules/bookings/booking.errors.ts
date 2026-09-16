/**
 * The booking module's one error shape.
 *
 * Same fields `handleRouteError` reads off every service error (message,
 * `errorCode`, `status`), so a route needs nothing booking-specific to answer
 * with it. Codes are SCREAMING_SNAKE and stable: the checkout on the web and in
 * the app branch on them.
 */
export class BookingError extends Error {
  constructor(
    message: string,
    public errorCode = "BOOKING_ERROR",
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
    this.name = "BookingError";
  }
}
