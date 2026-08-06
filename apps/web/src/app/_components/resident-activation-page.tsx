"use client";

import {
  Bell,
  Check,
  CheckCircle2,
  KeyRound,
  LockKeyhole,
  MapPin,
  QrCode,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { memo, useCallback, useState, type FormEvent } from "react";

import { BusyForm, SubmitButton } from "@/app/_components/busy-form";
import { browserApi } from "@/lib/browser-api";
import { Message } from "./resident-shared";
import { SiteName } from "@/components/site-config-provider";

export const ResidentActivationPageContent = memo(
  function ResidentActivationPageContent() {
    const searchParams = useSearchParams();
    const [message, setMessage] = useState("");
    const [activated, setActivated] = useState(false);
    // Prefilled when the resident followed the link in their activation email.
    const [code, setCode] = useState(() => searchParams.get("code")?.trim() ?? "");
    const [activeTab, setActiveTab] = useState<"code" | "qr">("code");

    const handleActivate = useCallback(
      async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setMessage("");

        try {
          await browserApi("/api/v1/resident/activate", {
            body: JSON.stringify({
              code: code.trim(),
              deviceInfo: { source: "web" },
              sessionInfo: { activatedAt: new Date().toISOString() },
            }),
            method: "POST",
          });
          setActivated(true);
          setMessage("Resident access activated successfully.");
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Activation failed.");
        }
      },
      [code],
    );

    return (
      <div className="min-h-screen bg-[#F8FAFC] text-[#0f172a] font-sans flex flex-col justify-between">
        {/* Top Header Bar */}
        <header className="bg-white border-b border-slate-100 shadow-sm sticky top-0 z-50">
          <div className="max-w-[1360px] mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
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

            {/* Navigation Links */}
            <nav className="hidden md:flex items-center gap-6 h-full text-sm font-semibold text-slate-500">
              <Link
                href="/resident/dashboard"
                className="hover:text-[#0A8A4B] transition flex items-center h-full"
              >
                Dashboard
              </Link>
              <Link
                href="/resident/profile"
                className="hover:text-[#0A8A4B] transition flex items-center h-full"
              >
                My Profile
              </Link>
              <span className="text-[#0A8A4B] border-b-2 border-[#0A8A4B] h-full flex items-center px-1 font-bold">
                Activate Access
              </span>
            </nav>

            {/* Notifications and Profile */}
            <div className="flex items-center gap-4">
              <button
                className="relative p-2 text-slate-400 hover:text-slate-600 transition"
                aria-label="Notifications"
              >
                <Bell className="size-5" />
                <span className="absolute top-1 right-1 size-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                  2
                </span>
              </button>

              <div className="flex items-center gap-2">
                <div className="flex size-9 items-center justify-center rounded-full bg-[#EAF6F3] text-[#0A8A4B] font-bold text-sm">
                  ST
                </div>
                <div className="hidden sm:block text-left">
                  <p className="text-xs font-bold text-[#0F172A] leading-tight">
                    Suman Thapa
                  </p>
                  <p className="text-[10px] text-slate-400">sumanthapa@gmail.com</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 max-w-[1360px] mx-auto w-full px-4 md:px-8 py-8">
          {/* Title Block */}
          <div className="mb-6">
            <h1 className="font-heading text-3xl font-extrabold text-[#0F172A]">
              Resident Activation
            </h1>
            <p className="text-sm text-slate-450 mt-1 max-w-3xl">
              Enter the code generated by your hostel admin to link your account to your
              hostel bed.
            </p>
          </div>

          {message && (
            <div className="mb-6">
              <Message value={message} />
            </div>
          )}

          {/* Dual Column Layout wrapper */}
          <div className="bg-white rounded-3xl shadow-xl shadow-slate-100/50 border border-slate-100 grid lg:grid-cols-[1.1fr_0.9fr] overflow-hidden">
            {/* Left Column: Form & Details */}
            <div className="p-6 md:p-8 border-b lg:border-b-0 lg:border-r border-slate-100">
              {activated ? (
                <div className="py-12 flex flex-col items-center justify-center text-center space-y-6 animate-in fade-in duration-300">
                  <div className="relative flex size-24 items-center justify-center">
                    <div className="absolute inset-0 rounded-full bg-emerald-500/5 animate-ping duration-1000" />
                    <div className="absolute inset-3 rounded-full bg-emerald-500/10" />
                    <div className="relative flex size-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/15">
                      <CheckCircle2 className="size-10 stroke-[2.5]" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h3 className="font-heading text-2xl font-extrabold text-[#0F172A]">
                      Activation complete
                    </h3>
                    <p className="text-sm text-slate-450 max-w-md mx-auto leading-relaxed">
                      Your resident access is now fully activated. You are successfully
                      linked to Room 101, Bed 101-A at Green View Hostel.
                    </p>
                  </div>
                  <Link
                    className="inline-flex h-11 items-center justify-center rounded-xl bg-[#0A8A4B] px-6 text-sm font-bold text-white shadow-md shadow-[#0A8A4B]/10 hover:brightness-105 transition"
                    href="/resident/dashboard"
                  >
                    Open Dashboard
                  </Link>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Tabs */}
                  <div className="flex border-b border-slate-100 text-sm font-bold select-none">
                    <button
                      onClick={() => setActiveTab("code")}
                      className={`pb-3 px-2 border-b-2 transition-all ${
                        activeTab === "code"
                          ? "border-[#0A8A4B] text-[#0A8A4B]"
                          : "border-transparent text-slate-400 hover:text-slate-600"
                      }`}
                    >
                      Enter Code
                    </button>
                    <button
                      onClick={() => setActiveTab("qr")}
                      className={`pb-3 px-6 border-b-2 transition-all ${
                        activeTab === "qr"
                          ? "border-[#0A8A4B] text-[#0A8A4B]"
                          : "border-transparent text-slate-400 hover:text-slate-600"
                      }`}
                    >
                      Scan QR Code
                    </button>
                  </div>

                  {activeTab === "qr" ? (
                    <div className="py-10 text-center space-y-3">
                      <span className="flex size-14 mx-auto items-center justify-center rounded-full bg-[#0A8A4B]/10 text-[#0A8A4B]">
                        <QrCode className="size-8" />
                      </span>
                      <h3 className="text-sm font-bold text-[#0F172A]">QR Activation</h3>
                      <p className="text-xs text-slate-450 max-w-[285px] mx-auto leading-relaxed">
                        Please use the camera scan box on the right of this page, or align
                        your device QR code to complete scanning automatically.
                      </p>
                      <button
                        onClick={() => setActiveTab("code")}
                        className="text-xs font-bold text-[#0A8A4B] hover:underline"
                        type="button"
                      >
                        Use manual activation code instead
                      </button>
                    </div>
                  ) : (
                    <BusyForm className="space-y-6" onSubmit={handleActivate}>
                      {/* Activation Code Input */}
                      <div className="space-y-1.5">
                        <label
                          className="block text-xs font-bold text-[#0F172A]"
                          htmlFor="activation-code"
                        >
                          Activation code
                        </label>
                        <div className="relative flex h-11 items-center rounded-xl border border-slate-200 bg-white px-3 text-[#0f172a] transition focus-within:border-[#0A8A4B] focus-within:ring-2 focus-within:ring-[#0A8A4B]/10">
                          <KeyRound className="mr-2.5 size-4.5 text-slate-400 shrink-0" />
                          <input
                            className="h-full w-full bg-transparent text-sm font-bold outline-none placeholder:text-slate-300 tracking-wider"
                            id="activation-code"
                            name="code"
                            onChange={(e) => setCode(e.target.value)}
                            placeholder="Enter activation code"
                            required
                            type="text"
                            value={code}
                          />
                        </div>
                      </div>

                      {/* Preview linked hostel details card */}
                      <div className="space-y-2">
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                          This code will give you access to:
                        </label>
                        <div className="flex flex-col sm:flex-row gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/50">
                          <div
                            className="w-full sm:w-28 h-20 rounded-xl bg-cover bg-center border border-slate-100 shrink-0"
                            style={{
                              backgroundImage:
                                'url("https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=300&q=80")',
                            }}
                          />
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <h4 className="text-sm font-bold text-[#0F172A]">
                                Green View Hostel
                              </h4>
                              <span className="flex items-center justify-center size-3.5 bg-[#0A8A4B] text-white rounded-full">
                                <Check className="size-2.5 stroke-[3]" />
                              </span>
                              <span className="text-[10px] font-semibold text-[#0A8A4B]">
                                Verified
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100/50">
                                Available
                              </span>
                              <span className="text-[11px] text-slate-400 flex items-center gap-0.5">
                                <MapPin className="size-3" /> New Baneshwor, Kathmandu
                              </span>
                            </div>

                            <p className="text-[11px] text-slate-500 font-medium">
                              Access Type:{" "}
                              <span className="font-bold text-[#0F172A]">
                                Resident Access (Standard Room)
                              </span>
                            </p>
                            <p className="text-[11px] text-slate-500 font-medium">
                              Valid for:{" "}
                              <span className="font-bold text-[#0F172A]">
                                Academic Year 2026-2027
                              </span>
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Linked resident details */}
                      <div className="space-y-2">
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                          You (Linked Resident)
                        </label>
                        <div className="flex items-center gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/50">
                          <div className="flex size-12 items-center justify-center rounded-full bg-[#EAF6F3] text-[#0A8A4B] font-bold text-base shrink-0">
                            ST
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 flex-1 min-w-0">
                            <div>
                              <span className="block text-[9px] text-slate-400 uppercase tracking-wider">
                                Full Name
                              </span>
                              <span className="text-xs font-bold text-[#0F172A] block truncate">
                                Suman Thapa
                              </span>
                            </div>
                            <div>
                              <span className="block text-[9px] text-slate-400 uppercase tracking-wider">
                                Email
                              </span>
                              <span className="text-xs font-bold text-[#0F172A] block truncate">
                                sumanthapa@gmail.com
                              </span>
                            </div>
                            <div>
                              <span className="block text-[9px] text-slate-400 uppercase tracking-wider">
                                Phone
                              </span>
                              <span className="text-xs font-bold text-[#0F172A] block truncate">
                                +977 9801234567
                              </span>
                            </div>
                            <div>
                              <span className="block text-[9px] text-slate-400 uppercase tracking-wider">
                                Bed Type
                              </span>
                              <span className="text-xs font-bold text-[#0F172A] block truncate">
                                Double Sharing
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <SubmitButton className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#0A8A4B] text-sm font-bold text-white transition hover:brightness-105 active:scale-[0.99] shadow-md shadow-[#0A8A4B]/10">
                        Activate Access
                      </SubmitButton>
                    </BusyForm>
                  )}
                </div>
              )}
            </div>

            {/* Right Column: QR Scanner & Help Status */}
            <div className="p-6 md:p-8 bg-[#EAF6F3]/30 flex flex-col justify-between space-y-6">
              {/* Scan QR Box */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-[#0F172A]">Scan QR Code</h3>
                <div className="relative flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-200 rounded-2xl bg-white select-none">
                  <div className="relative flex size-28 items-center justify-center border-2 border-[#0A8A4B] rounded-2xl overflow-hidden bg-slate-50">
                    <QrCode className="size-16 text-[#0A8A4B]/40" />
                    {/* Scanner laser bar animation */}
                    <div className="absolute left-0 top-0 w-full h-[2px] bg-[#0A8A4B] shadow-md shadow-[#0A8A4B]/50 animate-bounce" />
                  </div>
                  <p className="text-[11px] font-bold text-[#0f172a] mt-3">
                    Scan activation QR
                  </p>
                  <p className="text-[10px] text-slate-400 text-center mt-1 leading-normal max-w-[200px]">
                    Position the QR code within the frame to scan automatically.
                  </p>
                </div>
              </div>

              {/* Code status info */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-[#0F172A]">
                  Activation Code Status
                </h3>
                <div className="space-y-2">
                  <div className="flex items-start gap-2.5">
                    <span className="size-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                    <div>
                      <h4 className="text-[11px] font-bold text-[#0F172A]">Available</h4>
                      <p className="text-[10px] text-slate-450 leading-relaxed">
                        The code is ready to be linked to your account.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5">
                    <span className="size-2 rounded-full bg-slate-450 mt-1.5 shrink-0" />
                    <div>
                      <h4 className="text-[11px] font-bold text-[#0F172A]">Used</h4>
                      <p className="text-[10px] text-slate-450 leading-relaxed">
                        This code has already been linked to a resident account.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5">
                    <span className="size-2 rounded-full bg-red-500 mt-1.5 shrink-0" />
                    <div>
                      <h4 className="text-[11px] font-bold text-[#0F172A]">Expired</h4>
                      <p className="text-[10px] text-slate-450 leading-relaxed">
                        The code validity has expired. Request a new code from admin.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Privacy & Security rules */}
              <div className="pt-4 border-t border-slate-100 flex items-start gap-3 select-none">
                <span className="flex size-8 items-center justify-center rounded-lg bg-[#0A8A4B]/10 text-[#0A8A4B] shrink-0">
                  <LockKeyhole className="size-4" />
                </span>
                <div>
                  <h4 className="text-xs font-bold text-[#0F172A]">
                    Privacy &amp; Security
                  </h4>
                  <ul className="list-disc pl-3 text-[10px] text-slate-450 mt-1 leading-relaxed space-y-1">
                    <li>Activation codes are unique and can only be used once.</li>
                    <li>Once linked, your account will be tied to your room and bed.</li>
                    <li>Only hostel admins can revoke or change your bed assignment.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="text-center text-[10px] text-slate-400 font-semibold border-t border-slate-100 py-4 flex items-center justify-center gap-3 bg-white mt-8 select-none">
          <span>&copy; 2026 <SiteName /> Platform. All rights reserved.</span>
          <span className="text-slate-200">|</span>
          <span className="flex items-center gap-1">
            Made with <span className="text-red-500">❤️</span> in Nepal 🇳🇵
          </span>
        </footer>
      </div>
    );
  },
);
