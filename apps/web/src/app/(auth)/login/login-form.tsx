"use client";

import { Eye, EyeOff, LockKeyhole, ShieldCheck, User } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState, type FormEvent } from "react";

import { destinationForRole } from "@/lib/route-access";
import { Role } from "@/lib/roles";

import { GoogleAuthButton } from "../google-auth-button";

/* ─────────────────────── Types ─────────────────────── */
type LoginUser = { role: Role };
type LoginResponse =
  | { success: true; data: { user: LoginUser }; message: string }
  | { success: false; errorCode: string; message: string };

const routeErrorMessages: Record<string, string> = {
  forbidden: "Your account is not allowed to open that portal.",
  resident_removed:
    "Your hostel has removed your resident profile. Sign in again to keep using your account as a regular user, or contact your hostel if you think this is a mistake.",
  invalid_session: "Your session could not be verified. Please login again.",
  session_expired: "Your session expired. Please login again.",
};

/* ─────────────────────── Component ─────────────────── */
export function LoginForm({ googleClientId }: { googleClientId: string }) {
  return (
    <Suspense fallback={null}>
      <LoginFormContent googleClientId={googleClientId} />
    </Suspense>
  );
}

function LoginFormContent({ googleClientId }: { googleClientId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const routeError = searchParams.get("error");
  const visibleError =
    error || (routeError ? (routeErrorMessages[routeError] ?? "") : "");
  const nextParam = searchParams.get("next");
  const signupLink = nextParam
    ? `/signup?next=${encodeURIComponent(nextParam)}`
    : "/signup";

  /* helpers */
  function destinationAfterLogin(role: Role) {
    return destinationForRole(role, nextParam);
  }

  const handleGoogleSuccess = useCallback(
    (user: { role: Role }) => {
      router.push(destinationAfterLogin(user.role));
      router.refresh();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, nextParam],
  );

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: identifier.trim().toLowerCase(),
          password,
        }),
      });
      const payload = (await res.json().catch(() => null)) as LoginResponse | null;
      if (!res.ok || !payload?.success)
        throw new Error(payload?.message ?? "Login failed.");
      router.push(destinationAfterLogin(payload.data.user.role));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  /* ── render ── */
  return (
    <div className="flex flex-col gap-0">
      {/* ── Heading ── */}
      <div className="mb-7">
        <h2 className="font-heading text-[28px] font-bold text-[#0F172A] leading-tight">
          Login to your account
        </h2>
        <p className="mt-1.5 text-[13px] text-slate-500">
          Enter your credentials to access your dashboard.
        </p>
      </div>

      {/* ── Error ── */}
      {visibleError && (
        <div
          aria-live="polite"
          className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-600"
        >
          {visibleError}
        </div>
      )}

      {/* ── Form ── */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {/* Email / Phone */}
        <div className="flex flex-col gap-1.5">
          <label
            className="text-[13px] font-semibold text-[#0F172A]"
            htmlFor="login-identifier"
          >
            Email or Access Username
          </label>
          <div className="flex h-[52px] items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 transition focus-within:border-[#0A8A4B] focus-within:ring-2 focus-within:ring-[#0A8A4B]/15">
            <User className="size-[18px] shrink-0 text-slate-400" />
            <input
              autoComplete="username"
              className="h-full flex-1 bg-transparent text-[14px] text-[#0F172A] placeholder:text-slate-300 outline-none"
              id="login-identifier"
              name="identifier"
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="Enter your email or temporary access username"
              required
              type="text"
              value={identifier}
            />
          </div>
        </div>

        {/* Password */}
        <div className="flex flex-col gap-1.5">
          <label
            className="text-[13px] font-semibold text-[#0F172A]"
            htmlFor="login-password"
          >
            Password
          </label>
          <div className="flex h-[52px] items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 transition focus-within:border-[#0A8A4B] focus-within:ring-2 focus-within:ring-[#0A8A4B]/15">
            <LockKeyhole className="size-[18px] shrink-0 text-slate-400" />
            <input
              autoComplete="current-password"
              className="h-full flex-1 bg-transparent text-[14px] text-[#0F172A] placeholder:text-slate-300 outline-none"
              id="login-password"
              name="password"
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              type={showPassword ? "text" : "password"}
              value={password}
            />
            <button
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="text-slate-400 hover:text-slate-600 transition"
              onClick={() => setShowPassword((v) => !v)}
              type="button"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        {/* Remember + Forgot */}
        <div className="flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-slate-500 select-none">
            <input
              className="size-4 rounded border-slate-300 text-[#0A8A4B] focus:ring-[#0A8A4B] cursor-pointer"
              type="checkbox"
            />
            Remember me
          </label>
          <Link
            className="text-[13px] font-semibold text-[#0A8A4B] hover:underline"
            href="/reset-password"
          >
            Forgot password?
          </Link>
        </div>

        {/* Google button */}
        <GoogleAuthButton
          clientId={googleClientId}
          onError={setError}
          onSuccess={handleGoogleSuccess}
        />

        {/* Sign in */}
        <button
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[#0A8A4B] text-[15px] font-bold text-white shadow-md shadow-[#0A8A4B]/20 transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-400"
          disabled={isSubmitting}
          type="submit"
        >
          <LockKeyhole className="size-[18px]" />
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {/* ── Role-aware redirect info ── */}
      <div className="mt-5 flex items-center gap-3 rounded-xl border border-emerald-100 bg-[#EAF6F3] px-4 py-3">
        <ShieldCheck className="size-5 shrink-0 text-[#0A8A4B]" />
        <div>
          <p className="text-[13px] font-semibold text-[#0F172A]">Role-aware redirect</p>
          <p className="text-[12px] text-slate-500 mt-0.5">
            You&apos;ll be redirected to the right dashboard based on your role.
          </p>
        </div>
      </div>

      {/* ── Bottom link ── */}
      <p className="mt-8 text-center text-[13px] text-slate-500">
        Don&apos;t have an account?{" "}
        <a className="font-bold text-[#0A8A4B] hover:underline" href={signupLink}>
          Sign up
        </a>
      </p>
    </div>
  );
}
