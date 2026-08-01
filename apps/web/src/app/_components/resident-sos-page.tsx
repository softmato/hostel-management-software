"use client";

import { Siren } from "lucide-react";
import { memo, useCallback, useMemo, useState, type FormEvent } from "react";

import { BusyForm, SubmitButton } from "@/app/_components/busy-form";
import { browserApi } from "@/lib/browser-api";
import { usePortalResource } from "@/lib/portal-query";
import { residentEndpoints } from "@/lib/resident-endpoints";
import { field, Message, PageHeader } from "./daily-operations-shared";
import { EmptyState, Panel, TextArea } from "@/app/_components/shared-ui";

type EmergencyContact = {
  id: string;
  name: string;
  phone: string;
  relation: string;
};

export const ResidentSOSPageContent = memo(function ResidentSOSPageContent() {
  const [actionMessage, setActionMessage] = useState("");
  const contactsResource = usePortalResource<{ contacts: EmergencyContact[] }>(
    residentEndpoints.emergencyContacts,
    { errorMessage: "Could not load contacts." },
  );

  const contacts = useMemo(
    () => contactsResource.data?.contacts ?? [],
    [contactsResource.data],
  );
  const message = actionMessage || contactsResource.message;

  const trigger = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const alertsGuardian = form.get("guardianAlertEnabled") === "on";

    // §4.1: an SOS mails every admin and warden the moment it is raised, so the
    // one thing that must not happen is raising it by brushing the button.
    if (
      !window.confirm(
        alertsGuardian
          ? "Raise an emergency SOS? This immediately alerts hostel staff, every warden, and your guardian."
          : "Raise an emergency SOS? This immediately alerts hostel staff and every warden.",
      )
    ) {
      return;
    }

    try {
      await browserApi("/api/v1/resident/sos", {
        body: JSON.stringify({
          guardianAlertEnabled: form.get("guardianAlertEnabled") === "on",
          message: field(form, "message"),
        }),
        method: "POST",
      });
      setActionMessage("SOS alert triggered.");
      formElement.reset();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Could not trigger SOS.");
    }
  }, []);

  return (
    <div className="mx-auto max-w-[900px] space-y-6">
      <PageHeader
        description="Trigger an emergency alert for hostel staff."
        icon={Siren}
        title="SOS"
      />
      <Message value={message} />
      <Panel title="Emergency Alert">
        <BusyForm className="grid gap-3" onSubmit={trigger}>
          <TextArea label="Message" name="message" />
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input name="guardianAlertEnabled" type="checkbox" />
            Alert guardian if enabled
          </label>
          <SubmitButton className="h-11 rounded-md bg-rose-600 text-sm font-semibold text-white">
            Trigger SOS
          </SubmitButton>
        </BusyForm>
      </Panel>
      <Panel title="Emergency Contacts">
        {contacts.length === 0 ? <EmptyState label="No emergency contacts." /> : null}
        <div className="grid gap-3 md:grid-cols-2">
          {contacts.map((contact) => (
            <div className="rounded-lg border border-border p-4" key={contact.id}>
              <p className="font-semibold text-foreground">{contact.name}</p>
              <p className="text-sm text-muted-foreground">
                {contact.relation} / {contact.phone}
              </p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
});
