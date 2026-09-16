"use client";

import { cn } from "@/lib/utils";

/**
 * The payout account, as both hostel registration forms collect it.
 *
 * Optional at registration: bookings stay off for a hostel until an account is
 * verified, and an owner who does not have the passbook to hand can add it later
 * from Payment Setup. Kept out of the saved form draft on purpose — an account
 * number does not belong in localStorage.
 */

export type PayoutAccountDraft = {
  bankName: string;
  branch: string;
  holderName: string;
  method: "BANK" | "ESEWA" | "KHALTI";
  number: string;
};

export const EMPTY_PAYOUT_DRAFT: PayoutAccountDraft = {
  bankName: "",
  branch: "",
  holderName: "",
  method: "BANK",
  number: "",
};

/** What the API takes, or nothing when the section was left blank. */
export function payoutAccountPayload(draft: PayoutAccountDraft) {
  return draft.number.trim()
    ? { ...draft, holderName: draft.holderName.trim(), number: draft.number.trim() }
    : undefined;
}

const FIELD =
  "mt-1.5 h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm font-normal text-foreground outline-none focus:border-brand-teal";

const METHODS = [
  { label: "Bank account", value: "BANK" },
  { label: "eSewa", value: "ESEWA" },
  { label: "Khalti", value: "KHALTI" },
] as const;

export function PayoutAccountFields({
  onChange,
  value,
}: {
  onChange: (next: PayoutAccountDraft) => void;
  value: PayoutAccountDraft;
}) {
  const set = (patch: Partial<PayoutAccountDraft>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2" role="radiogroup">
        {METHODS.map((option) => (
          <button
            aria-checked={value.method === option.value}
            className={cn(
              "h-10 rounded-lg border text-sm font-semibold transition",
              value.method === option.value
                ? "border-brand-teal bg-brand-teal/10 text-brand-teal"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
            key={option.value}
            onClick={() => set({ method: option.value })}
            role="radio"
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      <label className="block text-sm font-semibold text-foreground">
        Name on the account
        <input className={FIELD} onChange={(event) => set({ holderName: event.target.value })} value={value.holderName} />
      </label>
      {value.method === "BANK" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-foreground">
            Bank
            <input className={FIELD} onChange={(event) => set({ bankName: event.target.value })} value={value.bankName} />
          </label>
          <label className="block text-sm font-semibold text-foreground">
            Branch <span className="font-normal text-muted-foreground">(optional)</span>
            <input className={FIELD} onChange={(event) => set({ branch: event.target.value })} value={value.branch} />
          </label>
        </div>
      ) : null}
      <label className="block text-sm font-semibold text-foreground">
        {value.method === "BANK" ? "Account number" : "Mobile number on the wallet"}
        <input
          className={FIELD}
          inputMode={value.method === "BANK" ? "text" : "numeric"}
          onChange={(event) => set({ number: event.target.value })}
          value={value.number}
        />
      </label>
    </div>
  );
}
