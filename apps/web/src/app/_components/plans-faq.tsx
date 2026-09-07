"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BedDouble,
  Bell,
  CheckCircle2,
  ChevronDown,
  HardHat,
  Home,
  Plus,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { useSiteConfig } from "@/components/site-config-provider";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Who is asking.
 *
 * Three people open this page and none of them want the same answer: someone
 * living in a hostel, someone running one, and a plumber deciding whether to
 * register. Grouping by person rather than by feature means nobody reads six
 * answers about staff permissions to find out how to pay their rent.
 */
type FaqRole = "resident" | "hostel" | "provider";

type FaqEntry = {
  answer: string;
  id: string;
  question: string;
  role: FaqRole;
};

const ROLES: { icon: LucideIcon; id: FaqRole; label: string }[] = [
  { icon: Home, id: "hostel", label: "Hostel owners" },
  { icon: UserRound, id: "resident", label: "Residents" },
  { icon: HardHat, id: "provider", label: "Service providers" },
];

/**
 * The questions people actually type into a contact form before they buy, in
 * the words they use — short, direct, and answered in two or three plain
 * sentences. A visitor who has to read a sentence twice has already decided
 * the software is complicated.
 *
 * `{site}` is filled in with the site name at render, so this list never
 * hard-codes the brand.
 *
 * Every answer is a claim about what the product does. When the product
 * changes, this changes with it.
 */
const FAQS: FaqEntry[] = [
  // Hostel owner and warden.
  {
    answer:
      "Software to run your hostel. Rooms, residents, rent, food, complaints and reports sit in one place, and your residents get a phone app for their side of it.",
    id: "hostel-what",
    question: "What is {site}?",
    role: "hostel",
  },
  {
    answer:
      "No. If you can use a phone for calls and messages, you can use this. Every screen is one list and the button you need on it.",
    id: "hostel-skills",
    question: "Do I need technical skills?",
    role: "hostel",
  },
  {
    answer:
      "One price for the whole hostel, set by how many residents you have. The three plans are above. Pay every month, or once for the year and pay less.",
    id: "hostel-cost",
    question: "How much does it cost?",
    role: "hostel",
  },
  {
    answer:
      "Register your hostel, add your rooms and your rent, then add your residents. After that the bills for each month are raised for you.",
    id: "hostel-start",
    question: "How do I start?",
    role: "hostel",
  },
  {
    answer:
      "One list for the month. Every name shows paid, part paid or due, and the totals are counted for you.",
    id: "hostel-dues",
    question: "How do I see who has paid and who has not?",
    role: "hostel",
  },
  {
    answer:
      "Yes. A month here is a Bikram Sambat month — Bhadra 2083, not August 2026. Bills and reports follow it.",
    id: "hostel-calendar",
    question: "Does it use the Nepali calendar?",
    role: "hostel",
  },
  {
    answer:
      "Yes. Each staff member gets their own login and sees only their own work. You decide whether they can see the money side.",
    id: "hostel-staff",
    question: "Can my warden use it too?",
    role: "hostel",
  },
  {
    answer:
      "Yes, on the Max plan. Each building keeps its own rooms and residents, and you get one report and one bill for all of them.",
    id: "hostel-multi",
    question: "Can I run more than one hostel?",
    role: "hostel",
  },
  {
    answer:
      "Your hostel's data is yours alone — no other hostel can see it. Every change is saved with who made it and when.",
    id: "hostel-safe",
    question: "Is my data safe?",
    role: "hostel",
  },
  {
    answer:
      "You can move up or down a plan whenever you want. Your residents, bills and old records stay exactly where they are.",
    id: "hostel-change-plan",
    question: "Can I change my plan later?",
    role: "hostel",
  },

  // Resident.
  {
    answer:
      "See your room, your bill, this week's food menu and the hostel's notices. You can also pay rent, mark attendance and report anything broken.",
    id: "resident-what",
    question: "What can I do in the app?",
    role: "resident",
  },
  {
    answer:
      "Open your bill and pay with eSewa, Khalti or Fonepay. The bill turns to paid on its own and the receipt stays in the app.",
    id: "resident-pay",
    question: "How do I pay my rent?",
    role: "resident",
  },
  {
    answer:
      "Send the payment screenshot on that same bill. The app checks the amount and the date, the hostel confirms it, and you can watch the status change.",
    id: "resident-unpaid",
    question: "I paid but my bill still shows due. What do I do?",
    role: "resident",
  },
  {
    answer:
      "Open a repair request. Add a photo, or just record a voice note saying what is wrong. You can see when someone takes it and when it is fixed.",
    id: "resident-repair",
    question: "How do I report something broken?",
    role: "resident",
  },
  {
    answer:
      "Yes. The week's menu is in the app, and you can say what you thought of each meal.",
    id: "resident-food",
    question: "Can I see the food menu?",
    role: "resident",
  },
  {
    answer:
      "No. Attendance only saves that you were in or out for the day. Your location is never stored.",
    id: "resident-location",
    question: "Does the app track my location?",
    role: "resident",
  },
  {
    answer:
      "Only what you allow. Your parent gets their own login, and every part of it stays switched off until you turn it on.",
    id: "resident-guardian",
    question: "What can my parents see?",
    role: "resident",
  },
  {
    answer:
      "No. The hostel pays for the software. For you the app is free.",
    id: "resident-cost",
    question: "Do I have to pay for the app?",
    role: "resident",
  },

  // Service provider.
  {
    answer:
      "Plumbers, electricians, carpenters and anyone who does repair work. Sign up, say what work you do and which areas you cover.",
    id: "provider-join",
    question: "Who can join as a service provider?",
    role: "provider",
  },
  {
    answer:
      "Hostels near you send jobs to your phone. Once a hostel has checked your details, they can reach you straight from a repair request.",
    id: "provider-work",
    question: "How do I get work?",
    role: "provider",
  },
  {
    answer:
      "Yes. The job comes with the room, a photo, and often a voice note from the resident saying what is wrong.",
    id: "provider-details",
    question: "Can I see the problem before I go?",
    role: "provider",
  },
  {
    answer:
      "No. You take the job, and you mark it done when it is finished.",
    id: "provider-typing",
    question: "Do I have to type a lot?",
    role: "provider",
  },
];

function firstIdFor(role: FaqRole) {
  return FAQS.find((faq) => faq.role === role)?.id ?? "";
}

/**
 * The FAQ block on Plans & Pricing.
 *
 * A picture of the product on the left and the answers on the right. The
 * picture is here because the questions beside it are about a thing the reader
 * has not seen yet — "how do I see who has paid" is a much smaller question
 * once the list it describes is on screen.
 *
 * It is drawn rather than screenshotted: a screenshot goes stale on the next
 * release and carries a real hostel's names in it. This is built from the same
 * tokens the portal is, so it cannot drift off palette.
 */
export function PlansFaq() {
  const { identity } = useSiteConfig();
  const [role, setRole] = useState<FaqRole>("hostel");
  const [openId, setOpenId] = useState(() => firstIdFor("hostel"));
  const reduced = useReducedMotion();

  const entries = FAQS.filter((faq) => faq.role === role).map((faq) => ({
    ...faq,
    question: faq.question.replace("{site}", identity.siteName),
  }));

  function selectRole(next: FaqRole) {
    setRole(next);
    // Open the first answer of the group the reader just switched to. Landing
    // on a column of closed rows reads as "nothing here"; one open answer shows
    // the shape of the rest.
    setOpenId(firstIdFor(next));
  }

  return (
    <section className="mt-20">
      <div className="text-center">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-teal">
          Have any questions?
        </p>
        <h2 className="mt-2 font-heading text-2xl font-bold tracking-tight text-foreground">
          Frequently asked questions
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          Short answers, in plain words. Pick who you are.
        </p>
      </div>

      <div className="mt-9 grid items-start gap-10 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        {/* Sticky on wide screens: the answers are long, and the whole point of
            the picture is that it stays beside them. */}
        <div className="lg:sticky lg:top-24">
          <AppPreview reduced={reduced} />
        </div>

        <div>
          <RoleTabs onSelect={selectRole} role={role} />

          {/*
           * Keyed on the role, so React throws the old list away and the rows
           * play their entrance again — the switch reads as a change of
           * subject rather than as text rewriting itself in place.
           *
           * Deliberately NOT wrapped in AnimatePresence. `mode="wait"` keeps
           * the outgoing list mounted until its exit finishes, and here that
           * exit never ran: the tab flipped, the state changed, and the column
           * went on showing the previous person's questions. Same trap the
           * price figure on the cards documents.
           */}
          <motion.ul
            animate={{ opacity: 1, y: 0 }}
            className="mt-5 space-y-3"
            initial={{ opacity: 0, y: reduced ? 0 : 8 }}
            key={role}
            transition={{ duration: reduced ? 0.12 : 0.24, ease: EASE }}
          >
            {entries.map((faq, index) => (
              <FaqRow
                delay={reduced ? 0 : index * 0.04}
                entry={faq}
                key={faq.id}
                onToggle={() =>
                  setOpenId((current) => (current === faq.id ? "" : faq.id))
                }
                open={openId === faq.id}
                reduced={reduced}
              />
            ))}
          </motion.ul>
        </div>
      </div>
    </section>
  );
}

/**
 * Segmented, and carrying the same sliding pill as the billing toggle above —
 * two controls on one page that behave differently are two things to learn.
 */
function RoleTabs({
  onSelect,
  role,
}: {
  onSelect: (next: FaqRole) => void;
  role: FaqRole;
}) {
  return (
    <div
      aria-label="Who is asking"
      className="grid grid-cols-3 gap-1 rounded-2xl border border-border bg-surface p-1 shadow-sm"
      role="tablist"
    >
      {ROLES.map((option) => {
        const selected = role === option.id;

        return (
          <button
            aria-selected={selected}
            className={cn(
              "relative flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold transition-colors sm:text-sm",
              selected ? "text-white" : "text-muted-foreground hover:text-foreground",
            )}
            key={option.id}
            onClick={() => onSelect(option.id)}
            role="tab"
            type="button"
          >
            {selected ? (
              <motion.span
                className="absolute inset-0 rounded-xl bg-brand-teal shadow-sm"
                layoutId="faq-role-pill"
                transition={{ damping: 30, stiffness: 380, type: "spring" }}
              />
            ) : null}
            <option.icon className="relative size-4 shrink-0" />
            <span className="relative truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * One question.
 *
 * Height is animated by framer here rather than by the CSS grid trick the plan
 * cards use, because unlike the saving pill this element genuinely goes from
 * absent to present: there is no server-rendered height to fight, and the
 * answer must be unmounted while closed so a closed row is never read out by a
 * screen reader or tabbed into.
 */
function FaqRow({
  delay,
  entry,
  onToggle,
  open,
  reduced,
}: {
  delay: number;
  entry: FaqEntry;
  onToggle: () => void;
  open: boolean;
  reduced: boolean | null;
}) {
  return (
    <motion.li
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "overflow-hidden rounded-2xl border bg-surface shadow-sm transition-colors",
        open ? "border-brand-teal/50" : "border-border hover:border-brand-teal/35",
      )}
      initial={{ opacity: 0, y: reduced ? 0 : 8 }}
      transition={{ delay, duration: reduced ? 0.12 : 0.35, ease: EASE }}
    >
      <button
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
        onClick={onToggle}
        type="button"
      >
        {/* The plus becomes a minus by rotating, so the open state is shown by
            a movement rather than by swapping one icon for another. */}
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full transition-colors",
            open ? "bg-brand-teal text-white" : "bg-brand-teal/10 text-brand-teal",
          )}
        >
          <Plus
            className={cn("size-4 transition-transform duration-300", open && "rotate-45")}
          />
        </span>
        <span className="flex-1 text-sm font-semibold text-foreground">
          {entry.question}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-300",
            open && "rotate-180 text-brand-teal",
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            animate={{ height: "auto", opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0.12 : 0.32, ease: EASE }}
          >
            <p className="px-5 pb-5 pl-[60px] text-sm leading-relaxed text-muted-foreground">
              {entry.answer}
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.li>
  );
}

/** The rows in the drawn dues list. Invented names, on purpose. */
const PREVIEW_ROWS: { name: string; room: string; state: "paid" | "part" | "due" }[] = [
  { name: "Anish Thapa", room: "Room 204", state: "paid" },
  { name: "Sabina Rai", room: "Room 108", state: "due" },
  { name: "Prashant K.", room: "Room 311", state: "paid" },
  { name: "Muna Gurung", room: "Room 106", state: "part" },
];

const STATE_LABEL = { due: "Due", paid: "Paid", part: "Part paid" } as const;

/**
 * A drawing of the portal, in the portal's own tokens.
 *
 * Painted header block with rounded bottom corners, tiles straddling its lower
 * edge, then a dated list whose heading sits outside the card — the same
 * vocabulary the product itself is built in, so this reads as the software
 * rather than as an illustration of software.
 */
function AppPreview({ reduced }: { reduced: boolean | null }) {
  return (
    <motion.div
      className="relative"
      initial="hidden"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: reduced ? 0 : 0.08 } },
      }}
      viewport={{ amount: 0.3, once: true }}
      whileInView="show"
    >
      <motion.div
        className="overflow-hidden rounded-[26px] border border-border bg-surface shadow-lg"
        variants={{
          hidden: { opacity: 0, y: reduced ? 0 : 18 },
          show: { opacity: 1, transition: { duration: 0.5, ease: EASE }, y: 0 },
        }}
      >
        {/* Window chrome. Three dots and an address is the cheapest way to say
            "this is a screen" without pretending to be a real browser. */}
        <div className="flex items-center gap-2 border-b border-border/70 bg-muted/40 px-4 py-3">
          <span className="size-2.5 rounded-full bg-muted-foreground/25" />
          <span className="size-2.5 rounded-full bg-muted-foreground/25" />
          <span className="size-2.5 rounded-full bg-muted-foreground/25" />
          <span className="ml-2 truncate rounded-md bg-background px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
            sunrise-hostel · dashboard
          </span>
        </div>

        {/* Deep bottom padding so the resident's "Rent paid" card, which
            hangs off this corner, lands on empty space rather than on top of
            the last row of the list. */}
        <div className="relative pb-12">
          <div className="rounded-b-[22px] bg-brand-teal px-5 pb-10 pt-5 text-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium text-white/70">Bhadra 2083</p>
                <p className="font-heading text-base font-bold">Sunrise Boys Hostel</p>
              </div>
              <span className="relative flex size-8 items-center justify-center rounded-full bg-white/15">
                <Bell className="size-4" />
                <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-white text-[8px] font-bold text-brand-teal">
                  3
                </span>
              </span>
            </div>
          </div>

          {/* Tiles straddling the bottom edge of the painted block. */}
          <div className="-mt-7 grid grid-cols-2 gap-3 px-5">
            {[
              { label: "Beds filled", sub: "of 50", value: "46" },
              { label: "Collected", sub: "this month", value: "92%" },
            ].map((tile) => (
              <motion.div
                className="rounded-2xl border border-border bg-background p-3 shadow-sm"
                key={tile.label}
                variants={{
                  hidden: { opacity: 0, y: reduced ? 0 : 10 },
                  show: { opacity: 1, transition: { duration: 0.4, ease: EASE }, y: 0 },
                }}
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {tile.label}
                </p>
                <p className="mt-1 font-heading text-xl font-bold text-foreground">
                  {tile.value}{" "}
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {tile.sub}
                  </span>
                </p>
              </motion.div>
            ))}
          </div>

          {/* The heading sits outside the card, the way lists do everywhere
              else in the product. */}
          <p className="mt-5 px-5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Rent · Bhadra
          </p>

          <div className="mt-2 space-y-2 px-5">
            {PREVIEW_ROWS.map((row) => (
              <motion.div
                className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5"
                key={row.name}
                variants={{
                  hidden: { opacity: 0, x: reduced ? 0 : -8 },
                  show: { opacity: 1, transition: { duration: 0.35, ease: EASE }, x: 0 },
                }}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-teal/10 text-brand-teal">
                  <BedDouble className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-foreground">
                    {row.name}
                  </span>
                  <span className="block text-[10px] text-muted-foreground">
                    {row.room}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
                    row.state === "paid" && "bg-brand-teal/10 text-brand-teal",
                    row.state === "part" && "bg-warning/15 text-warning",
                    row.state === "due" && "bg-destructive/10 text-destructive",
                  )}
                >
                  {STATE_LABEL[row.state]}
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* The resident's side of the same moment, overlapping the corner: the
          payment that turned one of the rows above green. Hidden on the
          narrowest screens, where it would sit on top of the list instead of
          beside it. */}
      <motion.div
        className="absolute -bottom-5 -right-3 hidden w-[190px] rounded-2xl border border-border bg-surface p-3 shadow-xl sm:block"
        variants={{
          hidden: { opacity: 0, scale: reduced ? 1 : 0.94, y: reduced ? 0 : 12 },
          show: {
            opacity: 1,
            scale: 1,
            transition: { delay: reduced ? 0 : 0.35, duration: 0.45, ease: EASE },
            y: 0,
          },
        }}
      >
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-5 shrink-0 text-brand-teal" />
          <div className="min-w-0">
            <p className="truncate text-xs font-bold text-foreground">Rent paid</p>
            <p className="truncate text-[10px] text-muted-foreground">NPR 6,500 · eSewa</p>
          </div>
        </div>
        <p className="mt-2 border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
          Receipt saved to your account.
        </p>
      </motion.div>
    </motion.div>
  );
}
