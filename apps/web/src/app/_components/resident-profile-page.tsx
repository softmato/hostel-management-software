"use client";

import { BedDouble, Mail, Phone, ShieldAlert, UserRound, Users } from "lucide-react";
import { memo } from "react";

import { EmptyState } from "@/app/_components/shared-ui";
import {
  EmptyInline,
  InitialsAvatar,
  MetricCard,
  PortalPageHeader,
  SectionCard,
  SoftBadge,
  statusToneFromLabel,
} from "@/app/_components/portal-dashboard-ui";
import { usePortalResource } from "@/lib/portal-query";
import { residentEndpoints } from "@/lib/resident-endpoints";
import {
  type ResidentDashboard,
  type ResidentSummary,
  Message,
} from "./resident-shared";

type Profile = {
  emergencyContacts: Array<{
    id: string;
    name: string;
    phone: string;
    relation: string;
  }>;
  guardians: Array<{
    firstName: string;
    id: string;
    lastName: string;
    phone: string;
    relation: string;
  }>;
  resident: ResidentSummary;
  roomBed: ResidentDashboard["roomBed"];
};

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[10.5px] font-medium text-muted-foreground">{label}</p>
        <p className="truncate text-[12.5px] font-semibold text-foreground">
          {value || "—"}
        </p>
      </div>
    </div>
  );
}

export const ResidentProfilePageContent = memo(function ResidentProfilePageContent() {
  const profileResource = usePortalResource<{ profile: Profile }>(
    residentEndpoints.profile,
    { errorMessage: "Could not load profile." },
  );

  const profile = profileResource.data?.profile ?? null;
  const state = profileResource.state;
  const message = profileResource.message;

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <PortalPageHeader
        breadcrumb={[{ href: "/resident", label: "Home" }, "My Profile"]}
        description="Your resident record and hostel contact information."
        title="My Profile"
      />
      <Message value={message} />
      {state === "error" ? <EmptyState label="Profile could not be loaded." /> : null}

      {profile ? (
        <>
          <SectionCard>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3.5">
                <InitialsAvatar
                  name={`${profile.resident.firstName} ${profile.resident.lastName}`}
                  size="lg"
                  tone="resident"
                />
                <div>
                  <p className="text-lg font-bold text-foreground">
                    {profile.resident.firstName} {profile.resident.lastName}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <SoftBadge tone={statusToneFromLabel(profile.resident.status)}>
                      {profile.resident.status}
                    </SoftBadge>
                    <span className="text-[11.5px] text-muted-foreground">
                      Resident ID · {profile.resident.id.slice(-6).toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>

          <div className="grid gap-4 sm:grid-cols-3">
            <MetricCard
              icon={BedDouble}
              label="Room / Bed"
              note="Your assignment"
              tone="green"
              value={`${profile.roomBed.room?.roomNumber ?? "—"} / ${profile.roomBed.bed?.bedNumber ?? "—"}`}
            />
            <MetricCard
              icon={Users}
              label="Guardians"
              note="Linked contacts"
              tone="purple"
              value={String(profile.guardians.length)}
            />
            <MetricCard
              icon={ShieldAlert}
              label="Emergency Contacts"
              note="On record"
              tone="amber"
              value={String(profile.emergencyContacts.length)}
            />
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <SectionCard title="Personal Information">
              <div className="divide-y divide-border/50">
                <InfoRow icon={UserRound} label="Full name" value={profile.resident.fullName} />
                <InfoRow icon={Phone} label="Phone" value={profile.resident.phone} />
                <InfoRow icon={Mail} label="Email" value={profile.resident.email} />
                <InfoRow
                  icon={BedDouble}
                  label="Room type"
                  value={profile.roomBed.room?.roomType?.replaceAll("_", " ")}
                />
              </div>
            </SectionCard>

            <SectionCard title="Contacts">
              {profile.guardians.length === 0 && profile.emergencyContacts.length === 0 ? (
                <EmptyInline label="No guardians or emergency contacts yet." />
              ) : (
                <div className="space-y-2.5">
                  {profile.guardians.map((guardian) => (
                    <div
                      className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/15 p-2.5"
                      key={guardian.id}
                    >
                      <InitialsAvatar
                        name={`${guardian.firstName} ${guardian.lastName}`}
                        size="sm"
                        tone="guardian"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-semibold text-foreground">
                          {guardian.firstName} {guardian.lastName}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {guardian.relation} · {guardian.phone}
                        </p>
                      </div>
                      <SoftBadge tone="purple">Guardian</SoftBadge>
                    </div>
                  ))}
                  {profile.emergencyContacts.map((contact) => (
                    <div
                      className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/15 p-2.5"
                      key={contact.id}
                    >
                      <InitialsAvatar name={contact.name} size="sm" tone="resident" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-semibold text-foreground">
                          {contact.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {contact.relation} · {contact.phone}
                        </p>
                      </div>
                      <SoftBadge tone="amber">Emergency</SoftBadge>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        </>
      ) : null}
    </div>
  );
});
