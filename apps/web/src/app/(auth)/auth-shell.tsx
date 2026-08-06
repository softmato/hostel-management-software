"use client";

import { ArrowLeft, BarChart3, Lock, Search, ShieldCheck, Star, Zap } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { useSiteConfig } from "@/components/site-config-provider";

type AuthShellProps = {
  children: ReactNode;
  mode: "login" | "signup";
};

const LOBBY_IMAGE =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuAD0NmbtkszFG87IhrLCwa2eHWDmk4NxOgpfoid2_zjZOx8uWA_hMcSeKmVOMRSjh6cGCyLc1Z9nGlZcL0Ki792qNxyaYBty13f2J3WQOuXIX_srJKrKQdS6r3NM_RDpDB3vErb3M4AXliIEEDa0efsPzIkws2iSLR5sBqDWjn4m6sUtt9ldLyN6Qa-ajl1zvazFY7UZ_2dAjeEU277a2C041A_ZzYl0_2dfHrJqKF0tb0-ivW1NlN_H88HwOtS1kTCG90Xs6WE0dc";

/**
 * Wordmark for the owner-configured site name. The first word stays ink and the
 * remainder picks up the brand green, which reproduces the original
 * "Hostel/Hub" lockup for any two-part name and degrades to plain ink for a
 * single word.
 */
function SiteWordmark() {
  const siteName = useSiteConfig().identity.siteName;
  const [head, ...rest] = siteName.split(" ");

  return (
    <Link href="/" className="group flex items-center gap-2.5">
      <span className="flex items-center justify-center size-9 bg-[#0A8A4B]/12 rounded-xl transition group-hover:bg-[#0A8A4B]/20">
        <ArrowLeft className="size-4.5 text-[#0A8A4B] hidden group-hover:block" />
        <svg
          className="block group-hover:hidden"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M3 9.5L12 3L21 9.5V20C21 20.5523 20.5523 21 20 21H14V14H10V21H4C3.44772 21 3 20.5523 3 20V9.5Z"
            fill="#0A8A4B"
          />
        </svg>
      </span>
      <span className="font-heading text-[22px] font-extrabold tracking-tight text-[#0F172A]">
        {head}
        {rest.length ? <span className="text-[#0A8A4B]"> {rest.join(" ")}</span> : null}
      </span>
    </Link>
  );
}

export function AuthShell({ children, mode }: AuthShellProps) {
  const isLogin = mode === "login";
  const siteName = useSiteConfig().identity.siteName;

  return (
    <main
      className="h-screen w-screen overflow-hidden flex flex-col"
      style={{ background: "#F0F4F8" }}
    >
      {/* ── Body: left branding + right form ── */}
      <div className="flex flex-1 min-h-0">
        {/* ────── LEFT PANEL ────── */}
        <section className="hidden lg:flex flex-col w-[44%] h-full px-10 pt-10 pb-0 select-none overflow-hidden relative">
          {/* ── Lobby image: absolute behind all content, no top rounding ── */}
          <div className="absolute left-6 right-0 bottom-0 h-[62%] pointer-events-none overflow-hidden rounded-b-2xl">
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url("${LOBBY_IMAGE}")` }}
            />
            {/* tall top-fade so bullets smoothly overlay the photo */}
            <div
              className="absolute inset-x-0 top-0 h-56 z-10"
              style={{
                background:
                  "linear-gradient(to bottom, #F0F4F8 0%, #F0F4F8 30%, transparent 100%)",
              }}
            />
          </div>

          <SiteWordmark />

          {isLogin ? (
            /* Login left content */
            <div className="mt-7 flex flex-col relative z-10">
              <h1 className="font-heading text-[30px] xl:text-[34px] font-extrabold leading-[1.2] text-[#0F172A]">
                Welcome back!
                <br />
                Let&apos;s get you logged in.
              </h1>
              <p className="mt-3 text-[13px] text-slate-500 leading-relaxed max-w-[380px]">
                {siteName} is the all-in-one platform to discover, manage, and grow your
                hostel operations.
              </p>

              <div className="mt-5 space-y-4">
                {[
                  {
                    Icon: ShieldCheck,
                    title: "Secure & Role-based Access",
                    desc: "Your data is safe with enterprise-grade security.",
                  },
                  {
                    Icon: BarChart3,
                    title: "Built for Every Role",
                    desc: "Owner, Warden, Staff or Resident — one platform.",
                  },
                  {
                    Icon: Zap,
                    title: "Fast, Reliable & Always Available",
                    desc: "Access anytime, from anywhere.",
                  },
                ].map(({ Icon, title, desc }) => (
                  <div key={title} className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#0A8A4B]/10 text-[#0A8A4B]">
                      <Icon className="size-4" />
                    </span>
                    <div>
                      <h3 className="text-[12px] font-bold text-[#0F172A]">{title}</h3>
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                        {desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Signup left content */
            <div className="mt-7 flex flex-col relative z-10">
              <h1 className="font-heading text-[30px] xl:text-[34px] font-extrabold leading-[1.2] text-[#0F172A]">
                One Platform.
                <br />
                Every Hostel.
                <br />
                <span className="text-[#0A8A4B]">Better Together.</span>
              </h1>
              <div className="h-1 w-14 bg-[#0A8A4B] mt-4 rounded-full" />
              <p className="mt-3 text-[13px] text-slate-500 leading-relaxed max-w-[380px]">
                Create a public account to explore hostels, compare facilities, read
                reviews, and make bookings.
              </p>

              <div className="mt-5 space-y-4 z-10">
                {[
                  {
                    Icon: Search,
                    title: "Discover & Compare",
                    desc: "Find verified hostels, compare facilities, prices, and availability.",
                  },
                  {
                    Icon: ShieldCheck,
                    title: "Verified & Secure",
                    desc: "Trusted listings, secure payments, and 24/7 support.",
                  },
                  {
                    Icon: Star,
                    title: "Book with Confidence",
                    desc: "Read reviews, view photos, and book your stay with ease.",
                  },
                ].map(({ Icon, title, desc }) => (
                  <div key={title} className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#0A8A4B]/10 text-[#0A8A4B]">
                      <Icon className="size-4" />
                    </span>
                    <div>
                      <h3 className="text-[12px] font-bold text-[#0F172A]">{title}</h3>
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                        {desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ────── RIGHT PANEL: white card ────── */}
        <section className="flex flex-1 items-center justify-center p-6 lg:p-8">
          <div
            className="w-full max-w-[560px] bg-white rounded-[20px] shadow-[0_4px_40px_rgba(0,0,0,0.10)] overflow-y-auto"
            style={{ maxHeight: "calc(100vh - 72px)" }}
          >
            <div className="px-10 py-10">{children}</div>
          </div>
        </section>
      </div>

      {/* ── Footer strip ── */}
      <footer className="hidden lg:flex items-center justify-between px-14 py-3 border-t border-slate-200/70 text-[11px] text-slate-400 select-none bg-transparent">
        {isLogin ? (
          <div className="flex items-center gap-1.5">
            <Lock className="size-3.5" />
            <span>Secure login protected by industry-standard encryption</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" />
            <span>
              Your data is safe. We use industry-standard security to protect your
              information.
            </span>
          </div>
        )}

        {isLogin ? (
          <div className="flex items-center gap-5">
            <Link href="/privacy" className="hover:text-slate-600 transition">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-slate-600 transition">
              Terms of Service
            </Link>
            <Link href="/pricing" className="hover:text-slate-600 transition">
              Help Center
            </Link>
            <span>&copy; 2026 {siteName}. All rights reserved.</span>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <span>Already have an account?</span>
            <Link href="/login" className="text-[#0A8A4B] font-bold hover:underline ml-1">
              Log in
            </Link>
          </div>
        )}
      </footer>
    </main>
  );
}
