"use client";

import {
  Camera,
  Check,
  Copy,
  Download,
  Loader2,
  QrCode,
  RotateCw,
  ShieldCheck,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { PhotoCropper } from "@/components/photo-cropper";
import { useSiteConfig } from "@/components/site-config-provider";
import { refreshSession } from "@/lib/auth-refresh";
import { acceptAttribute, uploadHint } from "@/lib/uploads/accepts";
import { uploadFile } from "@/lib/uploads/uploader";
import { ApiRequestError, browserApi } from "@/lib/browser-api";
import {
  loadCardImage,
  paintIdCard,
  idCardNoun,
  renderIdCardSheet,
  type IdCardData,
  type PlatformIdCardType,
} from "@/lib/platform-id-card";
import { cn } from "@/lib/utils";

/*
 * The resident identity is the "fill it once" personal profile behind a user's
 * QR code / resident ID. Two surfaces live here:
 *
 *   - the ID card modal, opened from the header account menu
 *   - the profile form, opened either from the QR modal or by a prompt after a
 *     visitor sends an inquiry / browses several hostels
 *
 * Any component can open either one without prop-drilling, via the two request*
 * helpers below. Both modals portal to document.body so a transformed or
 * overflow-hidden ancestor cannot clip them.
 */

const QR_EVENT = "hh:resident-qr";
const FORM_EVENT = "hh:resident-profile-form";
/** Fired whenever the identity modal writes — lets embedded views refresh. */
const CHANGED_EVENT = "hh:resident-identity-changed";
const SNOOZE_KEY = "hh:resident-profile-prompt-until";
const SNOOZE_DAYS = 7;

export type ProfilePromptReason = "BROWSING" | "INQUIRY" | "MANUAL";

export function requestResidentQr() {
  window.dispatchEvent(new CustomEvent(QR_EVENT));
}

function broadcastIdentityChange() {
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
}

export function requestResidentProfileForm(reason: ProfilePromptReason = "MANUAL") {
  window.dispatchEvent(new CustomEvent(FORM_EVENT, { detail: { reason } }));
}

/**
 * Opens the profile prompt unless the visitor dismissed one in the last week.
 * Use this for automatic triggers; `requestResidentProfileForm` for taps.
 */
export function maybePromptForResidentProfile(reason: ProfilePromptReason) {
  try {
    const until = Number(window.localStorage.getItem(SNOOZE_KEY) ?? 0);

    if (Number.isFinite(until) && until > Date.now()) {
      return;
    }
  } catch {
    // Private mode / storage disabled — prompting is still the right default.
  }

  requestResidentProfileForm(reason);
}

function snoozePrompt() {
  try {
    window.localStorage.setItem(
      SNOOZE_KEY,
      String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000),
    );
  } catch {
    // Non-fatal: the prompt will simply appear again next time.
  }
}

/* ── Types mirroring /api/v1/users/resident-identity ── */

type ResidentIdentity = {
  accountEmail: string | null;
  accountName: string;
  /** Which card variant this account holds — derived by the server. */
  cardType?: PlatformIdCardType;
  /** Printed under the name. Null for residents, who use their own profile. */
  cardRole?: string | null;
  hasPhoto: boolean;
  hasProfile: boolean;
  lastSharedAt: string | null;
  photoUpdatedAt: string | null;
  residentId: string | null;
  shareCount: number;
  shareUrl: string | null;
  sharingEnabled: boolean;
  updatedAt: string | null;
};

type ResidentProfile = {
  age?: number | null;
  alternatePhone?: string;
  backupEmail?: string;
  bloodGroup: string;
  budgetRange?: string;
  city?: string;
  courseOrDesignation?: string;
  dateOfBirth?: string;
  dietaryPreference: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
  fullName: string;
  gender: string;
  governmentIdNumber?: string;
  governmentIdType?: string;
  guardianEmail?: string;
  guardianName: string;
  guardianPhone: string;
  guardianRelation: string;
  institution?: string;
  interests: string[];
  medicalNotes?: string;
  occupation: string;
  permanentAddress?: string;
  primaryEmail: string;
  primaryPhone: string;
  province?: string;
  secondGuardianEmail?: string;
  secondGuardianName?: string;
  secondGuardianPhone?: string;
  secondGuardianRelation?: string;
};

type IdentityResponse = {
  identity: ResidentIdentity;
  profile: ResidentProfile | null;
};

/* ── Small building blocks (public-site styling: brand-teal) ── */

function Modal({
  children,
  onClose,
  subtitle,
  title,
  wide,
}: {
  children: ReactNode;
  onClose: () => void;
  subtitle?: string;
  title: string;
  wide?: boolean;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div aria-hidden className="absolute inset-0" onClick={onClose} />
      <div
        aria-modal
        className={cn(
          "relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-2xl sm:rounded-2xl",
          wide ? "sm:max-w-5xl" : "sm:max-w-md",
        )}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <h2 className="font-heading text-lg font-extrabold text-foreground">
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-1 text-sm leading-relaxed text-foreground/90">
                {subtitle}
              </p>
            ) : null}
          </div>
          <button
            aria-label="Close"
            className="rounded-md p-1.5 text-foreground transition hover:bg-muted"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function Field({
  defaultValue,
  hint,
  label,
  max,
  name,
  placeholder,
  readOnly,
  required,
  type = "text",
}: {
  defaultValue?: string;
  hint?: string;
  label: string;
  max?: string;
  name: string;
  placeholder?: string;
  readOnly?: boolean;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block text-xs font-bold text-foreground">
      {label}
      {required ? <span className="text-danger"> *</span> : null}
      <input
        className={cn(
          "mt-1.5 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal text-foreground outline-none transition placeholder:text-foreground/45 focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/15",
          readOnly && "cursor-not-allowed bg-muted/50",
        )}
        defaultValue={defaultValue}
        max={max}
        name={name}
        placeholder={placeholder}
        readOnly={readOnly}
        required={required}
        type={type}
      />
      {hint ? (
        <span className="mt-1 block text-xs font-medium text-foreground/75">{hint}</span>
      ) : null}
    </label>
  );
}

function SelectField({
  children,
  defaultValue,
  label,
  name,
  required,
}: {
  children: ReactNode;
  defaultValue?: string;
  label: string;
  name: string;
  required?: boolean;
}) {
  return (
    <label className="block text-xs font-bold text-foreground">
      {label}
      {required ? <span className="text-danger"> *</span> : null}
      <select
        className="mt-1.5 h-11 w-full cursor-pointer rounded-lg border border-border bg-background px-3 text-sm font-normal text-foreground outline-none transition focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/15"
        defaultValue={defaultValue}
        name={name}
        required={required}
      >
        {children}
      </select>
    </label>
  );
}

function SectionTitle({
  hint,
  icon: Icon,
  label,
}: {
  hint?: string;
  icon?: LucideIcon;
  label: string;
}) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border pb-2 text-xs font-extrabold uppercase tracking-wide text-foreground">
      {Icon ? <Icon className="size-3.5 text-brand-teal" /> : null}
      {label}
      {hint ? (
        <span className="font-medium normal-case tracking-normal text-foreground/55">
          {hint}
        </span>
      ) : null}
    </p>
  );
}

/**
 * A 422 from the API carries `details` = ZodError.flatten(). Surfacing the field
 * name matters: "Could not save your details" on a form this long leaves the
 * user hunting through nine sections for the problem.
 */
function describeSaveError(error: unknown) {
  const fallback = "Could not save your details.";

  if (!(error instanceof ApiRequestError)) {
    return error instanceof Error ? error.message : fallback;
  }

  const details = error.details as
    | { formErrors?: string[]; issues?: { message: string; path: string }[] }
    | undefined;

  const problems = [
    ...(details?.formErrors ?? []),
    ...(details?.issues ?? []).map((issue) => {
      // Paths arrive as `profile.backupEmail`; the leaf is the input name.
      const field = issue.path.split(".").filter(Boolean).pop() ?? "";
      const label = FIELD_LABELS[field];

      // Cross-field rules (the two-email check) already read as full sentences,
      // so a label prefix would only make them clumsier.
      return label && field !== "profile" ? `${label}: ${issue.message}` : issue.message;
    }),
  ];

  return problems.length > 0
    ? Array.from(new Set(problems)).join(" · ")
    : error.message || fallback;
}

/** Maps schema keys back to the labels shown on the form. */
const FIELD_LABELS: Record<string, string> = {
  backupEmail: "Backup email",
  bloodGroup: "Blood group",
  dateOfBirth: "Date of birth",
  fullName: "Full name",
  gender: "Gender",
  governmentIdNumber: "ID number",
  governmentIdType: "ID type",
  guardianEmail: "Guardian email",
  guardianName: "Guardian name",
  guardianPhone: "Guardian phone",
  guardianRelation: "Guardian relation",
  interests: "Interests",
  medicalNotes: "Allergies or medical notes",
  primaryEmail: "Account email",
  primaryPhone: "Phone",
  profile: "Profile",
  secondGuardianEmail: "Second guardian email",
  secondGuardianPhone: "Second guardian phone",
};

/* ── The one-time profile form ── */

const PROMPT_COPY: Record<ProfilePromptReason, { subtitle: string; title: string }> = {
  BROWSING: {
    subtitle:
      "You have looked at a few hostels. Save your details once and every hostel you apply to can fill their form by scanning your code — you never type this again.",
    title: "Set up your resident ID",
  },
  INQUIRY: {
    subtitle:
      "Your inquiry is on its way. Save your details once now and the hostel can complete your registration by scanning your code instead of asking you to fill another form.",
    title: "Save your details once",
  },
  MANUAL: {
    subtitle:
      "Stored encrypted and shared only when you show your QR code or give someone your resident ID.",
    title: "Your resident details",
  },
};

function ProfileForm({
  identity,
  onClose,
  onSaved,
  profile,
  reason,
}: {
  identity: ResidentIdentity;
  onClose: () => void;
  onSaved: (next: IdentityResponse) => void;
  profile: ResidentProfile | null;
  reason: ProfilePromptReason;
}) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showSecondGuardian, setShowSecondGuardian] = useState(
    Boolean(profile?.secondGuardianName),
  );
  const errorRef = useRef<HTMLDivElement>(null);
  const copy = PROMPT_COPY[reason];

  // The form is long enough that a message at the top can land off-screen after
  // a failed submit from the bottom. Bring it into view and move focus to it, so
  // it is announced to screen readers rather than silently rendered.
  useEffect(() => {
    if (!error) {
      return;
    }

    errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    errorRef.current?.focus({ preventScroll: true });
  }, [error]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const form = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value.trim() : "";
    };
    const optional = (name: string) => text(name) || undefined;

    setSaving(true);

    try {
      const next = await browserApi<IdentityResponse>("/api/v1/users/resident-identity", {
        body: JSON.stringify({
          profile: {
            alternatePhone: optional("alternatePhone"),
            backupEmail: optional("backupEmail"),
            bloodGroup: text("bloodGroup"),
            budgetRange: optional("budgetRange"),
            city: optional("city"),
            courseOrDesignation: optional("courseOrDesignation"),
            dateOfBirth: optional("dateOfBirth"),
            dietaryPreference: text("dietaryPreference"),
            emergencyContactName: optional("emergencyContactName"),
            emergencyContactPhone: optional("emergencyContactPhone"),
            emergencyContactRelation: optional("emergencyContactRelation"),
            fullName: text("fullName"),
            gender: text("gender"),
            governmentIdNumber: optional("governmentIdNumber"),
            governmentIdType: optional("governmentIdType"),
            guardianEmail: optional("guardianEmail"),
            guardianName: text("guardianName"),
            guardianPhone: text("guardianPhone"),
            guardianRelation: text("guardianRelation"),
            institution: optional("institution"),
            interests: text("interests")
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean)
              .slice(0, 12),
            medicalNotes: optional("medicalNotes"),
            occupation: text("occupation"),
            permanentAddress: optional("permanentAddress"),
            primaryEmail: text("primaryEmail"),
            primaryPhone: text("primaryPhone"),
            province: optional("province"),
            secondGuardianEmail: optional("secondGuardianEmail"),
            secondGuardianName: optional("secondGuardianName"),
            secondGuardianPhone: optional("secondGuardianPhone"),
            secondGuardianRelation: optional("secondGuardianRelation"),
          },
          sharingEnabled: form.get("sharingEnabled") === "on",
        }),
        method: "PUT",
      });

      onSaved(next);
    } catch (saveError) {
      setError(describeSaveError(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} subtitle={copy.subtitle} title={copy.title} wide>
      <form className="space-y-6" onSubmit={handleSubmit}>
        <div className="flex gap-3 rounded-xl border border-brand-teal/25 bg-brand-teal-soft/35 p-4">
          <ShieldCheck className="size-5 shrink-0 text-brand-teal" />
          <p className="text-sm leading-relaxed text-foreground">
            Everything below is encrypted before it is stored. Nobody can read it from
            your resident ID alone — a hostel only receives it when you show them your QR
            code or hand over your ID, and you can switch sharing off at any time.
          </p>
        </div>

        {error ? (
          <div
            aria-live="assertive"
            className="rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm font-semibold text-danger outline-none ring-danger/30 focus-visible:ring-2"
            ref={errorRef}
            role="alert"
            tabIndex={-1}
          >
            {error}
          </div>
        ) : null}

        <div className="space-y-3">
          <SectionTitle label="About you" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              defaultValue={profile?.fullName ?? identity.accountName}
              label="Full name"
              name="fullName"
              placeholder="As written on your ID"
              required
            />
            <Field
              defaultValue={profile?.dateOfBirth}
              hint="Used to show your age to the hostel."
              label="Date of birth"
              max={new Date().toISOString().slice(0, 10)}
              name="dateOfBirth"
              type="date"
            />
            <SelectField
              defaultValue={profile?.gender ?? ""}
              label="Gender"
              name="gender"
              required
            >
              <option disabled value="">
                Select gender
              </option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
              <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
            </SelectField>
            <SelectField
              defaultValue={profile?.bloodGroup ?? "UNKNOWN"}
              label="Blood group"
              name="bloodGroup"
            >
              {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
              <option value="UNKNOWN">I do not know</option>
            </SelectField>
          </div>
        </div>

        <div className="space-y-3">
          <SectionTitle label="How to reach you" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              defaultValue={profile?.primaryPhone}
              label="Phone"
              name="primaryPhone"
              placeholder="98XXXXXXXX"
              required
              type="tel"
            />
            <Field
              defaultValue={profile?.alternatePhone}
              label="Alternate phone"
              name="alternatePhone"
              placeholder="Optional"
              type="tel"
            />
            <Field
              defaultValue={profile?.primaryEmail ?? identity.accountEmail ?? ""}
              hint="This is your sign-in email and cannot be changed here."
              label="Account email"
              name="primaryEmail"
              readOnly={Boolean(identity.accountEmail)}
              required
              type="email"
            />
            <Field
              defaultValue={profile?.backupEmail}
              hint="A second email in case we cannot reach the first."
              label="Backup email"
              name="backupEmail"
              placeholder="Optional"
              type="email"
            />
          </div>
        </div>

        <div className="space-y-3">
          <SectionTitle label="Where you are from" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              defaultValue={profile?.permanentAddress}
              label="Permanent address"
              name="permanentAddress"
              placeholder="Street / tole, ward"
            />
            <Field defaultValue={profile?.city} label="City" name="city" />
            <Field
              defaultValue={profile?.province}
              label="Province / state"
              name="province"
            />
          </div>
        </div>

        <div className="space-y-3">
          {/*
            Nothing in this section is required — plenty of residents are just
            living here. The hint and the spelled-out "neither" option exist so
            the form says that, instead of leaving people to guess from the
            absence of an asterisk.
          */}
          <SectionTitle hint="Optional — skip it if neither applies" label="Study or work" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SelectField
              defaultValue={profile?.occupation ?? "STUDENT"}
              label="I am a"
              name="occupation"
            >
              <option value="STUDENT">Student</option>
              <option value="WORKING_PROFESSIONAL">Working professional</option>
              <option value="OTHER">Neither — just living here</option>
            </SelectField>
            <Field
              defaultValue={profile?.institution}
              hint="Leave blank if this does not apply."
              label="College / company"
              name="institution"
            />
            <Field
              defaultValue={profile?.courseOrDesignation}
              label="Course / job title"
              name="courseOrDesignation"
            />
          </div>
        </div>

        <div className="space-y-3">
          <SectionTitle label="Guardian" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              defaultValue={profile?.guardianName}
              label="Guardian name"
              name="guardianName"
              required
            />
            <Field
              defaultValue={profile?.guardianRelation}
              label="Relation"
              name="guardianRelation"
              placeholder="Father, mother, uncle…"
              required
            />
            <Field
              defaultValue={profile?.guardianPhone}
              label="Guardian phone"
              name="guardianPhone"
              required
              type="tel"
            />
            <Field
              defaultValue={profile?.guardianEmail}
              hint="Lets the hostel invite them to the guardian portal."
              label="Guardian email"
              name="guardianEmail"
              type="email"
            />
          </div>

          {showSecondGuardian ? (
            <div className="grid gap-4 rounded-xl border border-border bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field
                defaultValue={profile?.secondGuardianName}
                label="Second guardian name"
                name="secondGuardianName"
              />
              <Field
                defaultValue={profile?.secondGuardianRelation}
                label="Relation"
                name="secondGuardianRelation"
              />
              <Field
                defaultValue={profile?.secondGuardianPhone}
                label="Second guardian phone"
                name="secondGuardianPhone"
                type="tel"
              />
              <Field
                defaultValue={profile?.secondGuardianEmail}
                label="Second guardian email"
                name="secondGuardianEmail"
                type="email"
              />
            </div>
          ) : (
            <button
              className="text-xs font-bold text-brand-teal transition hover:underline"
              onClick={() => setShowSecondGuardian(true)}
              type="button"
            >
              + Add a second guardian
            </button>
          )}
        </div>

        <div className="space-y-3">
          <SectionTitle label="Emergency contact" />
          <p className="text-sm text-foreground">
            Leave blank to use your guardian as the emergency contact.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              defaultValue={profile?.emergencyContactName}
              label="Name"
              name="emergencyContactName"
            />
            <Field
              defaultValue={profile?.emergencyContactRelation}
              label="Relation"
              name="emergencyContactRelation"
            />
            <Field
              defaultValue={profile?.emergencyContactPhone}
              label="Phone"
              name="emergencyContactPhone"
              type="tel"
            />
          </div>
        </div>

        <div className="space-y-3">
          <SectionTitle label="Stay preferences and safety" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SelectField
              defaultValue={profile?.dietaryPreference ?? "NO_PREFERENCE"}
              label="Food preference"
              name="dietaryPreference"
            >
              <option value="NO_PREFERENCE">No preference</option>
              <option value="VEG">Vegetarian</option>
              <option value="NON_VEG">Non-vegetarian</option>
              <option value="EGGETARIAN">Eggetarian</option>
              <option value="VEGAN">Vegan</option>
            </SelectField>
            <Field
              defaultValue={profile?.budgetRange}
              hint="Prefills your future inquiries."
              label="Monthly budget"
              name="budgetRange"
              placeholder="8000-12000"
            />
          </div>
          <Field
            defaultValue={profile?.interests?.join(", ")}
            hint="Comma separated. Used for roommate and hostel suggestions."
            label="Interests"
            name="interests"
            placeholder="Football, music, coding"
          />
          <label className="block text-xs font-bold text-foreground">
            Allergies or medical notes
            <textarea
              className="mt-1.5 min-h-20 w-full rounded-lg border border-border bg-background p-3 text-sm font-normal text-foreground outline-none transition placeholder:text-foreground/45 focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/15"
              defaultValue={profile?.medicalNotes}
              maxLength={500}
              name="medicalNotes"
              placeholder="Anything the hostel should know in an emergency."
            />
          </label>
        </div>

        <div className="space-y-3">
          <SectionTitle label="Government ID" />
          <p className="text-sm text-foreground">
            Hostels are required to record one. Filling it here means you do not have to
            read it out at the desk.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SelectField
              defaultValue={profile?.governmentIdType ?? ""}
              label="ID type"
              name="governmentIdType"
            >
              <option value="">Not now</option>
              <option value="CITIZENSHIP">Citizenship</option>
              <option value="NATIONAL_ID">National ID</option>
              <option value="PASSPORT">Passport</option>
              <option value="DRIVING_LICENSE">Driving license</option>
              <option value="STUDENT_ID">Student ID</option>
              <option value="OTHER">Other</option>
            </SelectField>
            <Field
              defaultValue={profile?.governmentIdNumber}
              label="ID number"
              name="governmentIdNumber"
            />
          </div>
        </div>

        <label className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/20 p-3">
          <input
            className="mt-0.5 size-4 cursor-pointer rounded border-border"
            defaultChecked={identity.sharingEnabled}
            name="sharingEnabled"
            type="checkbox"
          />
          <span className="text-sm leading-relaxed text-foreground">
            Let a hostel load these details when I show them my QR code or give them my
            resident ID. You can turn this off later and your data stays saved.
          </span>
        </label>

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <button
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-brand-teal text-sm font-bold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60"
            disabled={saving}
            type="submit"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {saving ? "Saving…" : "Save my details"}
          </button>
          <button
            className="inline-flex h-11 items-center justify-center rounded-lg border border-border px-5 text-sm font-bold text-foreground transition hover:bg-muted sm:flex-none"
            onClick={() => {
              snoozePrompt();
              onClose();
            }}
            type="button"
          >
            Not now
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ── The ID card modal ── */

const OCCUPATION_LABELS: Record<string, string> = {
  OTHER: "Resident",
  STUDENT: "Student",
  WORKING_PROFESSIONAL: "Working professional",
};

function formatCardDate(value?: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

/**
 * The card's field mapping, shared by the modal and the in-portal preview so
 * the two can never drift into printing different cards for the same person.
 */
function buildIdCardData(
  identity: ResidentIdentity,
  profile: ResidentProfile | null,
  images: { photo: HTMLImageElement | null; qr: HTMLImageElement | null },
  brandName: string,
): IdCardData {
  return {
    brandName,
    cardType: identity.cardType ?? "RESIDENT",
    // "UNKNOWN" is the schema's placeholder, not something to print on a card
    // that a paramedic might read.
    bloodGroup:
      profile?.bloodGroup && profile.bloodGroup !== "UNKNOWN" ? profile.bloodGroup : null,
    dateOfBirth: formatCardDate(profile?.dateOfBirth),
    email: profile?.primaryEmail ?? identity.accountEmail,
    fullName: profile?.fullName ?? identity.accountName,
    issuedOn: formatCardDate(identity.updatedAt ?? new Date().toISOString()),
    phone: profile?.primaryPhone,
    photo: images.photo,
    qr: images.qr,
    residentId: identity.residentId ?? "—",
    // An approved provider's trade (or "Hostel Owner") outranks the resident
    // profile's course/occupation — it is what the card is now for.
    role:
      identity.cardRole ||
      profile?.courseOrDesignation ||
      profile?.institution ||
      OCCUPATION_LABELS[profile?.occupation ?? ""] ||
      "Resident",
    siteLabel: typeof window === "undefined" ? "" : window.location.host,
  };
}

/** Same-origin URL of the stored photo, cache-busted by its last write. */
function identityPhotoUrl(identity: ResidentIdentity) {
  return identity.hasPhoto
    ? `/api/v1/users/resident-identity/photo?v=${encodeURIComponent(
        identity.photoUpdatedAt ?? "1",
      )}`
    : null;
}

function IdCardPanel({
  identity,
  onClose,
  onEdit,
  onIdentityChange,
  onSharingChange,
  profile,
}: {
  identity: ResidentIdentity;
  onClose: () => void;
  onEdit: () => void;
  onIdentityChange: (next: IdentityResponse) => void;
  onSharingChange: (enabled: boolean) => void;
  profile: ResidentProfile | null;
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [images, setImages] = useState<{
    photo: HTMLImageElement | null;
    qr: HTMLImageElement | null;
  }>({ photo: null, qr: null });
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [togglingShare, setTogglingShare] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [face, setFace] = useState<"back" | "front">("front");
  const [paused, setPaused] = useState(false);

  const frontRef = useRef<HTMLCanvasElement>(null);
  const backRef = useRef<HTMLCanvasElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  /*
   * The just-cropped bitmap, kept so the card can repaint the instant the user
   * confirms the crop rather than waiting on the upload plus a round trip. It
   * also covers the server copy: if the proxy read fails, the card keeps showing
   * the photo the user actually chose instead of dropping back to initials.
   */
  const localPhotoRef = useRef<HTMLImageElement | null>(null);

  /*
   * The imperative uploader, not the useUploader hook: this field keeps no file
   * list of its own (the photo lives on the profile), and the hook's one-file
   * cap would reject every photo after the first. Progress still renders in the
   * global toaster either way.
   */
  async function uploadPhoto(file: File) {
    // PRIVATE: a resident's face is personal data, so the bytes stay behind the
    // authenticated proxy rather than sitting on a public bucket URL.
    return uploadFile(file, {
      accessLevel: "PRIVATE",
      kind: "image",
      label: "ID card photo",
      silent: true,
      target: "asset",
    });
  }

  const photoUrl = identityPhotoUrl(identity);

  useEffect(() => {
    let active = true;

    async function loadQr() {
      try {
        const data = await browserApi<{ qrDataUrl: string | null }>(
          "/api/v1/users/resident-identity/qr",
        );

        if (active) {
          setQrDataUrl(data.qrDataUrl);
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not build your QR code.",
          );
        }
      }
    }

    void loadQr();

    return () => {
      active = false;
    };
  }, []);

  // Both bitmaps have to be decoded, and the webfonts loaded, before the first
  // paint — otherwise the card renders once in a fallback face and again in the
  // real one, which reads as a flicker.
  useEffect(() => {
    let active = true;

    async function loadImages() {
      const [photo, qr] = await Promise.all([
        loadCardImage(photoUrl),
        loadCardImage(qrDataUrl),
      ]);

      await document.fonts?.ready?.catch?.(() => undefined);

      if (!active) {
        return;
      }

      // A saved photo that will not load is a real fault, not a styling detail —
      // say so instead of quietly rendering initials.
      if (photoUrl && !photo && !localPhotoRef.current) {
        setError("Your saved photo could not be loaded. Try uploading it again.");
      }

      setImages({ photo: photo ?? localPhotoRef.current, qr });
    }

    void loadImages();

    return () => {
      active = false;
    };
  }, [photoUrl, qrDataUrl]);

  const siteName = useSiteConfig().identity.siteName;
  const cardData = useMemo<IdCardData>(
    () => buildIdCardData(identity, profile, images, siteName),
    [identity, images, profile, siteName],
  );

  useEffect(() => {
    if (frontRef.current) {
      paintIdCard(frontRef.current, cardData, "front");
    }

    if (backRef.current) {
      paintIdCard(backRef.current, cardData, "back");
    }
  }, [cardData]);

  /*
   * The card shows itself off on its own: front for 5s, back for 3s, repeat.
   * Tapping the flip button restarts the cycle from whichever face was chosen,
   * and hovering pauses it so nobody has the back pulled away mid-read.
   */
  useEffect(() => {
    if (paused) {
      return;
    }

    const timer = window.setTimeout(
      () => setFace((current) => (current === "front" ? "back" : "front")),
      face === "front" ? 5000 : 3000,
    );

    return () => window.clearTimeout(timer);
  }, [face, paused]);

  /** Picking a file only opens the cropper — nothing uploads until it is framed. */
  function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Cleared straight away so re-picking the same file still fires a change.
    input.value = "";

    if (file) {
      setError("");
      setPendingFile(file);
    }
  }

  async function handleCropped(cropped: File) {
    setPendingFile(null);
    setError("");
    setSavingPhoto(true);

    // Paint it first, upload second: the card updates the moment the crop is
    // confirmed, so the upload never looks like it did nothing.
    const preview = await loadCardImage(URL.createObjectURL(cropped));

    if (preview) {
      localPhotoRef.current = preview;
      setImages((current) => ({ ...current, photo: preview }));
    }

    try {
      const uploaded = await uploadPhoto(cropped);

      // A rejected file already surfaced through the global toaster.
      if (!uploaded?.assetId) {
        setError("That photo could not be uploaded. Please try another one.");
        return;
      }

      onIdentityChange(
        await browserApi<IdentityResponse>("/api/v1/users/resident-identity/photo", {
          body: JSON.stringify({ photoAssetId: uploaded.assetId }),
          method: "PUT",
        }),
      );
    } catch (photoError) {
      setError(
        photoError instanceof Error
          ? photoError.message
          : "Could not add that photo to your card.",
      );
    } finally {
      setSavingPhoto(false);
    }
  }

  async function handleRemovePhoto() {
    setError("");
    setSavingPhoto(true);
    localPhotoRef.current = null;
    setImages((current) => ({ ...current, photo: null }));

    try {
      onIdentityChange(
        await browserApi<IdentityResponse>("/api/v1/users/resident-identity/photo", {
          method: "DELETE",
        }),
      );
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : "Could not remove your photo.",
      );
    } finally {
      setSavingPhoto(false);
    }
  }

  async function handleDownload() {
    setError("");
    setDownloading(true);

    try {
      const blob = await renderIdCardSheet(cardData);

      if (!blob) {
        setError("Could not build the image. Please try again.");
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `hostelhub-id-card-${identity.residentId ?? "card"}.png`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Could not download the card on this browser.");
    } finally {
      setDownloading(false);
    }
  }

  async function handleCopy() {
    if (!identity.residentId) {
      return;
    }

    try {
      await navigator.clipboard.writeText(identity.residentId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy — select the ID and copy it manually.");
    }
  }

  async function handleToggleSharing() {
    setTogglingShare(true);

    try {
      const next = await browserApi<IdentityResponse>("/api/v1/users/resident-identity", {
        body: JSON.stringify({ sharingEnabled: !identity.sharingEnabled }),
        method: "PATCH",
      });

      onSharingChange(next.identity.sharingEnabled);
    } catch (toggleError) {
      setError(
        toggleError instanceof Error ? toggleError.message : "Could not change sharing.",
      );
    } finally {
      setTogglingShare(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      subtitle={
        cardData.cardType === "RESIDENT"
          ? "Show this to a hostel and they can fill your registration without asking you to write anything down."
          : "Show this at a hostel to confirm who you are. Your ID stays the same as before."
      }
      title={`My ${idCardNoun(cardData.cardType)} ID card`}
    >
      {pendingFile ? (
        <PhotoCropper
          file={pendingFile}
          onCancel={() => setPendingFile(null)}
          onCropped={handleCropped}
        />
      ) : null}

      <div className="space-y-5">
        {error ? (
          <div className="rounded-lg border border-danger/25 bg-danger/5 p-3 text-xs font-semibold text-danger">
            {error}
          </div>
        ) : null}

        <div className="mx-auto w-full max-w-[300px] space-y-3">
          <div
            className="[perspective:1600px]"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <div
              className={cn(
                "relative aspect-[640/1000] w-full transition-transform duration-700 ease-[cubic-bezier(0.4,0,0.2,1)] [transform-style:preserve-3d]",
                face === "back" && "[transform:rotateY(180deg)]",
              )}
            >
              <canvas
                aria-label={`Front of your ${siteName} ${idCardNoun(cardData?.cardType)} ID card`}
                className="absolute inset-0 size-full rounded-2xl shadow-lg [backface-visibility:hidden]"
                ref={frontRef}
                role="img"
              />
              <canvas
                aria-label={`Back of your ${siteName} ${idCardNoun(cardData?.cardType)} ID card`}
                className="absolute inset-0 size-full rounded-2xl shadow-lg [backface-visibility:hidden] [transform:rotateY(180deg)]"
                ref={backRef}
                role="img"
              />
            </div>
          </div>

          <button
            className="mx-auto flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-foreground transition hover:bg-muted"
            onClick={() => setFace(face === "front" ? "back" : "front")}
            type="button"
          >
            <RotateCw className="size-3.5" />
            {face === "front" ? "Show back" : "Show front"}
          </button>
        </div>

        <div className="divide-y divide-border rounded-xl border border-border">
          <div className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-foreground">Photo</p>
              <p className="mt-0.5 truncate text-xs text-foreground/70">
                {identity.hasPhoto
                  ? "On your card and your account picture."
                  : uploadHint("image")}
              </p>
            </div>
            <input
              accept={acceptAttribute("image")}
              className="hidden"
              onChange={handlePhotoChange}
              ref={photoInputRef}
              type="file"
            />
            <button
              aria-label={identity.hasPhoto ? "Change photo" : "Add photo"}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold text-brand-teal transition hover:bg-muted disabled:opacity-60"
              disabled={savingPhoto}
              onClick={() => photoInputRef.current?.click()}
              type="button"
            >
              {savingPhoto ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Camera className="size-3.5" />
              )}
              {identity.hasPhoto ? "Change" : "Add"}
            </button>
            {identity.hasPhoto ? (
              <button
                aria-label="Remove photo"
                className="rounded-lg p-1.5 text-foreground/70 transition hover:bg-muted hover:text-danger disabled:opacity-60"
                disabled={savingPhoto}
                onClick={handleRemovePhoto}
                type="button"
              >
                <Trash2 className="size-3.5" />
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-foreground">Resident ID</p>
              <p className="mt-0.5 select-all font-mono text-sm font-extrabold tracking-widest text-brand-teal">
                {identity.residentId}
              </p>
            </div>
            <button
              aria-label="Copy resident ID"
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold text-foreground transition hover:bg-muted"
              onClick={handleCopy}
              type="button"
            >
              {copied ? (
                <Check className="size-3.5 text-success" />
              ) : (
                <Copy className="size-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <div className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-foreground">Sharing</p>
              <p className="mt-0.5 text-xs text-foreground/70">
                {identity.sharingEnabled
                  ? "Hostels can load your details with this ID."
                  : "Turned off — the ID will not open your details."}
                {identity.shareCount > 0
                  ? ` Used ${identity.shareCount} ${
                      identity.shareCount === 1 ? "time" : "times"
                    }${
                      identity.lastSharedAt
                        ? `, last on ${new Date(identity.lastSharedAt).toLocaleDateString()}`
                        : ""
                    }.`
                  : ""}
              </p>
            </div>
            <button
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-60",
                identity.sharingEnabled ? "bg-brand-teal" : "bg-muted-foreground/35",
              )}
              disabled={togglingShare}
              onClick={handleToggleSharing}
              role="switch"
              aria-checked={identity.sharingEnabled}
              type="button"
            >
              <span
                className={cn(
                  "absolute top-0.5 size-5 rounded-full bg-white shadow transition-all",
                  identity.sharingEnabled ? "left-[22px]" : "left-0.5",
                )}
              />
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <button
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-brand-teal text-sm font-bold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60"
            disabled={downloading}
            onClick={handleDownload}
            type="button"
          >
            {downloading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {downloading ? "Preparing…" : "Download card"}
          </button>
          <button
            className="inline-flex h-11 items-center justify-center rounded-lg border border-brand-teal px-5 text-sm font-bold text-brand-teal transition hover:bg-brand-teal/5 sm:flex-none"
            onClick={onEdit}
            type="button"
          >
            Edit my details
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Host component: mount once per shell ── */

function SignInPrompt({ onClose }: { onClose: () => void }) {
  const next =
    typeof window === "undefined"
      ? "/"
      : `${window.location.pathname}${window.location.search}`;

  return (
    <Modal
      onClose={onClose}
      subtitle="Sign in first and we will keep your details encrypted against your account, so no hostel ever asks you to fill this form again."
      title="Save your details once"
    >
      <div className="space-y-3">
        <Link
          className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-brand-teal text-sm font-bold text-white shadow-sm transition hover:brightness-110"
          href={`/login?next=${encodeURIComponent(next)}`}
        >
          Sign in
        </Link>
        <Link
          className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-border text-sm font-bold text-foreground transition hover:bg-muted"
          href={`/signup?next=${encodeURIComponent(next)}`}
        >
          Create an account
        </Link>
        <button
          className="w-full py-2 text-sm font-bold text-foreground transition hover:underline"
          onClick={() => {
            snoozePrompt();
            onClose();
          }}
          type="button"
        >
          Not now
        </button>
      </div>
    </Modal>
  );
}

/**
 * Renders the resident-identity modals and listens for open requests. Mount it
 * once, unconditionally, inside a shell present on every page (the public
 * header and the portal account menu both do).
 *
 * It determines sign-in state itself on first open, so it must NOT be gated on
 * the host's session check — doing so meant the modal silently failed to open
 * whenever that check was slow or had failed.
 */
export function ResidentIdentityCenter({
  onProfileSaved,
}: {
  /** Lets the host refresh its own copy of the user once an ID is minted. */
  onProfileSaved?: () => void;
}) {
  const [view, setView] = useState<"closed" | "loading" | "qr" | "form" | "signin">(
    "closed",
  );
  const [reason, setReason] = useState<ProfilePromptReason>("MANUAL");
  const [data, setData] = useState<IdentityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const loadedRef = useRef(false);
  // Mirrors `data` so the loader can read it without taking a dependency on
  // state — the listener effect must not re-register on every fetch.
  const dataRef = useRef<IdentityResponse | null>(null);

  /*
   * Auth is decided here, from this endpoint's own answer, rather than trusted
   * from a prop. The host's session check can still be in flight (or have
   * failed) when the user taps, and gating on it used to mean the modal simply
   * never opened.
   *
   * Deliberately not `browserApi`: that redirects to /login on an unrecoverable
   * 401, which would throw a browsing visitor off the page just for opening the
   * QR modal. A 401 here is an expected answer — "sign in first" — not a fault.
   */
  const loadIdentity = useCallback(async (): Promise<
    | { data: IdentityResponse; status: "ok" }
    | { status: "error" }
    | { status: "unauthenticated" }
  > => {
    if (loadedRef.current && dataRef.current) {
      return { data: dataRef.current, status: "ok" };
    }

    setLoading(true);

    try {
      let response = await fetch("/api/v1/users/resident-identity", {
        credentials: "same-origin",
      });

      // An expired access token is recoverable; a missing session is not.
      if (response.status === 401 && (await refreshSession())) {
        response = await fetch("/api/v1/users/resident-identity", {
          credentials: "same-origin",
        });
      }

      if (response.status === 401) {
        return { status: "unauthenticated" };
      }

      const payload = (await response.json().catch(() => null)) as {
        data: IdentityResponse;
        success: true;
      } | null;

      if (!response.ok || !payload?.success) {
        return { status: "error" };
      }

      loadedRef.current = true;
      dataRef.current = payload.data;
      setData(payload.data);

      return { data: payload.data, status: "ok" };
    } catch {
      return { status: "error" };
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function openQr() {
      setView("loading");

      const result = await loadIdentity();

      if (result.status !== "ok") {
        setView(result.status === "unauthenticated" ? "signin" : "closed");
        return;
      }

      setReason("MANUAL");
      // No profile yet, so there is nothing behind the QR — collect it first.
      setView(result.data.identity.hasProfile ? "qr" : "form");
    }

    async function openForm(event: Event) {
      const detail = (event as CustomEvent<{ reason?: ProfilePromptReason }>).detail;
      const requestedReason = detail?.reason ?? "MANUAL";

      setView("loading");

      const result = await loadIdentity();

      if (result.status !== "ok") {
        setView(result.status === "unauthenticated" ? "signin" : "closed");
        return;
      }

      // Never nag someone who already finished it via an automatic trigger.
      if (result.data.identity.hasProfile && requestedReason !== "MANUAL") {
        setView("closed");
        return;
      }

      setReason(requestedReason);
      setView("form");
    }

    (window as unknown as Record<string, unknown>).__hhIdentityListenerAttached = true;
    window.addEventListener(QR_EVENT, openQr);
    window.addEventListener(FORM_EVENT, openForm);

    return () => {
      window.removeEventListener(QR_EVENT, openQr);
      window.removeEventListener(FORM_EVENT, openForm);
    };
  }, [loadIdentity]);

  const close = useCallback(() => {
    setView("closed");
    setSaved(false);
  }, []);

  if (view === "closed") {
    return null;
  }

  if (view === "signin") {
    return <SignInPrompt onClose={close} />;
  }

  if (view === "loading" || loading || !data) {
    return (
      <Modal onClose={close} title="Loading your details">
        <div className="flex items-center justify-center py-10 text-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      </Modal>
    );
  }

  if (view === "form") {
    if (saved) {
      return (
        <Modal
          onClose={close}
          subtitle="From now on, any hostel can register you by scanning your code or typing your resident ID."
          title="Your resident ID is ready"
        >
          <div className="space-y-4 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand-teal-soft text-brand-teal">
              <Check className="size-7" />
            </div>
            <p className="select-all font-mono text-2xl font-extrabold tracking-widest text-brand-teal">
              {data.identity.residentId}
            </p>
            <button
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-teal text-sm font-bold text-white transition hover:brightness-110"
              onClick={() => {
                setSaved(false);
                setView("qr");
              }}
              type="button"
            >
              <QrCode className="size-4" />
              Open my ID card
            </button>
          </div>
        </Modal>
      );
    }

    return (
      <ProfileForm
        identity={data.identity}
        onClose={close}
        onSaved={(next) => {
          dataRef.current = next;
          setData(next);
          setSaved(true);
          broadcastIdentityChange();
          onProfileSaved?.();
        }}
        profile={data.profile}
        reason={reason}
      />
    );
  }

  return (
    <IdCardPanel
      identity={data.identity}
      onClose={close}
      onEdit={() => {
        setReason("MANUAL");
        setView("form");
      }}
      onIdentityChange={(next) => {
        dataRef.current = next;
        setData(next);
        broadcastIdentityChange();
      }}
      profile={data.profile}
      onSharingChange={(enabled) => {
        setData((current) =>
          current
            ? { ...current, identity: { ...current.identity, sharingEnabled: enabled } }
            : current,
        );
        broadcastIdentityChange();
      }}
    />
  );
}

/**
 * The ID card, embedded in a portal page rather than shown in the modal.
 *
 * Read-only on purpose: photo, sharing and profile edits all stay in the one
 * place that owns them (the modal, reachable from "Manage card" below), so the
 * identity keeps a single write path no matter which surface you came in
 * through. This view only ever draws what the modal draws — same
 * `buildIdCardData`, same canvas renderer.
 */
export function ResidentIdCard() {
  const [data, setData] = useState<IdentityResponse | null>(null);
  const [images, setImages] = useState<{
    photo: HTMLImageElement | null;
    qr: HTMLImageElement | null;
  }>({ photo: null, qr: null });
  const [state, setState] = useState<"error" | "loading" | "ready">("loading");
  const [face, setFace] = useState<"back" | "front">("front");
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const frontRef = useRef<HTMLCanvasElement>(null);
  const backRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let active = true;

    async function loadIdentity() {
      try {
        const next = await browserApi<IdentityResponse>(
          "/api/v1/users/resident-identity",
        );

        if (active) {
          setData(next);
          setState("ready");
        }
      } catch {
        if (active) {
          setState("error");
        }
      }
    }

    void loadIdentity();

    // The modal owns every write; this keeps the embedded copy in step with it.
    window.addEventListener(CHANGED_EVENT, loadIdentity);

    return () => {
      active = false;
      window.removeEventListener(CHANGED_EVENT, loadIdentity);
    };
  }, []);

  const identity = data?.identity ?? null;
  const hasCard = Boolean(identity?.hasProfile && identity.residentId);

  useEffect(() => {
    let active = true;

    async function loadImages() {
      if (!identity || !hasCard) {
        return;
      }

      const [qrPayload, photo] = await Promise.all([
        browserApi<{ qrDataUrl: string | null }>(
          "/api/v1/users/resident-identity/qr",
        ).catch(() => ({ qrDataUrl: null })),
        loadCardImage(identityPhotoUrl(identity)),
      ]);
      const qr = await loadCardImage(qrPayload.qrDataUrl);

      // Fonts first, or the card paints once in a fallback face and again in
      // the real one — which reads as a flicker.
      await document.fonts?.ready?.catch?.(() => undefined);

      if (active) {
        setImages({ photo, qr });
      }
    }

    void loadImages();

    return () => {
      active = false;
    };
  }, [hasCard, identity]);

  const siteName = useSiteConfig().identity.siteName;
  const cardData = useMemo<IdCardData | null>(
    () =>
      identity && hasCard
        ? buildIdCardData(identity, data?.profile ?? null, images, siteName)
        : null,
    [data, hasCard, identity, images, siteName],
  );

  useEffect(() => {
    if (!cardData) {
      return;
    }

    if (frontRef.current) {
      paintIdCard(frontRef.current, cardData, "front");
    }

    if (backRef.current) {
      paintIdCard(backRef.current, cardData, "back");
    }
  }, [cardData]);

  async function handleCopy() {
    if (!identity?.residentId) {
      return;
    }

    try {
      await navigator.clipboard.writeText(identity.residentId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Nothing to report — the ID is selectable text beside the button.
    }
  }

  async function handleDownload() {
    if (!cardData) {
      return;
    }

    setDownloading(true);

    try {
      const blob = await renderIdCardSheet(cardData);

      if (!blob) {
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `hostelhub-id-card-${identity?.residentId ?? "card"}.png`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      // Downloading is a convenience; the card is still on screen either way.
    } finally {
      setDownloading(false);
    }
  }

  if (state === "loading") {
    return (
      <div className="flex items-center justify-center py-10 text-foreground/60">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (state === "error") {
    return (
      <p className="py-6 text-center text-sm text-foreground/70">
        Your ID card could not be loaded right now.
      </p>
    );
  }

  if (!hasCard) {
    return (
      <div className="space-y-3 py-2 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-teal-soft text-brand-teal">
          <QrCode className="size-6" />
        </div>
        <p className="text-sm text-foreground/70">
          Fill in your details once and you get a resident ID card with a QR code any
          hostel can scan to register you.
        </p>
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-teal px-4 text-sm font-bold text-white transition hover:brightness-110"
          onClick={() => requestResidentProfileForm("MANUAL")}
          type="button"
        >
          Create my ID card
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="mx-auto w-full max-w-[260px] space-y-3">
        <div className="[perspective:1600px]">
          <div
            className={cn(
              "relative aspect-[640/1000] w-full transition-transform duration-700 ease-[cubic-bezier(0.4,0,0.2,1)] [transform-style:preserve-3d]",
              face === "back" && "[transform:rotateY(180deg)]",
            )}
          >
            <canvas
              aria-label={`Front of your ${siteName} ${idCardNoun(cardData?.cardType)} ID card`}
              className="absolute inset-0 size-full rounded-2xl shadow-lg [backface-visibility:hidden]"
              ref={frontRef}
              role="img"
            />
            <canvas
              aria-label={`Back of your ${siteName} ${idCardNoun(cardData?.cardType)} ID card`}
              className="absolute inset-0 size-full rounded-2xl shadow-lg [backface-visibility:hidden] [transform:rotateY(180deg)]"
              ref={backRef}
              role="img"
            />
          </div>
        </div>

        <button
          className="mx-auto flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-foreground transition hover:bg-muted"
          onClick={() => setFace(face === "front" ? "back" : "front")}
          type="button"
        >
          <RotateCw className="size-3.5" />
          {face === "front" ? "Show back" : "Show front"}
        </button>
      </div>

      <div className="rounded-xl border border-border p-3">
        <p className="text-xs font-bold text-foreground">Resident ID</p>
        <div className="mt-0.5 flex items-center gap-2">
          <p className="min-w-0 flex-1 select-all font-mono text-sm font-extrabold tracking-widest text-brand-teal">
            {identity?.residentId}
          </p>
          <button
            aria-label="Copy resident ID"
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold text-foreground transition hover:bg-muted"
            onClick={handleCopy}
            type="button"
          >
            {copied ? (
              <Check className="size-3.5 text-success" />
            ) : (
              <Copy className="size-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-brand-teal px-4 text-sm font-bold text-white transition hover:brightness-110"
          onClick={() => requestResidentQr()}
          type="button"
        >
          <QrCode className="size-4" />
          Manage card
        </button>
        <button
          className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm font-bold text-foreground transition hover:bg-muted disabled:opacity-60"
          disabled={downloading}
          onClick={handleDownload}
          type="button"
        >
          {downloading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          Download
        </button>
      </div>
    </div>
  );
}
