import { Ionicons } from "@expo/vector-icons";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ListRow } from "@/components/ui/list-row";
import { Money } from "@/components/ui/money";
import { Screen } from "@/components/ui/screen";
import { Sheet } from "@/components/ui/sheet";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import {
  acknowledgeSos,
  type AdminAlerts,
  approveClaim,
  getAdminAlerts,
  rejectClaim,
  replyToComplaint,
} from "@/lib/admin-api";
import { type AlertKind, type AlertRow, buildAlertFeed } from "@/lib/admin-alerts";
import { readApiError } from "@/lib/api-contract";
import { formatMoney, formatRelativeDay } from "@/lib/format";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * The inbox: everything that arrived without being asked for, ranked by what
 * happens if it is ignored.
 *
 * ## Three actions, and no fourth
 *
 * Approve or reject a payment claim, reply to a complaint, acknowledge an SOS.
 * Those are the decisions that are worse for waiting and that a person can make
 * from a phone with the facts already on screen. Resolving an SOS, changing a
 * complaint's status, converting an inquiry — each needs context this screen
 * does not have, so each opens the web portal from the More tab instead of
 * getting a half-informed button here.
 *
 * ## A denied source is named, not silently empty
 *
 * A warden's capabilities are per-flag: they may hold `viewComplaints` and not
 * `viewPayments`, in which case the claims queue 403s while everything else
 * returns. `getAdminAlerts` collects those refusals rather than swallowing
 * them — an empty inbox that is really a permissions boundary is exactly the
 * lie the guardian screens exist to avoid.
 */
const ICONS: Record<AlertKind, keyof typeof Ionicons.glyphMap> = {
  claim: "card-outline",
  complaint: "chatbox-ellipses-outline",
  inquiry: "mail-outline",
  sos: "alert-circle",
};

const TONES: Record<AlertKind, "danger" | "info" | "neutral" | "warning"> = {
  claim: "warning",
  complaint: "warning",
  inquiry: "info",
  sos: "danger",
};

const LABELS: Record<AlertKind, string> = {
  claim: "Payment claim",
  complaint: "Overdue complaint",
  inquiry: "Inquiry",
  sos: "SOS",
};

export default function AdminAlertsScreen() {
  const { colors } = useAppTheme();
  const alerts = useResource<AdminAlerts>(useCallback(() => getAdminAlerts(), []), {
    topics: [
      REALTIME_TOPIC.PAYMENTS,
      REALTIME_TOPIC.COMPLAINTS,
      REALTIME_TOPIC.INQUIRIES,
      REALTIME_TOPIC.SAFETY,
    ],
  });

  /** The row whose sheet is open, plus which decision it is collecting text for. */
  const [pending, setPending] = useState<{ mode: "reject" | "reply"; row: AlertRow } | null>(
    null,
  );
  const [note, setNote] = useState("");
  /** The id currently in flight — disables just that row, not the whole list. */
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = useCallback(
    async (id: string, action: () => Promise<void>, success: string) => {
      setBusyId(id);

      try {
        await action();
        toastSuccess(success);
        // The row is gone from the server's queue now; refetch rather than
        // splicing it out locally, because approving a claim also moves the
        // invoice and the dashboard's counters.
        alerts.refresh();
      } catch (caught) {
        toastError("That didn't go through", readApiError(caught));
      } finally {
        setBusyId(null);
      }
    },
    [alerts],
  );

  const submitNote = useCallback(async () => {
    if (!pending) {
      return;
    }

    const { mode, row } = pending;
    const text = note.trim();

    // The server's own bounds: a rejection reason is 3–500 characters and a
    // complaint reply 2–2000. Checked here so the sheet does not close on a
    // round trip that was always going to 422.
    if (mode === "reject" ? text.length < 3 : text.length < 2) {
      toastError(
        mode === "reject" ? "Give a reason" : "Write a reply",
        mode === "reject"
          ? "The resident is shown this, so it has to say something."
          : "The resident is shown this.",
      );
      return;
    }

    setPending(null);
    setNote("");

    await run(
      row.id,
      () =>
        mode === "reject" ? rejectClaim(row.id, text) : replyToComplaint(row.id, text),
      mode === "reject" ? "Claim rejected" : "Reply sent",
    );
  }, [note, pending, run]);

  const header = <AppBar title="Alerts" />;

  if (alerts.loading) {
    return (
      <Screen header={header} insideTabs>
        <LoadingState label="Checking what needs you" />
      </Screen>
    );
  }

  if (alerts.error || !alerts.data) {
    return (
      <Screen header={header} insideTabs>
        <ErrorState
          message={alerts.error ?? "Your alerts could not be loaded."}
          onRetry={alerts.reload}
        />
      </Screen>
    );
  }

  const rows = buildAlertFeed(alerts.data);
  const claimById = new Map(alerts.data.claims.map((claim) => [claim.eventId, claim]));

  return (
    <>
      <Screen
        header={header}
        insideTabs
        onRefresh={alerts.refresh}
        refreshing={alerts.refreshing}
        scroll
      >
        <View className="gap-4 pt-1">
          {alerts.data.denied.length > 0 ? (
            <Card className="gap-1">
              <Text variant="label">Some of this inbox is not yours to see</Text>
              <Text variant="muted">
                {`Your account does not have permission for ${alerts.data.denied.join(
                  ", ",
                )}. Ask your hostel admin if that looks wrong.`}
              </Text>
            </Card>
          ) : null}

          {rows.length === 0 ? (
            <Card>
              <EmptyState
                description="No SOS alerts, payment claims, overdue complaints or new inquiries."
                title="Nothing needs you"
              />
            </Card>
          ) : (
            <View>
              <SectionHeader
                subtitle="Most urgent first, then longest waiting"
                title={`${rows.length} waiting`}
              />

              <View className="gap-3">
                {rows.map((row) => {
                  const claim = row.kind === "claim" ? claimById.get(row.id) : undefined;
                  const busy = busyId === row.id;

                  return (
                    <Card className="gap-3" key={`${row.kind}-${row.id}`}>
                      <ListRow
                        icon={ICONS[row.kind]}
                        right={<Badge label={LABELS[row.kind]} tone={TONES[row.kind]} />}
                        subtitle={row.subtitle}
                        title={row.title}
                      />

                      <View className="flex-row items-center justify-between gap-2 border-t border-border pt-3">
                        <Text variant="caption">
                          {row.at ? formatRelativeDay(row.at) : "Undated"}
                        </Text>

                        {claim ? (
                          <View className="flex-row items-center gap-2">
                            <Money value={claim.amount} />
                            {/*
                              `allGreen` is the server's own verdict across every
                              claim check — the same rule the web's "Approve all"
                              gate applies. Surfacing it means an admin
                              approving from a phone is not approving blind.
                            */}
                            <Badge
                              label={claim.allGreen ? "Checks pass" : "Needs a look"}
                              tone={claim.allGreen ? "success" : "warning"}
                            />
                          </View>
                        ) : null}
                      </View>

                      {row.kind === "sos" ? (
                        <Button
                          label="Acknowledge"
                          loading={busy}
                          onPress={() =>
                            void run(row.id, () => acknowledgeSos(row.id), "Acknowledged")
                          }
                        />
                      ) : null}

                      {row.kind === "claim" ? (
                        <View className="flex-row gap-2">
                          <Button
                            className="flex-1"
                            label="Approve"
                            loading={busy}
                            onPress={() =>
                              void run(
                                row.id,
                                () => approveClaim(row.id),
                                `Verified ${formatMoney(claim?.amount)}`,
                              )
                            }
                          />
                          <Button
                            className="flex-1"
                            disabled={busy}
                            label="Reject"
                            onPress={() => {
                              setNote("");
                              setPending({ mode: "reject", row });
                            }}
                            variant="outline"
                          />
                        </View>
                      ) : null}

                      {row.kind === "complaint" ? (
                        <Button
                          disabled={busy}
                          label="Reply"
                          onPress={() => {
                            setNote("");
                            setPending({ mode: "reply", row });
                          }}
                          variant="outline"
                        />
                      ) : null}

                      {row.kind === "inquiry" ? (
                        <View className="flex-row items-center gap-2">
                          <Ionicons
                            color={colors.mutedForeground}
                            name="information-circle-outline"
                            size={16}
                          />
                          <Text className="flex-1" variant="caption">
                            Follow up from the web portal — status, notes and the
                            follow-up date live there.
                          </Text>
                        </View>
                      ) : null}
                    </Card>
                  );
                })}
              </View>
            </View>
          )}
        </View>
      </Screen>

      <Sheet
        footer={
          <Button
            label={pending?.mode === "reject" ? "Reject claim" : "Send reply"}
            onPress={() => void submitNote()}
          />
        }
        onClose={() => setPending(null)}
        open={Boolean(pending)}
        title={pending?.mode === "reject" ? "Why are you rejecting this?" : "Reply"}
      >
        <View className="gap-3 px-5 py-4">
          <Text variant="muted">
            {pending?.mode === "reject"
              ? "The resident is shown this reason, so it should tell them what to do next."
              : "The resident is shown this reply on their complaint."}
          </Text>
          <Input
            autoFocus
            maxLength={pending?.mode === "reject" ? 500 : 2000}
            multiline
            numberOfLines={4}
            onChangeText={setNote}
            placeholder={
              pending?.mode === "reject"
                ? "e.g. The screenshot shows a different amount"
                : "e.g. A plumber is coming tomorrow morning"
            }
            value={note}
          />
        </View>
      </Sheet>
    </>
  );
}
