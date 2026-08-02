"use client";

import {
  Building2,
  Check,
  Clock3,
  EyeOff,
  FileText,
  Globe,
  ImageOff,
  Mail,
  Phone,
  ShieldQuestion,
  X,
} from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import { currency, EmptyState, LoadingRows, Panel } from "@/app/_components/shared-ui";
import {
  DataTable,
  DetailField,
  DetailSection,
  PortalPageHeader,
  RoleButton,
  SoftBadge,
  TabBar,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
  Th,
  statusToneFromLabel,
} from "@/app/_components/portal-dashboard-ui";
import { MediaLightbox, type LightboxItem } from "@/components/media-lightbox";
import { browserApi } from "@/lib/browser-api";
import { platformEndpoints } from "@/lib/platform-endpoints";
import { useInvalidateResources, usePortalResource } from "@/lib/portal-query";
import { Hostel, Message } from "./core-portal-shared";

type PlatformHostelDocument = {
  createdAt: string | null;
  documentType: string;
  fileAssetId: string | null;
  fileUrl: string;
  id: string;
  rejectionReason: string;
  status: string;
};

type PlatformApplication = {
  id: string;
  infoRequestNote: string;
  infoRequestedAt: string | null;
  notes: string;
  rejectionReason: string;
  requestedDocuments: Array<{ documentType: string; note: string }>;
  reviewedAt: string | null;
  snapshot: Record<string, unknown>;
  status: string;
  submittedAt: string | null;
} | null;

type Contact = {
  email: string;
  id: string;
  name: string;
  phone: string;
  registeredAt: string | null;
  role: string;
} | null;

type PlatformHostelDetail = {
  applicant: Contact;
  application: PlatformApplication;
  documents: PlatformHostelDocument[];
  hostel: Hostel;
  owner: Contact;
  submitter: Contact;
};

const TABS = [
  { key: "submission", label: "Submission" },
  { key: "form", label: "Form Data" },
  { key: "photos", label: "Photos" },
  { key: "documents", label: "Documents" },
];

/**
 * Approve/reject/publish are one-way transitions, so which header buttons make
 * sense depends on the hostel's current status — mirrors actionsForHostel() in
 * platform-hostels-page.tsx (the list view's detail panel already gates on this;
 * this full-page review previously did not, so a PUBLISHED hostel still showed
 * "Approve").
 */
function headerActionsForStatus(
  status: string,
): Array<"approve" | "reject" | "request-documents"> {
  switch (status) {
    case "DRAFT":
    case "PENDING_APPROVAL":
      return ["approve", "request-documents", "reject"];
    case "APPROVED":
      return ["reject"];
    case "REJECTED":
      return ["approve", "request-documents"];
    default:
      return [];
  }
}

/**
 * A FileAsset id routes through the secure, auth-gated presign endpoint, which
 * 302-redirects the reviewer to a short-lived R2 URL. Legacy records that only
 * stored a raw fileUrl fall back to that URL directly.
 */
function assetHref(fileAssetId?: string | null, fileUrl?: string) {
  if (fileAssetId) {
    return `/api/v1/files/${fileAssetId}/url`;
  }
  return fileUrl || null;
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function humanizeKey(key: string) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .replace(/^./, (character) => character.toUpperCase())
    .trim();
}

/**
 * Flattens the stored registration snapshot into label/value rows. The snapshot
 * is Mixed, so anything nested is walked rather than dumped as JSON — the point
 * is for a reviewer to read what the owner typed.
 */
function flattenSnapshot(
  value: unknown,
  prefix = "",
  depth = 0,
): Array<{ label: string; value: string }> {
  if (depth > 3 || value == null) {
    return [];
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return [{ label: prefix, value: "—" }];
    if (value.every((item) => typeof item !== "object")) {
      return [{ label: prefix, value: value.join(", ") }];
    }
    return value.flatMap((item, index) =>
      flattenSnapshot(item, `${prefix} #${index + 1}`, depth + 1),
    );
  }

  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) =>
      flattenSnapshot(
        nested,
        prefix ? `${prefix} · ${humanizeKey(key)}` : humanizeKey(key),
        depth + 1,
      ),
    );
  }

  return [{ label: prefix, value: String(value) || "—" }];
}

export const PlatformHostelReviewPageContent = memo(
  function PlatformHostelReviewPageContent() {
    const params = useParams<{ id: string }>();
    const [actionMessage, setActionMessage] = useState("");
    const [busy, setBusy] = useState(false);
    const [tab, setTab] = useState("submission");
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    const [lightboxItems, setLightboxItems] = useState<LightboxItem[]>([]);

    const invalidate = useInvalidateResources();
    // Same cache entry the Hostels list opens its detail panel from, so arriving
    // here from that screen paints immediately.
    const detailResource = usePortalResource<PlatformHostelDetail>(
      platformEndpoints.hostel(params.id),
      { errorMessage: "Could not load hostel." },
    );

    const detail = detailResource.data ?? null;
    const message = actionMessage || detailResource.message;

    const action = useCallback(
      async (nextAction: string) => {
        let body = JSON.stringify({});

        if (nextAction === "reject") {
          const reason = window.prompt("Rejection reason")?.trim();
          if (!reason) return;
          body = JSON.stringify({ reason });
        } else if (nextAction === "request-documents") {
          const raw = window.prompt(
            "Which documents are needed? Separate multiple with commas.\ne.g. Citizenship (clearer scan), Hostel license",
          );
          if (!raw) return;
          const documents = raw
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
            .map((documentType) => ({ documentType }));
          if (documents.length === 0) return;
          const note =
            window.prompt("Optional message to the owner (leave blank to skip):") ||
            undefined;
          body = JSON.stringify({ documents, note });
        } else if (nextAction === "unpublish") {
          // Required: the owner is emailed this reason verbatim.
          const reason = window
            .prompt(
              "Why is this listing being unpublished? The owner will see this reason.",
            )
            ?.trim();
          if (!reason) return;
          body = JSON.stringify({ reason });
        }

        setBusy(true);
        try {
          const result = await browserApi<{
            notification?: { reason?: string; sent: boolean; to?: string };
          }>(`${platformEndpoints.hostel(params.id)}/${nextAction}`, {
            body,
            method: "PATCH",
          });

          // The request is saved either way, but the owner only finds out if the
          // email actually left — say so rather than reporting a flat success.
          const notification = result?.notification;

          setActionMessage(
            notification && !notification.sent
              ? `Documents requested, but the owner was NOT emailed (${notification.reason ?? "unknown error"}). Contact ${notification.to ?? "the owner"} manually.`
              : `Hostel ${nextAction} action completed.`,
          );
          invalidate(platformEndpoints.hostel(params.id), platformEndpoints.hostels);
        } catch (error) {
          setActionMessage(error instanceof Error ? error.message : "Action failed.");
        } finally {
          setBusy(false);
        }
      },
      [invalidate, params.id],
    );

    const hostel = detail?.hostel ?? null;
    const headerActions = headerActionsForStatus(hostel?.status ?? "");
    const documents = useMemo(() => detail?.documents ?? [], [detail]);
    const requestedDocuments = detail?.application?.requestedDocuments ?? [];

    // flatMap rather than map+filter so the empty case drops out without
    // needing a type predicate to strip the nulls back off.
    const photoItems = useMemo<LightboxItem[]>(
      () =>
        (hostel?.photos ?? []).flatMap<LightboxItem>((photo) => {
          const src = assetHref(
            (photo as { fileAssetId?: string }).fileAssetId,
            photo.url,
          );
          return src ? [{ src, title: hostel?.name ?? "Hostel photo" }] : [];
        }),
      [hostel],
    );

    const documentItems = useMemo<LightboxItem[]>(
      () =>
        documents.flatMap<LightboxItem>((document) => {
          const src = assetHref(document.fileAssetId, document.fileUrl);
          return src
            ? [
                {
                  caption: `Uploaded ${formatTimestamp(document.createdAt)}`,
                  src,
                  title: document.documentType,
                },
              ]
            : [];
        }),
      [documents],
    );

    const snapshotRows = useMemo(
      () => flattenSnapshot(detail?.application?.snapshot ?? {}),
      [detail],
    );

    function openLightbox(items: LightboxItem[], index: number) {
      setLightboxItems(items);
      setLightboxIndex(index);
    }

    if (!hostel) {
      return (
        <div className="mx-auto max-w-[1200px] space-y-4">
          <PortalPageHeader
            breadcrumb={[
              { href: "/platform/dashboard", label: "Home" },
              { href: "/platform/hostels", label: "Hostel Approvals" },
              "Review",
            ]}
            description="Review the owner's submission, paperwork, and photos before deciding."
            title="Hostel Review"
          />
          <Message value={message} />
          {message ? (
            <EmptyState label="Hostel detail is not loaded." />
          ) : (
            <LoadingRows />
          )}
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-[1200px] space-y-4">
        <PortalPageHeader
          actions={
            headerActions.length > 0 ? (
              <>
                {headerActions.includes("approve") ? (
                  <RoleButton
                    disabled={busy}
                    onClick={() => void action("approve")}
                    tone="platform"
                  >
                    <Check className="size-3.5" />
                    Approve
                  </RoleButton>
                ) : null}
                {headerActions.includes("request-documents") ? (
                  <RoleButton
                    disabled={busy}
                    onClick={() => void action("request-documents")}
                    tone="platform"
                    variant="outline"
                  >
                    <FileText className="size-3.5" />
                    Request docs
                  </RoleButton>
                ) : null}
                {headerActions.includes("reject") ? (
                  <RoleButton
                    disabled={busy}
                    onClick={() => void action("reject")}
                    tone="platform"
                    variant="outline"
                  >
                    <X className="size-3.5" />
                    Reject
                  </RoleButton>
                ) : null}
              </>
            ) : undefined
          }
          breadcrumb={[
            { href: "/platform/dashboard", label: "Home" },
            { href: "/platform/hostels", label: "Hostel Approvals" },
            hostel.name,
          ]}
          description="Everything the owner submitted, their identity, uploaded paperwork, and listing photos."
          title={hostel.name}
        />
        <Message value={message} />

        <div className="flex flex-wrap items-center gap-2">
          <SoftBadge tone={statusToneFromLabel(hostel.status)}>
            Listing: {hostel.status.replaceAll("_", " ")}
          </SoftBadge>
          <SoftBadge tone={statusToneFromLabel(hostel.verificationStatus)}>
            KYC: {hostel.verificationStatus.replaceAll("_", " ")}
          </SoftBadge>
          {detail?.application ? (
            <SoftBadge tone={statusToneFromLabel(detail.application.status)}>
              Application: {detail.application.status.replaceAll("_", " ")}
            </SoftBadge>
          ) : null}
          <span className="text-[11.5px] text-muted-foreground">
            Submitted {formatTimestamp(detail?.application?.submittedAt)}
          </span>
          {hostel.status === "PUBLISHED" ? (
            <RoleButton
              className="ml-auto"
              disabled={busy}
              onClick={() => void action("unpublish")}
              tone="platform"
              variant="outline"
            >
              <EyeOff className="size-3.5" />
              Unpublish
            </RoleButton>
          ) : hostel.status === "APPROVED" ? (
            <RoleButton
              className="ml-auto"
              disabled={busy}
              onClick={() => void action("publish")}
              tone="platform"
            >
              <Globe className="size-3.5" />
              Publish
            </RoleButton>
          ) : null}
        </div>

        <Panel>
          <TabBar className="mb-3" onChange={setTab} tabs={TABS} value={tab} />

          {/* ── Who submitted it, and when ─────────────────────────── */}
          {tab === "submission" ? (
            <div className="grid gap-3 lg:grid-cols-2">
              <DetailSection title="Submitted By">
                <DetailField
                  label="Name"
                  value={detail?.submitter?.name ?? detail?.owner?.name ?? "—"}
                />
                <DetailField
                  label="Email"
                  value={detail?.submitter?.email ?? detail?.owner?.email ?? "—"}
                />
                <DetailField
                  label="Phone"
                  value={detail?.submitter?.phone ?? detail?.owner?.phone ?? "—"}
                />
                <DetailField
                  label="Account role"
                  value={detail?.submitter?.role ?? detail?.owner?.role ?? "—"}
                />
                <DetailField
                  label="Account created"
                  value={formatTimestamp(
                    detail?.submitter?.registeredAt ?? detail?.owner?.registeredAt,
                  )}
                />
                <DetailField
                  label="Submitted on"
                  value={formatTimestamp(detail?.application?.submittedAt)}
                />
              </DetailSection>

              <DetailSection title="Hostel Owner">
                <DetailField label="Name" value={detail?.owner?.name ?? "—"} />
                <DetailField label="Email" value={detail?.owner?.email ?? "—"} />
                <DetailField label="Phone" value={detail?.owner?.phone ?? "—"} />
                <DetailField label="Owner ID" value={hostel.ownerId} />
                {detail?.applicant && detail.applicant.id !== detail.owner?.id ? (
                  <DetailField
                    label="Applicant"
                    value={`${detail.applicant.name} (${detail.applicant.email})`}
                  />
                ) : null}
              </DetailSection>

              <DetailSection title="Review Trail">
                <DetailField
                  label="Application status"
                  value={detail?.application?.status?.replaceAll("_", " ") ?? "—"}
                />
                <DetailField
                  label="Last reviewed"
                  value={formatTimestamp(detail?.application?.reviewedAt)}
                />
                <DetailField
                  label="Info requested"
                  value={formatTimestamp(detail?.application?.infoRequestedAt)}
                />
                {detail?.application?.rejectionReason ? (
                  <DetailField
                    label="Rejection reason"
                    value={detail.application.rejectionReason}
                  />
                ) : null}
                {detail?.application?.infoRequestNote ? (
                  <DetailField
                    label="Note to owner"
                    value={detail.application.infoRequestNote}
                  />
                ) : null}
              </DetailSection>

              <DetailSection title="Quick Contact">
                <div className="flex flex-wrap gap-2 pt-1">
                  {detail?.owner?.email ? (
                    <RoleButton asChild tone="platform" variant="outline">
                      <a href={`mailto:${detail.owner.email}`}>
                        <Mail className="size-3.5" />
                        Email owner
                      </a>
                    </RoleButton>
                  ) : null}
                  {detail?.owner?.phone ? (
                    <RoleButton asChild tone="platform" variant="outline">
                      <a href={`tel:${detail.owner.phone}`}>
                        <Phone className="size-3.5" />
                        Call owner
                      </a>
                    </RoleButton>
                  ) : null}
                  {hostel.contact?.phone ? (
                    <RoleButton asChild tone="platform" variant="outline">
                      <a href={`tel:${hostel.contact.phone}`}>
                        <Building2 className="size-3.5" />
                        Hostel line
                      </a>
                    </RoleButton>
                  ) : null}
                </div>
              </DetailSection>
            </div>
          ) : null}

          {/* ── Everything the owner typed into the form ───────────── */}
          {tab === "form" ? (
            <div className="space-y-3">
              <div className="grid gap-3 lg:grid-cols-2">
                <DetailSection title="Listing Basics">
                  <DetailField label="Hostel name" value={hostel.name} />
                  <DetailField label="Slug" value={hostel.slug} />
                  <DetailField
                    label="Type"
                    value={hostel.hostelType.replaceAll("_", " ")}
                  />
                  <DetailField
                    label="Room types"
                    value={hostel.roomTypes.join(", ") || "—"}
                  />
                </DetailSection>

                <DetailSection title="Location">
                  <DetailField label="Address" value={hostel.location.address || "—"} />
                  <DetailField label="Area" value={hostel.location.area || "—"} />
                  <DetailField label="City" value={hostel.location.city || "—"} />
                </DetailSection>

                <DetailSection title="Contact">
                  <DetailField label="Phone" value={hostel.contact?.phone || "—"} />
                  <DetailField label="Email" value={hostel.contact?.email || "—"} />
                </DetailSection>

                <DetailSection title="Pricing">
                  <DetailField
                    label="Monthly rent from"
                    value={
                      hostel.pricing?.monthlyRentMin
                        ? currency(hostel.pricing.monthlyRentMin)
                        : "—"
                    }
                  />
                  <DetailField
                    label="Monthly rent to"
                    value={
                      hostel.pricing?.monthlyRentMax
                        ? currency(hostel.pricing.monthlyRentMax)
                        : "—"
                    }
                  />
                </DetailSection>

                <DetailSection title="Capacity">
                  <DetailField
                    label="Total rooms"
                    value={String(hostel.capacitySummary?.totalRooms ?? "—")}
                  />
                  <DetailField
                    label="Total beds"
                    value={String(hostel.capacitySummary?.totalBeds ?? "—")}
                  />
                  <DetailField
                    label="Vacant beds"
                    value={String(hostel.capacitySummary?.vacantBeds ?? "—")}
                  />
                </DetailSection>

                <DetailSection title="Food">
                  <DetailField
                    label="Meals per day"
                    value={String(hostel.food?.mealsPerDay ?? "—")}
                  />
                  <DetailField
                    label="Vegetarian"
                    value={hostel.food?.hasVeg ? "Yes" : "No"}
                  />
                  <DetailField
                    label="Non-vegetarian"
                    value={hostel.food?.hasNonVeg ? "Yes" : "No"}
                  />
                  <DetailField label="Notes" value={hostel.food?.notes || "—"} />
                </DetailSection>
              </div>

              <DetailSection title="Description">
                <p className="py-1 text-[12px] leading-5 text-muted-foreground">
                  {hostel.description || "No description was provided."}
                </p>
              </DetailSection>

              <div className="grid gap-3 lg:grid-cols-2">
                <DetailSection title={`Facilities (${hostel.facilities.length})`}>
                  {hostel.facilities.length === 0 ? (
                    <p className="py-1 text-[11.5px] text-muted-foreground">
                      None listed.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {hostel.facilities.map((facility) => (
                        <SoftBadge key={facility} tone="teal">
                          {facility}
                        </SoftBadge>
                      ))}
                    </div>
                  )}
                </DetailSection>

                <DetailSection title={`House Rules (${hostel.rules.length})`}>
                  {hostel.rules.length === 0 ? (
                    <p className="py-1 text-[11.5px] text-muted-foreground">
                      None listed.
                    </p>
                  ) : (
                    <ul className="space-y-1 pt-1">
                      {hostel.rules.map((rule) => (
                        <li
                          className="flex items-start gap-1.5 text-[11.5px] text-muted-foreground"
                          key={rule}
                        >
                          <span className="mt-1.5 block size-1 shrink-0 rounded-full bg-role-platform" />
                          {rule}
                        </li>
                      ))}
                    </ul>
                  )}
                </DetailSection>
              </div>

              {snapshotRows.length > 0 ? (
                <DetailSection title="Original Form Submission">
                  <p className="pb-1.5 text-[11px] leading-4 text-muted-foreground">
                    Captured verbatim when the owner submitted the registration form —
                    compare against the live record above to spot post-submission edits.
                  </p>
                  {snapshotRows.map((row, index) => (
                    <DetailField
                      key={`${row.label}-${index}`}
                      label={row.label}
                      value={row.value}
                    />
                  ))}
                </DetailSection>
              ) : null}
            </div>
          ) : null}

          {/* ── Photos with in-site lightbox ───────────────────────── */}
          {tab === "photos" ? (
            photoItems.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <ImageOff className="size-5" />
                </span>
                <p className="text-[13px] font-semibold text-foreground">
                  No photos uploaded
                </p>
                <p className="text-[11.5px] text-muted-foreground">
                  A listing without photos should not be published.
                </p>
              </div>
            ) : (
              <>
                <p className="mb-2.5 text-[11.5px] text-muted-foreground">
                  {photoItems.length} photo{photoItems.length === 1 ? "" : "s"} — click
                  any image to open it full size.
                </p>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                  {photoItems.map((item, index) => (
                    <button
                      className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-border bg-muted transition hover:border-role-platform/50"
                      key={`${item.src}-${index}`}
                      onClick={() => openLightbox(photoItems, index)}
                      type="button"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- remote
                          R2 asset behind a redirecting presign route. */}
                      <img
                        alt={`${hostel.name} photo ${index + 1}`}
                        className="size-full object-cover transition group-hover:scale-[1.03]"
                        loading="lazy"
                        src={item.src}
                      />
                    </button>
                  ))}
                </div>
              </>
            )
          ) : null}

          {/* ── Uploaded paperwork ─────────────────────────────────── */}
          {tab === "documents" ? (
            <div className="space-y-3">
              {documents.length === 0 ? (
                <EmptyState label="No documents were uploaded for this hostel." />
              ) : (
                <DataTable className="min-w-[620px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <Th>Document</Th>
                      <Th>Status</Th>
                      <Th>Uploaded</Th>
                      <Th align="right">File</Th>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documents.map((document, index) => {
                      const hasFile = Boolean(
                        assetHref(document.fileAssetId, document.fileUrl),
                      );

                      return (
                        <TableRow key={document.id}>
                          <TableCell>
                            <div className="flex items-center gap-2 font-semibold text-foreground">
                              <FileText className="size-3.5 text-role-platform" />
                              {document.documentType}
                            </div>
                            {document.rejectionReason ? (
                              <p className="mt-0.5 text-[11px] text-rose-500">
                                {document.rejectionReason}
                              </p>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <SoftBadge tone={statusToneFromLabel(document.status)}>
                              {document.status.replaceAll("_", " ")}
                            </SoftBadge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {formatTimestamp(document.createdAt)}
                          </TableCell>
                          <TableCell className="text-right">
                            {hasFile ? (
                              <button
                                className="text-[11.5px] font-semibold text-role-platform transition hover:underline"
                                onClick={() =>
                                  openLightbox(
                                    documentItems,
                                    documentItems.findIndex(
                                      (item) => item.title === document.documentType,
                                    ) === -1
                                      ? index
                                      : documentItems.findIndex(
                                          (item) => item.title === document.documentType,
                                        ),
                                  )
                                }
                                type="button"
                              >
                                View
                              </button>
                            ) : (
                              <span className="text-[11.5px] text-muted-foreground">
                                No file
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </DataTable>
              )}

              {requestedDocuments.length > 0 ? (
                <DetailSection title="Documents Requested From Owner">
                  {requestedDocuments.map((document, index) => (
                    <div
                      className="flex items-start gap-2 border-b border-border/50 py-1.5 last:border-0"
                      key={`${document.documentType}-${index}`}
                    >
                      <ShieldQuestion className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                      <span className="text-[11.5px]">
                        <span className="font-semibold text-foreground">
                          {document.documentType}
                        </span>
                        {document.note ? (
                          <span className="text-muted-foreground">
                            {" "}
                            — {document.note}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  ))}
                  <p className="flex items-center gap-1.5 pt-1.5 text-[11px] text-muted-foreground">
                    <Clock3 className="size-3" />
                    Requested {formatTimestamp(detail?.application?.infoRequestedAt)}
                  </p>
                </DetailSection>
              ) : null}
            </div>
          ) : null}
        </Panel>

        {lightboxIndex !== null ? (
          <MediaLightbox
            index={lightboxIndex}
            items={lightboxItems}
            onClose={() => setLightboxIndex(null)}
            onIndexChange={setLightboxIndex}
          />
        ) : null}
      </div>
    );
  },
);
