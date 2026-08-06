"use client";

import {
  ArrowLeft,
  BarChart3,
  Building2,
  Check,
  Eye,
  EyeOff,
  HelpCircle,
  LockKeyhole,
  Mail,
  Pencil,
  Phone,
  ShieldCheck,
  User,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Suspense,
  useCallback,
  useState,
  useEffect,
  useRef,
  type FormEvent,
} from "react";

import { destinationForRole } from "@/lib/route-access";
import { Role } from "@/lib/roles";

import { GoogleAuthButton } from "../google-auth-button";
import { AuthShell } from "../auth-shell";
import { SiteName } from "@/components/site-config-provider";

type AuthResponse<T> =
  | {
      success: true;
      data: T;
      message: string;
    }
  | {
      success: false;
      errorCode: string;
      message: string;
    };

type OtpRequestData = {
  challengeId: string;
  devCode?: string;
  expiresAt: string;
};

type RegisterData = {
  user: {
    id: string;
    role: string;
  };
};

type SignupStep = "details" | "verify";

type SignupFormProps = {
  googleClientId: string;
};

async function authRequest<T>(path: string, body: unknown) {
  const response = await fetch(path, {
    body: JSON.stringify(body),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as AuthResponse<T> | null;

  if (!response.ok || !payload?.success) {
    throw new Error(payload?.message ?? "Request failed. Please try again.");
  }

  return payload.data;
}

export function SignupForm({ googleClientId }: SignupFormProps) {
  return (
    <Suspense fallback={null}>
      <SignupFormContent googleClientId={googleClientId} />
    </Suspense>
  );
}

function SignupFormContent({ googleClientId }: SignupFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Signup details state
  const [step, setStep] = useState<SignupStep>("details");
  const [activeTab, setActiveTab] = useState<"email" | "phone">("email");
  const [challengeId, setChallengeId] = useState("");
  const [devCode, setDevCode] = useState("");
  const [error, setError] = useState("");
  const [isResending, setIsResending] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form Fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreeToTerms, setAgreeToTerms] = useState(false);

  // Visibility toggles
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // OTP inputs
  const [otpArray, setOtpArray] = useState<string[]>(Array(6).fill(""));
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);

  // Timer state
  const [countdown, setCountdown] = useState(42);

  const identifier = email.trim().toLowerCase();
  const nextParam = searchParams.get("next");

  const redirectAfterAuth = useCallback(
    (role: Role) => {
      router.push(nextParam ?? destinationForRole(role));
      router.refresh();
    },
    [nextParam, router],
  );

  const handleGoogleSuccess = useCallback(
    (user: { role: Role }) => {
      redirectAfterAuth(user.role);
    },
    [redirectAfterAuth],
  );

  // Countdown timer effect
  useEffect(() => {
    if (step !== "verify" || countdown <= 0) return;

    const timer = setInterval(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [step, countdown]);

  // Handle OTP focus transitions
  const handleOtpChange = (value: string, index: number) => {
    const val = value.replace(/[^0-9]/g, "");
    if (!val) {
      const newOtp = [...otpArray];
      newOtp[index] = "";
      setOtpArray(newOtp);
      return;
    }

    const newOtp = [...otpArray];
    newOtp[index] = val.slice(-1);
    setOtpArray(newOtp);

    // Auto-focus next input
    if (index < 5 && val) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    index: number,
  ) => {
    if (event.key === "Backspace") {
      if (!otpArray[index] && index > 0) {
        // Clear previous input and focus it
        const newOtp = [...otpArray];
        newOtp[index - 1] = "";
        setOtpArray(newOtp);
        otpRefs.current[index - 1]?.focus();
      } else {
        const newOtp = [...otpArray];
        newOtp[index] = "";
        setOtpArray(newOtp);
      }
    }
  };

  async function sendOtp() {
    const data = await authRequest<OtpRequestData>("/api/v1/auth/otp/request", {
      channel: "email",
      identifier,
      purpose: "registration",
    });

    setChallengeId(data.challengeId);
    setDevCode(data.devCode ?? "");
    setOtpArray(Array(6).fill(""));
    setCountdown(42);
    setStep("verify");
  }

  async function requestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!agreeToTerms) {
      setError("Please agree to the Terms of Service and Privacy Policy.");
      return;
    }

    setIsSubmitting(true);

    try {
      await sendOtp();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not send OTP. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function resendOtp() {
    setError("");
    setIsResending(true);

    try {
      await sendOtp();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not resend OTP. Please try again.",
      );
    } finally {
      setIsResending(false);
    }
  }

  async function completeSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const fullCode = otpArray.join("");
    if (fullCode.length < 6) {
      setError("Please enter the full 6-digit OTP.");
      setIsSubmitting(false);
      return;
    }

    try {
      await authRequest("/api/v1/auth/otp/verify", {
        challengeId,
        code: fullCode,
      });
      await authRequest<RegisterData>("/api/v1/auth/register", {
        email: identifier,
        name,
        otpChallengeId: challengeId,
        password,
      });

      redirectAfterAuth(Role.PUBLIC);
    } catch (signupError) {
      setError(
        signupError instanceof Error
          ? signupError.message
          : "Could not complete signup. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  // Format timer countdown
  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins.toString().padStart(2, "0")}:${remainingSecs.toString().padStart(2, "0")}`;
  };

  // Render OTP Verification Screen
  if (step === "verify") {
    return (
      <main className="h-screen w-screen overflow-hidden bg-[#F8FAFC] text-[#0f172a] font-sans flex flex-col justify-between p-4 lg:p-8 select-none">
        {/* Top bar */}
        <header className="flex items-center justify-between max-w-[1360px] mx-auto w-full border-b border-slate-100 pb-3">
          {/* Logo */}
          <div className="flex items-center gap-2.5 text-[#0A8A4B]">
            <div className="flex items-center justify-center size-9 bg-[#0A8A4B]/10 rounded-xl">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M3 9.5L12 3L21 9.5V20C21 20.5523 20.5523 21 20 21H14V14H10V21H4C3.44772 21 3 20.5523 3 20V9.5Z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <span className="font-heading text-2xl font-extrabold text-[#0F172A] tracking-tight">
              Hostel<span className="text-[#0A8A4B]">Hub</span>
            </span>
          </div>

          <div className="flex items-center gap-6 text-xs font-semibold text-slate-400">
            <span className="hidden md:flex items-center gap-1.5">
              <ShieldCheck className="size-4 text-[#0A8A4B]" /> Secure & Trusted
            </span>
            <span className="hidden md:flex items-center gap-1.5">
              <HelpCircle className="size-4" /> Need help?
            </span>
            <button
              onClick={() => {
                setStep("details");
                setError("");
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 transition"
            >
              <ArrowLeft className="size-3.5" /> Back to Login
            </button>
          </div>
        </header>

        {/* Outer verification card */}
        <div className="flex-1 flex items-center justify-center w-full max-w-[1100px] mx-auto min-h-0 py-6">
          <div className="w-full bg-white rounded-3xl shadow-xl shadow-slate-100/50 border border-slate-100 grid md:grid-cols-[1.1fr_0.9fr] overflow-hidden min-h-0 max-h-[560px]">
            {/* Left side: Inputs */}
            <div className="p-8 flex flex-col justify-between">
              <div className="space-y-6">
                {/* Header icon & text */}
                <div className="flex flex-col items-center text-center">
                  <div className="flex size-14 items-center justify-center rounded-full bg-[#0A8A4B]/10 text-[#0A8A4B] mb-4">
                    <svg
                      className="size-6"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                      <line x1="12" y1="18" x2="12.01" y2="18" />
                      <path d="M9 6h6" />
                      <path d="M9 10h6" />
                    </svg>
                  </div>
                  <h2 className="font-heading text-2xl font-extrabold text-[#0F172A]">
                    Verify your account
                  </h2>
                  <p className="text-xs text-slate-400 mt-2 max-w-sm leading-relaxed">
                    We&apos;ve sent a 6-digit verification code to
                    <br />
                    <span className="font-bold text-slate-600 mt-1 inline-flex items-center gap-1.5">
                      {identifier}
                      <button
                        onClick={() => setStep("details")}
                        className="text-[#0A8A4B] hover:text-[#0a8a4b]/80 inline-flex items-center"
                        title="Edit email"
                      >
                        <Pencil className="size-3" />
                      </button>
                    </span>
                  </p>
                </div>

                {/* Verification form */}
                <form onSubmit={completeSignup} className="space-y-6">
                  {error ? (
                    <div className="rounded-xl border border-red-100 bg-red-50/50 p-3 text-xs font-semibold text-red-600 text-center animate-in fade-in slide-in-from-top-2 duration-200">
                      {error}
                    </div>
                  ) : null}

                  {devCode ? (
                    <div className="rounded-xl border border-amber-100 bg-amber-50/30 p-2.5 text-xs text-amber-800 text-center">
                      Development code:{" "}
                      <span className="font-mono font-bold tracking-wider">
                        {devCode}
                      </span>
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider text-center">
                      Enter 6-digit OTP
                    </label>
                    <div className="flex justify-center gap-2 max-w-[340px] mx-auto">
                      {otpArray.map((digit, index) => (
                        <input
                          aria-label={`OTP digit ${index + 1} of ${otpArray.length}`}
                          key={index}
                          ref={(el) => {
                            otpRefs.current[index] = el;
                          }}
                          type="text"
                          inputMode="numeric"
                          maxLength={1}
                          value={digit}
                          onChange={(e) => handleOtpChange(e.target.value, index)}
                          onKeyDown={(e) => handleOtpKeyDown(e, index)}
                          className="size-11 md:size-12 text-center text-lg font-bold rounded-xl border border-slate-200 bg-slate-50/30 focus:border-[#0A8A4B] focus:bg-white focus:ring-2 focus:ring-[#0A8A4B]/10 outline-none transition-all"
                        />
                      ))}
                    </div>
                  </div>

                  {/* Resend timer */}
                  <div className="text-center text-xs font-semibold text-slate-400">
                    Didn&apos;t receive the code?{" "}
                    {countdown > 0 ? (
                      <span className="text-[#0A8A4B] font-bold">
                        Resend in {formatTimer(countdown)}
                      </span>
                    ) : (
                      <button
                        onClick={resendOtp}
                        disabled={isResending}
                        type="button"
                        className="text-[#0A8A4B] font-bold hover:underline cursor-pointer inline-flex items-center gap-1"
                      >
                        {isResending ? "Resending..." : "Resend OTP"}
                      </button>
                    )}
                  </div>

                  {/* Button */}
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#0A8A4B] text-sm font-bold text-white transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-400 shadow-md shadow-[#0A8A4B]/10"
                  >
                    <LockKeyhole className="size-4" />
                    {isSubmitting ? "Verifying..." : "Verify & Continue"}
                  </button>
                </form>
              </div>

              {/* Encryption Notice */}
              <div className="text-center text-[10px] text-slate-400 font-semibold flex items-center justify-center gap-1 mt-4">
                <LockKeyhole className="size-3" /> Your information is encrypted and
                secure
              </div>
            </div>

            {/* Right side: Welcome context */}
            <div className="hidden md:flex flex-col justify-center p-8 bg-[#EAF6F3]/50 border-l border-slate-100">
              <div className="space-y-6">
                <div className="flex flex-col items-center text-center">
                  <div className="relative flex size-20 items-center justify-center">
                    <div className="absolute inset-0 rounded-full bg-[#0A8A4B]/5 animate-ping duration-1000" />
                    <div className="absolute inset-2 rounded-full bg-[#0A8A4B]/10" />
                    <div className="relative flex size-12 items-center justify-center rounded-full bg-[#0A8A4B] text-white shadow-md shadow-[#0A8A4B]/15">
                      <Check className="size-6 stroke-[3]" />
                    </div>
                  </div>
                  <h3 className="font-heading text-lg font-extrabold text-[#0F172A] mt-4">
                    You&apos;re almost there!
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-[240px] leading-relaxed">
                    Once verified, you&apos;ll get full access to your account and all
                    <SiteName /> features.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-[#0A8A4B]/10 text-[#0A8A4B] shrink-0">
                      <ShieldCheck className="size-4" />
                    </span>
                    <div>
                      <h4 className="text-xs font-bold text-[#0F172A]">Secure Access</h4>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                        Your account is protected with industry-standard encryption.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-[#0A8A4B]/10 text-[#0A8A4B] shrink-0">
                      <Building2 className="size-4" />
                    </span>
                    <div>
                      <h4 className="text-xs font-bold text-[#0F172A]">Manage Easily</h4>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                        Manage hostels, residents, payments and more from one dashboard.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-[#0A8A4B]/10 text-[#0A8A4B] shrink-0">
                      <BarChart3 className="size-4" />
                    </span>
                    <div>
                      <h4 className="text-xs font-bold text-[#0F172A]">
                        Grow Your Business
                      </h4>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                        Get insights and tools to grow your hostel or property business.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center text-[10px] text-slate-400 font-semibold border-t border-slate-100 pt-3 flex items-center justify-center gap-3">
          <span>&copy; 2026 <SiteName /> Platform. All rights reserved.</span>
          <span className="text-slate-200">|</span>
          <span className="flex items-center gap-1">
            Made with <span className="text-red-500">❤️</span> in Nepal 🇳🇵
          </span>
        </footer>
      </main>
    );
  }

  // Render Signup Details Screen (step === "details")
  return (
    <AuthShell mode="signup">
      <div>
        {/* Header */}
        <div className="mb-4">
          <h2 className="font-heading text-2xl font-extrabold text-[#0F172A] tracking-tight">
            Create your account
          </h2>
          <p className="text-xs text-slate-400 mt-1 font-normal">
            Join <SiteName /> to discover and book the best hostels.
          </p>
        </div>

        {/* Tabs switcher */}
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100/50 p-1 mb-4 border border-slate-200/20 text-slate-500">
          <button
            onClick={() => setActiveTab("email")}
            className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === "email"
                ? "bg-white text-[#0A8A4B] shadow-sm border border-slate-100"
                : "hover:text-slate-700"
            }`}
            type="button"
          >
            <Mail className="size-3.5" />
            Sign up with Email
          </button>
          <button
            onClick={() => setActiveTab("phone")}
            className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === "phone"
                ? "bg-white text-[#0A8A4B] shadow-sm border border-slate-100"
                : "hover:text-slate-700"
            }`}
            type="button"
          >
            <Phone className="size-3.5" />
            Sign up with Phone
          </button>
        </div>

        {error ? (
          <div
            aria-live="polite"
            className="mb-4 rounded-xl border border-red-100 bg-red-50/50 p-3 text-xs font-semibold text-red-600 animate-in fade-in slide-in-from-top-2 duration-200"
          >
            {error}
          </div>
        ) : null}

        {activeTab === "phone" ? (
          <div className="py-8 text-center space-y-3">
            <span className="flex size-10 mx-auto items-center justify-center rounded-full bg-[#0A8A4B]/10 text-[#0A8A4B]">
              <Phone className="size-5" />
            </span>
            <h3 className="text-sm font-bold text-[#0F172A]">Phone Registration</h3>
            <p className="text-xs text-slate-400 max-w-[280px] mx-auto leading-relaxed">
              SMS/Phone signups are handled exclusively via the mobile app. Please
              register via <b>Email OTP</b> here on the web dashboard.
            </p>
            <button
              onClick={() => setActiveTab("email")}
              className="text-xs font-bold text-[#0A8A4B] hover:underline"
              type="button"
            >
              Switch back to Email OTP
            </button>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={requestOtp}>
            {/* Full Name */}
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[#0F172A]">
                Full Name
              </label>
              <div className="relative flex h-10 items-center rounded-xl border border-slate-200 bg-white px-3 text-[#0f172a] transition focus-within:border-[#0A8A4B] focus-within:ring-2 focus-within:ring-[#0A8A4B]/10">
                <User className="mr-2 size-4 text-slate-400 shrink-0" />
                <input
                  aria-label="Full name"
                  className="h-full w-full bg-transparent text-xs font-normal outline-none placeholder:text-slate-300"
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Enter your full name"
                  required
                  type="text"
                  value={name}
                />
              </div>
              <p className="text-[10px] text-slate-400">Please enter your full name.</p>
            </div>

            {/* Email Address */}
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[#0F172A]">
                Email Address
              </label>
              <div className="relative flex h-10 items-center rounded-xl border border-slate-200 bg-white px-3 text-[#0f172a] transition focus-within:border-[#0A8A4B] focus-within:ring-2 focus-within:ring-[#0A8A4B]/10">
                <Mail className="mr-2 size-4 text-slate-400 shrink-0" />
                <input
                  aria-label="Email address"
                  autoComplete="email"
                  className="h-full w-full bg-transparent text-xs font-normal outline-none placeholder:text-slate-300"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Enter your email address"
                  required
                  type="email"
                  value={email}
                />
              </div>
              <p className="text-[10px] text-slate-400">
                Please enter a valid email address.
              </p>
            </div>

            {/* Password */}
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[#0F172A]">
                Password
              </label>
              <div className="relative flex h-10 items-center rounded-xl border border-slate-200 bg-white px-3 text-[#0f172a] transition focus-within:border-[#0A8A4B] focus-within:ring-2 focus-within:ring-[#0A8A4B]/10">
                <LockKeyhole className="mr-2 size-4 text-slate-400 shrink-0" />
                <input
                  aria-label="Password"
                  autoComplete="new-password"
                  className="h-full w-full bg-transparent text-xs font-normal outline-none placeholder:text-slate-300"
                  minLength={8}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Create a password"
                  required
                  type={showPassword ? "text" : "password"}
                  value={password}
                />
                <button
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="ml-2 text-slate-400 hover:text-slate-600 transition"
                  onClick={() => setShowPassword((current) => !current)}
                  type="button"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
              <p className="text-[9px] text-slate-450 leading-normal">
                Password must be at least 8 characters with a mix of letters, numbers &
                symbols.
              </p>
            </div>

            {/* Confirm Password */}
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[#0F172A]">
                Confirm Password
              </label>
              <div className="relative flex h-10 items-center rounded-xl border border-slate-200 bg-white px-3 text-[#0f172a] transition focus-within:border-[#0A8A4B] focus-within:ring-2 focus-within:ring-[#0A8A4B]/10">
                <LockKeyhole className="mr-2 size-4 text-slate-400 shrink-0" />
                <input
                  aria-label="Confirm password"
                  autoComplete="new-password"
                  className="h-full w-full bg-transparent text-xs font-normal outline-none placeholder:text-slate-300"
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Confirm your password"
                  required
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                />
                <button
                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                  className="ml-2 text-slate-400 hover:text-slate-600 transition"
                  onClick={() => setShowConfirmPassword((current) => !current)}
                  type="button"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
              {password && confirmPassword && password !== confirmPassword ? (
                <p className="text-[10px] text-red-500 font-semibold">
                  Passwords do not match.
                </p>
              ) : (
                <p className="text-[10px] text-slate-400">Confirm your password.</p>
              )}
            </div>

            {/* Agree To Terms Checkbox */}
            <label className="flex items-center gap-2 text-xs font-medium py-1 text-slate-500 cursor-pointer select-none">
              <input
                className="size-4 rounded-md border-slate-200 text-[#0A8A4B] focus:ring-[#0A8A4B] cursor-pointer"
                type="checkbox"
                checked={agreeToTerms}
                onChange={(e) => setAgreeToTerms(e.target.checked)}
              />
              <span>
                I agree to the{" "}
                <Link href="/terms" className="text-[#0A8A4B] font-bold hover:underline">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link
                  href="/privacy"
                  className="text-[#0A8A4B] font-bold hover:underline"
                >
                  Privacy Policy
                </Link>
              </span>
            </label>

            {/* Google Signup */}
            <div className="pt-1">
              <GoogleAuthButton
                clientId={googleClientId}
                onError={setError}
                onSuccess={handleGoogleSuccess}
              />
            </div>

            {/* Create Account Button */}
            <button
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#0A8A4B] text-sm font-bold text-white transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-400 shadow-md shadow-[#0A8A4B]/10"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? "Sending OTP..." : "Create Account"}
            </button>

            <p className="text-[10px] text-slate-400 text-center leading-normal pt-1.5">
              By creating an account, you agree to our{" "}
              <Link
                href="/terms"
                className="text-slate-500 font-semibold hover:underline"
              >
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link
                href="/privacy"
                className="text-slate-500 font-semibold hover:underline"
              >
                Privacy Policy
              </Link>
              .
            </p>
          </form>
        )}
      </div>

      {/* Footer link in Card */}
      <div className="mt-6 text-center text-xs text-slate-400 font-medium">
        Already have an account?{" "}
        <Link className="text-[#0A8A4B] font-bold hover:underline" href="/login">
          Log in
        </Link>
      </div>
    </AuthShell>
  );
}
