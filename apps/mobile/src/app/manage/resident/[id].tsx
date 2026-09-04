import { useLocalSearchParams } from "expo-router";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { Alert, Linking, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Chip, FactRow } from "@/components/ui/layout";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Money } from "@/components/ui/money";
import { Screen } from "@/components/ui/screen";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { Toggle } from "@/components/ui/toggle";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import {
  addEmergencyContact,
  addResidentGuardian,
  type ActivationIssue,
  issueActivationCode,
  issueGuardianAccess,
  type MoveOutChecklist,
  saveMoveInChecklist,
  saveMoveOutChecklist,
  setResidentFee,
  setResidentStatus,
  updateResident,
} from "@/lib/admin-manage-api";
import { type AdminResidentRecord, adminQuery } from "@/lib/admin-queries";
import { readApiError } from "@/lib/api-contract";
import { humanizeEnum } from "@/lib/format";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * One resident, and everything a hostel does to a tenancy.
 *
 * The roster tab used to end with "registering, moving someone in or out, and
 * issuing activation codes are done from the web portal". This is those, plus
 * the record itself, the contacts, the guardian login and the fee override.
 *
 * ## Three of these actions move a bed or money, and say so before they run
 *
 * - **Changing room type** moves a unit of vacancy between two types, and fails
 *   outright if the destination is full. It is not a label.
 * - **Moving out** does not free the bed by itself — the *status* does — so the
 *   sheet writes the checklist and sets `MOVED_OUT` together, which is the only
 *   way the two cannot drift apart.
 * - **Clearing the fee override** is `null`, not `0`. Zero is a deliberate free
 *   stay and the charge resolver honours it; null hands the resident back to the
 *   hostel's fee schedule. A form that treats an empty box as zero would quietly
 *   stop billing somebody.
 *
 * ## The activation code exists once
 *
 * Only its hash is stored. The plaintext comes back in the issuing response and
 * nowhere else, so this screen holds it on screen until dismissed and says
 * plainly that it cannot be looked up again. Email delivery is best-effort and
 * reports separately: a failed email does not invalidate the code.
 */

type Panel =
  | "activation"
  | "contact"
  | "details"
  | "fee"
  | "guardian"
  | "moveIn"
  | "moveOut"
  | "roomType"
  | "status"
  | null;

const STATUS_OPTIONS = [
  { description: "Registered, not moved in yet.", label: "Pending", value: "PENDING" },
  { description: "Living here now.", label: "Active", value: "ACTIVE" },
  {
    description: "Still on the roll, but access is withdrawn.",
    label: "Suspended",
    value: "SUSPENDED",
  },
  { description: "Gone. Their bed goes back to the pool.", label: "Moved out", value: "MOVED_OUT" },
] as const;

const REFUND_OPTIONS = [
  { description: "Not decided yet.", label: "Pending", value: "PENDING" },
  { description: "The whole deposit goes back.", label: "Full refund", value: "APPROVED" },
  { description: "Some withheld — say why below.", label: "Partial", value: "PARTIAL" },
  { description: "Nothing goes back.", label: "Forfeited", value: "FORFEITED" },
] as const;

/*
 * `ResidentData` and its six-request loader are `adminQuery.resident(id)` — see
 * `lib/admin-queries.ts`. The roster warms this key on touch-down of a row, so
 * the record is usually on its way before the screen is pushed.
 */

/**
 * One labelled block of facts inside the See details sheet.
 *
 * Not `Card` and not `SectionHeader`: a card inside a sheet is a panel inside a
 * panel, two borders deep for no gain, and the section header is sized for a
 * page. This is the sheet's own weight — a small heading with the rows under it,
 * separated by a hairline so eight sections read as eight rather than as forty
 * lines of label-and-value.
 */
function DetailSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <View className="gap-0.5">
      <Text className="pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </Text>
      <View className="rounded-2xl border border-border bg-card px-3 py-1">{children}</View>
    </View>
  );
}

function toNumber(value: string) {
  const parsed = Number(value.trim());

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export default function ManageResidentScreen() {
  const dates = useDates();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = adminQuery.resident(id);
  const data = useResource<AdminResidentRecord>(query.load, {
    cacheKey: query.key,
    topics: query.topics,
  });

  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [issued, setIssued] = useState<ActivationIssue | null>(null);

  const resident = data.data?.resident ?? null;

  /*
   * Memoised rather than a bare `??`: the fallback object is a fresh identity on
   * every render, and `openPanel` closes over it — so an unmemoised default
   * would re-create that callback on every keystroke in any sheet it opens.
   */
  const contacts = useMemo(
    () => data.data?.contacts ?? { emergencyContacts: [], guardians: [] },
    [data.data],
  );
  const roomTypes = data.data?.roomTypes ?? [];
  const ledger = data.data?.ledger ?? null;
  const moveIn = data.data?.moveIn ?? null;
  const moveOut = data.data?.moveOut ?? null;

  /*
   * The months the ledger still has money against. `dueAmount > paidAmount`
   * rather than `status !== "PAID"`: a partially settled month is money still
   * owed, and a month the hostel never billed has neither figure and is not the
   * resident's problem.
   */
  const monthsOwed = useMemo(
    () => (ledger?.months ?? []).filter((month) => month.dueAmount > month.paidAmount),
    [ledger],
  );

  const fullName = useMemo(
    () => (resident ? `${resident.firstName} ${resident.lastName}`.trim() : ""),
    [resident],
  );

  const { reload } = data;

  const openPanel = useCallback(
    (next: Panel) => {
      if (!resident) {
        return;
      }

      // `details` seeds nothing — it is a read-only panel now, and leaving the
      // last sheet's draft in `form` is harmless because nothing there reads it.
      if (next === "roomType") {
        setForm({ roomType: resident.roomType });
      }

      if (next === "fee") {
        setForm({ monthlyFee: resident.monthlyFee ? String(resident.monthlyFee) : "", reason: "" });
      }

      if (next === "status") {
        setForm({ status: resident.status });
      }

      if (next === "guardian") {
        setForm({ firstName: "", lastName: "", phone: "", relation: "" });
        setFlags({ isPrimary: contacts.guardians.length === 0 });
      }

      if (next === "contact") {
        setForm({ name: "", phone: "", relation: "" });
        setFlags({ isPrimary: contacts.emergencyContacts.length === 0 });
      }

      if (next === "moveIn") {
        const checklist = data.data?.moveIn;

        setForm({
          bedCondition: checklist?.bedCondition ?? "",
          depositAmount: String(checklist?.depositAmount ?? resident.depositAmount ?? 0),
          documentsCollected: (checklist?.documentsCollected ?? []).join(", "),
          itemsProvided: (checklist?.itemsProvided ?? []).join(", "),
          roomCondition: checklist?.roomCondition ?? "",
        });
        setFlags({ rulesAccepted: checklist?.rulesAccepted ?? false });
      }

      if (next === "moveOut") {
        const checklist = data.data?.moveOut;

        setForm({
          damageNotes: checklist?.damageNotes ?? "",
          depositRefundAmount: String(
            checklist?.depositRefundAmount ?? resident.depositAmount ?? 0,
          ),
          depositRefundDecision: checklist?.depositRefundDecision ?? "PENDING",
          itemReturnNotes: checklist?.itemReturnNotes ?? "",
        });
        setFlags({ alsoMoveOut: resident.status !== "MOVED_OUT" });
      }

      if (next === "activation") {
        setIssued(null);
        setFlags({ sendEmail: Boolean(resident.email) });
      }

      setPanel(next);
    },
    [contacts, data.data, resident],
  );

  const run = useCallback(
    async (work: () => Promise<void>, success: string, close = true) => {
      setBusy(true);

      try {
        await work();
        toastSuccess(success);

        if (close) {
          setPanel(null);
        }

        await reload();
      } catch (error) {
        toastError("That did not work", readApiError(error));
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const saveFee = useCallback(
    (clear: boolean) => {
      void run(
        () =>
          setResidentFee({
            monthlyFee: clear ? null : toNumber(form.monthlyFee ?? "0"),
            reason: form.reason?.trim() || undefined,
            residentIds: [id],
          }),
        clear ? "Back on the fee schedule" : "Fee set",
      );
    },
    [form, id, run],
  );

  const issueCode = useCallback(async () => {
    setBusy(true);

    try {
      const result = await issueActivationCode(id, {
        reissue: true,
        sendEmail: flags.sendEmail ?? false,
      });

      setIssued(result);
      await reload();
    } catch (error) {
      toastError("Could not issue a code", readApiError(error));
    } finally {
      setBusy(false);
    }
  }, [flags.sendEmail, id, reload]);

  const confirmMoveOut = useCallback(() => {
    Alert.alert(
      `Move ${fullName} out?`,
      flags.alsoMoveOut
        ? "The checklist is recorded and their bed goes back to the pool."
        : "The checklist is recorded. Their status is left as it is, so the bed stays taken.",
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () => {
            void run(async () => {
              await saveMoveOutChecklist(id, {
                damageNotes: form.damageNotes?.trim() || undefined,
                depositRefundAmount: toNumber(form.depositRefundAmount ?? "0"),
                depositRefundDecision: (form.depositRefundDecision ??
                  "PENDING") as MoveOutChecklist["depositRefundDecision"] as
                  | "PENDING"
                  | "APPROVED"
                  | "PARTIAL"
                  | "FORFEITED",
                itemReturnNotes: form.itemReturnNotes?.trim() || undefined,
              });

              if (flags.alsoMoveOut) {
                await setResidentStatus(id, "MOVED_OUT");
              }
            }, "Move-out recorded");
          },
          style: "destructive",
          text: "Move out",
        },
      ],
    );
  }, [flags.alsoMoveOut, form, fullName, id, run]);

  if (data.loading) {
    return (
      <Screen header={<AppBar accent centerTitle showBack title="Resident" />}>
        <LoadingState label="Reading their record" />
      </Screen>
    );
  }

  if (data.error || !resident) {
    return (
      <Screen header={<AppBar accent centerTitle showBack title="Resident" />}>
        <ErrorState message={data.error ?? "Not found"} onRetry={data.reload} />
      </Screen>
    );
  }

  return (
    <Screen
      header={<AppBar accent centerTitle showBack subtitle={humanizeEnum(resident.roomType)} title={fullName} />}
      onRefresh={data.refresh}
      refreshing={data.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <Card className="gap-3">
          <View className="flex-row items-center gap-3">
            <Avatar name={fullName} size="lg" />

            <View className="flex-1">
              <Text variant="subtitle">{fullName}</Text>
              <Text variant="caption">{resident.email || resident.phone}</Text>
            </View>

            <StatusPill status={resident.status} />
          </View>

          <View className="flex-row flex-wrap gap-2">
            {resident.phone ? (
              <Chip
                icon="call-outline"
                label={resident.phone}
                onPress={() => void Linking.openURL(`tel:${resident.phone}`)}
                tone="brand"
              />
            ) : null}
            <Chip icon="bed-outline" label={humanizeEnum(resident.roomType)} />
            <Chip icon="person-outline" label={humanizeEnum(resident.residentType)} />
            <Chip
              icon="calendar-outline"
              label={`Since ${dates.date(resident.moveInDate)}`}
            />
            {resident.userId ? null : (
              <Badge label="No app account yet" tone="warning" />
            )}
          </View>

          <View className="gap-1 border-t border-border pt-3">
            <FactRow
              label="Monthly fee"
              value={
                resident.monthlyFee > 0 ? (
                  <Money value={resident.monthlyFee} />
                ) : (
                  <Text variant="muted">On the fee schedule</Text>
                )
              }
            />
            <FactRow label="Deposit" value={<Money value={resident.depositAmount} />} />
          </View>
        </Card>

        <View>
          <SectionHeader title="The record" />
          <Card padding="px-4 py-1">
            <ListRow
              icon="person-circle-outline"
              onPress={() => openPanel("details")}
              subtitle="Everything on file, and what they have paid"
              title="See details"
            />
            <RowDivider inset />
            <ListRow
              icon="bed-outline"
              onPress={() => openPanel("roomType")}
              subtitle={humanizeEnum(resident.roomType)}
              title="Room type"
            />
            <RowDivider inset />
            <ListRow
              icon="swap-horizontal-outline"
              onPress={() => openPanel("status")}
              subtitle={humanizeEnum(resident.status)}
              title="Status"
            />
            <RowDivider inset />
            <ListRow
              icon="cash-outline"
              onPress={() => openPanel("fee")}
              subtitle={
                resident.monthlyFee > 0
                  ? "A per-person override is set"
                  : "Billed from the hostel's fee schedule"
              }
              title="Monthly fee"
            />
            <RowDivider inset />
            <ListRow
              icon="qr-code-outline"
              onPress={() => openPanel("activation")}
              subtitle={
                resident.userId
                  ? "They already have an account — this issues a fresh code"
                  : "Lets them sign in to the app for the first time"
              }
              title="Activation code"
            />
          </Card>
        </View>

        <View>
          <SectionHeader
            subtitle="What was handed over, and what came back"
            title="Moving in and out"
          />
          <Card padding="px-4 py-1">
            <ListRow
              icon="log-in-outline"
              onPress={() => openPanel("moveIn")}
              subtitle={
                data.data?.moveIn?.completedAt
                  ? `Recorded ${dates.date(data.data.moveIn.completedAt)}`
                  : "Not recorded yet"
              }
              title="Move-in checklist"
            />
            <RowDivider inset />
            <ListRow
              icon="log-out-outline"
              onPress={() => openPanel("moveOut")}
              subtitle={
                data.data?.moveOut?.completedAt
                  ? `Recorded ${dates.date(data.data.moveOut.completedAt)}`
                  : "Deposit, damages, and handing the bed back"
              }
              title="Move-out checklist"
            />
          </Card>
        </View>

        <View>
          <SectionHeader
            action={
              <Button
                label="Add"
                onPress={() => openPanel("guardian")}
                size="sm"
                variant="outline"
              />
            }
            subtitle="Who the hostel calls, and who may sign in on their behalf"
            title="Guardians"
          />
          <Card className="gap-3">
            {contacts.guardians.length === 0 ? (
              <Text variant="muted">
                Nobody listed. A guardian is who gets told about an SOS or a long
                absence.
              </Text>
            ) : (
              contacts.guardians.map((guardian) => (
                <View className="gap-2" key={guardian.id}>
                  <View className="flex-row items-center gap-2">
                    <View className="flex-1">
                      <Text variant="label">
                        {`${guardian.firstName} ${guardian.lastName}`.trim()}
                      </Text>
                      <Text variant="caption">
                        {`${guardian.relation}${guardian.email ? ` · ${guardian.email}` : ""}`}
                      </Text>
                    </View>
                    {guardian.isPrimary ? <Badge label="Primary" tone="info" /> : null}
                  </View>

                  <View className="flex-row flex-wrap gap-2">
                    {guardian.phone ? (
                      <Chip
                        icon="call-outline"
                        label={guardian.phone}
                        onPress={() => void Linking.openURL(`tel:${guardian.phone}`)}
                        tone="brand"
                      />
                    ) : null}
                    <Chip
                      icon="key-outline"
                      label="Give them a login"
                      onPress={() =>
                        void run(
                          async () => {
                            const result = await issueGuardianAccess(id, {
                              expiresInDays: 30,
                              guardianId: guardian.id,
                            });

                            if (result.accessCode) {
                              Alert.alert(
                                "Guardian access code",
                                `${result.accessCode}\n\nThey sign in with their phone number and this code. It lasts 30 days.`,
                              );
                            }
                          },
                          "Access issued",
                          false,
                        )
                      }
                    />
                  </View>
                </View>
              ))
            )}
          </Card>
        </View>

        <View>
          <SectionHeader
            action={
              <Button
                label="Add"
                onPress={() => openPanel("contact")}
                size="sm"
                variant="outline"
              />
            }
            subtitle="Called in an emergency, in this order"
            title="Emergency contacts"
          />
          <Card className="gap-2">
            {contacts.emergencyContacts.length === 0 ? (
              <Text variant="muted">Nobody listed.</Text>
            ) : (
              contacts.emergencyContacts.map((contact) => (
                <View className="flex-row items-center gap-2" key={contact.id}>
                  <View className="flex-1">
                    <Text variant="label">{contact.name}</Text>
                    <Text variant="caption">{contact.relation}</Text>
                  </View>
                  {contact.isPrimary ? <Badge label="First" tone="info" /> : null}
                  <Chip
                    icon="call-outline"
                    label={contact.phone}
                    onPress={() => void Linking.openURL(`tel:${contact.phone}`)}
                    tone="brand"
                  />
                </View>
              ))
            )}
          </Card>
        </View>
      </View>

      {/* ------------------------------------------------------------------ */}
      {/*
        Read-only, and deliberately.

        This was an edit form — name, phone, email, resident type, move-in date
        and deposit, all writable by whoever had the phone. That is the wrong way
        round: the identity on a record comes from the person themselves, through
        the code they registered with, and a hostel that can retype somebody's
        name and number can quietly make the record stop matching the human it is
        about. So the panel shows; it does not edit.

        What a hostel *decides* rather than *receives* still has its own row next
        to this one — status, room type, the fee override — because those are the
        hostel's facts about a tenancy, not the resident's facts about themselves.
      */}
      <Sheet onClose={() => setPanel(null)} open={panel === "details"} title={fullName}>
        <View className="gap-5 pb-2">
          <View className="flex-row items-center gap-3">
            <Avatar name={fullName} size="lg" />
            <View className="flex-1 gap-1">
              <Text variant="subtitle">{fullName}</Text>
              <View className="flex-row flex-wrap items-center gap-2">
                <StatusPill status={resident.status} />
                {resident.userId ? (
                  <Badge label="Has an app account" tone="success" />
                ) : (
                  <Badge label="No app account yet" tone="warning" />
                )}
              </View>
            </View>
          </View>

          <DetailSection title="Who they are">
            <FactRow
              label="Phone"
              value={
                resident.phone ? (
                  <Chip
                    icon="call-outline"
                    label={resident.phone}
                    onPress={() => void Linking.openURL(`tel:${resident.phone}`)}
                    tone="brand"
                  />
                ) : (
                  <Text variant="muted">Not on file</Text>
                )
              }
            />
            <FactRow
              label="Email"
              value={resident.email || <Text variant="muted">Not on file</Text>}
            />
            <FactRow label="They are a" value={humanizeEnum(resident.residentType)} />
          </DetailSection>

          <DetailSection title="Their tenancy">
            <FactRow label="Room type" value={humanizeEnum(resident.roomType)} />
            <FactRow label="Moved in" value={dates.date(resident.moveInDate)} />
            <FactRow label="Status" value={humanizeEnum(resident.status)} />
            {resident.createdAt ? (
              <FactRow label="On the roll since" value={dates.date(resident.createdAt)} />
            ) : null}
          </DetailSection>

          {/*
            The money, which is what this panel gets opened for as often as the
            phone number. Both figures come from the ledger route — totalled by
            the server across every invoice since move-in, rather than added up
            here from the one month the Money tab happens to be showing.
          */}
          <DetailSection title="What they have paid">
            {ledger ? (
              <>
                <FactRow label="Paid so far" value={<Money value={ledger.totals.paid} />} />
                <FactRow
                  label="Still owed"
                  value={
                    ledger.totals.outstanding > 0 ? (
                      <Money owed value={ledger.totals.outstanding} />
                    ) : (
                      <Text className="text-sm font-medium text-success">
                        Nothing outstanding
                      </Text>
                    )
                  }
                />
                <FactRow
                  label="Months settled"
                  value={`${ledger.totals.monthsPaid} of ${ledger.totals.monthsBilled}`}
                />
                {monthsOwed.length > 0 ? (
                  <FactRow
                    label={monthsOwed.length === 1 ? "Month still open" : "Months still open"}
                    value={monthsOwed.map((month) => dates.period(month.period)).join(", ")}
                  />
                ) : null}
              </>
            ) : (
              <Text variant="muted">
                This account does not have the payments permission, so their history is
                not shown here.
              </Text>
            )}

            <FactRow
              label="Monthly fee"
              value={
                resident.monthlyFee > 0 ? (
                  <Money value={resident.monthlyFee} />
                ) : (
                  <Text variant="muted">On the fee schedule</Text>
                )
              }
            />
            <FactRow label="Deposit held" value={<Money value={resident.depositAmount} />} />
          </DetailSection>

          <DetailSection title="Handover">
            <FactRow
              label="Move-in"
              value={
                moveIn?.completedAt ? (
                  dates.date(moveIn.completedAt)
                ) : (
                  <Text variant="muted">Not recorded</Text>
                )
              }
            />
            {moveIn ? (
              <>
                <FactRow
                  label="Documents"
                  value={
                    moveIn.documentsCollected.length > 0 ? (
                      moveIn.documentsCollected.join(", ")
                    ) : (
                      <Text variant="muted">None listed</Text>
                    )
                  }
                />
                <FactRow
                  label="Items given"
                  value={
                    moveIn.itemsProvided.length > 0 ? (
                      moveIn.itemsProvided.join(", ")
                    ) : (
                      <Text variant="muted">None listed</Text>
                    )
                  }
                />
                <FactRow
                  label="House rules"
                  value={moveIn.rulesAccepted ? "Read and accepted" : "Not accepted"}
                />
              </>
            ) : null}
            <FactRow
              label="Move-out"
              value={
                moveOut?.completedAt ? (
                  dates.date(moveOut.completedAt)
                ) : (
                  <Text variant="muted">Still living here</Text>
                )
              }
            />
          </DetailSection>

          <DetailSection title="Who to call">
            <FactRow
              label="Guardians"
              value={
                contacts.guardians.length > 0 ? (
                  contacts.guardians
                    .map((guardian) => `${guardian.firstName} ${guardian.lastName} · ${guardian.relation}`)
                    .join(", ")
                ) : (
                  <Text variant="muted">Nobody listed</Text>
                )
              }
            />
            <FactRow
              label="Emergency contacts"
              value={
                contacts.emergencyContacts.length > 0 ? (
                  contacts.emergencyContacts
                    .map((contact) => `${contact.name} · ${contact.phone}`)
                    .join(", ")
                ) : (
                  <Text variant="muted">Nobody listed</Text>
                )
              }
            />
          </DetailSection>

          <Text variant="caption">
            Name, phone and email are what the resident registered with and are not
            edited here — a correction has to come from them. Room type, status and the
            fee are the hostel&apos;s own, and each has its own row.
          </Text>
        </View>
      </Sheet>

      {/* ------------------------------------------------------------------ */}
      {/*
        Room type stayed writable when the rest of that form did not, because it
        is not a fact about the person: it says which pool of beds this tenancy
        is spending. The server takes a bed off the destination type and hands
        one back to the old one, and refuses outright if the destination is full.
      */}
      <Sheet
        footer={
          <Button
            label="Move them"
            loading={busy}
            onPress={() =>
              void run(
                () => updateResident(id, { roomType: form.roomType }),
                "Room type changed",
              )
            }
          />
        }
        onClose={() => setPanel(null)}
        open={panel === "roomType"}
        title="Room type"
      >
        <View className="gap-3 pb-2">
          <Select
            hint="Moving a bed between room types fails if the new one is full."
            label="Room type"
            onChange={(roomType) => setForm((prev) => ({ ...prev, roomType }))}
            options={roomTypes.map((value) => ({ label: value, value }))}
            value={form.roomType ?? null}
          />
        </View>
      </Sheet>

      {/* ------------------------------------------------------------------ */}
      <Sheet
        footer={
          <Button
            label="Set status"
            loading={busy}
            onPress={() =>
              void run(
                () =>
                  setResidentStatus(
                    id,
                    (form.status ?? "ACTIVE") as "PENDING" | "ACTIVE" | "SUSPENDED" | "MOVED_OUT",
                  ),
                "Status changed",
              )
            }
          />
        }
        onClose={() => setPanel(null)}
        open={panel === "status"}
        title="Status"
      >
        <View className="gap-3 pb-2">
          <Select
            label="They are"
            onChange={(status) => setForm((prev) => ({ ...prev, status }))}
            options={STATUS_OPTIONS}
            value={form.status ?? null}
          />
          <Text variant="caption">
            Moving somebody out here returns their bed to the pool immediately. If you
            also want the deposit and damages recorded, use the move-out checklist
            instead — it does both.
          </Text>
        </View>
      </Sheet>

      {/* ------------------------------------------------------------------ */}
      <Sheet
        footer={<Button label="Set this fee" loading={busy} onPress={() => saveFee(false)} />}
        onClose={() => setPanel(null)}
        open={panel === "fee"}
        title="Monthly fee"
      >
        <View className="gap-3 pb-2">
          <Text variant="caption">
            An override for this person only. Without one they are billed from the
            hostel&apos;s fee schedule, which is what most residents should be on.
          </Text>

          <Input
            hint="Zero is allowed and means a deliberate free stay — it is not the same as having no override."
            keyboardType="number-pad"
            label="Fee (NPR)"
            onChangeText={(monthlyFee) => setForm((prev) => ({ ...prev, monthlyFee }))}
            value={form.monthlyFee ?? ""}
          />

          <Input
            hint="Kept on the audit entry."
            label="Why"
            onChangeText={(reason) => setForm((prev) => ({ ...prev, reason }))}
            placeholder="Staff discount, agreed with the owner"
            value={form.reason ?? ""}
          />

          <Button
            label="Put them back on the fee schedule"
            loading={busy}
            onPress={() => saveFee(true)}
            variant="outline"
          />
        </View>
      </Sheet>

      {/* ------------------------------------------------------------------ */}
      <Sheet
        footer={
          issued ? (
            <Button label="Done" onPress={() => setPanel(null)} />
          ) : (
            <Button label="Issue a code" loading={busy} onPress={() => void issueCode()} />
          )
        }
        onClose={() => setPanel(null)}
        open={panel === "activation"}
        title="Activation code"
      >
        <View className="gap-3 pb-2">
          {issued ? (
            <>
              <Card className="items-center gap-2">
                <Text variant="caption">Read this out or write it down</Text>
                <Text className="text-2xl font-semibold tracking-[4px]">
                  {issued.activation.code ?? "—"}
                </Text>
                {issued.activation.expiresAt ? (
                  <Text variant="caption">
                    {`Valid until ${dates.dateTime(issued.activation.expiresAt)}`}
                  </Text>
                ) : null}
              </Card>

              <Text variant="caption">
                Only a hash of this is stored, so it cannot be looked up again — issuing
                another one cancels this.
              </Text>

              <Badge
                label={
                  issued.delivery.sent
                    ? "Emailed to the resident"
                    : `Not emailed${issued.delivery.reason ? ` (${issued.delivery.reason})` : ""}`
                }
                tone={issued.delivery.sent ? "success" : "warning"}
              />
            </>
          ) : (
            <>
              <Text variant="caption">
                {resident.userId
                  ? "This person already has an account. A new code lets them set it up again on a different phone, and cancels any code still outstanding."
                  : "The code is how they sign in for the first time. Issuing a new one cancels any that is still outstanding."}
              </Text>

              <View className="flex-row items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
                <View className="flex-1">
                  <Text variant="label">Email it to them</Text>
                  <Text variant="caption">
                    {resident.email
                      ? resident.email
                      : "No email on file — you will have to read it out."}
                  </Text>
                </View>
                <Toggle
                  accessibilityLabel="Email the activation code"
                  disabled={!resident.email}
                  onChange={(sendEmail) => setFlags((prev) => ({ ...prev, sendEmail }))}
                  value={flags.sendEmail ?? false}
                />
              </View>
            </>
          )}
        </View>
      </Sheet>

      {/* ------------------------------------------------------------------ */}
      <Sheet
        footer={
          <Button
            label="Save the checklist"
            loading={busy}
            onPress={() =>
              void run(
                () =>
                  saveMoveInChecklist(id, {
                    bedCondition: form.bedCondition?.trim() || undefined,
                    depositAmount: toNumber(form.depositAmount ?? "0"),
                    documentsCollected: (form.documentsCollected ?? "")
                      .split(",")
                      .map((entry) => entry.trim())
                      .filter(Boolean),
                    itemsProvided: (form.itemsProvided ?? "")
                      .split(",")
                      .map((entry) => entry.trim())
                      .filter(Boolean),
                    roomPhotoAssetIds: [],
                    rulesAccepted: flags.rulesAccepted ?? false,
                  }),
                "Move-in recorded",
              )
            }
          />
        }
        onClose={() => setPanel(null)}
        open={panel === "moveIn"}
        title="Move-in checklist"
      >
        <View className="gap-3 pb-2">
          <Input
            keyboardType="number-pad"
            label="Deposit taken (NPR)"
            onChangeText={(depositAmount) => setForm((prev) => ({ ...prev, depositAmount }))}
            value={form.depositAmount ?? ""}
          />
          <Input
            hint="Comma separated."
            label="Documents collected"
            onChangeText={(documentsCollected) =>
              setForm((prev) => ({ ...prev, documentsCollected }))
            }
            placeholder="Citizenship copy, college ID"
            value={form.documentsCollected ?? ""}
          />
          <Input
            hint="Comma separated. What goes back out with them when they leave."
            label="Items provided"
            onChangeText={(itemsProvided) => setForm((prev) => ({ ...prev, itemsProvided }))}
            placeholder="Mattress, pillow, key, cupboard key"
            value={form.itemsProvided ?? ""}
          />
          <Input
            label="Room condition"
            multiline
            onChangeText={(roomCondition) => setForm((prev) => ({ ...prev, roomCondition }))}
            style={{ height: 72 }}
            value={form.roomCondition ?? ""}
          />
          <Input
            label="Bed condition"
            multiline
            onChangeText={(bedCondition) => setForm((prev) => ({ ...prev, bedCondition }))}
            style={{ height: 72 }}
            value={form.bedCondition ?? ""}
          />
          <View className="flex-row items-center justify-between gap-3">
            <Text className="flex-1" variant="label">
              House rules read and accepted
            </Text>
            <Toggle
              accessibilityLabel="Rules accepted"
              onChange={(rulesAccepted) => setFlags((prev) => ({ ...prev, rulesAccepted }))}
              value={flags.rulesAccepted ?? false}
            />
          </View>
        </View>
      </Sheet>

      {/* ------------------------------------------------------------------ */}
      <Sheet
        footer={<Button label="Record it" loading={busy} onPress={confirmMoveOut} />}
        onClose={() => setPanel(null)}
        open={panel === "moveOut"}
        title="Move-out checklist"
      >
        <View className="gap-3 pb-2">
          {data.data?.moveOut?.pendingFeeAmount ? (
            <View className="gap-1 rounded-xl border border-warning/40 bg-warning-soft p-3">
              <Text variant="label">Still owed</Text>
              <Money owed value={data.data.moveOut.pendingFeeAmount} />
              <Text variant="caption">
                Worked out from their invoices, not typed in — settle or write it off
                before refunding the deposit.
              </Text>
            </View>
          ) : null}

          <Select
            label="Deposit"
            onChange={(depositRefundDecision) =>
              setForm((prev) => ({ ...prev, depositRefundDecision }))
            }
            options={REFUND_OPTIONS}
            value={form.depositRefundDecision ?? null}
          />

          <Input
            keyboardType="number-pad"
            label="Refunding (NPR)"
            onChangeText={(depositRefundAmount) =>
              setForm((prev) => ({ ...prev, depositRefundAmount }))
            }
            value={form.depositRefundAmount ?? ""}
          />

          <Input
            label="Damages"
            multiline
            onChangeText={(damageNotes) => setForm((prev) => ({ ...prev, damageNotes }))}
            placeholder="What was broken, and what it cost"
            style={{ height: 72 }}
            value={form.damageNotes ?? ""}
          />

          <Input
            label="Items returned"
            multiline
            onChangeText={(itemReturnNotes) =>
              setForm((prev) => ({ ...prev, itemReturnNotes }))
            }
            placeholder="Keys, mattress, cupboard key"
            style={{ height: 72 }}
            value={form.itemReturnNotes ?? ""}
          />

          <View className="flex-row items-center justify-between gap-3 border-t border-border pt-3">
            <View className="flex-1">
              <Text variant="label">Also mark them moved out</Text>
              <Text variant="caption">
                This is what actually frees the bed. The checklist alone does not.
              </Text>
            </View>
            <Toggle
              accessibilityLabel="Also set the resident to moved out"
              onChange={(alsoMoveOut) => setFlags((prev) => ({ ...prev, alsoMoveOut }))}
              value={flags.alsoMoveOut ?? false}
            />
          </View>
        </View>
      </Sheet>

      {/* ------------------------------------------------------------------ */}
      <Sheet
        footer={
          <Button
            label="Add guardian"
            loading={busy}
            onPress={() =>
              void run(
                () =>
                  addResidentGuardian(id, {
                    firstName: form.firstName?.trim() ?? "",
                    isPrimary: flags.isPrimary ?? false,
                    lastName: form.lastName?.trim() ?? "",
                    phone: form.phone?.trim() ?? "",
                    relation: form.relation?.trim() ?? "",
                  }),
                "Guardian added",
              )
            }
          />
        }
        onClose={() => setPanel(null)}
        open={panel === "guardian"}
        title="Add a guardian"
      >
        <View className="gap-3 pb-2">
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Input
                autoCapitalize="words"
                label="First name"
                onChangeText={(firstName) => setForm((prev) => ({ ...prev, firstName }))}
                value={form.firstName ?? ""}
              />
            </View>
            <View className="flex-1">
              <Input
                autoCapitalize="words"
                label="Last name"
                onChangeText={(lastName) => setForm((prev) => ({ ...prev, lastName }))}
                value={form.lastName ?? ""}
              />
            </View>
          </View>
          <Input
            keyboardType="phone-pad"
            label="Phone"
            onChangeText={(phone) => setForm((prev) => ({ ...prev, phone }))}
            value={form.phone ?? ""}
          />
          <Input
            label="Relation"
            onChangeText={(relation) => setForm((prev) => ({ ...prev, relation }))}
            placeholder="Father, mother, uncle"
            value={form.relation ?? ""}
          />
          <View className="flex-row items-center justify-between gap-3">
            <Text className="flex-1" variant="label">
              Primary guardian
            </Text>
            <Toggle
              accessibilityLabel="Primary guardian"
              onChange={(isPrimary) => setFlags((prev) => ({ ...prev, isPrimary }))}
              value={flags.isPrimary ?? false}
            />
          </View>
        </View>
      </Sheet>

      {/* ------------------------------------------------------------------ */}
      <Sheet
        footer={
          <Button
            label="Add contact"
            loading={busy}
            onPress={() =>
              void run(
                () =>
                  addEmergencyContact(id, {
                    isPrimary: flags.isPrimary ?? false,
                    name: form.name?.trim() ?? "",
                    phone: form.phone?.trim() ?? "",
                    relation: form.relation?.trim() ?? "",
                  }),
                "Contact added",
              )
            }
          />
        }
        onClose={() => setPanel(null)}
        open={panel === "contact"}
        title="Add an emergency contact"
      >
        <View className="gap-3 pb-2">
          <Input
            autoCapitalize="words"
            label="Name"
            onChangeText={(name) => setForm((prev) => ({ ...prev, name }))}
            value={form.name ?? ""}
          />
          <Input
            keyboardType="phone-pad"
            label="Phone"
            onChangeText={(phone) => setForm((prev) => ({ ...prev, phone }))}
            value={form.phone ?? ""}
          />
          <Input
            label="Relation"
            onChangeText={(relation) => setForm((prev) => ({ ...prev, relation }))}
            value={form.relation ?? ""}
          />
          <View className="flex-row items-center justify-between gap-3">
            <Text className="flex-1" variant="label">
              Call first
            </Text>
            <Toggle
              accessibilityLabel="Call this contact first"
              onChange={(isPrimary) => setFlags((prev) => ({ ...prev, isPrimary }))}
              value={flags.isPrimary ?? false}
            />
          </View>
        </View>
      </Sheet>
    </Screen>
  );
}
