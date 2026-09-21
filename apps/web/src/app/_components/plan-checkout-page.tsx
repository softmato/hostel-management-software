"use client";

import { CheckCircle2, Info, Loader2, Mail, ShieldCheck, Upload } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { billingCycles, cycleTotal, getPlan, type BillingCycle } from "@hostel/shared/plans/catalog";

import { useSiteConfig } from "@/components/site-config-provider";
import { browserApi } from "@/lib/browser-api";
import { uploadFile } from "@/lib/uploads/uploader";
import { cn } from "@/lib/utils";

import { PublicShell } from "./shared";

type PaymentState = {
  instructions: {
    amountDue: number;
    claim: { amount: number; claimedAt: string | null } | null;
    invoice: { invoiceNumber: string; planName: string } | null;
    qr: { label: string; url: string } | null;
    reference: string | null;
  };
  online: boolean;
  plan: { currentPeriodEnd: string | null; name: string | null; status: string } | null;
};

type Invoice = {
  amount: number;
  invoiceNumber: string;
  periodEnd: string | null;
  planName: string;
};

type Step = "details" | "code" | "pay" | "done";

const INPUT =
  "mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3.5 text-sm text-foreground outline-none transition focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/15";
const PRIMARY =
  "inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-teal text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-60";

function rupees(amount: number) {
  return `Rs ${amount.toLocaleString("en-IN")}`;
}

function day(iso: string | null) {
  return iso
    ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "—";
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

function checkout<T>(body: Record<string, unknown>) {
  return browserApi<T>("/api/v1/public/plan-checkout", {
    body: JSON.stringify(body),
    method: "POST",
  });
}

/**
 * Buying a plan for a hostel already on the platform, without signing in:
 * name the hostel (email + Hostel ID), prove it with a code sent to that
 * email, then pay. Paying extends the plan that is running.
 */
export function PlanCheckoutPage({ cycle: initialCycle, planId }: { cycle: string; planId: string }) {
  const { plans: catalog } = useSiteConfig();
  const plan = getPlan(catalog, planId);
  const [cycle, setCycle] = useState<BillingCycle>(
    (["monthly", "halfYearly", "annual"] as const).find((id) => id === initialCycle) ?? "annual",
  );
  const [step, setStep] = useState<Step>("details");
  const [email, setEmail] = useState("");
  const [hostelCode, setHostelCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [resumed, setResumed] = useState(false);
  // When "Resend code" unlocks, as a timestamp; `now` ticks while waiting.
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [token, setToken] = useState("");
  const [hostel, setHostel] = useState<{ code: string; name: string } | null>(null);
  const [payment, setPayment] = useState<PaymentState | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [reused, setReused] = useState(false);
  const [proof, setProof] = useState<{ claimToken: string; fileAssetId: string; name: string } | null>(null);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError("");

    try {
      await action();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    if (step !== "code" || resendAt <= Date.now()) return;

    const timer = window.setInterval(() => setNow(Date.now()), 1000);

    return () => window.clearInterval(timer);
  }, [resendAt, step]);

  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  function requestCode() {
    void run("send", async () => {
      const result = await checkout<{
        challengeId: string;
        resendInSeconds: number;
        resumed: boolean;
      }>({ email, hostelCode, step: "start" });

      setChallengeId(result.challengeId);
      setResumed(result.resumed);
      setResendAt(Date.now() + result.resendInSeconds * 1000);
      setNow(Date.now());
      setCode("");
      setStep("code");
    });
  }

  function sendCode(event: FormEvent) {
    event.preventDefault();
    requestCode();
  }

  function verify(event: FormEvent) {
    event.preventDefault();
    void run("verify", async () => {
      const verified = await checkout<PaymentState & { hostel: { code: string; name: string }; token: string }>({
        challengeId,
        code,
        hostelCode,
        step: "verify",
      });
      const raised = await checkout<PaymentState & { invoice: Invoice; reused: boolean }>({
        cycle,
        planId,
        step: "invoice",
        token: verified.token,
      });

      setToken(verified.token);
      setHostel(verified.hostel);
      setInvoice(raised.invoice);
      setReused(raised.reused);
      setPayment(raised);
      setStep(raised.instructions.claim ? "done" : "pay");
    });
  }

  function payOnline() {
    void run("online", async () => {
      const session = await checkout<{ checkoutUrl: string }>({ step: "pay", token });

      window.location.assign(session.checkoutUrl);
    });
  }

  function attach(file: File) {
    void run("upload", async () => {
      const uploaded = await uploadFile(file, {
        kind: "image",
        label: "Payment screenshot",
        silent: true,
        target: "public",
        visibility: "private",
      });

      if (!uploaded?.assetId || !uploaded.claimToken) {
        throw new Error("Could not upload that screenshot. Try again.");
      }

      setProof({ claimToken: uploaded.claimToken, fileAssetId: uploaded.assetId, name: file.name });
    });
  }

  function sendProof() {
    if (!proof) return;

    void run("claim", async () => {
      await checkout({
        claimToken: proof.claimToken,
        fileAssetId: proof.fileAssetId,
        reference,
        step: "claim",
        token,
      });
      setStep("done");
    });
  }

  if (!plan) {
    return (
      <PublicShell active="plans-pricing">
        <div className="mx-auto max-w-md px-5 py-20 text-center">
          <p className="text-lg font-bold text-foreground">That plan is not available.</p>
          <Link className="mt-4 inline-block font-semibold text-brand-teal" href="/plans-pricing">
            See all plans
          </Link>
        </div>
      </PublicShell>
    );
  }

  const price = cycleTotal(plan, cycle);

  return (
    <PublicShell active="plans-pricing">
      <div className="mx-auto max-w-lg px-4 pb-20 pt-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Get {plan.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          For a hostel already on the platform. Paying extends the plan it is on now.
        </p>

        {/* The plan being bought — the cycle can change until the invoice is raised. */}
        <div className="app-card mt-6 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-semibold text-foreground">{plan.name}</p>
            <p className="text-xl font-bold tabular-nums text-foreground">{rupees(invoice?.amount ?? price)}</p>
          </div>
          {step === "details" || step === "code" ? (
            <div className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
              {billingCycles(catalog).map((option) => (
                <button
                  className={cn(
                    "rounded-lg py-1.5 text-xs font-semibold transition",
                    cycle === option.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                  )}
                  key={option.id}
                  onClick={() => setCycle(option.id)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : invoice ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Invoice {invoice.invoiceNumber} · plan runs until {day(invoice.periodEnd)}
            </p>
          ) : null}
        </div>

        <div className="app-card mt-4 p-5">
          {step === "details" ? (
            <form className="space-y-4" onSubmit={sendCode}>
              <label className="block text-sm font-semibold text-foreground">
                Hostel email
                <input
                  autoComplete="email"
                  className={INPUT}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="owner@yourhostel.com"
                  required
                  type="email"
                  value={email}
                />
              </label>
              <div>
                <div className="flex items-center gap-1.5">
                  <label className="text-sm font-semibold text-foreground" htmlFor="hostel-id">
                    Hostel ID
                  </label>
                  {/* Hover on desktop, tap (focus) on a phone. */}
                  <span className="group relative inline-flex">
                    <button
                      aria-describedby="hostel-id-help"
                      aria-label="Where to find your Hostel ID"
                      className="rounded-full text-muted-foreground transition hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
                      type="button"
                    >
                      <Info className="size-3.5" />
                    </button>
                    <span
                      className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-64 -translate-x-1/2 rounded-lg bg-foreground px-3 py-2 text-xs leading-relaxed text-background opacity-0 shadow-lg transition group-focus-within:opacity-100 group-hover:opacity-100"
                      id="hostel-id-help"
                      role="tooltip"
                    >
                      It looks like <strong className="font-mono">HH-3F9A1C2E</strong>. Find it on
                      the top card of the app&apos;s Home screen, or on your web dashboard.
                    </span>
                  </span>
                </div>
                <input
                  autoCapitalize="characters"
                  className={cn(INPUT, "font-mono uppercase tracking-wide")}
                  id="hostel-id"
                  onChange={(event) => setHostelCode(event.target.value)}
                  placeholder="HH-3F9A1C2E"
                  required
                  value={hostelCode}
                />
              </div>
              <button className={PRIMARY} disabled={Boolean(busy)} type="submit">
                {busy === "send" ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                Send verification code
              </button>
              <p className="text-center text-xs text-muted-foreground">
                Not on HostelPalika yet?{" "}
                <Link className="font-semibold text-brand-teal" href={`/register-hostel?plan=${plan.id}`}>
                  Register your hostel
                </Link>
              </p>
            </form>
          ) : null}

          {step === "code" ? (
            <form className="space-y-4" onSubmit={verify}>
              <p className="text-sm text-muted-foreground">
                {resumed ? "We already sent a 6-digit code to " : "We sent a 6-digit code to "}
                <strong className="text-foreground">{email}</strong>
                {resumed ? " a moment ago — use that one." : "."}
              </p>
              <input
                aria-label="Verification code"
                autoComplete="one-time-code"
                className={cn(INPUT, "text-center font-mono text-2xl tracking-[0.5em]")}
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                required
                value={code}
              />
              <button className={PRIMARY} disabled={Boolean(busy) || code.length !== 6} type="submit">
                {busy === "verify" ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                Verify and continue
              </button>
              <div className="flex items-center justify-between text-xs font-semibold">
                <button
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setStep("details")}
                  type="button"
                >
                  Use a different email or ID
                </button>
                <button
                  className="text-brand-teal disabled:text-muted-foreground"
                  disabled={resendIn > 0 || Boolean(busy)}
                  onClick={requestCode}
                  type="button"
                >
                  {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
                </button>
              </div>
            </form>
          ) : null}

          {step === "pay" && payment && invoice ? (
            <div className="space-y-4">
              <div className="text-sm">
                <p className="font-semibold text-foreground">
                  {hostel?.name} <span className="font-mono text-xs text-muted-foreground">{hostel?.code}</span>
                </p>
                {payment.plan?.name ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Now on {payment.plan.name}
                    {payment.plan.currentPeriodEnd ? `, until ${day(payment.plan.currentPeriodEnd)}` : ""}
                  </p>
                ) : null}
              </div>

              {reused ? (
                <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground">
                  Invoice {invoice.invoiceNumber} for {invoice.planName} is already open, so that is what
                  you pay now.
                </p>
              ) : null}

              <p className="text-2xl font-bold tabular-nums text-foreground">
                {rupees(payment.instructions.amountDue)}
              </p>

              {payment.online ? (
                <button className={PRIMARY} disabled={Boolean(busy)} onClick={payOnline} type="button">
                  {busy === "online" ? <Loader2 className="size-4 animate-spin" /> : null}
                  Pay online
                </button>
              ) : null}

              {payment.instructions.qr ? (
                <div className="space-y-3 border-t border-border pt-4">
                  <p className="text-sm font-semibold text-foreground">
                    {payment.online ? "Or scan to pay" : "Scan to pay"}
                  </p>
                  <div className="mx-auto w-fit rounded-xl border border-border bg-white p-2">
                    <Image
                      alt="Payment QR"
                      height={200}
                      src={payment.instructions.qr.url}
                      unoptimized
                      width={200}
                    />
                  </div>
                  <p className="text-center text-xs text-muted-foreground">
                    {payment.instructions.qr.label} · write{" "}
                    <strong className="font-mono text-foreground">{payment.instructions.reference}</strong> in
                    the remarks
                  </p>
                  <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm font-semibold text-foreground transition hover:border-brand-teal">
                    {busy === "upload" ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                    {proof ? proof.name : "Attach payment screenshot"}
                    <input
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];

                        if (file) attach(file);

                        event.currentTarget.value = "";
                      }}
                      type="file"
                    />
                  </label>
                  <input
                    className={INPUT}
                    maxLength={120}
                    onChange={(event) => setReference(event.target.value)}
                    placeholder="Transaction ID (optional)"
                    value={reference}
                  />
                  <button className={PRIMARY} disabled={!proof || Boolean(busy)} onClick={sendProof} type="button">
                    {busy === "claim" ? <Loader2 className="size-4 animate-spin" /> : null}
                    Send payment proof
                  </button>
                </div>
              ) : !payment.online ? (
                <p className="text-sm text-muted-foreground">
                  Payment is not open right now. Contact us and we will take it for you.
                </p>
              ) : null}
            </div>
          ) : null}

          {step === "done" ? (
            <div className="py-4 text-center">
              <CheckCircle2 className="mx-auto size-10 text-success" />
              <p className="mt-3 font-bold text-foreground">We have your payment proof</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Our team checks it within 1–2 working days. Your plan is extended the moment it is
                confirmed, and we email you then.
              </p>
            </div>
          ) : null}

          {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
        </div>
      </div>
    </PublicShell>
  );
}
