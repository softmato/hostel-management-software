"use client";

import React, { useCallback, useMemo, useState, type FormEvent } from "react";
import { Wrench } from "lucide-react";
import {
  EmptyState,
  Input,
  LoadingRows,
  Panel,
  Select,
  StatusBadge,
  TextArea,
} from "@/app/_components/shared-ui";
import { BusyForm, SubmitButton } from "@/app/_components/busy-form";
import { browserApi } from "@/lib/browser-api";
import { hostelAdminEndpoints } from "@/lib/hostel-admin-endpoints";
import {
  combineResources,
  useInvalidateResources,
  usePortalResource,
} from "@/lib/portal-query";
import {
  Message,
  PageHeader,
  field,
  optionalField,
  type MaintenanceRequest,
  type ServiceProvider,
} from "./portal-shared";

export const HostelAdminMaintenancePageContent = React.memo(
  function HostelAdminMaintenancePageContent() {
    const [actionMessage, setActionMessage] = useState("");
    const invalidate = useInvalidateResources();
    // Providers are shared with the Service Provider Search screen — same cache
    // entry, so arriving from there costs no extra request.
    const providersResource = usePortalResource<{ providers: ServiceProvider[] }>(
      hostelAdminEndpoints.serviceProviders,
      { errorMessage: "Could not load maintenance." },
    );
    const requestsResource = usePortalResource<{ requests: MaintenanceRequest[] }>(
      hostelAdminEndpoints.maintenanceRequests,
      { errorMessage: "Could not load maintenance." },
    );

    const providers = useMemo(
      () => providersResource.data?.providers ?? [],
      [providersResource.data],
    );
    const requests = useMemo(
      () => requestsResource.data?.requests ?? [],
      [requestsResource.data],
    );
    const combined = combineResources(providersResource, requestsResource);
    const state = combined.state;
    const message = actionMessage || combined.message;

    const create = useCallback(
      async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);

        try {
          await browserApi(hostelAdminEndpoints.maintenanceRequests, {
            body: JSON.stringify({
              category: field(form, "category"),
              costNote: optionalField(form, "costNote"),
              description: optionalField(form, "description"),
              priority: field(form, "priority"),
              providerId: optionalField(form, "providerId"),
              title: field(form, "title"),
            }),
            method: "POST",
          });
          formElement.reset();
          setActionMessage("Maintenance request created.");
          invalidate(
            hostelAdminEndpoints.maintenanceRequests,
            hostelAdminEndpoints.maintenanceReport,
          );
        } catch (error) {
          setActionMessage(
            error instanceof Error ? error.message : "Could not create request.",
          );
        }
      },
      [invalidate],
    );

    const updateStatus = useCallback(
      async (requestId: string, status: string) => {
        try {
          await browserApi(
            `${hostelAdminEndpoints.maintenanceRequests}/${requestId}/status`,
            {
              body: JSON.stringify({ status }),
              method: "PATCH",
            },
          );
          invalidate(
            hostelAdminEndpoints.maintenanceRequests,
            hostelAdminEndpoints.maintenanceReport,
          );
        } catch (error) {
          setActionMessage(
            error instanceof Error ? error.message : "Could not update request.",
          );
        }
      },
      [invalidate],
    );

    return (
      <div className="mx-auto max-w-[1448px] space-y-6">
        <PageHeader
          description="Create and track hostel repair work with approved providers."
          icon={Wrench}
          title="Maintenance"
        />
        <Message value={message} />
        <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
          <Panel title="Requests">
            {state === "loading" ? <LoadingRows /> : null}
            {state === "error" ? (
              <EmptyState label="Requests could not be loaded." />
            ) : null}
            {state === "ready" && requests.length === 0 ? (
              <EmptyState label="No maintenance requests." />
            ) : null}
            <div className="space-y-3">
              {requests.map((request) => (
                <div className="rounded-lg border border-border p-4" key={request.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-foreground">{request.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {request.category.replaceAll("_", " ")} / {request.priority}
                      </p>
                    </div>
                    <StatusBadge>{request.status}</StatusBadge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {request.description || request.costNote || "-"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {["CONTACTED", "SCHEDULED", "COMPLETED", "CANCELLED"].map((status) => (
                      <button
                        className="rounded-md border border-role-admin px-3 py-2 text-sm font-semibold text-role-admin"
                        key={status}
                        onClick={() => void updateStatus(request.id, status)}
                        type="button"
                      >
                        {status.replaceAll("_", " ")}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="New Request">
            <BusyForm className="grid gap-3" onSubmit={create}>
              <Input label="Title" name="title" required />
              <Select label="Category" name="category" required>
                {[
                  "PLUMBING",
                  "ELECTRICAL",
                  "INTERNET",
                  "CLEANING",
                  "CARPENTRY",
                  "PAINTING",
                  "WATER",
                  "APPLIANCE",
                  "ROOM_REPAIR",
                  "HEALTH",
                  "OTHER",
                ].map((category) => (
                  <option key={category} value={category}>
                    {category.replaceAll("_", " ")}
                  </option>
                ))}
              </Select>
              <Select label="Priority" name="priority">
                {["LOW", "MEDIUM", "HIGH", "URGENT"].map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </Select>
              <Select label="Provider" name="providerId">
                <option value="">Manual contact later</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.fullName} / {provider.category.replaceAll("_", " ")}
                  </option>
                ))}
              </Select>
              <TextArea label="Description" name="description" />
              <Input label="Cost note" name="costNote" />
              <SubmitButton className="h-11 rounded-md bg-role-admin text-sm font-semibold text-white">
                Create Request
              </SubmitButton>
            </BusyForm>
          </Panel>
        </div>
      </div>
    );
  },
);
