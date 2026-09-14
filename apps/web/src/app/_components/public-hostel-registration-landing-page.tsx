"use client";

import { ArrowRight, Building2, ChevronRight, type LucideIcon } from "lucide-react";
import {
  animate,
  motion,
  useInView,
  useReducedMotion,
  useScroll,
  useTransform,
  type Easing,
  type Variants,
} from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { browserApi } from "@/lib/browser-api";
import { cn } from "@/lib/utils";
import {
  HostelStatusView,
  type OwnerApplication,
} from "@/app/_components/public-hostel-registration-page";
import { MOCKUPS, type Mockup } from "@/app/_components/portal-mockups";
import { PublicShell } from "@/app/_components/shared";
import { useSiteConfig } from "@/components/site-config-provider";
import { contentIcon, resolveContentPage } from "@/lib/site-content";
import { useSessionStore } from "@/stores/session-store";

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
  bullets: string[];
  description: string;
  icon: LucideIcon;
  image: Mockup;
  title: string;
  tone: "teal" | "platform" | "admin" | "resident" | "guardian";
};

/** Every portal screen we have, in the order an owner meets them. */
const heroSlides: { image: Mockup; label: string }[] = [
  { image: MOCKUPS.wardenDashboard, label: "Hostel dashboard" },
  { image: MOCKUPS.wardenRooms, label: "Rooms & beds" },
  { image: MOCKUPS.residentRegister, label: "Resident registration" },
  { image: MOCKUPS.residentVerify, label: "Identity check" },
  { image: MOCKUPS.wardenFinance, label: "Fee schedule & reconcile" },
  { image: MOCKUPS.wardenTransactions, label: "Transactions" },
  { image: MOCKUPS.wardenPaymentSetup, label: "Payment setup" },
  { image: MOCKUPS.residentPortal, label: "Resident portal" },
  { image: MOCKUPS.residentFees, label: "Resident fees & payments" },
  { image: MOCKUPS.residentProfile, label: "Resident ID card" },
  { image: MOCKUPS.guardianPortal, label: "Guardian portal" },
  { image: MOCKUPS.appCommunity, label: "Your public hostel page" },
  { image: MOCKUPS.appMap, label: "Found on the map" },
];

/**
 * Presentation only. The features' **titles and descriptions** live in the
 * site config under `content.registerHostel.sections`, because the app shows the
 * same list on its Register your hostel screen — see `contentSchema`. What stays
 * here is what cannot be stored: the tone token and the screen shown beside it.
 *
 * Indexed by position rather than by title, so an owner rewording "Central
 * Dashboard" does not silently drop its picture. A section added past the end in the
 * admin panel falls back to the first chrome entry rather than crashing.
 */
const featureChrome: { image: Mockup; tone: Feature["tone"] }[] = [
  { image: MOCKUPS.wardenDashboard, tone: "platform" },
  { image: MOCKUPS.wardenRooms, tone: "admin" },
  { image: MOCKUPS.residentRegister, tone: "resident" },
  { image: MOCKUPS.residentVerify, tone: "teal" },
  { image: MOCKUPS.wardenFinance, tone: "admin" },
  { image: MOCKUPS.wardenPaymentSetup, tone: "platform" },
  { image: MOCKUPS.wardenTransactions, tone: "teal" },
  { image: MOCKUPS.residentPortal, tone: "resident" },
  { image: MOCKUPS.residentFees, tone: "resident" },
  { image: MOCKUPS.residentProfile, tone: "admin" },
  { image: MOCKUPS.guardianPortal, tone: "guardian" },
  { image: MOCKUPS.appCommunity, tone: "platform" },
  { image: MOCKUPS.appMap, tone: "teal" },
  { image: MOCKUPS.appHome, tone: "platform" },
];

/**
 * Counts the number inside a stat up from zero the first time it scrolls into
 * view — "3×", "9 in 10", "1,240". Text with no number in it renders as is.
 */
function CountUp({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { margin: "-80px", once: true });
  const reduced = useReducedMotion();
  const match = /^(\D*)([\d,]+(?:\.\d+)?)(.*)$/.exec(text);
  const target = match ? Number(match[2].replace(/,/g, "")) : 0;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!inView || reduced || target === 0) return;
    const controls = animate(0, target, {
      duration: 1.4,
      ease: "easeOut",
      onUpdate: setShown,
    });
    return () => controls.stop();
  }, [inView, reduced, target]);

  if (!match) return <span ref={ref}>{text}</span>;

  const decimals = match[2].split(".")[1]?.length ?? 0;
  const value = reduced ? target : shown;

  return (
    <span ref={ref}>
      {match[1]}
      {value.toLocaleString("en-US", {
        maximumFractionDigits: decimals,
        minimumFractionDigits: decimals,
      })}
      {match[3]}
    </span>
  );
}

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
  const { content, identity, platformStats } = useSiteConfig();
  const siteName = identity.siteName;
  const page = resolveContentPage(content.registerHostel, identity);
  const stats = page.highlights;
  const features: Feature[] = page.sections.map((section, index) => ({
    ...(featureChrome[index] ?? featureChrome[0]),
    // The first line is the sentence under the title; the rest are its bullets.
    bullets: section.body.slice(1),
    description: section.body[0] ?? "",
    icon: contentIcon(section.icon),
    title: section.title,
  }));
  const [currentSlide, setCurrentSlide] = useState(0);
  const [displayedWord, setDisplayedWord] = useState(siteName);
  const [showBottomCta, setShowBottomCta] = useState(false);
  const [bordersDone, setBordersDone] = useState(false);
  const featureRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();
  const router = useRouter();

  // If the signed-in user has already submitted a hostel, this route shows their
  // application status instead of the marketing page.
  const [statusApp, setStatusApp] = useState<OwnerApplication | null>(null);
  // Read from the shared session cache the header already fills, so the lookup
  // below can wait until it is known whether anyone is signed in.
  const sessionResolved = useSessionStore((state) => state.status === "resolved");
  const sessionUser = useSessionStore((state) => state.user);

  const loadOwnerStatus = useCallback(async () => {
    setStatusApp(await fetchOwnerApplication());
  }, []);

  useEffect(() => {
    // Only ask for an anonymous visitor's application if there is an account to
    // ask about. `my-applications` 401s for a signed-out visitor, and a 401 that
    // no refresh token can rescue is exactly what `browserApi` reads as an
    // expired session — it sends the tab to /login. So merely opening the pitch
    // page bounced people to the sign-in screen. Signing in is a requirement of
    // the *form*, and `/register-hostel/form` guards itself; the page that
    // explains the product asks nothing of anyone.
    if (!sessionResolved || !sessionUser) {
      return;
    }

    let active = true;

    void fetchOwnerApplication().then((application) => {
      // The visitor may have navigated away while the request was in flight.
      if (active) setStatusApp(application);
    });

    return () => {
      active = false;
    };
  }, [sessionResolved, sessionUser]);

  const bottomCtaOpacity = useTransform(scrollY, [600, 900], [0, 1]);

  useEffect(() => {
    const slideInterval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % heroSlides.length);
    }, 5000);
    return () => clearInterval(slideInterval);
  }, []);

  useEffect(() => {
    const doScramble = () => {
      const steps = scrambleWord(siteName);
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
  }, [siteName]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setShowBottomCta(entry.isIntersecting),
      { threshold: 0 },
    );
    const el = featureRef.current;
    if (el) observer.observe(el);
    return () => {
      if (el) observer.unobserve(el);
    };
  }, []);

  // `sessionUser` guards the render as well as the fetch, so signing out in the
  // header drops the status view instead of leaving a stale one on screen.
  if (statusApp && sessionUser) {
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
              className="text-[2.1rem] font-extrabold leading-tight text-foreground sm:text-5xl md:text-6xl md:leading-[1.12]"
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
              {page.intro[0]}
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
            <div className="relative h-[20rem] overflow-hidden rounded-2xl border border-border bg-muted/30 shadow-xl sm:h-[26rem] md:h-[32rem]">
              <motion.div
                key={currentSlide}
                className="absolute inset-0 px-4 pb-6 pt-14 sm:px-12 sm:pb-12"
                initial={{ opacity: 0, scale: 1.03 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6 }}
              >
                <span className="absolute left-1/2 top-4 -translate-x-1/2 whitespace-nowrap rounded-full border border-border bg-background/90 px-3 py-1 text-xs font-semibold text-foreground">
                  {heroSlides[currentSlide].label}
                </span>
                <div className="relative size-full">
                  <Image
                    alt={heroSlides[currentSlide].image.alt}
                    className="object-contain"
                    fill
                    priority={currentSlide === 0}
                    sizes="(min-width: 896px) 800px, 100vw"
                    src={heroSlides[currentSlide].image.src}
                  />
                </div>
              </motion.div>

              {/* Slide navigation arrows */}
              <button
                onClick={() =>
                  setCurrentSlide((prev) =>
                    prev === 0 ? heroSlides.length - 1 : prev - 1,
                  )
                }
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

        {/* Stats: real counts first, then the growth claims an owner is sold on */}
        {platformStats.length > 0 || stats.length > 0 ? (
          <section className="relative overflow-hidden border-y border-border bg-muted/30">
            <div className="pointer-events-none absolute -left-24 top-1/2 size-72 -translate-y-1/2 rounded-full bg-brand-teal/10 blur-3xl" />
            <div className="relative mx-auto max-w-[1200px] px-6 py-14 md:py-20">
              {platformStats.length > 0 ? (
                <div className={cn(stats.length > 0 && "mb-14")}>
                  <p className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-brand-teal">
                    <span className="relative flex size-2">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-teal opacity-60" />
                      <span className="relative inline-flex size-2 rounded-full bg-brand-teal" />
                    </span>
                    Live on {siteName}
                  </p>
                  <div className="mt-6 grid gap-6 sm:grid-cols-3">
                    {platformStats.map((stat) => (
                      <div className="text-center" key={stat.label}>
                        <p className="text-3xl font-extrabold text-foreground sm:text-4xl md:text-5xl">
                          <CountUp text={stat.value.toLocaleString("en-US")} />
                        </p>
                        <p className="mt-1 text-xs font-semibold text-muted-foreground md:text-sm">
                          {stat.label}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {stats.length > 0 ? (
                <>
                  <h2 className="text-center text-2xl font-bold text-foreground md:text-3xl">
                    Get your hostel more popular
                  </h2>
                  <p className="mx-auto mt-2 max-w-xl text-center text-sm text-muted-foreground md:text-base">
                    What changes when students can find you and residents pay from their phone.
                  </p>
                  <motion.div
                    className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4"
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: "-80px" }}
                    variants={stagger}
                  >
                    {stats.map((stat, index) => (
                      <motion.div
                        className="group relative overflow-hidden rounded-2xl border border-border bg-background p-5 shadow-sm transition hover:-translate-y-1 hover:border-brand-teal/40 hover:shadow-lg"
                        custom={index}
                        key={stat.label}
                        variants={fadeUp}
                      >
                        <span className="absolute -right-8 -top-8 size-24 rounded-full bg-brand-teal/10 transition duration-500 group-hover:scale-150" />
                        <p className="relative font-heading text-3xl font-extrabold text-brand-teal sm:text-4xl md:text-5xl">
                          <CountUp text={stat.value} />
                        </p>
                        <p className="relative mt-2 text-sm font-semibold leading-snug text-foreground">
                          {stat.label}
                        </p>
                      </motion.div>
                    ))}
                  </motion.div>
                </>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* Features with scroll-triggered images */}
        <section ref={featureRef} className="mx-auto max-w-[1200px] px-6 py-20 md:py-28">
          <motion.div
            className="mb-14 text-center"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={stagger}
          >
            <motion.h2
              className="text-3xl font-bold text-foreground md:text-4xl"
              variants={fadeUp}
            >
              Everything you need to run your hostel
            </motion.h2>
            <motion.p
              className="mx-auto mt-4 max-w-xl text-sm text-muted-foreground md:text-base"
              variants={fadeUp}
              custom={1}
            >
              A fully integrated platform for hostel owners, staff, residents, and
              guardians.
            </motion.p>
          </motion.div>

          <div className="space-y-20 md:space-y-28">
            {features.map((feature, idx) => {
              const isEven = idx % 2 === 0;

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
                        feature.tone === "platform" &&
                          "bg-role-platform-soft text-role-platform",
                        feature.tone === "admin" && "bg-role-admin-soft text-role-admin",
                        feature.tone === "resident" &&
                          "bg-role-resident-soft text-role-resident",
                        feature.tone === "guardian" &&
                          "bg-role-guardian-soft text-role-guardian",
                      )}
                    >
                      <feature.icon className="size-5" />
                    </span>
                    <h3 className="text-2xl font-bold text-foreground">
                      {feature.title}
                    </h3>
                    <p className="text-base leading-relaxed text-muted-foreground">
                      {feature.description}
                    </p>
                    {feature.bullets.length > 0 ? (
                      <ul className="space-y-2 pt-2">
                        {feature.bullets.map((bullet) => (
                          <li
                            className="flex items-start gap-3 text-sm text-muted-foreground"
                            key={bullet}
                          >
                            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-teal/10 text-[10px] font-bold text-brand-teal">
                              &#10003;
                            </span>
                            {bullet}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </motion.div>

                  {/* Image side - scroll triggered fade */}
                  <motion.div
                    className="flex-1"
                    initial={{ opacity: 0, x: isEven ? 40 : -40, scale: 0.95 }}
                    whileInView={{ opacity: 1, x: 0, scale: 1 }}
                    viewport={{ once: true, margin: "-100px" }}
                    transition={{ duration: 0.7, ease: "easeOut" }}
                  >
                    <div className="relative h-64 w-full sm:h-80 md:h-96">
                      <Image
                        alt={feature.image.alt}
                        className="object-contain"
                        fill
                        sizes="(min-width: 768px) 576px, 100vw"
                        src={feature.image.src}
                      />
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
                  href="/service-providers"
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
        style={{
          opacity: bottomCtaOpacity,
          pointerEvents: showBottomCta ? "auto" : ("none" as const),
        }}
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
