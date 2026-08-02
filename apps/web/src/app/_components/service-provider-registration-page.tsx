"use client";

/* eslint-disable @typescript-eslint/no-unused-vars */

import {
  AlertCircle,
  AlertCircle as AlertIcon,
  ArrowRight,
  BadgeCheck,
  BedDouble,
  Bell,
  Building2,
  Calendar,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  Eye,
  FileCheck2,
  FileText,
  Filter,
  Grid2X2,
  Heart,
  HelpCircle,
  Home,
  KeyRound,
  List,
  LockKeyhole,
  Mail,
  MapPin,
  MessageSquare,
  Moon,
  MoreVertical,
  Phone,
  PhoneCall,
  Plus,
  QrCode,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Trash2,
  Upload,
  User,
  UserRound,
  Users,
  Utensils,
  Wifi,
  WalletCards,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { FileUploaderView, useUploader } from "@/components/uploads";
import { browserApi } from "@/lib/browser-api";
import { cn } from "@/lib/utils";
import {
  AnimatedPage,
  Breadcrumbs,
  FormField,
  HostelCard,
  HostelListCard,
  MetricCard,
  NepalBannerGraphic,
  PublicShell,
  SectionCard,
  StatusPill,
  TableView,
  formatMoney,
  humanize,
  metricIcons,
  type AuthMode,
  type PortalKind,
} from "./shared";

function ServiceProviderRegistrationPageContent() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  // Public form — no session yet, so documents go to the rate-limited public
  // route and come back as URLs the application record can store directly.
  const documentUpload = useUploader({
    kind: "document",
    label: "Supporting document",
    target: "public",
  });
  const documentUrl = documentUpload.files[0]?.url ?? "";
  const { clear: clearDocument } = documentUpload;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const value = (name: string) => {
      const field = form.get(name);

      return typeof field === "string" ? field.trim() : "";
    };

    setIsSubmitting(true);
    setMessage("");

    try {
      await browserApi("/api/v1/public/service-providers/register", {
        body: JSON.stringify({
          area: value("area"),
          availability: value("availability") || undefined,
          category: value("category"),
          city: value("city") || "Kathmandu",
          description: value("description") || undefined,
          documents: documentUrl
            ? [
                {
                  documentType: value("documentType") || "PROFILE_DOCUMENT",
                  fileUrl: documentUrl,
                },
              ]
            : [],
          email: value("email") || undefined,
          experience: value("experience") || undefined,
          fullName: value("fullName"),
          phone: value("phone"),
        }),
        method: "POST",
      });
      formElement.reset();
      clearDocument();
      setMessage("Registration submitted for platform review.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not submit registration.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <PublicShell active="providers">
      <section className="mx-auto grid max-w-[1280px] gap-6 px-6 py-8 lg:grid-cols-[0.9fr_1.1fr]">
        <SectionCard title="Join as a Service Provider">
          <div className="p-1">
            <p className="text-muted-foreground">
              Register plumbing, electrical, cleaning, medical, internet, repair, or water
              supply services for hostel admins to discover.
            </p>
            <div className="mt-6 grid gap-3">
              {[
                "Verified provider profile",
                "Area-based hostel discovery",
                "Approval by platform owner",
                "Service history and ratings",
              ].map((item) => (
                <div className="rounded-lg bg-brand-teal-soft/50 p-4" key={item}>
                  <p className="font-semibold text-brand-teal">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
        <SectionCard
          action={<StatusPill tone="warning">Pending approval</StatusPill>}
          title="Provider Details"
        >
          {message ? (
            <div className="mb-4 rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
              {message}
            </div>
          ) : null}
          <form onSubmit={submit}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-semibold text-foreground">
                Full Name
                <span className="mt-2 flex h-12 items-center gap-3 rounded-lg border border-border bg-surface px-3 shadow-sm transition focus-within:border-brand-teal focus-within:ring-2 focus-within:ring-brand-teal/15">
                  <UserRound className="size-4 text-muted-foreground" />
                  <input
                    className="h-full w-full bg-transparent text-sm font-normal outline-none placeholder:text-muted-foreground"
                    name="fullName"
                    placeholder="CleanStay Nepal"
                    required
                  />
                </span>
              </label>
              <label className="block text-sm font-semibold text-foreground">
                Phone
                <span className="mt-2 flex h-12 items-center gap-3 rounded-lg border border-border bg-surface px-3 shadow-sm transition focus-within:border-brand-teal focus-within:ring-2 focus-within:ring-brand-teal/15">
                  <Phone className="size-4 text-muted-foreground" />
                  <input
                    className="h-full w-full bg-transparent text-sm font-normal outline-none placeholder:text-muted-foreground"
                    name="phone"
                    placeholder="9841002300"
                    required
                  />
                </span>
              </label>
              <label className="block text-sm font-semibold text-foreground">
                Email <span className="font-normal text-muted-foreground">(optional)</span>
                <span className="mt-2 flex h-12 items-center gap-3 rounded-lg border border-border bg-surface px-3 shadow-sm transition focus-within:border-brand-teal focus-within:ring-2 focus-within:ring-brand-teal/15">
                  <Mail className="size-4 text-muted-foreground" />
                  <input
                    className="h-full w-full bg-transparent text-sm font-normal outline-none placeholder:text-muted-foreground"
                    name="email"
                    placeholder="you@example.com"
                    type="email"
                  />
                </span>
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  We will email you when your listing is approved. Leave blank if
                  you would rather be contacted only by phone.
                </span>
              </label>
              <label className="block text-sm font-semibold text-foreground">
                Category
                <select
                  className="mt-2 h-12 w-full rounded-lg border border-border bg-surface px-3 text-sm font-normal outline-none focus:border-brand-teal"
                  name="category"
                  required
                >
                  {[
                    "PLUMBER",
                    "ELECTRICIAN",
                    "DOCTOR_CLINIC",
                    "INTERNET_TECHNICIAN",
                    "CLEANER",
                    "CARPENTER",
                    "PAINTER",
                    "WATER_SUPPLIER",
                    "APPLIANCE_REPAIR",
                    "ROOM_REPAIR",
                    "OTHER",
                  ].map((category) => (
                    <option key={category} value={category}>
                      {category.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-semibold text-foreground">
                Area
                <span className="mt-2 flex h-12 items-center gap-3 rounded-lg border border-border bg-surface px-3 shadow-sm transition focus-within:border-brand-teal focus-within:ring-2 focus-within:ring-brand-teal/15">
                  <MapPin className="size-4 text-muted-foreground" />
                  <input
                    className="h-full w-full bg-transparent text-sm font-normal outline-none placeholder:text-muted-foreground"
                    name="area"
                    placeholder="Lalitpur"
                    required
                  />
                </span>
              </label>
              <FormField icon={MapPin} label="City" placeholder="Kathmandu" />
              <input name="city" type="hidden" value="Kathmandu" />
              <label className="block text-sm font-semibold text-foreground">
                Availability
                <span className="mt-2 flex h-12 items-center gap-3 rounded-lg border border-border bg-surface px-3 shadow-sm transition focus-within:border-brand-teal focus-within:ring-2 focus-within:ring-brand-teal/15">
                  <CalendarDays className="size-4 text-muted-foreground" />
                  <input
                    className="h-full w-full bg-transparent text-sm font-normal outline-none placeholder:text-muted-foreground"
                    name="availability"
                    placeholder="Weekdays, emergency, on-call"
                  />
                </span>
              </label>
              <label className="block text-sm font-semibold text-foreground">
                Experience
                <input
                  className="mt-2 h-12 w-full rounded-lg border border-border bg-surface px-3 text-sm font-normal outline-none focus:border-brand-teal"
                  name="experience"
                  placeholder="5+ years serving hostels"
                />
              </label>
              <div className="block text-sm font-semibold text-foreground">
                Supporting document
                <span className="ml-1 font-normal text-muted-foreground">(optional)</span>
                <FileUploaderView
                  className="mt-2"
                  label="Upload licence, ID or certificate"
                  uploader={documentUpload}
                />
              </div>
              <input name="documentType" type="hidden" value="PROFILE_DOCUMENT" />
            </div>
            <label className="mt-4 block text-sm font-semibold text-foreground">
              Description
              <textarea
                className="mt-2 min-h-28 w-full rounded-lg border border-border bg-surface p-3 text-sm outline-none focus:border-brand-teal"
                name="description"
                placeholder="Describe your service coverage, tools, and response time."
              />
            </label>
            <button
              className="mt-5 w-full rounded-md bg-brand-teal px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Submitting..." : "Submit Provider Registration"}
            </button>
          </form>
        </SectionCard>
      </section>
    </PublicShell>
  );
}

export function ServiceProviderRegistrationPage() {
  return (
    <Suspense fallback={null}>
      <ServiceProviderRegistrationPageContent />
    </Suspense>
  );
}
