"use client";

import { ClipboardList } from "lucide-react";
import { memo } from "react";

import { EmptyState, LoadingRows, Panel, StatusBadge } from "@/app/_components/shared-ui";
import { usePortalResource } from "@/lib/portal-query";
import { residentEndpoints } from "@/lib/resident-endpoints";
import { Message, ResidentHeader } from "./resident-shared";

type MoveInChecklist = {
  bedCondition: string;
  completedAt?: string;
  depositAmount: number;
  documentsCollected: string[];
  itemsProvided: string[];
  roomCondition: string;
  rulesAccepted: boolean;
};

type MoveOutChecklist = {
  completedAt?: string;
  damageNotes: string;
  depositRefundAmount: number;
  depositRefundDecision: string;
  itemReturnNotes: string;
  pendingFeeAmount: number;
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-foreground">{value || "—"}</span>
    </div>
  );
}

export const ResidentMoveChecklistPageContent = memo(
  function ResidentMoveChecklistPageContent() {
    const resource = usePortalResource<{
      moveIn: MoveInChecklist | null;
      moveOut: MoveOutChecklist | null;
    }>(residentEndpoints.moveChecklist, {
      errorMessage: "Could not load your move checklist.",
    });

    const moveIn = resource.data?.moveIn ?? null;
    const moveOut = resource.data?.moveOut ?? null;
    const state = resource.state;

    return (
      <div className="mx-auto max-w-[1448px] space-y-6">
        <ResidentHeader
          description="What the hostel recorded when you moved in, and what is outstanding when you move out."
          icon={ClipboardList}
          title="Move Checklist"
        />
        <Message value={resource.message} />

        {state === "loading" ? <LoadingRows /> : null}

        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title="Move-In">
            {state === "ready" && !moveIn ? (
              <EmptyState label="No move-in checklist recorded yet." />
            ) : null}
            {moveIn ? (
              <div>
                <div className="mb-3 flex flex-wrap gap-2">
                  <StatusBadge>
                    {moveIn.completedAt ? "COMPLETED" : "IN PROGRESS"}
                  </StatusBadge>
                  {moveIn.rulesAccepted ? (
                    <StatusBadge>RULES ACKNOWLEDGED</StatusBadge>
                  ) : null}
                </div>
                <Row label="Deposit paid" value={`Rs ${moveIn.depositAmount}`} />
                <Row
                  label="Documents collected"
                  value={moveIn.documentsCollected.join(", ")}
                />
                <Row label="Items provided" value={moveIn.itemsProvided.join(", ")} />
                <Row label="Room condition" value={moveIn.roomCondition} />
                <Row label="Bed condition" value={moveIn.bedCondition} />
                <Row
                  label="Completed on"
                  value={
                    moveIn.completedAt
                      ? new Date(moveIn.completedAt).toLocaleDateString()
                      : ""
                  }
                />
              </div>
            ) : null}
          </Panel>

          <Panel title="Move-Out">
            {state === "ready" && !moveOut ? (
              <EmptyState label="No move-out checklist started." />
            ) : null}
            {moveOut ? (
              <div>
                <div className="mb-3 flex flex-wrap gap-2">
                  <StatusBadge>
                    {moveOut.completedAt ? "COMPLETED" : "IN PROGRESS"}
                  </StatusBadge>
                  <StatusBadge>{moveOut.depositRefundDecision}</StatusBadge>
                </div>
                <Row label="Pending fees" value={`Rs ${moveOut.pendingFeeAmount}`} />
                <Row label="Deposit refund" value={`Rs ${moveOut.depositRefundAmount}`} />
                <Row label="Damage notes" value={moveOut.damageNotes} />
                <Row label="Items returned" value={moveOut.itemReturnNotes} />
                <Row
                  label="Completed on"
                  value={
                    moveOut.completedAt
                      ? new Date(moveOut.completedAt).toLocaleDateString()
                      : ""
                  }
                />
              </div>
            ) : null}
          </Panel>
        </div>
      </div>
    );
  },
);
