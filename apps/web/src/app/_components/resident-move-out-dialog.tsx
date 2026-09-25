"use client";

import { Loader2, LogOut } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { currency } from "@/app/_components/shared-ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { browserApi } from "@/lib/browser-api";
import { hostelAdminEndpoints } from "@/lib/hostel-admin-endpoints";
import { cn } from "@/lib/utils";

type Decision = "APPROVED" | "PARTIAL" | "FORFEITED" | "PENDING";

const DECISIONS: { label: string; value: Decision }[] = [
  { label: "Return all", value: "APPROVED" },
  { label: "Return part", value: "PARTIAL" },
  { label: "Keep all", value: "FORFEITED" },
  { label: "Decide later", value: "PENDING" },
];

type MoveOutResident = {
  depositAmount: number;
  firstName: string;
  id: string;
  lastName: string;
};

/**
 * Moving somebody out, in one step: what they owe, what happens to the
 * deposit, and one button. The server sets `MOVED_OUT`, frees the bed, records
 * the deposit decision and tells the resident — there is no separate status
 * change to remember afterwards.
 */
export function ResidentMoveOutDialog({
  resident,
  ...props
}: {
  onClose: () => void;
  onMovedOut: (message: string) => void;
  resident: MoveOutResident | null;
}) {
  // Keyed so every resident opens on a clean form.
  return resident ? <MoveOutForm key={resident.id} resident={resident} {...props} /> : null;
}

function MoveOutForm({
  onClose,
  onMovedOut,
  resident,
}: {
  onClose: () => void;
  onMovedOut: (message: string) => void;
  resident: MoveOutResident;
}) {
  const [owed, setOwed] = useState<number | null>(null);
  const [decision, setDecision] = useState<Decision>("APPROVED");
  const [partAmount, setPartAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const residentId = resident.id;

  useEffect(() => {
    let live = true;

    browserApi<{ pendingFeeAmount?: number }>(
      `${hostelAdminEndpoints.residents}/${residentId}/move-out`,
    )
      .then((result) => live && setOwed(result.pendingFeeAmount ?? 0))
      .catch(() => live && setOwed(null));

    return () => {
      live = false;
    };
  }, [residentId]);

  const fullName = `${resident.firstName} ${resident.lastName}`.trim();
  const deposit = resident.depositAmount;
  const holdsBack = deposit > 0 && (decision === "PARTIAL" || decision === "FORFEITED");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      await browserApi(`${hostelAdminEndpoints.residents}/${resident.id}/move-out`, {
        body: JSON.stringify({
          damageNotes: holdsBack ? reason.trim() || undefined : undefined,
          depositRefundAmount: decision === "PARTIAL" ? Number(partAmount || 0) : 0,
          // No deposit held: "Return all" of nothing, so the notice says nothing about one.
          depositRefundDecision: deposit > 0 ? decision : "APPROVED",
        }),
        method: "POST",
      });
      onMovedOut(`${fullName} has moved out. Their bed is free.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not move them out.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog onOpenChange={(open) => !open && !busy && onClose()} open>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move out {fullName}</DialogTitle>
          <DialogDescription>
            Their bed is freed and they get no new bills. What they already owe stays on
            their record.
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <dl className="grid gap-2 rounded-xl border border-border bg-muted/40 p-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Still owed</dt>
              <dd
                className={cn(
                  "font-semibold",
                  owed ? "text-warning" : "text-foreground",
                )}
              >
                {owed === null ? "…" : owed > 0 ? currency(owed) : "Nothing"}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Deposit held</dt>
              <dd className="font-semibold text-foreground">
                {deposit > 0 ? currency(deposit) : "None"}
              </dd>
            </div>
          </dl>

          {deposit > 0 ? (
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-semibold text-foreground">Deposit</legend>
              <div className="grid grid-cols-2 gap-2">
                {DECISIONS.map((option) => (
                  <button
                    aria-pressed={decision === option.value}
                    className={cn(
                      "h-10 rounded-lg border text-sm font-medium transition-colors",
                      decision === option.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-foreground hover:bg-muted",
                    )}
                    key={option.value}
                    onClick={() => setDecision(option.value)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          {deposit > 0 && decision === "PARTIAL" ? (
            <label className="grid gap-2 text-sm font-semibold text-foreground">
              Amount to return (NPR)
              <input
                className="h-11 rounded-md border border-border bg-background px-3 text-sm font-normal outline-none focus:border-primary"
                inputMode="numeric"
                max={deposit}
                min={0}
                onChange={(event) => setPartAmount(event.target.value)}
                required
                type="number"
                value={partAmount}
              />
            </label>
          ) : null}

          {holdsBack ? (
            <label className="grid gap-2 text-sm font-semibold text-foreground">
              Why it is held back
              <textarea
                className="min-h-20 rounded-md border border-border bg-background px-3 py-2 text-sm font-normal outline-none focus:border-primary"
                maxLength={2000}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Broken chair, unpaid rent, lost key"
                value={reason}
              />
            </label>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button disabled={busy} onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={busy}
              type="submit"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
              Move out
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
