"use client";

import {
  ArrowRight,
  BadgeCheck,
  FileText,
  Receipt,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from "lucide-react";
import Link from "next/link";

import { PublicShell } from "@/app/_components/shared";
import { useSiteConfig } from "@/components/site-config-provider";
import { Button } from "@/components/ui/button";
import { useSessionStore } from "@/stores/session-store";

/**
 * The public explainer for the Resident Offer Program.
 *
 * **Public, and deliberately so.** Every other surface that mentions the
 * programme is behind a login, but the two moments a resident most wants to read
 * about it are moments they are not logged in: the confirmation email that lands
 * seconds after they submit a payment proof, and the conversation with a parent
 * or guardian who is paying the rent and has no account at all.
 *
 * **The same shell as the legal pages**, on purpose. This is a page of plain
 * answers to plain questions, and the privacy/terms layout is what the site
 * already uses for that. It is not a landing page and should not grow into one
 * here — a deeper treatment is later work.
 *
 * The copy answers, in order, the four things residents actually ask: what it is,
 * what to do, what they get, and why the receipt cannot be reused. The last one
 * is not decoration — residents have tried to re-submit an issued receipt as
 * proof of a later payment, and telling them plainly why that does not work is
 * cheaper than the rejection it otherwise becomes.
 */

const SECTIONS = [
  {
    icon: Sparkles,
    title: "What the Resident Offer Program is",
    content: [
      "Every invoice you receive carries its own reference code — something like RUP-4821-K.",
      "Quote that code when you pay, and your payment is matched to the right month automatically, usually within minutes instead of waiting on a manual check.",
      "Verified payments are receipted under the programme, with a certified receipt you can download or forward at any time.",
    ],
  },
  {
    icon: UserPlus,
    title: "Who is eligible",
    content: [
      "You must be a resident of a hostel that uses this platform — the programme runs on the invoices your hostel issues you.",
      "Your resident account must be active, with at least one invoice raised against it.",
      "There is no fee and no minimum. Eligibility is per resident, not per hostel.",
      "If you are not a resident yet, join a hostel on the platform first — the button below will not be available until then.",
    ],
  },
  {
    icon: BadgeCheck,
    title: "What you need to do",
    content: [
      "Copy the reference code from your invoice or from the Fees & Payments page in your resident portal.",
      "Paste it into the remarks, purpose or notes field when you make the transfer or wallet payment.",
      "If your bank strips that field or does not offer one, pay as normal — your rent still counts. Quoting the code speeds up matching; it is never a condition of payment.",
    ],
  },
  {
    icon: Receipt,
    title: "What happens after you pay",
    content: [
      "Upload your payment screenshot in the resident portal. We email you straight away to confirm we have it.",
      "Nothing is credited to your account until your hostel verifies the payment — a submitted proof is not yet a settled payment.",
      "Once it is verified, we email you a certified receipt as a PDF and keep a copy in your portal to download any time.",
    ],
  },
  {
    icon: FileText,
    title: "What is on your receipt",
    content: [
      "A receipt number unique to that one payment — no two receipts ever share it, even for the same month.",
      "The amount paid, the date it was issued, and the exact dates the payment covers.",
      "The invoice reference code it was matched against, and a Resident Offer Program certification stamp.",
      "If a receipt is ever corrected, the original is marked VOID and a replacement is issued with its own number. Both stay readable.",
    ],
  },
  {
    icon: ShieldCheck,
    title: "Why a receipt cannot be used as payment proof",
    content: [
      "A receipt is our record that the hostel received money. It is not evidence that you sent it — those are opposite directions.",
      "Receipts we issue are marked so our system recognises them, and uploading one as proof of a payment will be refused, including a screenshot of it.",
      "For proof, upload the confirmation from the app or bank you paid with — the screen showing the money leaving your account.",
      "This protects you as much as the hostel: it is what stops one payment being counted twice and your balance going wrong.",
    ],
  },
];

/**
 * The apply block — the one part of this page that is not the same for everyone.
 *
 * Three states, and the distinction that matters is the third: a signed-in user
 * who is not a resident. Showing them "Apply" would send them to a portal they
 * cannot open, and showing them the signed-out pitch would tell them to create an
 * account they already have. Both are dead ends, and both are what a two-state
 * check produces.
 *
 * `status === "unknown"` renders the block disabled rather than absent. The
 * session resolves a beat after first paint, and a button that appears late moves
 * the page under whoever was already reading it — worse than one that is briefly
 * inert.
 *
 * **Apply routes into the portal rather than writing anything.** Eligibility is a
 * property of being a resident with invoices, which is already true or already
 * false by the time anyone reads this page; there is no approval to grant. The
 * button takes an eligible resident to the screen where their code lives and
 * where the programme is actually used.
 */
function ApplyBlock() {
  const status = useSessionStore((state) => state.status);
  const user = useSessionStore((state) => state.user);
  const isResident = Boolean(user?.userResidentId);

  if (status === "unknown") {
    return (
      <div className="mt-16 rounded-xl border border-border bg-muted/50 p-6">
        <p className="text-sm text-muted-foreground">Checking your account…</p>
      </div>
    );
  }

  if (isResident) {
    return (
      <div className="mt-16 rounded-xl border border-primary/30 bg-primary/5 p-6">
        <p className="font-semibold text-foreground">You are eligible</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Your resident account qualifies for the Resident Offer Program. Apply to
          start using your reference code on your next payment.
        </p>
        <Button asChild className="mt-4">
          <Link href="/resident/payments">
            Apply for the Resident Offer Program
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    );
  }

  if (user) {
    // Signed in, but not as a resident — an owner, a warden, a guardian, a
    // visitor with an account. Saying "become a resident" is the honest answer
    // and it is not the same as "sign up".
    return (
      <div className="mt-16 rounded-xl border border-border bg-muted/50 p-6">
        <p className="font-semibold text-foreground">
          This programme is for residents
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Your account is signed in, but it is not a resident account. The Resident
          Offer Program runs on the invoices a hostel issues you, so you need to be a
          resident of a hostel on the platform to be eligible.
        </p>
        <Button asChild className="mt-4" variant="outline">
          <Link href="/hostels">
            Find a hostel
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-16 rounded-xl border border-border bg-muted/50 p-6">
      <p className="font-semibold text-foreground">Become a resident to be eligible</p>
      <p className="mt-1 text-sm text-muted-foreground">
        The Resident Offer Program is open to residents of hostels on this platform.
        Join a hostel first — once your resident account is active and your first
        invoice is raised, you can apply from this page.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/hostels">
            Find a hostel
            <ArrowRight className="size-4" />
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/login">Already a resident? Sign in</Link>
        </Button>
      </div>
    </div>
  );
}

export function PublicOfferProgramPage() {
  const siteName = useSiteConfig().identity.siteName;

  return (
    <PublicShell active="offer-program">
      <div className="mx-auto max-w-3xl px-6 py-20">
        {/* Header */}
        <div className="mb-16 text-center">
          <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-primary/10">
            <Sparkles className="size-7 text-primary" />
          </div>
          <h1 className="font-heading text-4xl font-bold tracking-tight text-foreground">
            Resident Offer Program
          </h1>
          <p className="mt-3 text-muted-foreground">
            How your rent payments are matched, verified and receipted
          </p>
          <div className="mx-auto mt-4 h-px max-w-xs bg-border" />
        </div>

        {/* Intro */}
        <div className="mb-14 text-sm leading-relaxed text-muted-foreground">
          <p>
            The Resident Offer Program is how {siteName} makes sure a payment reaches
            the right month, the right resident and the right hostel — without anyone
            having to chase it. It costs you one extra step when you pay, and it is the
            difference between a payment credited the same day and one sitting in a
            queue waiting to be identified by hand.
          </p>
          <p className="mt-4">
            Anyone can read the rules below. Applying needs a resident account.
          </p>
        </div>

        {/* Sections */}
        <div className="space-y-12">
          {SECTIONS.map(({ icon: Icon, title, content }) => (
            <section key={title}>
              <div className="mb-4 flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="size-4.5 text-primary" />
                </span>
                <h2 className="font-heading text-lg font-semibold text-foreground">
                  {title}
                </h2>
              </div>
              <ul className="ml-12 space-y-2.5">
                {content.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 text-sm leading-relaxed text-muted-foreground"
                  >
                    <span className="mt-1.5 block size-1.5 shrink-0 rounded-full bg-primary/40" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* Apply — the only part of the page that depends on who is reading it. */}
        <ApplyBlock />

        {/* Contact */}
        <div className="mt-8 rounded-xl border border-border bg-muted/50 p-6 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">
            Not sure about a payment or a receipt?
          </p>
          <p className="mt-1">
            Your hostel administration is the right first stop — they can see your
            invoices, your payments and every receipt issued to you. You can also
            reach them from the Fees &amp; Payments page in your resident portal.
          </p>
        </div>
      </div>
    </PublicShell>
  );
}
