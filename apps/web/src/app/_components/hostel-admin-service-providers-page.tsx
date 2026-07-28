"use client";

import React, { useMemo } from "react";
import { Search } from "lucide-react";
import { EmptyState, LoadingRows, Panel } from "@/app/_components/shared-ui";
import { hostelAdminEndpoints } from "@/lib/hostel-admin-endpoints";
import { usePortalResource } from "@/lib/portal-query";
import { Message, PageHeader, type ServiceProvider } from "./portal-shared";

export const HostelAdminServiceProvidersPageContent = React.memo(
  function HostelAdminServiceProvidersPageContent() {
    const providersResource = usePortalResource<{ providers: ServiceProvider[] }>(
      hostelAdminEndpoints.serviceProviders,
      { errorMessage: "Could not load providers." },
    );

    const providers = useMemo(
      () => providersResource.data?.providers ?? [],
      [providersResource.data],
    );
    const message = providersResource.message;
    const state = providersResource.state;

    return (
      <div className="mx-auto max-w-[1448px] space-y-6">
        <PageHeader
          description="Approved local providers available for hostel maintenance."
          icon={Search}
          title="Service Provider Search"
        />
        <Message value={message} />
        <Panel>
          {state === "loading" ? <LoadingRows /> : null}
          {state === "error" ? <EmptyState label="Providers could not be loaded." /> : null}
          {state === "ready" && providers.length === 0 ? (
            <EmptyState label="No approved providers." />
          ) : null}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {providers.map((provider) => (
              <div className="rounded-lg border border-border p-4" key={provider.id}>
                <p className="font-semibold text-foreground">{provider.fullName}</p>
                <p className="text-sm text-muted-foreground">
                  {provider.category.replaceAll("_", " ")} / {provider.area}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">{provider.phone}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {provider.availability || provider.description || "-"}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    );
  },
);
