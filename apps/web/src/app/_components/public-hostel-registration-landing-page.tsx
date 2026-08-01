"use client";

import {
  ArrowRight,
  BedDouble,
  Bell,
  Building2,
  ChevronRight,
  HeartHandshake,
  LayoutDashboard,
  QrCode,
  ShieldCheck,
  Users,
  Utensils,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { motion, useScroll, useTransform, type Easing, type Variants } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { browserApi } from "@/lib/browser-api";
import { cn } from "@/lib/utils";
import { HostelStatusView, type OwnerApplication } from "@/app/_components/public-hostel-registration-page";
import { PublicShell } from "@/app/_components/shared";

const SYMBOLS = "0SCB87675HJGS##&";

function scrambleWord(targetWord: string) {
  const steps: string[] = [];
  for (let i = 0; i <= targetWord.length; i++) {
    let frame = "";
    for (let j = 0; j < targetWord.length; j++) {
      if (j < i) frame += targetWord[j];
      else frame += SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
    }
    steps.push(frame);
  }
  return steps;
}

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 30 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.12, duration: 0.6, ease: "easeOut" as Easing },
  }),
};

const stagger = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

type Feature = {
  icon: LucideIcon;
  title: string;
  description: string;
  tone: "teal" | "platform" | "admin" | "resident" | "guardian";
  gradient: string;
  accent: string;
};

const heroSlides = [
  {
    gradient: "from-brand-teal/20 to-cyan-400/10",
    icon: LayoutDashboard,
    label: "Central Dashboard",
    accent: "bg-brand-teal",
  },
  {
    gradient: "from-blue-500/20 to-indigo-400/10",
    icon: BedDouble,
    label: "Room & Bed Map",
    accent: "bg-blue-500",
  },
  {
    gradient: "from-emerald-400/20 to-green-400/10",
    icon: Users,
    label: "Resident Management",
    accent: "bg-emerald-500",
  },
  {
    gradient: "from-amber-400/20 to-orange-400/10",
    icon: WalletCards,
    label: "Payments & Fee Tracking",
    accent: "bg-amber-500",
  },
  {
    gradient: "from-rose-400/20 to-pink-400/10",
    icon: ShieldCheck,
    label: "Night Safety & SOS",
    accent: "bg-rose-500",
  },
  {
    gradient: "from-violet-400/20 to-purple-400/10",
    icon: HeartHandshake,
    label: "Guardian Dashboard",
    accent: "bg-violet-500",
  },
];

const features: (Feature & { imageIndex: number })[] = [
  {
    icon: LayoutDashboard, title: "Central Dashboard", description: "Real-time occupancy, payments, complaints, staff activity, and reports — all from one command centre.", tone: "platform", gradient: "from-brand-teal/20 to-cyan-400/10", accent: "bg-brand-teal", imageIndex: 0,
  },
  {
    icon: BedDouble, title: "Digital Room & Bed Map", description: "Rooms, bed assignment, vacancy status, room type (1-4 seater), attached bathroom, balcony, and maintenance status per room.", tone: "admin", gradient: "from-blue-500/20 to-indigo-400/10", accent: "bg-blue-500", imageIndex: 1,
  },
  {
    icon: Users, title: "Resident Management + QR", description: "Admin registers residents. System generates unique QR code. Resident scans to activate their dashboard — no manual data entry.", tone: "resident", gradient: "from-emerald-400/20 to-green-400/10", accent: "bg-emerald-500", imageIndex: 2,
  },
  {
    icon: WalletCards, title: "Payments & Fee Tracking", description: "Track monthly fees, deposits, dues, and receipts. Residents upload payment proof (eSewa, Khalti, bank). Admin verifies and issues digital receipts.", tone: "guardian", gradient: "from-amber-400/20 to-orange-400/10", accent: "bg-amber-500", imageIndex: 3,
  },
  {
    icon: Utensils, title: "Food Transparency System", description: "Weekly menu, daily food photos, meal timing, veg/non-veg tracking, and resident food ratings — build trust with residents and guardians.", tone: "teal", gradient: "from-teal-400/20 to-emerald-400/10", accent: "bg-teal-500", imageIndex: 0,
  },
  {
    icon: Bell, title: "Notices & Complaints", description: "Send hostel, fee, holiday, and emergency notices. Residents submit complaints with photo attachments and track resolution status.", tone: "platform", gradient: "from-cyan-400/20 to-sky-400/10", accent: "bg-cyan-500", imageIndex: 1,
  },
  {
    icon: ShieldCheck, title: "Night Safety & SOS", description: "Privacy-first night status (Inside/Outside/Not Verified). SOS button alerts warden and guardian. Emergency contacts and safety guides.", tone: "admin", gradient: "from-rose-400/20 to-pink-400/10", accent: "bg-rose-500", imageIndex: 4,
  },
  {
    icon: HeartHandshake, title: "Guardian Trust Dashboard", description: "Guardians get limited visibility into fee status, food menu, notices, night safety summary, and emergency contact — privacy-first design.", tone: "guardian", gradient: "from-violet-400/20 to-purple-400/10", accent: "bg-violet-500", imageIndex: 5,
  },
  {
    icon: QrCode, title: "Move-in / Move-out Checklist", description: "Digital move-in: document collection, room photos, item checklist, deposit record. Move-out: fee check, damage check, deposit refund.", tone: "teal", gradient: "from-brand-teal/20 to-emerald-400/10", accent: "bg-brand-teal", imageIndex: 2,
  },
];

const stats = [
  { label: "Hostels Onboarded", value: "500+" },
  { label: "Active Residents", value: "12,000+" },
  { label: "NPR Managed Monthly", value: "Cr 5+" },
  { label: "Avg. Occupancy Lift", value: "23%" },
];

/** The signed-in owner's most recent hostel application, if they have one. */
async function fetchOwnerApplication(): Promise<OwnerApplication | null> {
  try {
    const data = await browserApi<{ applications: OwnerApplication[] }>(
      "/api/v1/public/hostel-applications/my-applications",
    );
    return data.applications[0] ?? null;
  } catch {
    return null;
  }
}

export function PublicHostelRegistrationLandingPage() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [displayedWord, setDisplayedWord] = useState("HostelHub");
  const [showBottomCta, setShowBottomCta] = useState(false);
  const [bordersDone, setBordersDone] = useState(false);
  const featureRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();
  const router = useRouter();

  // If the signed-in user has already submitted a hostel, this route shows their
  // application status instead of the marketing page. Anonymous visitors (the
  // request 401s) keep seeing the landing page.
  const [statusApp, setStatusApp] = useState<OwnerApplication | null>(null);

  const loadOwnerStatus = useCallback(async () => {
    setStatusApp(await fetchOwnerApplication());
  }, []);

  useEffect(() => {
    let active = true;

    void fetchOwnerApplication().then((application) => {
      // The visitor may have navigated away while the request was in flight.
      if (active) setStatusApp(application);
    });

    return () => {
      active = false;
    };
  }, []);

  const bottomCtaOpacity = useTransform(scrollY, [600, 900], [0, 1]);

  useEffect(() => {
    const slideInterval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % heroSlides.length);
    }, 5000);
    return () => clearInterval(slideInterval);
  }, []);

  useEffect(() => {
    const doScramble = () => {
      const steps = scrambleWord("HostelHub");
      steps.forEach((step, index) => {
        setTimeout(() => setDisplayedWord(step), index * 80);
      });
    };

    const scrambleTimeout = setTimeout(doScramble, 600);
    const scrambleInterval = setInterval(doScramble, 10000);

    return () => {
      clearTimeout(scrambleTimeout);
      clearInterval(scrambleInterval);
    };
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setShowBottomCta(entry.isIntersecting),
      { threshold: 0 },
    );
    const el = featureRef.current;
    if (el) observer.observe(el);
    return () => { if (el) observer.unobserve(el); };
  }, []);

  const SlideIcon = heroSlides[currentSlide].icon;

  if (statusApp) {
    return (
      <PublicShell active="register-hostel">
        <HostelStatusView
          application={statusApp}
          onRegisterAnother={() => router.push("/register-hostel/form")}
          onResubmitted={loadOwnerStatus}
        />
      </PublicShell>
    );
  }

  return (
    <PublicShell active="register-hostel">
      <div className="relative overflow-hidden -mt-16">
        {/* Animated borders — grow from all 4 sides for 3s, then fade out */}
        <motion.div
          className="pointer-events-none fixed inset-0 z-50"
          initial={{ opacity: 1 }}
          animate={{ opacity: bordersDone ? 0 : 1 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <motion.div
            className="absolute top-0 left-0 h-1 bg-gradient-to-r from-brand-teal to-cyan-500"
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: 3, ease: "easeOut" }}
          />
          <motion.div
            className="absolute bottom-0 right-0 h-1 bg-gradient-to-l from-brand-teal to-cyan-500"
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: 3, ease: "easeOut" }}
          />
          <motion.div
            className="absolute left-0 top-0 w-1 bg-gradient-to-b from-brand-teal to-cyan-500"
            initial={{ height: "0%" }}
            animate={{ height: "100%" }}
            transition={{ duration: 3, ease: "easeOut" }}
            onAnimationComplete={() => setBordersDone(true)}
          />
          <motion.div
            className="absolute right-0 top-0 w-1 bg-gradient-to-b from-brand-teal to-cyan-500"
            initial={{ height: "0%" }}
            animate={{ height: "100%" }}
            transition={{ duration: 3, ease: "easeOut" }}
          />
        </motion.div>

        <div className="pointer-events-none absolute -inset-1 opacity-30 dark:opacity-10">
          <div className="absolute -left-40 -top-40 size-80 rounded-full bg-brand-teal blur-3xl" />
          <div className="absolute -right-40 -top-20 size-96 rounded-full bg-cyan-400 blur-3xl" />
        </div>

        {/* Hero */}
        <section className="relative mx-auto max-w-[1200px] px-6 pt-28 pb-16 md:pt-40 md:pb-24">
          <motion.div
            className="mx-auto max-w-4xl text-center"
            initial="hidden"
            animate="visible"
            variants={stagger}
          >
            <motion.div
              className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand-teal/20 bg-brand-teal/5 px-4 py-1.5 text-xs font-semibold text-brand-teal"
              variants={fadeUp}
              custom={0}
            >
              <Building2 className="size-3.5" />
              For Hostel Owners & Operators
            </motion.div>
            <motion.h1
              className="text-4xl font-extrabold leading-tight text-foreground md:text-6xl md:leading-[1.12]"
              variants={fadeUp}
              custom={1}
            >
              Become a Partner at{" "}
              <span className="inline-block bg-gradient-to-r from-brand-teal to-cyan-500 bg-clip-text font-mono tracking-tight text-transparent">
                {displayedWord}
              </span>
            </motion.h1>
            <motion.p
              className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg"
              variants={fadeUp}
              custom={2}
            >
              Transform your hostel with a complete digital ecosystem — from resident management
              to guardian communication. Give every stakeholder their own portal while you stay
              in control from one dashboard.
            </motion.p>

            {/* Register button at top */}
            <motion.div
              className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row"
              variants={fadeUp}
              custom={3}
            >
              <Link
                href="/register-hostel/form"
                className="inline-flex h-13 items-center gap-2 rounded-xl bg-brand-teal px-7 text-sm font-bold text-white shadow-lg shadow-brand-teal/25 transition hover:brightness-110 md:h-14 md:text-base md:px-8"
              >
                Get Started
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/hostels"
                className="inline-flex h-13 items-center gap-1 rounded-xl border border-border px-7 text-sm font-semibold text-foreground transition hover:bg-muted md:h-14 md:text-base md:px-8"
              >
                Browse Hostels
                <ChevronRight className="size-4" />
              </Link>
            </motion.div>
          </motion.div>

          {/* Image slideshow */}
          <motion.div
            className="mx-auto mt-16 max-w-4xl"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.6, duration: 0.8 }}
          >
            <div className="relative h-[20rem] overflow-hidden rounded-2xl border-2 border-border shadow-xl md:h-[26rem]">
              <motion.div
                key={currentSlide}
                className={`absolute inset-0 flex items-center justify-center bg-gradient-br ${heroSlides[currentSlide].gradient}`}
                initial={{ opacity: 0, scale: 1.05 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6 }}
              >
                <div className="flex flex-col items-center gap-4 p-8 text-center">
                  <div className={`flex size-24 items-center justify-center rounded-2xl ${heroSlides[currentSlide].accent}/10`}>
                    <SlideIcon className={`size-12 ${heroSlides[currentSlide].accent.replace("bg-", "text-")}`} />
                  </div>
                  <p className="text-xl font-bold text-foreground md:text-2xl">
                    {heroSlides[currentSlide].label}
                  </p>
                  <p className="max-w-md text-sm text-muted-foreground">
                    Everything you need to manage your hostel efficiently
                  </p>
                </div>
              </motion.div>

              {/* Slide navigation arrows */}
              <button
                onClick={() => setCurrentSlide((prev) => (prev === 0 ? heroSlides.length - 1 : prev - 1))}
                className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-brand-teal p-2 text-white shadow-lg transition hover:brightness-110"
                type="button"
              >
                <ChevronRight className="size-5 rotate-180" />
              </button>
              <button
                onClick={() => setCurrentSlide((prev) => (prev + 1) % heroSlides.length)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-brand-teal p-2 text-white shadow-lg transition hover:brightness-110"
                type="button"
              >
                <ChevronRight className="size-5" />
              </button>

              {/* Slide indicators */}
              <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
                {heroSlides.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentSlide(i)}
                    className={`size-2 rounded-full transition ${i === currentSlide ? "bg-brand-teal w-6" : "bg-border hover:bg-muted-foreground/40"}`}
                    type="button"
                  />
                ))}
              </div>
            </div>
          </motion.div>
        </section>

        {/* Stats */}
        <section className="border-y border-border bg-muted/30">
          <div className="mx-auto max-w-[1200px] px-6 py-12 md:py-16">
            <motion.div
              className="grid grid-cols-2 gap-6 md:grid-cols-4"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-80px" }}
              variants={stagger}
            >
              {stats.map((stat) => (
                <motion.div key={stat.label} className="text-center" variants={fadeUp}>
                  <p className="text-3xl font-extrabold text-foreground md:text-4xl">{stat.value}</p>
                  <p className="mt-1 text-xs font-semibold text-muted-foreground md:text-sm">{stat.label}</p>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* Features with scroll-triggered images */}
        <section ref={featureRef} className="mx-auto max-w-[1200px] px-6 py-20 md:py-28">
          <motion.div
            className="mb-14 text-center"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={stagger}
          >
            <motion.h2 className="text-3xl font-bold text-foreground md:text-4xl" variants={fadeUp}>
              Everything you need to run your hostel
            </motion.h2>
            <motion.p
              className="mx-auto mt-4 max-w-xl text-sm text-muted-foreground md:text-base"
              variants={fadeUp}
              custom={1}
            >
              A fully integrated platform for hostel owners, staff, residents, and guardians.
            </motion.p>
          </motion.div>

          <div className="space-y-20 md:space-y-28">
            {features.map((feature, idx) => {
              const isEven = idx % 2 === 0;
              const slideMeta = heroSlides[feature.imageIndex];
              const SlideFeatureIcon = slideMeta.icon;

              return (
                <motion.div
                  key={feature.title}
                  className={`flex flex-col items-center gap-8 md:flex-row ${isEven ? "" : "md:flex-row-reverse"}`}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, margin: "-120px" }}
                  variants={stagger}
                >
                  {/* Text side */}
                  <motion.div className="flex-1 space-y-4" variants={fadeUp}>
                    <span
                      className={cn(
                        "mb-3 inline-flex size-10 items-center justify-center rounded-xl",
                        feature.tone === "teal" && "bg-brand-teal/10 text-brand-teal",
                        feature.tone === "platform" && "bg-role-platform-soft text-role-platform",
                        feature.tone === "admin" && "bg-role-admin-soft text-role-admin",
                        feature.tone === "resident" && "bg-role-resident-soft text-role-resident",
                        feature.tone === "guardian" && "bg-role-guardian-soft text-role-guardian",
                      )}
                    >
                      <feature.icon className="size-5" />
                    </span>
                    <h3 className="text-2xl font-bold text-foreground">{feature.title}</h3>
                    <p className="text-base leading-relaxed text-muted-foreground">
                      {feature.description}
                    </p>
                    <ul className="space-y-2 pt-2">
                      <li className="flex items-start gap-3 text-sm text-muted-foreground">
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-teal/10 text-[10px] font-bold text-brand-teal">&#10003;</span>
                        Real-time insights and analytics at your fingertips
                      </li>
                      <li className="flex items-start gap-3 text-sm text-muted-foreground">
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-teal/10 text-[10px] font-bold text-brand-teal">&#10003;</span>
                        Role-based access for staff, residents, and guardians
                      </li>
                      <li className="flex items-start gap-3 text-sm text-muted-foreground">
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-teal/10 text-[10px] font-bold text-brand-teal">&#10003;</span>
                        Mobile-friendly portals accessible from any device
                      </li>
                    </ul>
                  </motion.div>

                  {/* Image side - scroll triggered fade */}
                  <motion.div
                    className="flex-1"
                    initial={{ opacity: 0, x: isEven ? 40 : -40, scale: 0.95 }}
                    whileInView={{ opacity: 1, x: 0, scale: 1 }}
                    viewport={{ once: true, margin: "-100px" }}
                    transition={{ duration: 0.7, ease: "easeOut" }}
                  >
                    <div className={`relative h-64 overflow-hidden rounded-2xl border-2 border-border bg-gradient-br ${slideMeta.gradient} shadow-lg md:h-80`}>
                      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                        <div className={`flex size-20 items-center justify-center rounded-2xl ${slideMeta.accent}/10`}>
                          <SlideFeatureIcon className={`size-10 ${slideMeta.accent.replace("bg-", "text-")}`} />
                        </div>
                        <p className="text-lg font-bold text-foreground">{slideMeta.label}</p>
                        <p className="max-w-xs text-sm text-muted-foreground">
                          {feature.description.slice(0, 100)}...
                        </p>
                      </div>
                    </div>
                  </motion.div>
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="border-t border-border bg-gradient-to-b from-background to-muted/20">
          <div className="mx-auto max-w-[1200px] px-6 py-20 md:py-28">
            <motion.div
              className="mx-auto max-w-2xl text-center"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-80px" }}
              variants={stagger}
            >
              <motion.h2
                className="text-3xl font-bold text-foreground md:text-4xl"
                variants={fadeUp}
              >
                Ready to bring your hostel online?
              </motion.h2>
              <motion.p
                className="mx-auto mt-4 max-w-lg text-sm text-muted-foreground md:text-base"
                variants={fadeUp}
                custom={1}
              >
                List your property, manage residents, and give everyone their own portal —
                all from one place.
              </motion.p>
              <motion.div
                className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row"
                variants={fadeUp}
                custom={2}
              >
                <Link
                  href="/register-hostel/form"
                  className="inline-flex h-13 items-center gap-2 rounded-xl bg-brand-teal px-7 text-sm font-bold text-white shadow-lg shadow-brand-teal/25 transition hover:brightness-110 md:h-14 md:text-base md:px-8"
                >
                  Register Your Hostel
                  <ArrowRight className="size-4" />
                </Link>
                <Link
                  href="/service-providers/register"
                  className="inline-flex h-13 items-center gap-1 rounded-xl border border-border px-7 text-sm font-semibold text-foreground transition hover:bg-muted md:h-14 md:text-base md:px-8"
                >
                  Register as Service Provider
                  <ChevronRight className="size-4" />
                </Link>
              </motion.div>
            </motion.div>
          </div>
        </section>
      </div>

      {/* Floating bottom register button - appears on scroll */}
      <motion.div
        className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 md:bottom-8"
        style={{ opacity: bottomCtaOpacity, pointerEvents: showBottomCta ? "auto" : "none" as const }}
      >
        <Link
          href="/register-hostel/form"
          className="inline-flex h-12 items-center gap-2 rounded-2xl bg-brand-teal px-6 text-sm font-bold text-white shadow-xl shadow-brand-teal/30 transition hover:brightness-110 md:h-14 md:px-8 md:text-base"
        >
          Register Your Hostel Now
          <ArrowRight className="size-4" />
        </Link>
      </motion.div>
    </PublicShell>
  );
}
