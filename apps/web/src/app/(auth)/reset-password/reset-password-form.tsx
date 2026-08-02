"use client";

import { ArrowLeft, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";

import { AuthShell } from "../auth-shell";

type AuthResponse =
  | { success: true; message: string; data: unknown }
  | { success: false; message: string; errorCode: string };

async function authRequest(path: string, body: unknown) {
  const response = await fetch(path, {
    body: JSON.stringify(body),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as AuthResponse | null;

  if (!response.ok || !payload?.success) {
    throw new Error(payload?.message ?? "Request failed. Please try again.");
  }

  return payload.message;
}

const FIELD_SHELL =
  "flex h-[52px] items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 transition focus-within:border-[#0A8A4B] focus-within:ring-2 focus-within:ring-[#0A8A4B]/15";
const FIELD_INPUT =
  "h-full flex-1 bg-transparent text-[14px] text-[#0F172A] placeholder:text-slate-300 outline-none";
const PRIMARY_BUTTON =
  "flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[#0A8A4B] text-[15px] font-bold text-white shadow-md shadow-[#0A8A4B]/20 transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-400";

export function ResetPasswordForm() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordFormContent />
    </Suspense>
  );
}

function ResetPasswordFormContent() {
  const searchParams = useSearchParams();
  // The emailed link carries the token. Without one the visitor arrived from
  // "Forgot password?" and needs to request a link first.
  const token = searchParams.get("token") ?? "";

  return (
    <AuthShell mode="login">
      {token ? <SetNewPassword token={token} /> : <RequestResetLink />}
    </AuthShell>
  );
}

function Heading({ subtitle, title }: { subtitle: string; title: string }) {
  return (
    <div className="mb-7">
      <h2 className="font-heading text-[26px] font-extrabold tracking-tight text-[#0F172A]">
        {title}
      </h2>
      <p className="mt-1.5 text-[13px] text-slate-500">{subtitle}</p>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      aria-live="polite"
      className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-600"
    >
      {message}
    </div>
  );
}

function BackToLogin() {
  return (
    <Link
      className="mt-6 flex items-center justify-center gap-1.5 text-[13px] font-semibold text-slate-500 transition hover:text-[#0A8A4B]"
      href="/login"
    >
      <ArrowLeft className="size-4" />
      Back to sign in
    </Link>
  );
}

/** Step 1 — ask for the reset email. */
function RequestResetLink() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const identifier = email.trim().toLowerCase();

    try {
      await authRequest("/api/v1/auth/forgot-password", { email: identifier });
      setSentTo(identifier);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not send the reset link. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (sentTo) {
    return (
      <>
        <Heading
          subtitle="If an account exists for that address, a reset link is on its way."
          title="Check your inbox"
        />
        <div className="flex items-start gap-3 rounded-xl border border-emerald-100 bg-[#EAF6F3] px-4 py-4">
          <CheckCircle2 className="size-5 shrink-0 text-[#0A8A4B]" />
          <div>
            <p className="text-[13px] font-semibold text-[#0F172A]">Sent to {sentTo}</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">
              The link expires in one hour and can only be used once. If it does not
              arrive, check your spam folder before requesting another.
            </p>
          </div>
        </div>
        <button
          className="mt-5 w-full text-[13px] font-semibold text-[#0A8A4B] hover:underline"
          onClick={() => setSentTo("")}
          type="button"
        >
          Use a different email address
        </button>
        <BackToLogin />
      </>
    );
  }

  return (
    <>
      <Heading
        subtitle="Enter the email on your account and we'll send you a reset link."
        title="Reset your password"
      />

      {error ? <ErrorBanner message={error} /> : null}

      <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1.5">
          <label
            className="text-[13px] font-semibold text-[#0F172A]"
            htmlFor="reset-email"
          >
            Email
          </label>
          <div className={FIELD_SHELL}>
            <Mail className="size-[18px] shrink-0 text-slate-400" />
            <input
              autoComplete="email"
              className={FIELD_INPUT}
              id="reset-email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              required
              type="email"
              value={email}
            />
          </div>
        </div>

        <button className={PRIMARY_BUTTON} disabled={isSubmitting} type="submit">
          <Mail className="size-[18px]" />
          {isSubmitting ? "Sending…" : "Send reset link"}
        </button>
      </form>

      <BackToLogin />
    </>
  );
}

/** Step 2 — the visitor followed the emailed link and sets a new password. */
function SetNewPassword({ token }: { token: string }) {
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isDone, setIsDone] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    try {
      await authRequest("/api/v1/auth/reset-password", { newPassword, token });
      setIsDone(true);
    } catch (resetError) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : "Could not reset the password. Please request a new link.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isDone) {
    return (
      <>
        <Heading
          subtitle="Your password has been changed and every other session was signed out."
          title="Password updated"
        />
        <div className="flex items-start gap-3 rounded-xl border border-emerald-100 bg-[#EAF6F3] px-4 py-4">
          <CheckCircle2 className="size-5 shrink-0 text-[#0A8A4B]" />
          <p className="text-[12px] leading-relaxed text-slate-500">
            Signing out everywhere is deliberate — if someone else had access to the old
            password, that access is now gone.
          </p>
        </div>
        <Link className={`${PRIMARY_BUTTON} mt-5`} href="/login">
          <LockKeyhole className="size-[18px]" />
          Continue to sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <Heading
        subtitle="Choose a new password for your account."
        title="Set a new password"
      />

      {error ? <ErrorBanner message={error} /> : null}

      <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1.5">
          <label
            className="text-[13px] font-semibold text-[#0F172A]"
            htmlFor="new-password"
          >
            New password
          </label>
          <div className={FIELD_SHELL}>
            <LockKeyhole className="size-[18px] shrink-0 text-slate-400" />
            <input
              autoComplete="new-password"
              className={FIELD_INPUT}
              id="new-password"
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="At least 8 characters"
              required
              type={showPassword ? "text" : "password"}
              value={newPassword}
            />
            <button
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="text-slate-400 transition hover:text-slate-600"
              onClick={() => setShowPassword((visible) => !visible)}
              type="button"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            className="text-[13px] font-semibold text-[#0F172A]"
            htmlFor="confirm-password"
          >
            Confirm new password
          </label>
          <div className={FIELD_SHELL}>
            <LockKeyhole className="size-[18px] shrink-0 text-slate-400" />
            <input
              autoComplete="new-password"
              className={FIELD_INPUT}
              id="confirm-password"
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Re-enter the new password"
              required
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
            />
          </div>
        </div>

        <button className={PRIMARY_BUTTON} disabled={isSubmitting} type="submit">
          <LockKeyhole className="size-[18px]" />
          {isSubmitting ? "Updating…" : "Reset password"}
        </button>
      </form>

      <BackToLogin />
    </>
  );
}
