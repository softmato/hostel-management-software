"use client";

import { PLATFORM_NAME } from "@hostel/shared/brand/brand";
import { BedDouble, CalendarCheck, Check, Copy, ShieldCheck, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  Card,
  Facts,
  INPUT,
  Notice,
  PRIMARY,
  SECONDARY,
  Skeleton,
  at,
  errorText,
  rupees,
} from "@/app/_components/booking-ui";
import { MediaLightbox, type LightboxItem } from "@/components/media-lightbox";
import { ApiRequestError, browserApi } from "@/lib/browser-api";
import { uploadFile } from "@/lib/uploads/uploader";
import { cn } from "@/lib/utils";
import type { BookingAvailabilityView } from "@/modules/bookings/booking-button";
import type { BookingQuote, GuestBookingDetail } from "@/modules/bookings/booking.service";
import { useSessionStore, type SessionUser } from "@/stores/session-store";

import { PublicShell } from "./shared";

/**
 * The checkout: docs/BOOKINGS.md item 15.
 *
 * Two columns. The left is what is being bought and never changes: the hostel,
 * the room, the rent, the fee. The right walks the one next step — choose a
 * room, sign in, details and refund account and the policy tick, pay and send
 * the screenshot, then the live status. The booking id goes into the URL as
 * soon as it exists, so a refresh or a closed tab comes back to the same step.
 */

type Method = "BANK" | "ESEWA" | "KHALTI";

const METHODS: Array<{ label: string; value: Method }> = [
  { label: "eSewa", value: "ESEWA" },
  { label: "Khalti", value: "KHALTI" },
  { label: "Bank account", value: "BANK" },
];

/* ── Room photos ───────────────────────────────────────────────────────── */

/**
 * A room's photos as a small overlapping stack: enough to recognise the room
 * without turning the chooser into a gallery. A room nobody photographed keeps
 * the same footprint, so the names stay in one column.
 */
function PhotoStack({ photos, roomType }: { photos: string[]; roomType: string }) {
  const shown = photos.slice(0, 3);
  const extra = photos.length - shown.length;

  if (shown.length === 0) {
    return (
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
        <BedDouble aria-hidden className="h-5 w-5" />
      </span>
    );
  }

  return (
    <span className="flex shrink-0 items-center">
      {shown.map((url, index) => (
        // Photo hosts are not in next/image's remotePatterns, as on the hostel page.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={index === 0 ? roomType : ""}
          className={cn("h-14 w-14 rounded-lg border-2 border-surface object-cover shadow-sm", index > 0 && "-ml-5")}
          key={`${url}-${index}`}
          src={url}
        />
      ))}
      {extra > 0 ? (
        <span className="-ml-5 flex h-14 w-14 items-center justify-center rounded-lg border-2 border-surface bg-foreground/80 text-xs font-bold text-background">
          +{extra}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The room being bought, in its own photos — never the hostel's exterior, which
 * is already the cover above. Tapping one opens the same viewer the rest of the
 * site uses, so a bed can be looked at properly before it is paid for.
 */
function RoomPhotos({ cover, photos, roomType }: { cover: string | null; photos: string[]; roomType: string }) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  // A hostel with only room shots has one of them as its cover: show it once.
  const shown = photos.filter((url) => url !== cover).slice(0, 6);

  if (shown.length === 0) {
    return null;
  }

  const items: LightboxItem[] = shown.map((src, index) => ({
    caption: `${roomType} — photo ${index + 1} of ${shown.length}`,
    kind: "image",
    src,
  }));

  return (
    <div className="mt-5 border-t border-border pt-4">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{roomType}</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {shown.map((url, index) => (
          <button
            className="aspect-square overflow-hidden rounded-lg border border-border bg-muted transition hover:opacity-90"
            key={`${url}-${index}`}
            onClick={() => setOpenAt(index)}
            title={`${roomType} photo ${index + 1}`}
            type="button"
          >
            {/* Photo hosts are not in next/image's remotePatterns, as on the hostel page. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={`${roomType} photo ${index + 1}`} className="h-full w-full object-cover" src={url} />
          </button>
        ))}
      </div>
      {openAt === null ? null : (
        <MediaLightbox index={openAt} items={items} onClose={() => setOpenAt(null)} onIndexChange={setOpenAt} />
      )}
    </div>
  );
}

/* ── Left column ───────────────────────────────────────────────────────── */

function PackageCard({ quote }: { quote: BookingQuote }) {
  return (
    <aside className="h-fit overflow-hidden rounded-xl border border-border bg-surface shadow-sm lg:sticky lg:top-24">
      {quote.hostel.coverPhotoUrl ? (
        // Photo hosts are not in next/image's remotePatterns, as on the hostel page.
        // eslint-disable-next-line @next/next/no-img-element
        <img alt={quote.hostel.name} className="aspect-video w-full object-cover" src={quote.hostel.coverPhotoUrl} />
      ) : null}
      <div className="p-5">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Booking</p>
        <h1 className="mt-1 text-2xl font-extrabold text-foreground">{quote.hostel.name}</h1>
        {quote.hostel.address ? <p className="mt-1 text-sm text-muted-foreground">{quote.hostel.address}</p> : null}

        <div className="mt-5">
          <Facts
            rows={[
              ["Room type", quote.room.roomType],
              ["Monthly rent", quote.room.monthlyRent ? rupees(quote.room.monthlyRent) : ""],
              ["Beds per room", quote.room.bedsPerRoom ? String(quote.room.bedsPerRoom) : ""],
              ["Meals", quote.room.mealInclusion ?? ""],
              ["Hostel answers within", `${quote.terms.hostelAnswerHours} hours of our payment check`],
              ["Bed held for", `${quote.terms.holdDays} days after the hostel confirms`],
            ]}
          />
        </div>

        <RoomPhotos cover={quote.hostel.coverPhotoUrl} photos={quote.room.photos} roomType={quote.room.roomType} />

        <div className="mt-5 flex items-end justify-between gap-4 border-t border-border pt-4">
          <div>
            <p className="text-sm font-bold text-foreground">Booking fee</p>
            <p className="text-xs text-muted-foreground">{quote.terms.feePercent}% of one month&apos;s rent</p>
          </div>
          <p className="text-2xl font-extrabold text-foreground">{rupees(quote.fee)}</p>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Paid to {PLATFORM_NAME}. Rent, admission fee and deposit are paid to the hostel.
        </p>
      </div>
    </aside>
  );
}

/* ── Right column: before a booking exists ─────────────────────────────── */

function RoomChooser({ availability, slug }: { availability: BookingAvailabilityView | null; slug: string }) {
  if (!availability) {
    return <Skeleton className="mt-6 h-48" />;
  }

  const rooms = availability.rooms.filter((room) => room.bookable);

  return (
    <div className="mx-auto mt-6 max-w-xl">
      <Card title="Choose a room">
        {rooms.length === 0 ? (
          <Notice>No room at this hostel can be booked right now.</Notice>
        ) : (
          <ul className="divide-y divide-border">
            {rooms.map((room) => (
              <li key={room.roomType}>
                <Link
                  className="flex items-center gap-4 py-3 text-sm font-bold text-foreground transition hover:text-brand-teal"
                  href={`/book/${encodeURIComponent(slug)}?room=${encodeURIComponent(room.roomType)}`}
                >
                  <PhotoStack photos={room.photos} roomType={room.roomType} />
                  <span className="min-w-0 flex-1 truncate">{room.roomType}</span>
                  <span className="shrink-0 font-semibold text-muted-foreground">{rupees(room.fee)} fee</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function SignInCard({ next }: { next: string }) {
  return (
    <Card title="Sign in to book">
      <p className="text-sm text-muted-foreground">
        A booking belongs to your {PLATFORM_NAME} account: that is where its receipt, refund and ID card are.
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Link className={PRIMARY} href={`/login?next=${encodeURIComponent(next)}`}>
          Sign in
        </Link>
        <Link
          className="inline-flex h-12 items-center justify-center rounded-lg border border-brand-teal text-sm font-bold text-brand-teal transition hover:bg-brand-teal/5"
          href={`/signup?next=${encodeURIComponent(next)}`}
        >
          Create an account
        </Link>
      </div>
    </Card>
  );
}

function PolicyRows({ quote }: { quote: BookingQuote }) {
  const policy = quote.policy;

  if (!policy || !quote.fee) {
    return null;
  }

  return (
    <Facts
      rows={[
        ["Cancel before the hostel confirms", rupees(quote.fee)],
        ["Hostel declines, does not answer or cancels", rupees(quote.fee)],
        ...policy.rows.map((row): [string, string] => [
          row.fromDay === row.throughDay
            ? `Cancel on day ${row.fromDay} of the hold`
            : `Cancel on days ${row.fromDay}–${row.throughDay} of the hold`,
          `${rupees(row.refund)} (${row.refundPercent}%)`,
        ]),
        [`Not moved in within ${policy.holdDays} days`, rupees(policy.noShowRefund)],
      ]}
    />
  );
}

function BookingForm({
  onBooked,
  onPolicyChanged,
  quote,
  user,
}: {
  onBooked: (booking: GuestBookingDetail) => void;
  onPolicyChanged: () => void;
  quote: BookingQuote;
  user: SessionUser;
}) {
  const [method, setMethod] = useState<Method>("ESEWA");
  const [holderName, setHolderName] = useState(user.name);
  const [number, setNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [branch, setBranch] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (!accepted) {
      setError("Accept the refund policy to book.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const data = await browserApi<{ booking: GuestBookingDetail }>("/api/v1/bookings", {
        body: JSON.stringify({
          acceptPolicy: true,
          hostel: quote.hostel.slug,
          // Bookings start today and hold the bed for `holdDays`; no move-in date for now.
          plannedMoveIn: null,
          policyVersion: quote.policyVersion,
          refundAccount: { bankName, branch, holderName, method, number },
          roomType: quote.room.roomType,
        }),
        method: "POST",
      });

      onBooked(data.booking);
    } catch (caught) {
      // The numbers moved while the page was open: show the new ones and ask again.
      if (caught instanceof ApiRequestError && caught.errorCode === "BOOKING_POLICY_CHANGED") {
        setAccepted(false);
        onPolicyChanged();
      }

      setError(errorText(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={submit}>
      <Card title="Your details">
        <Facts
          rows={[
            ["Name", user.name],
            ["Email", user.email ?? ""],
            ["Booking", `From today, valid for ${quote.terms.holdDays} days`],
          ]}
        />
      </Card>

      <Card title="Refund account">
        <p className="-mt-2 mb-4 text-sm text-muted-foreground">Where any refund of the booking fee is sent.</p>
        <div className="grid grid-cols-3 gap-2" role="radiogroup">
          {METHODS.map((option) => (
            <button
              aria-checked={method === option.value}
              className={cn(
                "h-10 rounded-lg border text-sm font-bold transition",
                method === option.value
                  ? "border-brand-teal bg-brand-teal/10 text-brand-teal"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
              key={option.value}
              onClick={() => setMethod(option.value)}
              role="radio"
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="mt-4 block text-sm font-semibold text-foreground">
          Name on the account
          <input className={INPUT} onChange={(event) => setHolderName(event.target.value)} required value={holderName} />
        </label>
        {method === "BANK" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="mt-4 block text-sm font-semibold text-foreground">
              Bank
              <input className={INPUT} onChange={(event) => setBankName(event.target.value)} required value={bankName} />
            </label>
            <label className="mt-4 block text-sm font-semibold text-foreground">
              Branch <span className="font-normal text-muted-foreground">(optional)</span>
              <input className={INPUT} onChange={(event) => setBranch(event.target.value)} value={branch} />
            </label>
          </div>
        ) : null}
        <label className="mt-4 block text-sm font-semibold text-foreground">
          {method === "BANK" ? "Account number" : "Mobile number on the wallet"}
          <input
            className={INPUT}
            inputMode={method === "BANK" ? "text" : "numeric"}
            onChange={(event) => setNumber(event.target.value)}
            required
            value={number}
          />
        </label>
      </Card>

      <Card title="Refund policy">
        <PolicyRows quote={quote} />
        <label className="mt-5 flex items-start gap-3 text-sm text-foreground">
          <input
            checked={accepted}
            className="mt-0.5 size-4 accent-brand-teal"
            onChange={(event) => setAccepted(event.target.checked)}
            type="checkbox"
          />
          <span>
            I accept the{" "}
            <Link className="font-bold text-brand-teal hover:underline" href="/refund-policy" target="_blank">
              refund policy
            </Link>
            .
          </span>
        </label>
        <p className="mt-3 text-xs text-muted-foreground">
          <Link className="font-semibold text-brand-teal hover:underline" href="/how-booking-works" target="_blank">
            How booking works
          </Link>{" "}
          walks through every step and deadline, from this payment to the day you move in.
        </p>
      </Card>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <button className={PRIMARY} disabled={submitting} type="submit">
        <CalendarCheck className="size-4" />
        {submitting ? "Booking…" : `Book and pay ${rupees(quote.fee)}`}
      </button>
    </form>
  );
}

/* ── Right column: once it exists ──────────────────────────────────────── */

function PayStep({ booking, onChange }: { booking: GuestBookingDetail; onChange: (booking: GuestBookingDetail) => void }) {
  const pay = booking.pay!;
  const [proof, setProof] = useState<{ id: string; name: string; previewUrl: string } | null>(null);
  const [reference, setReference] = useState("");
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function attach(file: File) {
    setUploading(true);
    setError("");

    try {
      const result = await uploadFile(file, {
        accessLevel: "PRIVATE",
        assetKind: "BOOKING_PAYMENT_PROOF",
        kind: "image",
        label: "Payment screenshot",
        silent: true,
      });

      if (!result?.assetId) {
        throw new Error("The screenshot did not upload. Try again.");
      }

      setProof({ id: result.assetId, name: file.name, previewUrl: URL.createObjectURL(file) });
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => () => URL.revokeObjectURL(proof?.previewUrl ?? ""), [proof]);

  async function send() {
    if (!proof) {
      setError("Attach the payment screenshot first.");
      return;
    }

    setSending(true);
    setError("");

    try {
      const data = await browserApi<{ booking: GuestBookingDetail }>(
        `/api/v1/bookings/${encodeURIComponent(booking.id)}/payment`,
        { body: JSON.stringify({ proofAssetId: proof.id, reference: reference.trim() || undefined }), method: "POST" },
      );

      onChange(data.booking);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSending(false);
    }
  }

  function copyCode() {
    void navigator.clipboard?.writeText(pay.reference).then(() => setCopied(true));
  }

  return (
    <div className="space-y-6">
      {booking.paymentRejection?.reason ? (
        <Notice tone="danger">We could not confirm your last screenshot: {booking.paymentRejection.reason}</Notice>
      ) : null}

      <Card title="1. Pay the booking fee">
        <div className="grid gap-5 sm:grid-cols-[180px_1fr]">
          {pay.qr ? (
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt={pay.qr.label} className="aspect-square w-full rounded-lg border border-border bg-white object-contain p-2" src={pay.qr.url} />
              <figcaption className="mt-2 text-center text-xs text-muted-foreground">{pay.qr.label}</figcaption>
            </figure>
          ) : (
            <Notice>The payment QR is not set up yet. Try again shortly.</Notice>
          )}
          <div className="space-y-4">
            <Facts rows={[["Amount", rupees(pay.amount)], ["Pay by", at(pay.payBy)]]} />
            <div>
              <p className="text-sm font-semibold text-foreground">Write this in the remarks</p>
              <button
                className="mt-2 inline-flex h-11 w-full items-center justify-between rounded-lg border border-border bg-muted px-3 font-mono text-base font-bold text-foreground"
                onClick={copyCode}
                type="button"
              >
                {pay.reference}
                {copied ? <Check className="size-4 text-brand-teal" /> : <Copy className="size-4 text-muted-foreground" />}
              </button>
            </div>
          </div>
        </div>
      </Card>

      <Card title="2. Send the screenshot">
        <label
          className={cn(
            "block cursor-pointer rounded-lg border border-dashed transition",
            proof ? "border-brand-teal bg-muted/40" : "border-border hover:border-foreground/40",
          )}
        >
          {uploading ? (
            <span className="flex h-24 flex-col items-center justify-center gap-1 text-sm font-semibold text-muted-foreground">
              <Upload className="size-5" />
              Uploading…
            </span>
          ) : proof ? (
            <span className="block p-2">
              {/* The blob is this browser's copy of the file just picked. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt={proof.name} className="mx-auto max-h-64 w-full rounded-md object-contain" src={proof.previewUrl} />
              <span className="mt-2 flex items-center justify-center gap-1.5 text-xs font-bold text-brand-teal">
                <Upload className="size-3.5" />
                Choose a different screenshot
              </span>
            </span>
          ) : (
            <span className="flex h-24 flex-col items-center justify-center gap-1 text-sm font-semibold text-muted-foreground transition hover:text-foreground">
              <Upload className="size-5" />
              Attach the screenshot from your banking app
            </span>
          )}
          <input
            accept="image/*"
            className="sr-only"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];

              if (file) void attach(file);
            }}
            type="file"
          />
        </label>
        <label className="mt-4 block text-sm font-semibold text-foreground">
          Transaction ID <span className="font-normal text-muted-foreground">(optional)</span>
          <input className={INPUT} maxLength={64} onChange={(event) => setReference(event.target.value)} value={reference} />
        </label>
        {error ? (
          <div className="mt-4">
            <Notice tone="danger">{error}</Notice>
          </div>
        ) : null}
        <button className={cn(PRIMARY, "mt-5")} disabled={uploading || sending || !proof} onClick={() => void send()} type="button">
          {sending ? "Sending…" : "Send screenshot"}
        </button>
        <p className="mt-3 text-xs text-muted-foreground">We check it within {pay.checkHours} hours.</p>
      </Card>
    </div>
  );
}

function nextStep(booking: GuestBookingDetail) {
  switch (booking.status) {
    case "PAYMENT_IN_REVIEW":
      return "We are checking your payment screenshot. We email you as soon as it is checked.";
    case "AWAITING_HOSTEL":
      return `Payment received. ${booking.hostel.name} confirms by ${at(booking.hostelAnswerBy)}. If it declines or does not answer, the full fee comes back.`;
    case "CONFIRMED":
      return `Your bed is held until ${at(booking.holdEndsAt)}. Show your ${PLATFORM_NAME} ID card at the hostel to move in.`;
    case "CHECKED_IN":
      return "You have moved in.";
    default:
      return booking.settlement
        ? booking.settlement.refund > 0
          ? `${rupees(booking.settlement.refund)} of the booking fee comes back to ${booking.refundAccount.methodLabel} ${booking.refundAccount.maskedNumber}.`
          : "No refund is due under the refund policy."
        : "This booking has ended. Nothing was paid.";
  }
}

function StatusCard({ booking }: { booking: GuestBookingDetail }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Booking {booking.code}</p>
          <h2 className="mt-1 text-xl font-extrabold text-foreground">{booking.statusLabel}</h2>
        </div>
        <ShieldCheck className="size-6 text-brand-teal" />
      </div>
      <p className="mt-3 text-sm text-foreground">{nextStep(booking)}</p>
      <Link
        className={cn(SECONDARY, "mt-5")}
        href={`/bookings/${encodeURIComponent(booking.id)}`}
      >
        View booking
      </Link>
    </Card>
  );
}

/* ── The page ──────────────────────────────────────────────────────────── */

export function BookingCheckoutPage({
  bookingId,
  roomType,
  slug,
}: {
  bookingId: string | null;
  roomType: string | null;
  slug: string;
}) {
  const router = useRouter();
  const user = useSessionStore((state) => state.user);
  const sessionStatus = useSessionStore((state) => state.status);
  const [quote, setQuote] = useState<BookingQuote | null>(null);
  const [rooms, setRooms] = useState<BookingAvailabilityView | null>(null);
  const [booking, setBooking] = useState<GuestBookingDetail | null>(null);
  const [loadError, setLoadError] = useState("");

  const loadQuote = useCallback(() => {
    if (!roomType) {
      return;
    }

    browserApi<{ quote: BookingQuote }>(
      `/api/v1/bookings/quote?hostel=${encodeURIComponent(slug)}&roomType=${encodeURIComponent(roomType)}`,
    )
      .then((data) => setQuote(data.quote))
      .catch((error: unknown) => setLoadError(errorText(error)));
  }, [roomType, slug]);

  const loadBooking = useCallback((id: string) => {
    browserApi<{ booking: GuestBookingDetail }>(`/api/v1/bookings/${encodeURIComponent(id)}`)
      .then((data) => setBooking(data.booking))
      .catch((error: unknown) => setLoadError(errorText(error)));
  }, []);

  useEffect(() => {
    loadQuote();
  }, [loadQuote, user?.id]);

  useEffect(() => {
    if (roomType) {
      return;
    }

    browserApi<{ availability: BookingAvailabilityView }>(
      `/api/v1/bookings/availability?hostel=${encodeURIComponent(slug)}`,
    )
      .then((data) => setRooms(data.availability))
      .catch((error: unknown) => setLoadError(errorText(error)));
  }, [roomType, slug]);

  useEffect(() => {
    if (bookingId && user) {
      loadBooking(bookingId);
    }
  }, [bookingId, loadBooking, user]);

  // While we or the hostel are deciding, the status moves without this tab doing anything.
  const liveId =
    booking && (booking.status === "PAYMENT_IN_REVIEW" || booking.status === "AWAITING_HOSTEL") ? booking.id : null;

  useEffect(() => {
    if (!liveId) {
      return;
    }

    const timer = window.setInterval(() => loadBooking(liveId), 30_000);

    return () => window.clearInterval(timer);
  }, [liveId, loadBooking]);

  const here = `/book/${encodeURIComponent(slug)}${roomType ? `?room=${encodeURIComponent(roomType)}` : ""}`;

  function right(current: BookingQuote) {
    if (booking) {
      return booking.status === "AWAITING_PAYMENT" && booking.pay ? (
        <PayStep booking={booking} onChange={setBooking} />
      ) : (
        <StatusCard booking={booking} />
      );
    }

    if (bookingId && sessionStatus !== "resolved") {
      return <Skeleton className="h-64" />;
    }

    if (!current.available) {
      return <Notice>{current.reasonMessage ?? "This room cannot be booked right now."}</Notice>;
    }

    if (current.openBooking) {
      return (
        <Card title="You already have an open booking">
          <p className="text-sm text-muted-foreground">
            {current.openBooking.code} at {current.openBooking.hostelName}. Finish or cancel it before booking another
            room.
          </p>
          <Link className={cn(PRIMARY, "mt-5")} href={`/bookings/${encodeURIComponent(current.openBooking.id)}`}>
            Open that booking
          </Link>
        </Card>
      );
    }

    if (sessionStatus !== "resolved") {
      return <Skeleton className="h-64" />;
    }

    if (!user) {
      return <SignInCard next={here} />;
    }

    return (
      <BookingForm
        onBooked={(created) => {
          setBooking(created);
          router.replace(`${here}&booking=${encodeURIComponent(created.id)}`, { scroll: false });
        }}
        onPolicyChanged={loadQuote}
        quote={current}
        user={user}
      />
    );
  }

  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-8">
        <Link className="text-sm font-semibold text-brand-teal hover:underline" href={`/hostels/${encodeURIComponent(slug)}`}>
          ← Back to the hostel
        </Link>

        {loadError ? (
          <div className="mt-6">
            <Notice tone="danger">{loadError}</Notice>
          </div>
        ) : null}

        {!roomType ? (
          <RoomChooser availability={rooms} slug={slug} />
        ) : !quote ? (
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <Skeleton className="h-96" />
            <Skeleton className="h-96" />
          </div>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <PackageCard quote={quote} />
            <div>{right(quote)}</div>
          </div>
        )}
      </div>
    </PublicShell>
  );
}
