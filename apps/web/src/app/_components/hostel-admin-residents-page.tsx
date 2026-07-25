"use client";

import {
  Download,
  MoreHorizontal,
  Plus,
  QrCode,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { memo, useCallback, useMemo, useState, type FormEvent } from "react";

import {
  currency,
  EmptyState,
  Input as FormInput,
  LoadingRows,
  Select as FormSelect,
} from "@/app/_components/shared-ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useResidents, useRoomMap } from "@/hooks/use-hostel-admin";
import { browserApi } from "@/lib/browser-api";
import { cn } from "@/lib/utils";

import { DemoDataBadge, field, optionalField } from "./hostel-admin-shared";
import {
  DataTable,
  EmptyInline,
  InitialsAvatar,
  PortalPageHeader,
  RoleButton,
  SearchField,
  SectionCard,
  SoftBadge,
  statusToneFromLabel,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./portal-dashboard-ui";

export const HostelAdminResidentsPage = memo(function HostelAdminResidentsPage() {
  const residentsQuery = useResidents();
  const roomMapQuery = useRoomMap();
  const residents = useMemo(
    () => residentsQuery.data?.residents ?? [],
    [residentsQuery.data],
  );
  const floors = useMemo(() => roomMapQuery.data?.floors ?? [], [roomMapQuery.data]);
  const isPending = residentsQuery.isPending || roomMapQuery.isPending;
  const isError = residentsQuery.isError || roomMapQuery.isError;

  const [selectedResidentId, setSelectedResidentId] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [showAddForm, setShowAddForm] = useState(false);

  const selectedResident =
    residents.find((resident) => resident.id === selectedResidentId) ?? residents[0];
  const activeResidentId = selectedResident?.id ?? "";

  const roomOptions = useMemo(
    () =>
      floors.flatMap((floor) =>
        floor.rooms.map((room) => ({ ...room, floorName: floor.name })),
      ),
    [floors],
  );

  const bedOptions = useMemo(
    () =>
      roomOptions.flatMap((room) =>
        room.beds.map((bed) => ({
          ...bed,
          label: `${room.floorName} / Room ${room.roomNumber} / Bed ${bed.bedNumber}`,
          roomId: room.id,
          roomNumber: room.roomNumber,
        })),
      ),
    [roomOptions],
  );

  const bedById = useMemo(
    () => new Map(bedOptions.map((bed) => [bed.id, bed])),
    [bedOptions],
  );

  const filteredResidents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return residents.filter((resident) => {
      if (statusFilter !== "ALL" && resident.status !== statusFilter) {
        return false;
      }
      if (typeFilter !== "ALL" && (resident.residentType ?? "STUDENT") !== typeFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      const bed = bedById.get(resident.bedId);
      const haystack = [
        resident.firstName,
        resident.lastName,
        resident.phone,
        resident.email,
        bed?.roomNumber,
        bed?.bedNumber,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [bedById, residents, search, statusFilter, typeFilter]);

  const handleCreateResident = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const bedId = field(form, "bedId");
      const bed = bedOptions.find((option) => option.id === bedId);

      try {
        await browserApi("/api/v1/hostel-admin/residents", {
          body: JSON.stringify({
            bedId,
            depositAmount: Number(field(form, "depositAmount") || 0),
            email: optionalField(form, "email"),
            firstName: field(form, "firstName"),
            lastName: field(form, "lastName"),
            monthlyFee: Number(optionalField(form, "monthlyFee") || 0),
            moveInDate: field(form, "moveInDate"),
            phone: field(form, "phone"),
            residentType: field(form, "residentType"),
            roomId: bed?.roomId,
          }),
          method: "POST",
        });
        event.currentTarget.reset();
        setShowAddForm(false);
        setMessage("Resident created.");
        await residentsQuery.refetch();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not create resident.");
      }
    },
    [bedOptions, residentsQuery],
  );

  const handleGenerateActivation = useCallback(async () => {
    if (!activeResidentId) {
      return;
    }

    try {
      const result = await browserApi<{
        activation: { code?: string };
        delivery: { sent: boolean; to?: string };
      }>(`/api/v1/hostel-admin/residents/${activeResidentId}/activation-code`, {
        // Expiry is left to the platform's qrActivationExpiryDays setting.
        body: JSON.stringify({}),
        method: "POST",
      });

      setActivationCode(result.activation.code ?? "");
      setMessage(
        result.delivery.sent
          ? `Activation code generated and emailed to ${result.delivery.to}.`
          : "Activation code generated. No email was sent — share the code below with the resident.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not generate activation code.",
      );
    }
  }, [activeResidentId]);

  const handleAddGuardian = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!activeResidentId) {
        return;
      }

      const form = new FormData(event.currentTarget);

      try {
        await browserApi(
          `/api/v1/hostel-admin/residents/${activeResidentId}/guardians`,
          {
            body: JSON.stringify({
              email: optionalField(form, "email"),
              firstName: field(form, "firstName"),
              isPrimary: form.get("isPrimary") === "on",
              lastName: field(form, "lastName"),
              phone: field(form, "phone"),
              relation: field(form, "relation"),
            }),
            method: "POST",
          },
        );
        event.currentTarget.reset();
        setMessage("Guardian saved.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not save guardian.");
      }
    },
    [activeResidentId],
  );

  const handleAddEmergencyContact = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!activeResidentId) {
        return;
      }

      const form = new FormData(event.currentTarget);

      try {
        await browserApi(
          `/api/v1/hostel-admin/residents/${activeResidentId}/emergency-contacts`,
          {
            body: JSON.stringify({
              isPrimary: form.get("isPrimary") === "on",
              name: field(form, "name"),
              phone: field(form, "phone"),
              relation: field(form, "relation"),
            }),
            method: "POST",
          },
        );
        event.currentTarget.reset();
        setMessage("Emergency contact saved.");
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Could not save emergency contact.",
        );
      }
    },
    [activeResidentId],
  );

  return (
    <div className="mx-auto max-w-[1448px] space-y-6">
      <PortalPageHeader
        actions={
          <>
            <RoleButton
              onClick={handleGenerateActivation}
              tone="admin"
              type="button"
              variant="outline"
            >
              <QrCode className="size-4" />
              Generate Activation Code
            </RoleButton>
            <RoleButton
              onClick={() => setShowAddForm((value) => !value)}
              tone="admin"
              type="button"
            >
              <Plus className="size-4" />
              Add Resident
            </RoleButton>
          </>
        }
        description="Manage hostel residents, their details, and status."
        title="Residents"
      />

      {message ? (
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">
          {message}
        </div>
      ) : null}

      {showAddForm ? (
        <SectionCard
          actions={
            <Button
              className="size-8"
              onClick={() => setShowAddForm(false)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X className="size-4" />
            </Button>
          }
          description="Add a new resident and assign room, plan, and details."
          title="Register New Resident"
        >
          <form className="grid gap-3 md:grid-cols-2" onSubmit={handleCreateResident}>
            <FormInput label="First name" name="firstName" required />
            <FormInput label="Last name" name="lastName" required />
            <FormInput label="Phone" name="phone" required />
            <FormInput label="Email" name="email" type="email" />
            <FormSelect label="Available bed" name="bedId" required>
              <option value="">Select bed</option>
              {bedOptions
                .filter((bed) => bed.status === "AVAILABLE")
                .map((bed) => (
                  <option key={bed.id} value={bed.id}>
                    {bed.label}
                  </option>
                ))}
            </FormSelect>
            <FormInput label="Move-in date" name="moveInDate" required type="date" />
            <FormInput label="Deposit" name="depositAmount" required type="number" />
            <FormSelect defaultValue="STUDENT" label="Resident type" name="residentType">
              <option value="STUDENT">Student</option>
              <option value="WORKING_PROFESSIONAL">Working professional</option>
              <option value="OTHER">Other</option>
            </FormSelect>
            <FormInput label="Monthly fee" min="0" name="monthlyFee" type="number" />
            <div className="flex items-end">
              <RoleButton className="w-full" tone="admin" type="submit">
                <UserPlus className="size-4" />
                Save Resident
              </RoleButton>
            </div>
          </form>
        </SectionCard>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <SectionCard>
          <div className="mb-4 space-y-3">
            <SearchField
              onChange={setSearch}
              placeholder="Search by name, phone, room..."
              value={search}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Select onValueChange={setStatusFilter} value={statusFilter}>
                <SelectTrigger className="h-10 w-[160px] rounded-xl">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All statuses</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="SUSPENDED">Suspended</SelectItem>
                  <SelectItem value="MOVED_OUT">Moved out</SelectItem>
                </SelectContent>
              </Select>
              <Select onValueChange={setTypeFilter} value={typeFilter}>
                <SelectTrigger className="h-10 w-[190px] rounded-xl">
                  <SelectValue placeholder="Resident type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All types</SelectItem>
                  <SelectItem value="STUDENT">Student</SelectItem>
                  <SelectItem value="WORKING_PROFESSIONAL">Working professional</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
              <SoftBadge tone="cyan">
                <Users className="size-3" />
                Total Residents: {filteredResidents.length}
              </SoftBadge>
              <Button className="ml-auto h-10 gap-2 rounded-xl" type="button" variant="outline">
                <Download className="size-4" />
                Export
              </Button>
            </div>
          </div>

          {isPending ? <LoadingRows /> : null}
          {isError ? <EmptyState label="Residents could not be loaded." /> : null}
          {!isPending && !isError && filteredResidents.length === 0 ? (
            <EmptyInline label="No residents match your filters." />
          ) : null}

          {!isPending && !isError && filteredResidents.length > 0 ? (
            <DataTable className="min-w-[720px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10">
                    <span className="sr-only">Select</span>
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Resident
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Room / Bed
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Phone
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Deposit
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Status
                  </TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredResidents.map((resident) => {
                  const bed = bedById.get(resident.bedId);
                  const fullName = `${resident.firstName} ${resident.lastName}`.trim();
                  const selected = activeResidentId === resident.id;

                  return (
                    <TableRow
                      className={cn(
                        "cursor-pointer",
                        selected && "bg-role-admin-soft/50 data-[state=selected]:bg-role-admin-soft/50",
                      )}
                      data-state={selected ? "selected" : undefined}
                      key={resident.id}
                      onClick={() => {
                        setSelectedResidentId(resident.id);
                        setActivationCode("");
                      }}
                    >
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={selected}
                          onCheckedChange={() => {
                            setSelectedResidentId(resident.id);
                            setActivationCode("");
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <InitialsAvatar name={fullName} size="sm" tone="admin" />
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground">{fullName}</p>
                            {resident.isDemoData ? (
                              <DemoDataBadge label={resident.demoDataLabel} />
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                Room {bed?.roomNumber ?? "—"}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {bed
                          ? `${bed.roomNumber} / Bed ${bed.bedNumber}`
                          : `Room ${resident.roomId.slice(-4)} / Bed ${resident.bedId.slice(-4)}`}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{resident.phone}</TableCell>
                      <TableCell className="font-medium text-foreground">
                        {currency(resident.depositAmount)}
                      </TableCell>
                      <TableCell>
                        <SoftBadge tone={statusToneFromLabel(resident.status)}>
                          {resident.status.replaceAll("_", " ")}
                        </SoftBadge>
                      </TableCell>
                      <TableCell>
                        <Button className="size-8" size="icon" type="button" variant="ghost">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </DataTable>
          ) : null}
        </SectionCard>

        <div className="space-y-5">
          <SectionCard>
            {selectedResident ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <InitialsAvatar
                    name={`${selectedResident.firstName} ${selectedResident.lastName}`}
                    size="lg"
                    tone="admin"
                  />
                  <div className="min-w-0">
                    <p className="text-lg font-bold text-foreground">
                      {selectedResident.firstName} {selectedResident.lastName}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {(() => {
                        const bed = bedById.get(selectedResident.bedId);
                        return bed
                          ? `Room ${bed.roomNumber} · Bed ${bed.bedNumber}`
                          : selectedResident.phone;
                      })()}
                    </p>
                    <div className="mt-2">
                      <SoftBadge tone={statusToneFromLabel(selectedResident.status)}>
                        {selectedResident.status.replaceAll("_", " ")}
                      </SoftBadge>
                    </div>
                  </div>
                </div>

                <Tabs defaultValue="details">
                  <TabsList className="grid w-full grid-cols-3 rounded-xl" variant="line">
                    <TabsTrigger value="details">Details</TabsTrigger>
                    <TabsTrigger value="guardian">Guardian</TabsTrigger>
                    <TabsTrigger value="emergency">Emergency</TabsTrigger>
                  </TabsList>

                  <TabsContent className="mt-4 space-y-3" value="details">
                    <dl className="space-y-2 rounded-xl border border-border bg-muted/15 p-3 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Full Name</dt>
                        <dd className="font-medium text-foreground">
                          {selectedResident.firstName} {selectedResident.lastName}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Phone</dt>
                        <dd className="font-medium text-foreground">
                          {selectedResident.phone}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Email</dt>
                        <dd className="font-medium text-foreground">
                          {selectedResident.email || "—"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Deposit</dt>
                        <dd className="font-medium text-foreground">
                          {currency(selectedResident.depositAmount)}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Move-in</dt>
                        <dd className="font-medium text-foreground">
                          {selectedResident.moveInDate
                            ? new Date(selectedResident.moveInDate).toLocaleDateString()
                            : "—"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Room / Bed</dt>
                        <dd className="font-medium text-foreground">
                          {(() => {
                            const bed = bedById.get(selectedResident.bedId);
                            return bed
                              ? `${bed.roomNumber} / ${bed.bedNumber}`
                              : "Assigned";
                          })()}
                        </dd>
                      </div>
                    </dl>

                    {activationCode ? (
                      <div className="rounded-xl border border-role-admin/30 bg-role-admin-soft/50 p-4">
                        <p className="text-sm font-semibold text-foreground">Activation Code</p>
                        <p className="mt-2 font-mono text-2xl font-bold tracking-widest text-role-admin">
                          {activationCode}
                        </p>
                      </div>
                    ) : (
                      <RoleButton
                        className="w-full"
                        onClick={handleGenerateActivation}
                        tone="admin"
                        type="button"
                        variant="outline"
                      >
                        <QrCode className="size-4" />
                        Generate Activation Code
                      </RoleButton>
                    )}
                  </TabsContent>

                  <TabsContent className="mt-4" value="guardian">
                    <form className="grid gap-3" onSubmit={handleAddGuardian}>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <FormInput label="First name" name="firstName" required />
                        <FormInput label="Last name" name="lastName" required />
                      </div>
                      <FormInput label="Phone" name="phone" required />
                      <FormInput label="Relation" name="relation" required />
                      <FormInput label="Email" name="email" type="email" />
                      <label className="flex items-center gap-2 text-sm text-foreground">
                        <input name="isPrimary" type="checkbox" />
                        Primary guardian
                      </label>
                      <RoleButton className="w-full" tone="admin" type="submit" variant="outline">
                        Save Guardian
                      </RoleButton>
                    </form>
                  </TabsContent>

                  <TabsContent className="mt-4" value="emergency">
                    <form className="grid gap-3" onSubmit={handleAddEmergencyContact}>
                      <FormInput label="Name" name="name" required />
                      <FormInput label="Phone" name="phone" required />
                      <FormInput label="Relation" name="relation" required />
                      <label className="flex items-center gap-2 text-sm text-foreground">
                        <input name="isPrimary" type="checkbox" />
                        Primary contact
                      </label>
                      <RoleButton className="w-full" tone="admin" type="submit" variant="outline">
                        Save Contact
                      </RoleButton>
                    </form>
                  </TabsContent>
                </Tabs>
              </div>
            ) : (
              <EmptyInline label="Select a resident to view details." />
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
});
