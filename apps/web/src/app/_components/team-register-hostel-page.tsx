"use client";

import { Banknote, Check, Loader2, Plus, QrCode, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { useSiteConfig } from "@/components/site-config-provider";
import { browserApi } from "@/lib/browser-api";
import { uploadFile } from "@/lib/uploads/uploader";
import { cn } from "@/lib/utils";
import { billingCycles, cycleTotal, type BillingCycle } from "./plans-catalog";

/**
 * The field team's registration form.
 *
 * Deliberately **not** the public one. That form is a five-step guided flow with
 * a rail, a preview, and a section of reassurance beside every question, because
 * it is filled in once by somebody who has never seen it and is nervous about
 * handing over their citizenship document.
 *
 * This one is filled in by an agent for the fifteenth time this month, sitting
 * across a desk from the owner, quite possibly on a patchy connection with
 * somebody waiting. So it is one page, dense, tab-ordered, and asks nothing it
 * does not need. Straightforward and clean beats guided when the user already
 * knows the questions by heart.
 *
 * ## The two things this form has that the public one does not
 *
 * The plan is chosen **here**, and the money is taken **here** — because the
 * agent is with the owner and both happen in that conversation. Submitting
 * publishes the hostel immediately; see `registerTeamHostelApplication` for why
 * that is safe on this path and not on the other one.
 */

type RoomRow = {
  bedsPerRoom: string;
  id: string;
  monthlyRent: string;
  rooms: string;
  roomType: string;
  vacantBeds: string;
};

type DocRow = { id: string; name: string; type: string; uploading: boolean; url: string };

const ROOM_TYPES = [
  "Single Room",
  "Double Sharing",
  "Triple Sharing",
  "Four Sharing",
  "Dormitory",
];

const DOC_TYPES = [
  "Ownership proof",
  "Owner ID proof",
  "PAN / VAT document",
  "Hostel license",
  "Bank account details",
  "Rules & policies",
];

const FACILITIES = [
  "Wi-Fi",
  "Study Room",
  "CCTV",
  "Hot Water",
  "Laundry",
  "Meals",
  "Parking",
  "Power Backup",
  "RO Water",
  "Housekeeping",
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

function num(value: string) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function rupees(amount: number) {
  return `Rs ${amount.toLocaleString("en-IN")}`;
}

function Section({
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
      <h2 className="text-sm font-bold text-foreground">{title}</h2>
      {subtitle ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({
  children,
  label,
  required,
}: {
  children: React.ReactNode;
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
    </label>
  );
}

export function TeamRegisterHostelPage() {
  const router = useRouter();
  const { plans: catalog } = useSiteConfig();

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

  const [rooms, setRooms] = useState<RoomRow[]>([newRoom()]);
  const [facilities, setFacilities] = useState<string[]>([]);
  const [customFacility, setCustomFacility] = useState("");
  const [documents, setDocuments] = useState<DocRow[]>([]);

  const [planId, setPlanId] = useState("");
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [method, setMethod] = useState<"CASH" | "SOFTMATO">("CASH");
  const [amount, setAmount] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const cycles = billingCycles(catalog);
  const priced = catalog.plans.filter((plan) => plan.monthly > 0);
  const plan = priced.find((entry) => entry.id === planId);
  const price = plan ? cycleTotal(plan, cycle) : 0;
  const collecting = num(amount) ?? 0;
  const shortfall = Math.max(0, price - collecting);
  const uploading = documents.some((doc) => doc.uploading);
  /** Whatever was typed in — derived, so it cannot drift from what is submitted. */
  const custom = facilities.filter((facility) => !FACILITIES.includes(facility));

  /**
   * Adds a typed facility, matching case-insensitively so "wifi" selects the
   * existing Wi-Fi rather than listing a second one beside it.
   */
  function addFacility() {
    const value = customFacility.trim().replace(/\s+/g, " ");

    if (!value || value.length > 80 || facilities.length >= 40) {
      return;
    }

    const preset = FACILITIES.find(
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!plan) {
      setError("Choose a plan before submitting.");

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

    setSubmitting(true);

    const roomConfigurations = rooms
      .filter((room) => room.roomType.trim() && room.rooms)
      .map((room) => ({
        bedsPerRoom: num(room.bedsPerRoom) ?? 0,
        mealInclusion: "Included" as const,
        monthlyRent: num(room.monthlyRent),
        rooms: num(room.rooms) ?? 0,
        roomType: room.roomType.trim(),
        vacantBeds: num(room.vacantBeds) ?? 0,
      }));

    try {
      const result = await browserApi<{ hostel: { id: string } }>(
        "/api/v1/team/hostels",
        {
          body: JSON.stringify({
            alternatePhone: alternatePhone.trim() || undefined,
            applicant: {
              email: email.trim() || undefined,
              name: ownerName.trim(),
              phone: phone.trim(),
            },
            contact: { email: email.trim() || undefined, phone: phone.trim() },
            description: description.trim() || undefined,
            documents: documents
              .filter((doc) => doc.url)
              .map((doc) => ({ documentType: doc.type, fileUrl: doc.url })),
            facilities,
            hostelType,
            landmark: landmark.trim() || undefined,
            location: {
              address: address.trim() || undefined,
              area: area.trim(),
              city: city.trim(),
            },
            mapLink: mapLink.trim() || undefined,
            name: hostelName.trim(),
            payment: { amount: collecting, method },
            plan: { cycle, planId: plan.id },
            roomConfigurations,
            roomTypes: roomConfigurations.map((room) => room.roomType),
            totalFloors: num(totalFloors),
            yearEstablished: yearEstablished.trim() || undefined,
          }),
          method: "POST",
        },
      );

      router.push(`/team?registered=${result.hostel.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not register this hostel.");
      setSubmitting(false);
    }
  }

  return (
    <form className="max-w-4xl space-y-5" onSubmit={submit}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Register a hostel
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Publishes immediately on submit. Collect what you can — anything short
          becomes a due on the owner&apos;s dashboard.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}

      <Section subtitle="Who owns it and how to reach them." title="Owner">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Owner name" required>
            <input
              className="input-field w-full"
              onChange={(event) => setOwnerName(event.target.value)}
              required
              value={ownerName}
            />
          </Field>
          <Field label="Phone" required>
            <input
              className="input-field w-full"
              onChange={(event) => setPhone(event.target.value)}
              required
              value={phone}
            />
          </Field>
          <Field label="Email">
            <input
              className="input-field w-full"
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              value={email}
            />
            <span className="mt-1 block text-[11px] text-muted-foreground">
              Their invoice, receipt and login go here.
            </span>
          </Field>
          <Field label="Alternate phone">
            <input
              className="input-field w-full"
              onChange={(event) => setAlternatePhone(event.target.value)}
              value={alternatePhone}
            />
          </Field>
        </div>
      </Section>

      <Section title="The hostel">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Hostel name" required>
            <input
              className="input-field w-full"
              onChange={(event) => setHostelName(event.target.value)}
              required
              value={hostelName}
            />
          </Field>
          <Field label="Type">
            <select
              className="input-field w-full"
              onChange={(event) =>
                setHostelType(event.target.value as "BOYS" | "CO_LIVING" | "GIRLS")
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
              maxLength={4}
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
            <Field label="Description">
              <textarea
                className="input-field h-20 w-full py-2"
                onChange={(event) => setDescription(event.target.value)}
                value={description}
              />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Where it is">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Area / locality" required>
            <input
              className="input-field w-full"
              onChange={(event) => setArea(event.target.value)}
              required
              value={area}
            />
          </Field>
          <Field label="City" required>
            <input
              className="input-field w-full"
              onChange={(event) => setCity(event.target.value)}
              required
              value={city}
            />
          </Field>
          <Field label="Address">
            <input
              className="input-field w-full"
              onChange={(event) => setAddress(event.target.value)}
              value={address}
            />
          </Field>
          <Field label="Landmark">
            <input
              className="input-field w-full"
              onChange={(event) => setLandmark(event.target.value)}
              placeholder="Opposite the campus gate"
              value={landmark}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Map link">
              <input
                className="input-field w-full"
                onChange={(event) => setMapLink(event.target.value)}
                placeholder="https://maps.app.goo.gl/…"
                value={mapLink}
              />
            </Field>
          </div>
        </div>
      </Section>

      <Section subtitle="One row per room type." title="Rooms">
        <div className="space-y-2">
          {rooms.map((room) => (
            <div className="flex flex-wrap items-end gap-2" key={room.id}>
              <select
                className="input-field min-w-[9rem] flex-1"
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
                {ROOM_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              {(
                [
                  ["rooms", "Rooms"],
                  ["bedsPerRoom", "Beds/room"],
                  ["vacantBeds", "Vacant"],
                  ["monthlyRent", "Rent"],
                ] as const
              ).map(([key, label]) => (
                <input
                  aria-label={`${room.roomType} — ${label}`}
                  className="input-field w-24"
                  inputMode="numeric"
                  key={key}
                  onChange={(event) =>
                    setRooms((prev) =>
                      prev.map((entry) =>
                        entry.id === room.id
                          ? { ...entry, [key]: event.target.value }
                          : entry,
                      ),
                    )
                  }
                  placeholder={label}
                  value={room[key]}
                />
              ))}
              {rooms.length > 1 ? (
                <button
                  className="rounded-lg border border-border p-2.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                  onClick={() =>
                    setRooms((prev) => prev.filter((entry) => entry.id !== room.id))
                  }
                  type="button"
                >
                  <Trash2 className="size-4" />
                </button>
              ) : null}
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
      </Section>

      <Section title="Facilities">
        <div className="flex flex-wrap gap-2">
          {[...FACILITIES, ...custom].map((facility) => {
            const on = facilities.includes(facility);
            const isCustom = !FACILITIES.includes(facility);

            return (
              <button
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs font-semibold transition",
                  on
                    ? "border-brand-teal bg-brand-teal/10 text-brand-teal"
                    : "border-border text-muted-foreground hover:border-brand-teal/40",
                )}
                key={facility}
                onClick={() =>
                  setFacilities((prev) =>
                    on ? prev.filter((item) => item !== facility) : [...prev, facility],
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

        {/*
          The same typed field the public form has. An agent standing in a
          building sees whatever is actually there, and the preset list is ten
          common cases rather than an inventory.
        */}
        <div className="mt-3 flex gap-2">
          <input
            className="input-field min-w-0 flex-1"
            maxLength={80}
            onChange={(event) => setCustomFacility(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addFacility();
              }
            }}
            placeholder="Anything else — e.g. Rooftop"
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
      </Section>

      <Section subtitle="Whatever the owner handed you." title="Documents">
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
                    setDocuments((prev) => prev.filter((entry) => entry.id !== doc.id))
                  }
                  type="button"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section subtitle="What they are buying." title="Plan">
        <div className="mb-4 inline-flex rounded-lg border border-border bg-muted/50 p-1">
          {cycles.map((option) => (
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
            </button>
          ))}
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {priced.map((entry) => (
            <button
              className={cn(
                "rounded-lg border p-3 text-left transition",
                planId === entry.id
                  ? "border-brand-teal bg-brand-teal/5 ring-1 ring-brand-teal/30"
                  : "border-border hover:border-brand-teal/40",
              )}
              key={entry.id}
              onClick={() => setPlanId(entry.id)}
              type="button"
            >
              <p className="text-sm font-bold text-foreground">{entry.name}</p>
              <p className="mt-1 text-base font-bold tabular-nums text-foreground">
                {rupees(cycleTotal(entry, cycle))}
              </p>
            </button>
          ))}
        </div>
      </Section>

      <Section
        subtitle="Full, part, or nothing — the hostel publishes either way."
        title="Payment"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Method">
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
          </Field>

          <Field label="Amount collected">
            <input
              className="input-field w-full"
              inputMode="numeric"
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0"
              value={amount}
            />
          </Field>
        </div>

        {method === "SOFTMATO" ? (
          <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
            An online payment settles the invoice in <strong>full</strong>, and only
            once the owner has actually paid. Submitting opens a checkout link for
            you to hand over — the hostel publishes now either way, and the balance
            clears when the payment lands, not when you submit.
          </p>
        ) : null}

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
      </Section>

      <div className="flex items-center gap-3 pb-10">
        <button
          className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-6 py-3 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50"
          disabled={submitting || uploading || !plan}
          type="submit"
        >
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          Register and publish
        </button>
        {shortfall > 0 && plan ? (
          <p className="text-xs text-muted-foreground">
            {rupees(shortfall)} will show as a due on their dashboard.
          </p>
        ) : null}
      </div>
    </form>
  );
}
