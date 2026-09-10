"use client";

import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Building2,
  Check,
  ImagePlus,
  Loader2,
  Plus,
  QrCode,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useConfirm } from "@/app/_components/confirm-dialog";
import { MEAL_TIMING_DEFAULTS } from "@hostel/shared/food/meal-window";

import { LocationPicker, type LocationPickerValue } from "@/components/maps/location-picker";
import { useMediaViewer } from "@/components/media-viewer";
import { useSiteConfig } from "@/components/site-config-provider";
import { browserApi } from "@/lib/browser-api";
import { acceptAttribute } from "@/lib/uploads/accepts";
import { uploadFile } from "@/lib/uploads/uploader";
import { cn } from "@/lib/utils";
import { billingCycles, bestDiscountPercent, cycleTotal, type BillingCycle } from "./plans-catalog";
import {
  cityOptions,
  DOC_TYPES,
  facilityOptions,
  numberValue,
  roomTypeOptions,
  RULES_TEMPLATES,
  rupees,
} from "./registration-fields";
import { StepFlow, StepRail, type RegistrationStep } from "./registration-step-shell";

/**
 * The field team's registration form.
 *
 * ## Why this is a flow now and not one dense page
 *
 * It used to be a single long page, on the argument that an agent filling it in
 * for the fifteenth time does not need to be guided. That argument was right
 * about the agent and wrong about the form: this one now collects a whole
 * hostel — photos by kind, house rules, the food routine, per-room pricing,
 * documents, the plan and the money — because a hostel our own staff registered
 * should not go live thinner than one an owner filled in themselves at midnight.
 *
 * Forty fields with no rail tells nobody how much is left. So it wears the same
 * shell as the public form, for the same reason: the journey stays visible while
 * exactly one thing is asked at a time. What stays different is the manner —
 * no reassurance panels, no explanations of why we need a citizenship document.
 * The agent knows. The rail is scaffolding, not hand-holding.
 *
 * ## The two things this form has that the public one does not
 *
 * The plan is chosen **here** and the money is taken **here**, because the agent
 * is with the owner and both happen in that conversation. And submitting
 * publishes the hostel on the spot — which is why the last step is a decision
 * rather than a button, and why it is the only step that cannot be skipped past.
 */

type RoomRow = {
  bedsPerRoom: string;
  id: string;
  monthlyRent: string;
  rooms: string;
  roomType: string;
  vacantBeds: string;
};

type PhotoKind = "EXTERIOR" | "INTERIOR" | "ROOM";

type PhotoRow = {
  id: string;
  kind: PhotoKind;
  name: string;
  roomType?: string;
  uploading: boolean;
  url: string;
};

type DocRow = { id: string; name: string; type: string; uploading: boolean; url: string };

const MEAL_TYPES = ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"] as const;
type MealType = (typeof MEAL_TYPES)[number];

const ROUTINE_DAYS = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const;
type RoutineDay = (typeof ROUTINE_DAYS)[number];

/** `SUNDAY` → `Sun`. The rail is tight and the full names do not fit. */
function shortDay(day: RoutineDay) {
  return day.charAt(0) + day.slice(1, 3).toLowerCase();
}

function titleCase(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

const DRAFT_KEY = "hostelhub:team-registration-draft";

/**
 * Bumped whenever a stored draft can no longer be read at face value.
 *
 * Version 2 is the arrival of the sample week. Drafts written before it hold an
 * empty routine — either absent, or, if somebody pressed "use this day for every
 * day" on a blank day, twenty-eight explicit empty strings. An empty string is
 * meaningful now: it is a cell the agent cleared on purpose, for a hostel that
 * genuinely serves no snacks. So the two cannot be told apart by looking at the
 * values, and the older draft's routine is discarded rather than guessed at.
 *
 * Only the routine is discarded. Everything else in an old draft — the hostel,
 * the owner, the rooms, the uploads — is still exactly what the agent typed, and
 * throwing that away to fix a menu would be the worse trade by a wide margin.
 */
const DRAFT_VERSION = 2;

/**
 * A typical Nepali hostel week, pre-filled so the agent edits rather than types.
 *
 * Twenty-eight cells is a lot to fill from a conversation, and the answer to
 * most of them is the same in most hostels — dal bhat twice, tea with something
 * at four. Starting from that and correcting the differences is both faster and
 * more accurate than an empty grid, because it prompts the questions ("do you do
 * eggs on Friday?") instead of relying on the agent to think of them.
 *
 * ## The obvious hazard, and what is done about it
 *
 * A default that is never looked at becomes a menu the hostel never agreed to.
 * These are real values, not placeholders, so an agent who skips the step
 * publishes this week as fact. The review step therefore checks whether the
 * routine is still untouched and says so — see `recommendations`. It does not
 * block: a routine that happens to match the sample is a routine, and a hostel
 * that genuinely serves dal bhat twice a day should not have to retype it to
 * prove they meant it.
 */
/*
 * The same four strings the hostel's own Food & Menu screen seeds, imported
 * rather than restated. A hostel our agent registered should not open with
 * different serving times from one the owner set up themselves — and
 * `MEAL_ANNOUNCE_LEAD_MINUTES` is documented against *these* windows never
 * overlapping, which a second set of defaults would quietly break.
 */
const DEFAULT_TIMINGS: Record<MealType, string> = MEAL_TIMING_DEFAULTS;

const DEFAULT_WEEK: Record<RoutineDay, Record<MealType, string>> = {
  SUNDAY: {
    BREAKFAST: "Roti, Aloo Tarkari, Tea",
    LUNCH: "Dal, Bhat, Tarkari, Achar",
    SNACKS: "Chiura, Tea",
    DINNER: "Dal, Bhat, Tarkari",
  },
  MONDAY: {
    BREAKFAST: "Bread, Jam, Tea",
    LUNCH: "Dal, Bhat, Tarkari, Achar",
    SNACKS: "Biscuit, Tea",
    DINNER: "Dal, Bhat, Saag",
  },
  TUESDAY: {
    BREAKFAST: "Roti, Tarkari, Tea",
    LUNCH: "Dal, Bhat, Tarkari",
    SNACKS: "Chana, Tea",
    DINNER: "Dal, Bhat, Tarkari, Achar",
  },
  WEDNESDAY: {
    BREAKFAST: "Paratha, Tea",
    LUNCH: "Dal, Bhat, Tarkari, Achar",
    SNACKS: "Chiura, Tea",
    DINNER: "Dal, Bhat, Anda Curry",
  },
  THURSDAY: {
    BREAKFAST: "Roti, Aloo Tarkari, Tea",
    LUNCH: "Dal, Bhat, Tarkari",
    SNACKS: "Chowmein, Tea",
    DINNER: "Dal, Bhat, Saag",
  },
  FRIDAY: {
    BREAKFAST: "Bread, Anda, Tea",
    LUNCH: "Dal, Bhat, Tarkari, Achar",
    SNACKS: "Chiura, Tea",
    DINNER: "Dal, Bhat, Masu",
  },
  SATURDAY: {
    BREAKFAST: "Puri, Tarkari, Tea",
    LUNCH: "Dal, Bhat, Tarkari, Achar",
    SNACKS: "Sel Roti, Tea",
    DINNER: "Dal, Bhat, Tarkari",
  },
};

/** The flat `DAY:MEAL` shape the form edits in. */
function defaultRoutine(): Record<string, string> {
  const cells: Record<string, string> = {};

  for (const day of ROUTINE_DAYS) {
    for (const meal of MEAL_TYPES) {
      cells[`${day}:${meal}`] = DEFAULT_WEEK[day][meal];
    }
  }

  return cells;
}

const STEPS: RegistrationStep[] = [
  {
    description: "Who owns it, and what the place is called.",
    key: 1,
    label: "Owner & hostel",
  },
  { description: "Address, area, and how to find the door.", key: 2, label: "Where it is" },
  {
    description: "Room types, how many of each, and the rent.",
    key: 3,
    label: "Rooms & pricing",
  },
  {
    description: "Outside, inside, and each kind of room.",
    key: 4,
    label: "Photos",
  },
  {
    description: "Facilities, house rules, meals and the weekly routine.",
    key: 5,
    label: "Rules & food",
  },
  { description: "Whatever the owner handed you.", key: 6, label: "Documents" },
  {
    description: "What they are buying, and what you collected.",
    key: 7,
    label: "Plan & payment",
  },
  { description: "Check it, then put the hostel live.", key: 8, label: "Review & publish" },
];

function newRoom(): RoomRow {
  return {
    bedsPerRoom: "",
    id: crypto.randomUUID(),
    monthlyRent: "",
    rooms: "",
    roomType: "Single Room",
    vacantBeds: "",
  };
}

function Card({
  children,
  subtitle,
  title,
}: {
  children: React.ReactNode;
  subtitle?: string;
  title: string;
}) {
  return (
    <section className="app-card p-5">
      <h2 className="text-base font-bold text-foreground">{title}</h2>
      {subtitle ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({
  children,
  hint,
  label,
  required,
}: {
  children: React.ReactNode;
  hint?: string;
  label: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-foreground">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </span>
      {children}
      {hint ? (
        <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

/**
 * One kind of photo, uploaded and previewed.
 *
 * Kind is fixed by the caller rather than chosen per file, because the thing
 * that goes wrong is not "the agent picked the wrong option" — it is nobody
 * picking at all and every shot landing as an interior. A section per kind makes
 * the category a consequence of where you dropped the file.
 */
function PhotoStrip({
  busy,
  kind,
  label,
  onAdd,
  onOpen,
  onRemove,
  photos,
  roomType,
}: {
  busy: boolean;
  kind: PhotoKind;
  label: string;
  onAdd: (kind: PhotoKind, files: File[], roomType?: string) => void;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  photos: PhotoRow[];
  roomType?: string;
}) {
  const mine = photos.filter(
    (photo) => photo.kind === kind && (kind !== "ROOM" || photo.roomType === roomType),
  );

  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-foreground">
        {label}
        {mine.length > 0 ? (
          <span className="ml-1.5 font-normal text-muted-foreground">
            {mine.length}
          </span>
        ) : null}
      </p>

      <div className="flex flex-wrap gap-2">
        {mine.map((photo) => (
          <div
            className="group relative size-24 overflow-hidden rounded-lg border border-border bg-surface"
            key={photo.id}
          >
            {photo.uploading ? (
              <span className="flex size-full items-center justify-center">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </span>
            ) : (
              /*
               * A thumbnail this small is not enough to check that the right
               * photo went into the right section — which is the whole reason
               * an agent looks at this step. Clicking opens the app-wide viewer
               * on the full set, so they can arrow through everything they have
               * uploaded at full size without leaving the form.
               */
              <button
                aria-label={`View ${photo.name}`}
                className="size-full cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/50"
                onClick={() => onOpen(photo.id)}
                type="button"
              >
                <Image
                  alt={photo.name}
                  className="size-full object-cover"
                  height={96}
                  src={photo.url}
                  unoptimized
                  width={96}
                />
              </button>
            )}
            <button
              aria-label={`Remove ${photo.name}`}
              className="absolute right-1 top-1 rounded-md bg-background/85 p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
              onClick={() => onRemove(photo.id)}
              type="button"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}

        <label
          className={cn(
            "flex size-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-center transition hover:border-brand-teal hover:bg-brand-teal/5",
            busy && "pointer-events-none opacity-50",
          )}
        >
          <ImagePlus className="size-4 text-muted-foreground" />
          <span className="text-[10px] font-semibold text-muted-foreground">Add</span>
          <input
            accept={acceptAttribute("image")}
            className="sr-only"
            multiple
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);

              if (files.length > 0) {
                onAdd(kind, files, roomType);
              }

              event.currentTarget.value = "";
            }}
            type="file"
          />
        </label>
      </div>
    </div>
  );
}

export function TeamRegisterHostelPage() {
  const router = useRouter();
  const { plans: catalog } = useSiteConfig();
  const { confirm, confirmDialog } = useConfirm();
  const mediaViewer = useMediaViewer();

  const [step, setStep] = useState(1);

  const [hostelName, setHostelName] = useState("");
  const [description, setDescription] = useState("");
  const [hostelType, setHostelType] = useState<"BOYS" | "CO_LIVING" | "GIRLS">(
    "CO_LIVING",
  );
  const [yearEstablished, setYearEstablished] = useState("");
  const [totalFloors, setTotalFloors] = useState("");

  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [alternatePhone, setAlternatePhone] = useState("");
  const [email, setEmail] = useState("");

  const [address, setAddress] = useState("");
  const [area, setArea] = useState("");
  const [city, setCity] = useState("Kathmandu");
  const [landmark, setLandmark] = useState("");
  const [mapLink, setMapLink] = useState("");
  /*
   * The pin, and how it got there.
   *
   * The agent is standing in the building, which makes them the best source of
   * coordinates this hostel will ever have — better than geocoding "Balkmurari,
   * Narephat" and landing in the middle of the neighbourhood. A pin they placed
   * is MANUAL, which is what stops the nightly nearby-places sweep moving it.
   */
  const [pin, setPin] = useState<LocationPickerValue>({
    coordinates: null,
    source: "GEOCODED",
  });

  const [rooms, setRooms] = useState<RoomRow[]>([newRoom()]);
  const [admissionFee, setAdmissionFee] = useState("");

  const [photos, setPhotos] = useState<PhotoRow[]>([]);

  const [facilities, setFacilities] = useState<string[]>([]);
  const [customFacility, setCustomFacility] = useState("");
  const [rules, setRules] = useState("");

  const [hasVeg, setHasVeg] = useState(true);
  const [hasNonVeg, setHasNonVeg] = useState(true);
  const [mealsPerDay, setMealsPerDay] = useState("3");
  const [foodNotes, setFoodNotes] = useState("");

  const [timings, setTimings] =
    useState<Partial<Record<MealType, string>>>(DEFAULT_TIMINGS);
  const [routineDay, setRoutineDay] = useState<RoutineDay>("SUNDAY");
  const [routine, setRoutine] = useState<Record<string, string>>(defaultRoutine);

  const [documents, setDocuments] = useState<DocRow[]>([]);

  const [planId, setPlanId] = useState("");
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [method, setMethod] = useState<"CASH" | "SOFTMATO">("CASH");
  const [amount, setAmount] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [qr, setQr] = useState<{ label: string; url: string } | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [draftNotice, setDraftNotice] = useState("");

  const cycles = billingCycles(catalog);
  const priced = catalog.plans.filter((plan) => plan.monthly > 0);
  const plan = priced.find((entry) => entry.id === planId);
  const price = plan ? cycleTotal(plan, cycle) : 0;
  const collecting = numberValue(amount) ?? 0;
  const shortfall = Math.max(0, price - collecting);
  const uploading = documents.some((doc) => doc.uploading) || photos.some((p) => p.uploading);

  /** Room rows that have enough on them to be a room type at all. */
  const validRooms = rooms.filter(
    (room) => room.roomType.trim() && numberValue(room.rooms),
  );

  const roomTypeNames = Array.from(
    new Set(validRooms.map((room) => room.roomType.trim())),
  );

  /*
   * Capacity and the rent range are computed from the room rows rather than
   * asked for again. Two boxes that must agree with a table above them are two
   * boxes that will eventually disagree with it, and the table is the more
   * specific answer — `hostelDocumentFrom` already treats it that way.
   */
  const capacity = validRooms.reduce(
      (total, room) => {
        const count = numberValue(room.rooms) ?? 0;
        const beds = numberValue(room.bedsPerRoom) ?? 0;

        return {
          totalBeds: total.totalBeds + count * beds,
          totalRooms: total.totalRooms + count,
          vacantBeds: total.vacantBeds + (numberValue(room.vacantBeds) ?? 0),
        };
      },
    { totalBeds: 0, totalRooms: 0, vacantBeds: 0 },
  );

  const rentRange = (() => {
    const rents = validRooms
      .map((room) => numberValue(room.monthlyRent))
      .filter((rent): rent is number => rent !== undefined && rent > 0);

    return rents.length > 0
      ? { max: Math.max(...rents), min: Math.min(...rents) }
      : null;
  })();

  /** Whatever was typed in — derived, so it cannot drift from what is submitted. */
  const custom = facilities.filter((facility) => !facilityOptions.includes(facility));

  /**
   * Every uploaded photo, in the order the strips render them.
   *
   * The viewer is handed the whole set rather than one strip's worth so its
   * arrows walk the entire gallery: an agent checking their work wants to see
   * what the listing will look like, and the listing does not stop at the
   * section boundary either.
   */
  const uploadedPhotos = photos.filter((photo) => photo.url && !photo.uploading);

  function openPhoto(id: string) {
    const index = uploadedPhotos.findIndex((photo) => photo.id === id);

    if (index < 0) {
      return;
    }

    mediaViewer.open(
      uploadedPhotos.map((photo) => ({
        caption: photo.name,
        kind: "image" as const,
        src: photo.url,
        title:
          photo.kind === "ROOM"
            ? (photo.roomType ?? "Room")
            : photo.kind === "EXTERIOR"
              ? "Outside"
              : "Inside",
      })),
      index,
    );
  }

  /* ── The QR the owner scans ──────────────────────────────────────────── */

  useEffect(() => {
    async function loadQr() {
      try {
        const result = await browserApi<{ qr: { label: string; url: string } }>(
          "/api/v1/team/collection-qr",
        );

        setQr(result.qr);
      } catch {
        // A missing QR is not an error worth blocking the form for — the
        // payment step says so in place of the image, and cash still works.
        setQr(null);
      }
    }

    void loadQr();
  }, []);

  /* ── Draft ───────────────────────────────────────────────────────────── */

  /*
   * An agent fills this in standing in a corridor on a phone connection. Losing
   * forty fields to a backgrounded tab is the difference between a tool and a
   * liability, so everything typed is kept locally until the form is submitted.
   *
   * Uploaded photos and documents are kept as URLs, which is safe: the file is
   * already on our storage by then, so the draft only carries a pointer to
   * something that exists.
   */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);

      if (!saved) {
        return;
      }

      const draft = JSON.parse(saved) as Record<string, unknown>;
      const read = <T,>(key: string, apply: (value: T) => void) => {
        if (draft[key] !== undefined) {
          apply(draft[key] as T);
        }
      };

      read<number>("step", setStep);
      read<string>("hostelName", setHostelName);
      read<string>("description", setDescription);
      read<"BOYS" | "CO_LIVING" | "GIRLS">("hostelType", setHostelType);
      read<string>("yearEstablished", setYearEstablished);
      read<string>("totalFloors", setTotalFloors);
      read<string>("ownerName", setOwnerName);
      read<string>("phone", setPhone);
      read<string>("alternatePhone", setAlternatePhone);
      read<string>("email", setEmail);
      read<string>("address", setAddress);
      read<string>("area", setArea);
      read<string>("city", setCity);
      read<string>("landmark", setLandmark);
      read<string>("mapLink", setMapLink);
      read<LocationPickerValue>("pin", setPin);
      read<RoomRow[]>("rooms", setRooms);
      read<string>("admissionFee", setAdmissionFee);
      read<PhotoRow[]>("photos", setPhotos);
      read<string[]>("facilities", setFacilities);
      read<string>("rules", setRules);
      read<boolean>("hasVeg", setHasVeg);
      read<boolean>("hasNonVeg", setHasNonVeg);
      read<string>("mealsPerDay", setMealsPerDay);
      read<string>("foodNotes", setFoodNotes);
      /*
       * The routine and its timings **merge onto** the defaults rather than
       * replacing them.
       *
       * A draft saved before the sample week existed carries `{}` for both, and
       * `{}` is defined — so a plain restore handed the form two empty objects
       * and every agent with an older draft saw an empty grid where the sample
       * should have been. Merging also gets the general case right: a cell the
       * draft never recorded falls back to the sample, while a cell the agent
       * deliberately emptied is stored as `""` and stays empty.
       */
      /*
       * The routine merges onto the defaults so a cell the draft never recorded
       * falls back to the sample while a cell the agent emptied stays empty —
       * but only for a draft new enough for that distinction to mean anything.
       */
      if (draft.version === DRAFT_VERSION) {
        read<Partial<Record<MealType, string>>>("timings", (value) =>
          setTimings({ ...DEFAULT_TIMINGS, ...value }),
        );
        read<Record<string, string>>("routine", (value) =>
          setRoutine({ ...defaultRoutine(), ...value }),
        );
      }
      read<DocRow[]>("documents", setDocuments);
      read<string>("planId", setPlanId);
      read<BillingCycle>("cycle", setCycle);
    } catch {
      // A corrupt draft is discarded rather than diagnosed.
    }
  }, []);

  /*
   * One writer for both the autosave and the button.
   *
   * The button does not do anything the typing has not already done — it exists
   * because autosave is invisible, and an agent who has spent twenty minutes on
   * a form has no way of knowing it is safe. Pressing something and being told
   * "Saved" is the whole feature; the storage write is incidental.
   */
  function writeDraft() {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          address,
          admissionFee,
          alternatePhone,
          area,
          city,
          cycle,
          description,
          documents,
          email,
          facilities,
          foodNotes,
          hasNonVeg,
          hasVeg,
          hostelName,
          hostelType,
          landmark,
          mapLink,
          mealsPerDay,
          ownerName,
          phone,
          photos,
          pin,
          planId,
          rooms,
          routine,
          rules,
          step,
          timings,
          totalFloors,
          version: DRAFT_VERSION,
          yearEstablished,
        }),
      );

      return true;
    } catch {
      // Private mode, or a full quota. The form still works; it just forgets —
      // and the button says so rather than claiming a save that did not happen.
      return false;
    }
  }

  useEffect(() => {
    writeDraft();
    // `writeDraft` closes over every field; listing them is what makes the
    // autosave fire on each keystroke. It deliberately sets no state — a
    // timestamp updated on every keypress would cascade a render for something
    // nobody is reading. The button below is what reports, because a button
    // press is a moment somebody is actually looking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    address,
    admissionFee,
    alternatePhone,
    area,
    city,
    cycle,
    description,
    documents,
    email,
    facilities,
    foodNotes,
    hasNonVeg,
    hasVeg,
    hostelName,
    hostelType,
    landmark,
    mapLink,
    mealsPerDay,
    ownerName,
    phone,
    photos,
    pin,
    planId,
    rooms,
    routine,
    rules,
    step,
    timings,
    totalFloors,
    yearEstablished,
  ]);

  /* ── Completeness ────────────────────────────────────────────────────── */

  function stepComplete(key: number) {
    switch (key) {
      case 1:
        return Boolean(ownerName.trim() && phone.trim() && hostelName.trim());
      case 2:
        return Boolean(area.trim() && city.trim());
      case 3:
        return validRooms.length > 0;
      case 4:
        return photos.some((photo) => photo.url && !photo.uploading);
      case 5:
        return facilities.length > 0;
      case 6:
        return documents.some((doc) => doc.url);
      case 7:
        return Boolean(plan);
      default:
        return false;
    }
  }

  /** Missing things that stop a submission, each pointing at its own step. */
  const blocking = (() => {
    const checks: { label: string; step: number; valid: boolean }[] = [
      { label: "Owner name", step: 1, valid: Boolean(ownerName.trim()) },
      { label: "Owner phone", step: 1, valid: Boolean(phone.trim()) },
      { label: "Hostel name", step: 1, valid: Boolean(hostelName.trim()) },
      { label: "Area", step: 2, valid: Boolean(area.trim()) },
      { label: "City", step: 2, valid: Boolean(city.trim()) },
      { label: "At least one room type", step: 3, valid: validRooms.length > 0 },
      { label: "A plan", step: 7, valid: Boolean(plan) },
    ];

    return checks.filter((check) => !check.valid);
  })();

  /**
   * Things a live listing is worse without, but which are not worth refusing a
   * registration over.
   *
   * A hostel with no photos publishes with a stock image, which is a poorer
   * listing and not an invalid one — and an agent who cannot get photos today
   * should still be able to file the hostel and take the money.
   */
  const recommendations = (() => {
    /*
     * The routine ships pre-filled with a typical week, which is a head start
     * and a trap: an agent who never opened step 5 would publish a menu the
     * hostel never agreed to. Untouched is therefore called out here by name
     * rather than passing silently as "filled in".
     */
    const sample = defaultRoutine();
    const routineUntouched =
      ROUTINE_DAYS.every((day) =>
        MEAL_TYPES.every(
          (meal) => (routine[`${day}:${meal}`] ?? "") === sample[`${day}:${meal}`],
        ),
      ) && MEAL_TYPES.every((meal) => (timings[meal] ?? "") === DEFAULT_TIMINGS[meal]);

    const checks: { label: string; step: number; valid: boolean }[] = [
      { label: "Photos of the building", step: 4, valid: photos.some((p) => p.url) },
      {
        // The server geocodes the address when nobody placed a pin, which puts
        // the hostel somewhere in the right neighbourhood. The agent is in the
        // building; they can do better, and it is worth asking them to.
        label: "The map pin — you are standing there, so place it",
        step: 2,
        valid: pin.coordinates !== null,
      },
      { label: "Facilities", step: 5, valid: facilities.length > 0 },
      { label: "House rules", step: 5, valid: Boolean(rules.trim()) },
      {
        label: "The food routine is still the sample week — check it with the owner",
        step: 5,
        valid: !routineUntouched,
      },
      { label: "Documents", step: 6, valid: documents.some((doc) => doc.url) },
      { label: "The owner's email", step: 1, valid: Boolean(email.trim()) },
    ];

    return checks.filter((check) => !check.valid);
  })();

  /* ── Editing ─────────────────────────────────────────────────────────── */

  function addFacility() {
    const value = customFacility.trim().replace(/\s+/g, " ");

    if (!value || value.length > 80 || facilities.length >= 40) {
      return;
    }

    const preset = facilityOptions.find(
      (option) => option.toLowerCase() === value.toLowerCase(),
    );
    const name = preset ?? value;

    if (!facilities.some((item) => item.toLowerCase() === name.toLowerCase())) {
      setFacilities((prev) => [...prev, name]);
    }

    setCustomFacility("");
  }

  async function addDocument(type: string, file: File) {
    const id = crypto.randomUUID();

    setDocuments((prev) => [
      ...prev,
      { id, name: file.name, type, uploading: true, url: "" },
    ]);

    try {
      const uploaded = await uploadFile(file, {
        kind: "document",
        label: type,
        silent: true,
        target: "public",
      });

      const url = uploaded?.url;

      if (!url) {
        throw new Error("Upload failed");
      }

      setDocuments((prev) =>
        prev.map((doc) => (doc.id === id ? { ...doc, uploading: false, url } : doc)),
      );
    } catch {
      setDocuments((prev) => prev.filter((doc) => doc.id !== id));
      setError(`Could not upload ${file.name}.`);
    }
  }

  function addPhotos(kind: PhotoKind, files: File[], roomType?: string) {
    for (const file of files) {
      const id = crypto.randomUUID();

      setPhotos((prev) => [
        ...prev,
        { id, kind, name: file.name, roomType, uploading: true, url: "" },
      ]);

      void (async () => {
        try {
          const uploaded = await uploadFile(file, {
            kind: "image",
            label: `${titleCase(kind)} photo`,
            silent: true,
            target: "public",
          });

          const url = uploaded?.url;

          if (!url) {
            throw new Error("Upload failed");
          }

          setPhotos((prev) =>
            prev.map((photo) =>
              photo.id === id ? { ...photo, uploading: false, url } : photo,
            ),
          );
        } catch {
          setPhotos((prev) => prev.filter((photo) => photo.id !== id));
          setError(`Could not upload ${file.name}.`);
        }
      })();
    }
  }

  function setRoutineItems(day: RoutineDay, meal: MealType, value: string) {
    setRoutine((prev) => ({ ...prev, [`${day}:${meal}`]: value }));
  }

  /**
   * Copies the day on screen onto the other six. Most weeks are one week.
   *
   * Refuses to copy a day with nothing in it. Pressing this on a blank day can
   * only ever mean a misfire — nobody sets out to erase six days of meals — and
   * before the guard it did exactly that, writing an empty string into all
   * twenty-eight cells and leaving a routine that looked deliberately cleared.
   */
  function copyDayToAll(day: RoutineDay) {
    const source = MEAL_TYPES.map((meal) => routine[`${day}:${meal}`] ?? "");

    if (source.every((value) => !value.trim())) {
      setError(
        `${titleCase(day)} has no meals on it yet — fill it in before copying it across.`,
      );

      return;
    }

    setError("");
    setRoutine((prev) => {
      const next = { ...prev };

      for (const target of ROUTINE_DAYS) {
        MEAL_TYPES.forEach((meal, index) => {
          next[`${target}:${meal}`] = source[index];
        });
      }

      return next;
    });
  }

  function applyRulesTemplate(id: string) {
    const template = RULES_TEMPLATES.find((entry) => entry.id === id);

    if (!template) {
      return;
    }

    /*
     * The template is a document; `rules[]` is a list of short lines. Taking the
     * bulleted lines out of it gives the listing something readable without
     * dumping five headings and a blank line into the rules card.
     */
    const lines = template.body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .map((line) => line.replace(/^-\s*/, ""));

    setRules(lines.join("\n"));
  }

  /* ── Submitting ──────────────────────────────────────────────────────── */

  /**
   * Throws the draft away and reloads onto an empty form.
   *
   * Reloading rather than resetting thirty pieces of state by hand: there is one
   * definition of "a fresh form" — the one the component mounts with — and a
   * hand-written reset is a second one that will drift from it the next time a
   * field is added.
   */
  async function discardDraft() {
    const confirmed = await confirm({
      actionLabel: "Discard it",
      description:
        "Everything typed into this form is thrown away, including uploads that have not been submitted. The hostel is not affected — nothing has been registered yet.",
      title: "Start over?",
      tone: "destructive",
    });

    if (!confirmed) {
      return;
    }

    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Nothing stored to begin with.
    }

    window.location.reload();
  }

  function goTo(next: number) {
    setStep(Math.min(STEPS.length, Math.max(1, next)));
    window.scrollTo({ behavior: "smooth", top: 0 });
  }

  function buildPayload() {
    const roomConfigurations = validRooms.map((room) => ({
      bedsPerRoom: numberValue(room.bedsPerRoom) ?? 0,
      mealInclusion: "Included" as const,
      monthlyRent: numberValue(room.monthlyRent),
      rooms: numberValue(room.rooms) ?? 0,
      roomType: room.roomType.trim(),
      vacantBeds: numberValue(room.vacantBeds) ?? 0,
    }));

    const meals = ROUTINE_DAYS.flatMap((day) =>
      MEAL_TYPES.flatMap((meal) => {
        const items = (routine[`${day}:${meal}`] ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);

        return items.length > 0
          ? [{ dayOfWeek: day, items, mealType: meal }]
          : [];
      }),
    );

    const cleanTimings = Object.fromEntries(
      MEAL_TYPES.map((meal) => [meal, (timings[meal] ?? "").trim()]).filter(
        ([, value]) => value,
      ),
    );

    return {
      alternatePhone: alternatePhone.trim() || undefined,
      applicant: {
        email: email.trim() || undefined,
        name: ownerName.trim(),
        phone: phone.trim(),
      },
      capacitySummary: capacity,
      contact: { email: email.trim() || undefined, phone: phone.trim() },
      description: description.trim() || undefined,
      documents: documents
        .filter((doc) => doc.url)
        .map((doc) => ({ documentType: doc.type, fileUrl: doc.url })),
      facilities,
      food: {
        hasNonVeg,
        hasVeg,
        mealsPerDay: numberValue(mealsPerDay),
        notes: foodNotes.trim() || undefined,
      },
      /*
       * Only sent when there is something in it. An empty routine posted every
       * time would create a `FoodRoutine` document for every hostel whether or
       * not anybody asked about meals, and "no routine recorded" then becomes
       * indistinguishable from "a routine with nothing in it".
       */
      foodRoutine:
        meals.length > 0 || Object.keys(cleanTimings).length > 0
          ? { meals, timings: cleanTimings }
          : undefined,
      hostelType,
      landmark: landmark.trim() || undefined,
      location: {
        address: address.trim() || undefined,
        area: area.trim(),
        city: city.trim(),
        /*
         * The pin travels with the address, so the listing has a map on the day
         * it publishes. Without it the server can only geocode the locality,
         * and the public page opens on a dashed box telling the visitor the
         * hostel has not finished setting itself up.
         */
        ...(pin.coordinates
          ? {
              lat: pin.coordinates.lat,
              lng: pin.coordinates.lng,
              locationSource: pin.source,
            }
          : {}),
      },
      mapLink: mapLink.trim() || undefined,
      name: hostelName.trim(),
      payment: {
        amount: collecting,
        method,
        reference: paymentReference.trim() || undefined,
      },
      photos: photos
        .filter((photo) => photo.url && !photo.uploading)
        .map((photo) => ({
          kind: photo.kind,
          roomType: photo.kind === "ROOM" ? photo.roomType : undefined,
          url: photo.url,
        })),
      plan: { cycle, planId: plan?.id ?? "" },
      pricing: {
        admissionFee: numberValue(admissionFee),
        currency: "NPR",
        monthlyRentMax: rentRange?.max,
        monthlyRentMin: rentRange?.min,
      },
      roomConfigurations,
      roomTypes: roomTypeNames,
      rules: rules
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      totalFloors: numberValue(totalFloors),
      yearEstablished: yearEstablished.trim() || undefined,
    };
  }

  async function publish() {
    setError("");

    if (blocking.length > 0) {
      setError("Some required details are still missing.");
      goTo(blocking[0].step);

      return;
    }

    if (uploading) {
      setError("Wait for the uploads to finish.");

      return;
    }

    if (collecting > price) {
      setError(`You cannot collect more than the plan price of ${rupees(price)}.`);

      return;
    }

    /*
     * The last gate before a hostel is public.
     *
     * Everything else on this form can be corrected afterwards from the admin
     * portal. This cannot: the listing goes live, the owner is emailed, and an
     * invoice with somebody's money against it exists. So the agent is told in
     * plain figures what they are about to do and has to say yes to it.
     */
    const confirmed = await confirm({
      actionLabel: "Publish the hostel",
      description: [
        `${hostelName.trim()} goes live now, on the ${plan?.name} plan at ${rupees(price)}.`,
        collecting > 0
          ? `${rupees(collecting)} collected by ${method === "CASH" ? "cash" : "QR"}.`
          : "Nothing collected today.",
        shortfall > 0
          ? `${rupees(shortfall)} becomes a due on the owner's dashboard.`
          : "Nothing left owing.",
        "The owner will be emailed that their hostel is published.",
      ].join(" "),
      title: "Publish this hostel?",
    });

    if (!confirmed) {
      return;
    }

    setSubmitting(true);

    try {
      const result = await browserApi<{ hostel: { id: string } }>(
        "/api/v1/team/hostels",
        { body: JSON.stringify(buildPayload()), method: "POST" },
      );

      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        // Nothing to do — a leftover draft is a stale form, not a lost hostel.
      }

      router.push(`/team?registered=${result.hostel.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not register this hostel.");
      setSubmitting(false);
    }
  }

  /* ── Render ──────────────────────────────────────────────────────────── */

  return (
    <div className="pb-10">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Register a hostel
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Collect everything the owner would otherwise set up themselves. It
            publishes on the last step, not before.
          </p>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <button
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition hover:border-brand-teal hover:bg-brand-teal/5"
              onClick={() => {
                const at = new Date().toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                });

                setDraftNotice(
                  writeDraft()
                    ? `Draft saved on this device at ${at}.`
                    : "This browser will not let us save a draft — do not close the tab.",
                );
              }}
              type="button"
            >
              <Save className="size-3.5" />
              Save draft
            </button>

            <button
              className="rounded-lg px-2 py-2 text-xs font-semibold text-muted-foreground transition hover:text-destructive"
              onClick={() => void discardDraft()}
              type="button"
            >
              Start over
            </button>
          </div>

          {/* Autosave is silent by design; this is the receipt for it. */}
          <p aria-live="polite" className="text-[11px] text-muted-foreground">
            {draftNotice || "Saved on this device as you type"}
          </p>
        </div>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <StepRail
          currentStep={step}
          onStepSelect={goTo}
          stepComplete={stepComplete}
          steps={STEPS}
        />

        <StepFlow className="min-w-0 space-y-5" stepKey={step}>
          {step === 1 ? (
            <>
              <Card subtitle="Who owns it and how to reach them." title="Owner">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Owner name" required>
                    <input
                      className="input-field w-full"
                      onChange={(event) => setOwnerName(event.target.value)}
                      value={ownerName}
                    />
                  </Field>
                  <Field label="Phone" required>
                    <input
                      className="input-field w-full"
                      inputMode="tel"
                      onChange={(event) => setPhone(event.target.value)}
                      value={phone}
                    />
                  </Field>
                  <Field
                    hint="Their invoice, receipt and sign-in details go here."
                    label="Email"
                  >
                    <input
                      className="input-field w-full"
                      inputMode="email"
                      onChange={(event) => setEmail(event.target.value)}
                      type="email"
                      value={email}
                    />
                  </Field>
                  <Field label="Alternate phone">
                    <input
                      className="input-field w-full"
                      inputMode="tel"
                      onChange={(event) => setAlternatePhone(event.target.value)}
                      value={alternatePhone}
                    />
                  </Field>
                </div>
              </Card>

              <Card subtitle="What the place is and what it is called." title="The hostel">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Hostel name" required>
                    <input
                      className="input-field w-full"
                      onChange={(event) => setHostelName(event.target.value)}
                      value={hostelName}
                    />
                  </Field>
                  <Field label="Type">
                    <select
                      className="input-field w-full"
                      onChange={(event) =>
                        setHostelType(
                          event.target.value as "BOYS" | "CO_LIVING" | "GIRLS",
                        )
                      }
                      value={hostelType}
                    >
                      <option value="CO_LIVING">Co-living</option>
                      <option value="BOYS">Boys</option>
                      <option value="GIRLS">Girls</option>
                    </select>
                  </Field>
                  <Field label="Year established">
                    <input
                      className="input-field w-full"
                      inputMode="numeric"
                      onChange={(event) => setYearEstablished(event.target.value)}
                      placeholder="2018"
                      value={yearEstablished}
                    />
                  </Field>
                  <Field label="Floors">
                    <input
                      className="input-field w-full"
                      inputMode="numeric"
                      onChange={(event) => setTotalFloors(event.target.value)}
                      value={totalFloors}
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field
                      hint="Two or three lines. It is the first thing a resident reads."
                      label="Description"
                    >
                      <textarea
                        className="input-field h-24 w-full py-2"
                        onChange={(event) => setDescription(event.target.value)}
                        value={description}
                      />
                    </Field>
                  </div>
                </div>
              </Card>
            </>
          ) : null}

          {step === 2 ? (
            <Card subtitle="How somebody actually finds it." title="Where it is">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Area / locality" required>
                  <input
                    className="input-field w-full"
                    onChange={(event) => setArea(event.target.value)}
                    value={area}
                  />
                </Field>
                <Field label="City" required>
                  <select
                    className="input-field w-full"
                    onChange={(event) => setCity(event.target.value)}
                    value={city}
                  >
                    {cityOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Address line">
                  <input
                    className="input-field w-full"
                    onChange={(event) => setAddress(event.target.value)}
                    value={address}
                  />
                </Field>
                <Field hint="Opposite the campus gate, behind the temple." label="Landmark">
                  <input
                    className="input-field w-full"
                    onChange={(event) => setLandmark(event.target.value)}
                    value={landmark}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field
                    hint="Kept exactly as the owner sent it, and shown on the listing."
                    label="Maps link"
                  >
                    <input
                      className="input-field w-full"
                      onChange={(event) => setMapLink(event.target.value)}
                      placeholder="https://maps.app.goo.gl/…"
                      value={mapLink}
                    />
                  </Field>
                </div>
                {/*
                  The pin, not the address text, is what the public map shows and
                  what the nearby colleges, hospitals and parks are measured from.
                  The agent is standing in the building while they fill this in,
                  so this is the one moment the platform can get it exactly right
                  — an address geocoded later lands in the middle of the tole.
                */}
                <div className="space-y-2 sm:col-span-2">
                  <div>
                    <p className="text-sm font-bold text-foreground">Exact map pin</p>
                    <p className="text-xs font-medium text-muted-foreground">
                      Paste the maps link above, search for the hostel, use your
                      current location while you are standing at it, or drag the
                      marker onto the gate. Without a pin the listing publishes
                      without a map.
                    </p>
                  </div>
                  <LocationPicker
                    addressHint={[address, area, city].filter(Boolean).join(", ")}
                    lookupPath="/api/v1/team/geocode"
                    onChange={setPin}
                    onResolvedAddress={(parts) => {
                      // The picker resolved a real place; let it fill in what
                      // the agent has not typed rather than overwriting them.
                      if (parts.address && !address.trim()) setAddress(parts.address);
                      if (parts.area && !area.trim()) setArea(parts.area);
                      if (parts.city && cityOptions.includes(parts.city)) {
                        setCity(parts.city);
                      }
                    }}
                    value={pin}
                  />
                </div>
              </div>
            </Card>
          ) : null}

          {step === 3 ? (
            <>
              <Card
                subtitle="One row per kind of room. The totals below come from these."
                title="Rooms"
              >
                <div className="space-y-2">
                  {rooms.map((room) => (
                    <div className="flex flex-wrap items-end gap-2" key={room.id}>
                      <label className="min-w-[9rem] flex-1">
                        <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                          Room type
                        </span>
                        <select
                          className="input-field w-full"
                          onChange={(event) =>
                            setRooms((prev) =>
                              prev.map((entry) =>
                                entry.id === room.id
                                  ? { ...entry, roomType: event.target.value }
                                  : entry,
                              ),
                            )
                          }
                          value={room.roomType}
                        >
                          {roomTypeOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>

                      {(
                        [
                          ["rooms", "Rooms"],
                          ["bedsPerRoom", "Beds each"],
                          ["vacantBeds", "Vacant"],
                          ["monthlyRent", "Rent"],
                        ] as const
                      ).map(([key, label]) => (
                        <label className="w-20" key={key}>
                          <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                            {label}
                          </span>
                          <input
                            className="input-field w-full"
                            inputMode="numeric"
                            onChange={(event) =>
                              setRooms((prev) =>
                                prev.map((entry) =>
                                  entry.id === room.id
                                    ? { ...entry, [key]: event.target.value }
                                    : entry,
                                ),
                              )
                            }
                            value={room[key]}
                          />
                        </label>
                      ))}

                      <button
                        aria-label="Remove this room type"
                        className="rounded-lg border border-border p-2.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                        disabled={rooms.length === 1}
                        onClick={() =>
                          setRooms((prev) => prev.filter((entry) => entry.id !== room.id))
                        }
                        type="button"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-teal hover:underline"
                  onClick={() => setRooms((prev) => [...prev, newRoom()])}
                  type="button"
                >
                  <Plus className="size-3.5" /> Add room type
                </button>

                <dl className="mt-4 grid grid-cols-3 gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                  {(
                    [
                      ["Rooms", capacity.totalRooms],
                      ["Beds", capacity.totalBeds],
                      ["Vacant", capacity.vacantBeds],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-[11px] text-muted-foreground">{label}</dt>
                      <dd className="font-bold tabular-nums text-foreground">{value}</dd>
                    </div>
                  ))}
                </dl>
              </Card>

              <Card subtitle="What a resident pays on top of rent." title="Pricing">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Admission fee">
                    <input
                      className="input-field w-full"
                      inputMode="numeric"
                      onChange={(event) => setAdmissionFee(event.target.value)}
                      value={admissionFee}
                    />
                  </Field>
                  <div className="self-end rounded-lg border border-border bg-muted/30 p-3 text-sm">
                    <p className="text-[11px] text-muted-foreground">
                      Rent range on the listing
                    </p>
                    <p className="font-bold tabular-nums text-foreground">
                      {rentRange
                        ? rentRange.min === rentRange.max
                          ? rupees(rentRange.min)
                          : `${rupees(rentRange.min)} – ${rupees(rentRange.max)}`
                        : "Add rents above"}
                    </p>
                  </div>
                </div>
              </Card>
            </>
          ) : null}

          {step === 4 ? (
            <Card
              subtitle="The listing leads with an exterior. Room shots attach to the room type they are of."
              title="Photos"
            >
              <div className="space-y-5">
                <PhotoStrip
                  busy={false}
                  kind="EXTERIOR"
                  label="Outside the building"
                  onAdd={addPhotos}
                  onOpen={openPhoto}
                  onRemove={(id) =>
                    setPhotos((prev) => prev.filter((photo) => photo.id !== id))
                  }
                  photos={photos}
                />
                <PhotoStrip
                  busy={false}
                  kind="INTERIOR"
                  label="Inside — common areas, kitchen, study room"
                  onAdd={addPhotos}
                  onOpen={openPhoto}
                  onRemove={(id) =>
                    setPhotos((prev) => prev.filter((photo) => photo.id !== id))
                  }
                  photos={photos}
                />

                {roomTypeNames.length === 0 ? (
                  <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                    Add a room type on the previous step to attach room photos to
                    it.
                  </p>
                ) : (
                  roomTypeNames.map((name) => (
                    <PhotoStrip
                      busy={false}
                      key={name}
                      kind="ROOM"
                      label={name}
                      onAdd={addPhotos}
                      onOpen={openPhoto}
                      onRemove={(id) =>
                        setPhotos((prev) => prev.filter((photo) => photo.id !== id))
                      }
                      photos={photos}
                      roomType={name}
                    />
                  ))
                )}
              </div>
            </Card>
          ) : null}

          {step === 5 ? (
            <>
              <Card subtitle="What the hostel has." title="Facilities">
                <div className="flex flex-wrap gap-2">
                  {[...facilityOptions, ...custom].map((facility) => {
                    const active = facilities.includes(facility);
                    const isCustom = custom.includes(facility);

                    return (
                      <button
                        className={cn(
                          "rounded-lg border px-3 py-1.5 text-xs font-semibold transition",
                          active
                            ? "border-brand-teal bg-brand-teal/10 text-brand-teal"
                            : "border-border text-muted-foreground hover:border-brand-teal/40",
                        )}
                        key={facility}
                        onClick={() =>
                          setFacilities((prev) =>
                            prev.includes(facility)
                              ? prev.filter((item) => item !== facility)
                              : [...prev, facility],
                          )
                        }
                        type="button"
                      >
                        {facility}
                        {isCustom ? <span className="ml-1 opacity-50">&times;</span> : null}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-3 flex gap-2">
                  <input
                    className="input-field min-w-0 flex-1"
                    onChange={(event) => setCustomFacility(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addFacility();
                      }
                    }}
                    placeholder="Something else they have"
                    value={customFacility}
                  />
                  <button
                    className="shrink-0 rounded-lg border border-border px-4 text-xs font-semibold text-foreground transition hover:border-brand-teal hover:bg-brand-teal/5 disabled:opacity-40"
                    disabled={!customFacility.trim()}
                    onClick={addFacility}
                    type="button"
                  >
                    Add
                  </button>
                </div>
              </Card>

              <Card
                subtitle="One rule per line. Start from a template and edit what differs."
                title="House rules"
              >
                <div className="mb-3 flex flex-wrap gap-2">
                  {RULES_TEMPLATES.map((template) => (
                    <button
                      className="rounded-lg border border-dashed border-border px-3 py-1.5 text-left text-xs font-semibold text-foreground transition hover:border-brand-teal hover:bg-brand-teal/5"
                      key={template.id}
                      onClick={() => applyRulesTemplate(template.id)}
                      type="button"
                    >
                      {template.name}
                    </button>
                  ))}
                </div>

                <textarea
                  className="input-field h-40 w-full py-2"
                  onChange={(event) => setRules(event.target.value)}
                  placeholder={"Gate closes at 10:00 PM\nNo smoking indoors"}
                  value={rules}
                />
              </Card>

              <Card subtitle="What the kitchen serves." title="Food">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Kitchen">
                    <div className="flex gap-2">
                      {(
                        [
                          ["Veg", hasVeg, setHasVeg],
                          ["Non-veg", hasNonVeg, setHasNonVeg],
                        ] as const
                      ).map(([label, active, set]) => (
                        <button
                          className={cn(
                            "flex-1 rounded-lg border px-3 py-2.5 text-xs font-semibold transition",
                            active
                              ? "border-brand-teal bg-brand-teal/10 text-brand-teal"
                              : "border-border text-muted-foreground hover:border-brand-teal/40",
                          )}
                          key={label}
                          onClick={() => set(!active)}
                          type="button"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Meals a day">
                    <input
                      className="input-field w-full"
                      inputMode="numeric"
                      onChange={(event) => setMealsPerDay(event.target.value)}
                      value={mealsPerDay}
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Notes">
                      <input
                        className="input-field w-full"
                        onChange={(event) => setFoodNotes(event.target.value)}
                        placeholder="Special meal every Saturday"
                        value={foodNotes}
                      />
                    </Field>
                  </div>
                </div>
              </Card>

              <Card
                subtitle="Timings apply to the whole week. Items are per day — fill one day and copy it across."
                title="Weekly routine"
              >
                <div className="grid gap-3 sm:grid-cols-4">
                  {MEAL_TYPES.map((meal) => (
                    <Field key={meal} label={`${titleCase(meal)} time`}>
                      <input
                        className="input-field w-full"
                        onChange={(event) =>
                          setTimings((prev) => ({ ...prev, [meal]: event.target.value }))
                        }
                        placeholder="7:30 am"
                        value={timings[meal] ?? ""}
                      />
                    </Field>
                  ))}
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-1">
                  {ROUTINE_DAYS.map((day) => (
                    <button
                      className={cn(
                        "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                        routineDay === day
                          ? "bg-brand-teal text-white"
                          : "text-muted-foreground hover:bg-muted",
                      )}
                      key={day}
                      onClick={() => setRoutineDay(day)}
                      type="button"
                    >
                      {shortDay(day)}
                    </button>
                  ))}
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {MEAL_TYPES.map((meal) => (
                    <Field key={meal} label={titleCase(meal)}>
                      <input
                        className="input-field w-full"
                        onChange={(event) =>
                          setRoutineItems(routineDay, meal, event.target.value)
                        }
                        placeholder="Dal, Bhat, Tarkari"
                        value={routine[`${routineDay}:${meal}`] ?? ""}
                      />
                    </Field>
                  ))}
                </div>

                <button
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-teal hover:underline"
                  onClick={() => copyDayToAll(routineDay)}
                  type="button"
                >
                  <Check className="size-3.5" />
                  Use {titleCase(routineDay)} for every day
                </button>
              </Card>
            </>
          ) : null}

          {step === 6 ? (
            <Card subtitle="Whatever the owner handed you." title="Documents">
              <div className="flex flex-wrap gap-2">
                {DOC_TYPES.map((type) => (
                  <label
                    className="cursor-pointer rounded-lg border border-dashed border-border px-3 py-1.5 text-xs font-semibold text-foreground transition hover:border-brand-teal hover:bg-brand-teal/5"
                    key={type}
                  >
                    <Upload className="mr-1 inline size-3.5 text-muted-foreground" />
                    {type}
                    <input
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];

                        if (file) {
                          void addDocument(type, file);
                        }

                        event.currentTarget.value = "";
                      }}
                      type="file"
                    />
                  </label>
                ))}
              </div>

              {documents.length > 0 ? (
                <ul className="mt-3 space-y-1.5">
                  {documents.map((doc) => (
                    <li
                      className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs"
                      key={doc.id}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {doc.uploading ? (
                          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                        ) : (
                          <Check className="size-3.5 shrink-0 text-brand-teal" />
                        )}
                        <span className="truncate font-semibold text-foreground">
                          {doc.type}
                        </span>
                        <span className="truncate text-muted-foreground">{doc.name}</span>
                      </span>
                      <button
                        className="ml-2 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          setDocuments((prev) =>
                            prev.filter((entry) => entry.id !== doc.id),
                          )
                        }
                        type="button"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ) : null}

          {step === 7 ? (
            <>
              <Card subtitle="What they are buying." title="Plan">
                <div className="mb-4 inline-flex rounded-lg border border-border bg-muted/50 p-1">
                  {cycles.map((option) => {
                    const saving = bestDiscountPercent(catalog, option.id);

                    return (
                      <button
                        className={cn(
                          "rounded-md px-3 py-1.5 text-xs font-semibold transition",
                          cycle === option.id
                            ? "bg-surface text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                        key={option.id}
                        onClick={() => setCycle(option.id)}
                        type="button"
                      >
                        {option.label}
                        {saving > 0 ? (
                          <span className="ml-1 text-brand-teal">−{saving}%</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>

                {priced.length === 0 ? (
                  <p className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                    No plans are published yet. A superadmin sets them in Website
                    Config → Plans &amp; Pricing.
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {priced.map((entry) => {
                      const selected = entry.id === planId;

                      return (
                        <button
                          className={cn(
                            "rounded-xl border p-4 text-left transition",
                            selected
                              ? "border-brand-teal bg-brand-teal/5 ring-1 ring-brand-teal/30"
                              : "border-border bg-surface hover:border-brand-teal/40",
                          )}
                          key={entry.id}
                          onClick={() => setPlanId(entry.id)}
                          type="button"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-bold text-foreground">
                              {entry.name}
                            </p>
                            {selected ? (
                              <span className="flex size-5 items-center justify-center rounded-full bg-brand-teal text-white">
                                <Check className="size-3" strokeWidth={3} />
                              </span>
                            ) : null}
                          </div>

                          <p className="mt-2 text-lg font-bold tabular-nums text-foreground">
                            {rupees(cycleTotal(entry, cycle))}
                            <span className="ml-1 text-xs font-medium text-muted-foreground">
                              /{" "}
                              {cycles
                                .find((option) => option.id === cycle)
                                ?.label.toLowerCase()}
                            </span>
                          </p>

                          {entry.description ? (
                            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                              {entry.description}
                            </p>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>

              <Card
                subtitle="Full, part, or nothing — the hostel publishes either way."
                title="Payment"
              >
                <div className="flex gap-2">
                  {(
                    [
                      ["CASH", "Cash", Banknote],
                      ["SOFTMATO", "Online", QrCode],
                    ] as const
                  ).map(([value, label, Icon]) => (
                    <button
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs font-semibold transition",
                        method === value
                          ? "border-brand-teal bg-brand-teal/10 text-brand-teal"
                          : "border-border text-muted-foreground hover:border-brand-teal/40",
                      )}
                      key={value}
                      onClick={() => setMethod(value)}
                      type="button"
                    >
                      <Icon className="size-4" />
                      {label}
                    </button>
                  ))}
                </div>

                {method === "SOFTMATO" ? (
                  <div className="mt-4 flex flex-col gap-4 rounded-lg border border-border bg-muted/30 p-4 sm:flex-row sm:items-center">
                    {/*
                      Sized to be scanned across a desk, and tappable to go
                      fullscreen. A phone camera reading a QR off another screen
                      needs the modules bigger than a thumbnail makes them — and
                      in a badly lit lobby the fullscreen view, at whatever the
                      agent's screen brightness is, is the one that works.
                    */}
                    <div className="flex size-56 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-white p-2">
                      {qr?.url ? (
                        <button
                          className="size-full cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/50"
                          onClick={() =>
                            mediaViewer.open([
                              {
                                caption: qr.label || undefined,
                                kind: "image",
                                src: qr.url,
                                title: "Scan to pay",
                              },
                            ])
                          }
                          title="Tap to show it full screen"
                          type="button"
                        >
                          <Image
                            alt="Scan to pay"
                            className="size-full object-contain"
                            height={224}
                            src={qr.url}
                            unoptimized
                            width={224}
                          />
                        </button>
                      ) : (
                        <span className="px-3 text-center text-[11px] text-muted-foreground">
                          No QR has been set yet — a superadmin uploads it in
                          Platform → System → Settings.
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 text-xs leading-relaxed text-muted-foreground">
                      <p className="font-semibold text-foreground">
                        Let the owner scan this, then type in what arrived.
                      </p>
                      {qr?.label ? (
                        <p className="mt-1">
                          Read the account name out as they scan:{" "}
                          <span className="font-semibold text-foreground">
                            {qr.label}
                          </span>
                          . They should see the same name before they confirm.
                        </p>
                      ) : null}
                      <p className="mt-1">
                        The amount below is what we record as received, so take it
                        from their confirmation screen and not from what was agreed.
                      </p>
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field
                    hint={
                      method === "CASH"
                        ? "Whole rupees taken in hand."
                        : "Whole rupees shown on their confirmation."
                    }
                    label="Amount collected"
                  >
                    <input
                      className="input-field w-full"
                      inputMode="numeric"
                      onChange={(event) => setAmount(event.target.value)}
                      placeholder="0"
                      value={amount}
                    />
                  </Field>
                  <Field
                    hint={method === "CASH" ? "Slip number, if you wrote one." : "Transaction id."}
                    label="Reference"
                  >
                    <input
                      className="input-field w-full"
                      onChange={(event) => setPaymentReference(event.target.value)}
                      value={paymentReference}
                    />
                  </Field>
                </div>

                {plan ? (
                  <dl className="mt-4 space-y-1.5 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">{plan.name}</dt>
                      <dd className="font-semibold tabular-nums text-foreground">
                        {rupees(price)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Collecting now</dt>
                      <dd className="font-semibold tabular-nums text-foreground">
                        {rupees(collecting)}
                      </dd>
                    </div>
                    <div className="flex justify-between border-t border-border pt-1.5">
                      <dt className="font-semibold text-foreground">
                        {shortfall > 0 ? "Owner will owe" : "Settled in full"}
                      </dt>
                      <dd
                        className={cn(
                          "font-bold tabular-nums",
                          shortfall > 0 ? "text-warning" : "text-success",
                        )}
                      >
                        {shortfall > 0 ? rupees(shortfall) : "—"}
                      </dd>
                    </div>
                  </dl>
                ) : null}
              </Card>
            </>
          ) : null}

          {step === 8 ? (
            <>
              <Card
                subtitle="Everything on this form, as the owner will see it."
                title="Review"
              >
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {(
                    [
                      ["Hostel", hostelName.trim() || "—"],
                      ["Owner", `${ownerName.trim() || "—"} · ${phone.trim() || "—"}`],
                      [
                        "Where",
                        [area.trim(), city.trim()].filter(Boolean).join(", ") || "—",
                      ],
                      [
                        "Rooms",
                        validRooms.length > 0
                          ? `${capacity.totalRooms} rooms · ${capacity.totalBeds} beds · ${capacity.vacantBeds} vacant`
                          : "—",
                      ],
                      [
                        "Rent",
                        rentRange
                          ? rentRange.min === rentRange.max
                            ? rupees(rentRange.min)
                            : `${rupees(rentRange.min)} – ${rupees(rentRange.max)}`
                          : "—",
                      ],
                      ["Photos", String(photos.filter((p) => p.url).length)],
                      ["Facilities", String(facilities.length)],
                      [
                        "Documents",
                        String(documents.filter((doc) => doc.url).length),
                      ],
                      ["Plan", plan ? `${plan.name} · ${rupees(price)}` : "—"],
                      [
                        "Collected",
                        collecting > 0
                          ? `${rupees(collecting)} · ${method === "CASH" ? "cash" : "QR"}`
                          : "Nothing",
                      ],
                    ] as const
                  ).map(([label, value]) => (
                    <div className="flex justify-between gap-4 text-sm" key={label}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="text-right font-semibold text-foreground">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Card>

              {blocking.length > 0 ? (
                <Card
                  subtitle="These have to be filled in before the hostel can publish."
                  title="Still missing"
                >
                  <ul className="space-y-1.5">
                    {blocking.map((item) => (
                      <li key={item.label}>
                        <button
                          className="text-sm font-semibold text-destructive hover:underline"
                          onClick={() => goTo(item.step)}
                          type="button"
                        >
                          {item.label}
                          <span className="ml-1.5 font-normal text-muted-foreground">
                            {STEPS[item.step - 1].label}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}

              {recommendations.length > 0 ? (
                <Card
                  subtitle="The hostel will publish without these. The listing is thinner for it."
                  title="Worth going back for"
                >
                  <ul className="space-y-1.5">
                    {recommendations.map((item) => (
                      <li key={item.label}>
                        <button
                          className="text-sm font-semibold text-foreground hover:underline"
                          onClick={() => goTo(item.step)}
                          type="button"
                        >
                          {item.label}
                          <span className="ml-1.5 font-normal text-muted-foreground">
                            {STEPS[item.step - 1].label}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-6 py-3 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50"
                  disabled={submitting || uploading || blocking.length > 0}
                  onClick={() => void publish()}
                  type="button"
                >
                  {submitting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Building2 className="size-4" />
                  )}
                  Review and publish
                </button>

                {shortfall > 0 && plan ? (
                  <p className="text-xs text-muted-foreground">
                    {rupees(shortfall)} will show as a due on their dashboard.
                  </p>
                ) : null}
              </div>
            </>
          ) : null}

          {/* Bottom navigation. The last step has its own button. */}
          {step < STEPS.length ? (
            <div className="flex items-center justify-between gap-3 pt-1">
              <button
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted disabled:opacity-40"
                disabled={step === 1}
                onClick={() => goTo(step - 1)}
                type="button"
              >
                <ArrowLeft className="size-4" /> Back
              </button>
              <button
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-bold text-white transition hover:brightness-110"
                onClick={() => goTo(step + 1)}
                type="button"
              >
                Continue <ArrowRight className="size-4" />
              </button>
            </div>
          ) : null}
        </StepFlow>
      </div>

      {confirmDialog}
    </div>
  );
}
