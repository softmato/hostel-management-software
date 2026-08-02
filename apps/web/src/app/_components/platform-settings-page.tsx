"use client";

import {
  AlertCircle,
  Check,
  Copy,
  KeyRound,
  Loader2,
  ShieldCheck,
  ShieldHalf,
  Trash2,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { memo, useState } from "react";

import { EmptyState, LoadingRows, Panel } from "@/app/_components/shared-ui";
import {
  DataTable,
  DetailField,
  FilterSelect,
  InitialsAvatar,
  PortalPageHeader,
  RoleButton,
  SoftBadge,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
  Th,
  statusToneFromLabel,
} from "@/app/_components/portal-dashboard-ui";
import { TextField } from "@/app/_components/platform-config-shared";
import { browserApi } from "@/lib/browser-api";
import { Role } from "@/lib/roles";
import { platformEndpoints } from "@/lib/platform-endpoints";
import {
  combineResources,
  useInvalidateResources,
  usePortalResource,
} from "@/lib/portal-query";
import { PlatformBroadcastPanel } from "./platform-broadcast-panel";
import { PlatformOperationsPanel } from "./platform-operations-panel";
import { Message, ReportRecord } from "./core-portal-shared";

type PlatformOwner = {
  email: string | null;
  emailVerified: boolean;
  id: string;
  name: string;
  phone: string | null;
  role: string;
  status: string;
};

type PlatformAdmin = {
  createdAt: string | null;
  email: string;
  id: string;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
  name: string;
  phone: string;
  role: string;
  status: string;
};

const ROLE_COPY: Record<string, { description: string; label: string }> = {
  [Role.PLATFORM_MODERATOR]: {
    description:
      "Approvals, verification, moderation and read-only reports. Cannot reach website config, fee plans, settings, report exports, or the admin roster.",
    label: "Platform Moderator",
  },
  [Role.SUPERADMIN]: {
    description:
      "Identical access to you, including the ability to create, promote, and revoke other platform admins.",
    label: "Superadmin",
  },
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export const PlatformSettingsPageContent = memo(function PlatformSettingsPageContent() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteRole, setInviteRole] = useState<string>(Role.PLATFORM_MODERATOR);
  const [creating, setCreating] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState("");

  const invalidate = useInvalidateResources();
  const ownerResource = usePortalResource<{ user: PlatformOwner }>(
    platformEndpoints.currentUser,
    { errorMessage: "Could not load settings." },
  );
  const reportResource = usePortalResource<{ report: ReportRecord }>(
    platformEndpoints.dashboardReport,
    { errorMessage: "Could not load settings." },
  );
  const adminsResource = usePortalResource<{ admins: PlatformAdmin[] }>(
    platformEndpoints.admins,
  );

  const owner = ownerResource.data?.user ?? null;
  const report = reportResource.data?.report ?? null;
  // A PLATFORM_MODERATOR gets 403 on the roster by design — show it empty rather
  // than surfacing an error they cannot act on, so its failure is not combined
  // into the page-level state below.
  const admins = adminsResource.data?.admins ?? [];
  const { state, message: loadMessage } = combineResources(ownerResource, reportResource);
  const pageError = error || loadMessage;

  // Only a full superadmin may manage admins; an acting superadmin sees the
  // roster read-only. The server enforces this too.
  const canManageAdmins = owner?.role === Role.SUPERADMIN;

  async function createAdmin() {
    if (!inviteEmail.trim()) {
      setError("An email address is required.");
      return;
    }

    setCreating(true);
    setError("");
    setMessage("");
    setTemporaryPassword("");

    try {
      const result = await browserApi<{ temporaryPassword: string }>(
        platformEndpoints.admins,
        {
          body: JSON.stringify({
            email: inviteEmail.trim(),
            name: inviteName.trim() || undefined,
            phone: invitePhone.trim() || undefined,
            role: inviteRole,
          }),
          method: "POST",
        },
      );

      setMessage(
        `${ROLE_COPY[inviteRole]?.label ?? "Admin"} created — credentials emailed to ${inviteEmail.trim()}.`,
      );
      setTemporaryPassword(result.temporaryPassword);
      setInviteEmail("");
      setInviteName("");
      setInvitePhone("");
      invalidate(platformEndpoints.admins);
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Could not create admin.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function changeRole(adminId: string, role: string) {
    setError("");
    setMessage("");

    try {
      await browserApi(`${platformEndpoints.admins}/${adminId}`, {
        body: JSON.stringify({ role }),
        method: "PATCH",
      });
      setMessage("Access level updated.");
      invalidate(platformEndpoints.admins);
    } catch (roleError) {
      setError(roleError instanceof Error ? roleError.message : "Could not update role.");
    }
  }

  async function revoke(adminId: string, name: string) {
    if (!window.confirm(`Revoke platform access for ${name}? They will be suspended.`)) {
      return;
    }

    setError("");
    setMessage("");

    try {
      await browserApi(`${platformEndpoints.admins}/${adminId}`, { method: "DELETE" });
      setMessage("Platform access revoked.");
      invalidate(platformEndpoints.admins);
    } catch (revokeError) {
      setError(
        revokeError instanceof Error ? revokeError.message : "Could not revoke access.",
      );
    }
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      <PortalPageHeader
        breadcrumb={["Home", "Settings"]}
        description="Your account, platform access control, and a workspace snapshot."
        title="Settings"
      />

      {message ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200/80 bg-emerald-50 px-3 py-2 text-[12.5px] font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          <Check className="size-3.5 shrink-0" />
          {message}
        </div>
      ) : null}
      {pageError ? (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200/80 bg-rose-50 px-3 py-2 text-[12.5px] font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertCircle className="size-3.5 shrink-0" />
          {pageError}
        </div>
      ) : null}
      <Message value="" />

      {state === "loading" ? <LoadingRows /> : null}
      {state === "error" ? <EmptyState label="Settings could not be loaded." /> : null}

      {state === "ready" ? (
        <>
          {canManageAdmins ? <PlatformBroadcastPanel /> : null}
          {canManageAdmins ? <PlatformOperationsPanel /> : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Your Account">
              {owner ? (
                <div className="space-y-1">
                  <DetailField label="Name" value={owner.name} />
                  <DetailField label="Email" value={owner.email ?? "—"} />
                  <DetailField label="Phone" value={owner.phone ?? "—"} />
                  <DetailField
                    label="Access level"
                    value={
                      <SoftBadge tone="teal">
                        {ROLE_COPY[owner.role]?.label ?? owner.role}
                      </SoftBadge>
                    }
                  />
                  <DetailField
                    label="Status"
                    value={
                      <SoftBadge tone={statusToneFromLabel(owner.status)}>
                        {owner.status}
                      </SoftBadge>
                    }
                  />
                  <DetailField
                    label="Email verified"
                    value={
                      <SoftBadge tone={owner.emailVerified ? "green" : "amber"}>
                        {owner.emailVerified ? "Verified" : "Unverified"}
                      </SoftBadge>
                    }
                  />
                </div>
              ) : (
                <EmptyState label="Account is not loaded." />
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <RoleButton asChild tone="platform" variant="outline">
                  <Link href="/reset-password">
                    <KeyRound className="size-3.5" />
                    Change password
                  </Link>
                </RoleButton>
                <RoleButton asChild tone="platform" variant="outline">
                  <Link href="/platform/users">
                    <ShieldCheck className="size-3.5" />
                    Manage users
                  </Link>
                </RoleButton>
              </div>
            </Panel>

            <Panel title="Platform Snapshot">
              <div className="space-y-1">
                <DetailField
                  label="Total hostels"
                  value={String(report?.totalHostels ?? 0)}
                />
                <DetailField
                  label="Pending approvals"
                  value={String(report?.pendingApprovals ?? 0)}
                />
                <DetailField
                  label="Active residents"
                  value={String(report?.activeResidents ?? 0)}
                />
                <DetailField
                  label="Service providers"
                  value={String(report?.serviceProviders ?? 0)}
                />
                <DetailField label="Reviews" value={String(report?.reviews ?? 0)} />
                <DetailField
                  label="Open listing flags"
                  value={String(report?.openListingFlags ?? 0)}
                />
              </div>
            </Panel>
          </div>

          {/* ── Platform access ─────────────────────────────────────── */}
          {canManageAdmins ? (
            <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <header className="border-b border-border/60 px-3.5 py-2.5">
                <h2 className="font-heading text-[13.5px] font-bold text-foreground">
                  Add a Platform Admin
                </h2>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  The new admin receives a temporary password by email and must change it
                  on first login.
                </p>
              </header>

              <div className="space-y-3 p-3.5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <TextField
                    label="Email"
                    onChange={setInviteEmail}
                    placeholder="admin@example.com"
                    value={inviteEmail}
                  />
                  <TextField
                    label="Full name"
                    onChange={setInviteName}
                    placeholder="Optional"
                    value={inviteName}
                  />
                  <TextField
                    label="Phone"
                    onChange={setInvitePhone}
                    placeholder="Optional"
                    value={invitePhone}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
                  <FilterSelect
                    defaultLabel="Platform Moderator"
                    label="Access level"
                    onChange={(next) => setInviteRole(next || Role.PLATFORM_MODERATOR)}
                    options={[
                      { label: "Platform Moderator", value: Role.PLATFORM_MODERATOR },
                      { label: "Superadmin (full access)", value: Role.SUPERADMIN },
                    ]}
                    value={inviteRole}
                  />
                  <div className="flex items-end">
                    <p className="pb-2 text-[11.5px] leading-4 text-muted-foreground">
                      {ROLE_COPY[inviteRole]?.description}
                    </p>
                  </div>
                </div>

                <RoleButton disabled={creating} onClick={createAdmin} tone="platform">
                  {creating ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <UserPlus className="size-3.5" />
                  )}
                  Create admin
                </RoleButton>

                {temporaryPassword ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    <span className="font-semibold">Temporary password:</span>
                    <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono dark:bg-amber-900/50">
                      {temporaryPassword}
                    </code>
                    <button
                      className="inline-flex items-center gap-1 rounded border border-amber-300 px-1.5 py-0.5 text-[11px] font-semibold transition hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900/50"
                      onClick={() =>
                        void navigator.clipboard.writeText(temporaryPassword)
                      }
                      type="button"
                    >
                      <Copy className="size-3" />
                      Copy
                    </button>
                    <span className="w-full text-[11px]">
                      Shown once so you can hand it over if email delivery is not
                      configured. It must be changed on first login.
                    </span>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          <Panel title={`Platform Admins (${admins.length})`}>
            {admins.length === 0 ? (
              <EmptyState
                label={
                  canManageAdmins
                    ? "No other platform admins yet."
                    : "Only a full superadmin can view the admin roster."
                }
              />
            ) : (
              <DataTable className="min-w-[720px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <Th>Admin</Th>
                    <Th>Access level</Th>
                    <Th>Status</Th>
                    <Th>Added</Th>
                    <Th>Last login</Th>
                    {canManageAdmins ? <Th align="right">Actions</Th> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {admins.map((admin) => {
                    const isSelf = admin.id === owner?.id;

                    return (
                      <TableRow key={admin.id}>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <InitialsAvatar name={admin.name} size="sm" tone="platform" />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="truncate font-semibold text-foreground">
                                  {admin.name}
                                </span>
                                {isSelf ? <SoftBadge tone="slate">You</SoftBadge> : null}
                              </div>
                              <p className="truncate text-[11px] text-muted-foreground">
                                {admin.email}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <SoftBadge
                            tone={admin.role === Role.SUPERADMIN ? "teal" : "purple"}
                          >
                            <span className="inline-flex items-center gap-1">
                              {admin.role === Role.SUPERADMIN ? (
                                <ShieldCheck className="size-3" />
                              ) : (
                                <ShieldHalf className="size-3" />
                              )}
                              {ROLE_COPY[admin.role]?.label ?? admin.role}
                            </span>
                          </SoftBadge>
                        </TableCell>
                        <TableCell>
                          <SoftBadge tone={statusToneFromLabel(admin.status)}>
                            {admin.status}
                          </SoftBadge>
                          {admin.mustChangePassword ? (
                            <p className="mt-0.5 text-[10.5px] text-amber-600">
                              Password change pending
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDate(admin.createdAt)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDate(admin.lastLoginAt)}
                        </TableCell>
                        {canManageAdmins ? (
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <button
                                className="rounded-md px-2 py-1 text-[11px] font-semibold text-role-platform transition hover:bg-role-platform-soft"
                                onClick={() =>
                                  void changeRole(
                                    admin.id,
                                    admin.role === Role.SUPERADMIN
                                      ? Role.PLATFORM_MODERATOR
                                      : Role.SUPERADMIN,
                                  )
                                }
                                type="button"
                              >
                                {admin.role === Role.SUPERADMIN
                                  ? "Make moderator"
                                  : "Make superadmin"}
                              </button>
                              {isSelf ? null : (
                                <button
                                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40"
                                  onClick={() => void revoke(admin.id, admin.name)}
                                  type="button"
                                >
                                  <Trash2 className="size-3" />
                                  Revoke
                                </button>
                              )}
                            </div>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </DataTable>
            )}
          </Panel>
        </>
      ) : null}
    </div>
  );
});
