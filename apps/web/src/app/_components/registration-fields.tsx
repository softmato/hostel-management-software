"use client";

import {
  FileText,
  Image as ImageIcon,
  Loader2,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { acceptAttribute, uploadHint } from "@/lib/uploads/accepts";
import { cn } from "@/lib/utils";

/**
 * The parts of a hostel registration that are the same whoever is filling it in.
 *
 * Two forms collect a hostel now — the public one an owner fills in themselves
 * and the team one an agent fills in beside them — and the *questions* do not
 * change with the desk. The city list, the room types, the document types and
 * the rules templates are facts about hostels in Nepal, not facts about who is
 * typing, so they live here rather than being copied into the second form and
 * then quietly drifting from the first.
 *
 * The uploader is here for the same reason. Both forms need "drop a file, watch
 * it upload, take it away again", and two of those are two chances for one of
 * them to forget the dragging state or the remove button.
 *
 * What is deliberately **not** here is layout. The public form is a guided flow
 * with reassurance beside every question; the team form is a working surface
 * for somebody doing it for the fifteenth time. They share their content and
 * not their manner, and a shared component that tried to serve both would end
 * up with a `variant` prop for every difference.
 */

export const facilityOptions = [
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
  "Common Room",
  "First Aid",
  "Generator",
  "Garden",
  "Personal Cupboard (Daraz)",
  "Personal Table & Chair",
  "Attached Bathroom",
  "Balcony",
  "Bedding & Mattress",
  "Shoe Rack",
  "Iron & Laundry Board",
  "Solar Water Heater",
  "Refrigerator",
  "Gym / Fitness Area",
  "Elevator",
  "Fire Extinguisher",
];

export const cityOptions = [
  "Kathmandu",
  "Lalitpur",
  "Bhaktapur",
  "Pokhara",
  "Butwal",
  "Biratnagar",
  "Dharan",
  "Chitwan",
  "Birgunj",
  "Nepalgunj",
];

export const roomTypeOptions = [
  "Single Room",
  "Double Sharing",
  "Triple Sharing",
  "Four Sharing",
  "Dormitory",
];

export const ID_PROOF_TYPES = [
  "Citizenship",
  "National Identity Card (NID)",
  "Passport",
] as const;

export type IdProofType = (typeof ID_PROOF_TYPES)[number] | "";

/**
 * The paperwork a hostel is asked for, in the order it is usually handed over.
 *
 * Ownership proof leads because it is the one that decides whether the rest is
 * worth reading.
 */
export const DOC_TYPES = [
  "Ownership proof",
  "Owner ID proof",
  "PAN / VAT document",
  "Hostel license",
  "Bank account details",
  "Rules & policies",
];

export type RulesTemplate = { body: string; id: string; name: string; summary: string };

export const RULES_TEMPLATES: RulesTemplate[] = [
  {
    body: [
      "HOSTEL RULES & POLICIES",
      "",
      "1. Entry & Exit",
      "   - Main gate closes at 10:00 PM. Late entry requires prior warden approval.",
      "   - Residents must sign the in/out register when leaving overnight.",
      "",
      "2. Visitors",
      "   - Visitors are allowed only in the common area between 9:00 AM and 7:00 PM.",
      "   - Visitors are not permitted inside resident rooms.",
      "",
      "3. Conduct",
      "   - Smoking, alcohol, and any illegal substances are strictly prohibited.",
      "   - Maintain silence after 10:00 PM to respect fellow residents.",
      "",
      "4. Payments",
      "   - Monthly rent is due within the first 5 days of each month.",
      "   - A one-month security deposit is required at the time of admission.",
      "",
      "5. Property & Safety",
      "   - Residents are responsible for damage to hostel property.",
      "   - Report any maintenance or safety issue to the warden immediately.",
    ].join("\n"),
    id: "standard",
    name: "Standard House Rules",
    summary: "General discipline, timings, visitors, and payment terms.",
  },
  {
    body: [
      "HOSTEL RULES & POLICIES (STUDENT / STRICT)",
      "",
      "1. Study Environment",
      "   - Study hours 7:00 PM - 9:00 PM are strictly quiet hours.",
      "   - No loud music or gatherings on weekdays.",
      "",
      "2. Timings",
      "   - Gate closes at 9:00 PM on weekdays, 10:00 PM on weekends.",
      "   - Attendance is taken every night; guardians are notified of absences.",
      "",
      "3. Visitors & Guests",
      "   - Opposite-gender visitors are not allowed beyond the reception.",
      "   - Overnight guests are not permitted.",
      "",
      "4. Prohibited",
      "   - Smoking, alcohol, drugs, and weapons are strictly banned.",
      "   - Cooking inside rooms is not allowed.",
      "",
      "5. Discipline",
      "   - Repeated violations may lead to termination of accommodation.",
      "   - Rent must be cleared by the 5th of every month.",
    ].join("\n"),
    id: "student-strict",
    name: "Student Hostel (Strict)",
    summary: "Stricter timings, study hours, and guardian notifications.",
  },
  {
    body: [
      "HOSTEL RULES & POLICIES (FLEXIBLE / WORKING PROFESSIONALS)",
      "",
      "1. Access",
      "   - 24/7 access with secure keycard/biometric entry.",
      "   - Please be considerate of others when returning late.",
      "",
      "2. Common Areas",
      "   - Kitchen and lounge are shared - clean up after use.",
      "   - Quiet hours are observed from 11:00 PM to 6:00 AM.",
      "",
      "3. Visitors",
      "   - Guests are welcome in common areas until 9:00 PM.",
      "   - Inform reception in advance for any guest.",
      "",
      "4. Payments",
      "   - Rent is due by the 7th of each month.",
      "   - One-month deposit, refundable on proper checkout with notice.",
      "",
      "5. Community",
      "   - No smoking indoors; designated areas only.",
      "   - Respect shared spaces and fellow residents.",
    ].join("\n"),
    id: "flexible",
    name: "Working Professionals (Flexible)",
    summary: "24/7 access, shared spaces, lighter restrictions.",
  },
];

export type UploadedFile = {
  id: string;
  name: string;
  uploading?: boolean;
  url: string;
};

/** Rupees as they are written on a receipt here. */
export function rupees(amount: number) {
  return `Rs ${amount.toLocaleString("en-IN")}`;
}

/**
 * A typed number, or nothing.
 *
 * Empty and unparseable both return `undefined` rather than 0, because a blank
 * "vacant beds" means the agent has not asked yet and a zero means they asked
 * and the answer was none. Storing the first as the second loses the question.
 */
export function numberValue(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/** One document slot: what it is on the left, its uploader on the right. */
export function DocRow({
  children,
  desc,
  icon: Icon,
  title,
}: {
  children: React.ReactNode;
  desc: string;
  icon: LucideIcon;
  title: React.ReactNode;
}) {
  return (
    <div className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-[1fr_1.2fr] md:items-center">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-teal/10 text-brand-teal">
          <Icon className="size-5" />
        </span>
        <div>
          <p className="text-sm font-bold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}

export function FileUploadArea({
  accept = acceptAttribute("document"),
  files,
  hint,
  label = "Upload file",
  maxFiles = 1,
  onFileSelect,
  onFilesDropped,
  onRemove,
}: {
  accept?: string;
  files: UploadedFile[];
  hint?: string;
  label?: string;
  maxFiles?: number;
  onFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  onFilesDropped?: (files: File[]) => Promise<void>;
  onRemove: (id: string) => void;
}) {
  const canAdd = files.length < maxFiles;
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div className="space-y-2">
      {files.map((file) => (
        <div
          className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2"
          key={file.id}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            {file.uploading ? (
              <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-teal/10 text-brand-teal">
                {/\.(jpe?g|png|webp)/i.test(file.name) ? (
                  <ImageIcon className="size-4" />
                ) : (
                  <FileText className="size-4" />
                )}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-foreground">
                {file.name}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {file.uploading ? "Uploading…" : "Uploaded"}
              </p>
            </div>
          </div>
          <button
            className="ml-2 shrink-0 rounded-md p-1 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onRemove(file.id)}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}

      {canAdd ? (
        <label
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border px-4 py-4 text-center transition hover:border-brand-teal hover:bg-brand-teal/5",
            isDragging && "border-solid border-brand-teal bg-brand-teal/5",
          )}
          onDragLeave={() => setIsDragging(false)}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            void onFilesDropped?.(Array.from(event.dataTransfer.files ?? []));
          }}
        >
          <Upload className="size-4 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">
            {isDragging ? "Drop to upload" : label}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {hint ?? uploadHint("document", accept)}
          </span>
          <input
            accept={accept}
            className="sr-only"
            hidden
            multiple={maxFiles > 1}
            onChange={onFileSelect}
            type="file"
          />
        </label>
      ) : null}
    </div>
  );
}
