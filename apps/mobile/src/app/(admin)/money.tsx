import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Linking, View } from "react-native";

import { AlertCard, DeniedNotice, useAdminAlerts, useAlertActions } from "@/components/admin-alerts";
import { EarningsTrend } from "@/components/admin-home";
import { AdminMoneyCard } from "@/components/admin-money-card";
import { NotificationBell } from "@/components/notification-bell";
import { AppBar } from "@/components/ui/app-bar";
import { StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Chip } from "@/components/ui/layout";
import { Avatar } from "@/components/ui/avatar";
import { CardRow, ListRow } from "@/components/ui/list-row";
import { Money as Amount } from "@/components/ui/money";
import { Screen } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { SkeletonCard, SkeletonRows } from "@/components/ui/skeleton";
import { EmptyCard, ErrorState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useResource } from "@/hooks/use-resource";
import {
  type AdminHostel,
  type AdminInvoiceMatrix,
  type AdminInvoiceRow,
  type AdminPeriodSummary,
  getAdminHostel,
  getAdminInvoices,
  getAdminPeriodSummary,
} from "@/lib/admin-api";
import { buildAlertFeed } from "@/lib/admin-alerts";
import { earningsTrend } from "@/lib/admin-home";
import { recordCashPayment, voidInvoice } from "@/lib/admin-manage-api";
import { amountOwed, type InvoiceSegment, invoiceSegment } from "@/lib/admin-money";
import { readApiError } from "@/lib/api-contract";
import { formatMoney, humanizeEnum } from "@/lib/format";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * Money — a statement, and shaped like one.
 *
 * ## What this screen is, as distinct from the others
 *
 * Every admin tab briefly opened with the same painted band under the same
 * painted bar, and five screens whose top two hundred points are identical is
 * not a design system — it is a failure to say where you are. Each tab now has
 * its own *shape*, sharing only the tokens:
 *
 * - **Home** is a full-bleed hero with the building behind it. It is the front
 *   door, so it says which app and which hostel.
 * - **Money is a card on a page.** A statement is an object you hold, so the
 *   colour is inset on all four sides with a shadow under it, and the bar above
 *   it is ordinary page chrome.
 * - **Residents** leads with search, because a directory is something you look
 *   *into*.
 * - **Alerts** leads with its filter tabs, because an inbox is something you
 *   triage.
 * - **Today** leads with the date and the roll call's progress.
 * - **More** leads with who you are signed in as, and is deliberately calm.
 *
 * ## The segmented control is the mockup's own idea
 *
 * `04_hostel_admin/02_payments_management.png` puts Paid / Unpaid / Partial /
 * Overdue across the top of its table, and it is the right control here for the
 * reason Material 3 gives: a small set of mutually exclusive views of one list,
 * switching instantly. Filter chips would say the wrong thing — that two could
 * be on at once — and this list has no meaningful intersection to offer.
 *
 * Defaulting to **Owing** rather than to everything: a screen that opens on the
 * people who have already paid has forgotten what it is for. `Paid` exists so
 * somebody can answer "did so-and-so pay" without a laptop, which is the only
 * reason a settled row is worth rendering at all.
 *
 * ## Order: what needs a decision, then what is owed
 *
 * The verify queue is above the list even when it is empty. A payment claim is a
 * resident's money in limbo and their invoice still reads unpaid to them, which
 * makes it the only thing here with a clock on it.
 *
 * ## Why the list is not the web's matrix
 *
 * The portal's table is one row per resident with seven columns and a month
 * picker. What survives the trip to a phone is "who has not paid", sorted by
 * what is owed, with the phone number one tap away. Issuing, editing, voiding,
 * the fee schedule and the billing run are keyboard jobs and stay in the
 * browser, one section down.
 */
type MoneyData = {
  hostel: AdminHostel | null;
  invoices: AdminInvoiceMatrix;
  /** Null when the caller's role has no `viewPayments` grant — see below. */
  periods: AdminPeriodSummary | null;
};

async function loadMoney(): Promise<MoneyData> {
  const [invoices, hostel, periods] = await Promise.all([
    getAdminInvoices(),
    // A warden scoped to several hostels cannot resolve one profile, and the
    // portal link is the only thing that needs it. The figures are unaffected.
    getAdminHostel().catch(() => null),
    /*
     * The monthly roll-up the trend chart plots. Tolerant because `viewPayments`
     * is a per-warden grant and this is the one read here a legitimate user can
     * be refused — the chart is absent in that case rather than empty.
     */
    getAdminPeriodSummary().catch(() => null),
  ]);

  return { hostel, invoices, periods };
}

export default function AdminMoneyScreen() {
  const money = useResource<MoneyData>(useCallback(() => loadMoney(), []), {
    topics: [REALTIME_TOPIC.PAYMENTS, REALTIME_TOPIC.RESIDENTS],
  });
  const alerts = useAdminAlerts();
  const actions = useAlertActions();

  const trend = useMemo(
    () => earningsTrend(money.data?.periods?.months ?? []),
    [money.data],
  );

  const [segment, setSegment] = useState<InvoiceSegment>("owing");
  const [showAll, setShowAll] = useState(false);

  /*
   * `buildAlertFeed` with one source populated: it is the module that owns the
   * row shape and the oldest-first ordering, and duplicating that mapping here
   * would be a second place for the claim subtitle to drift from the one on the
   * combined queue.
   */
  const claimRows = useMemo(
    () =>
      buildAlertFeed({
        claims: alerts.data?.claims ?? [],
        complaints: [],
        inquiries: [],
        sos: [],
      }),
    [alerts.data],
  );
  const claimById = useMemo(
    () => new Map((alerts.data?.claims ?? []).map((claim) => [claim.eventId, claim])),
    [alerts.data],
  );

  const rows = useMemo(() => money.data?.invoices.rows ?? [], [money.data]);

  const segments = useMemo(
    () => [
      { count: invoiceSegment(rows, "owing").length, label: "Owing", value: "owing" as const },
      {
        count: invoiceSegment(rows, "overdue").length,
        label: "Overdue",
        value: "overdue" as const,
      },
      {
        count: invoiceSegment(rows, "unbilled").length,
        label: "Unbilled",
        value: "unbilled" as const,
      },
      {
        count: invoiceSegment(rows, "settled").length,
        label: "Paid",
        value: "settled" as const,
      },
    ],
    [rows],
  );

  const listed = useMemo(() => invoiceSegment(rows, segment), [rows, segment]);

  /*
   * The row sheet. Two writes live here — recording cash and voiding — because
   * both are things somebody does *with the resident in front of them*, which
   * is the case the browser hand-off served worst: money changed hands at the
   * desk and the record waited until whenever a laptop was next opened.
   */
  const [open, setOpen] = useState<AdminInvoiceRow | null>(null);
  const [cash, setCash] = useState<Record<string, string>>({});
  const [voidReason, setVoidReason] = useState("");
  const [busy, setBusy] = useState(false);

  const openRow = useCallback((row: AdminInvoiceRow) => {
    setOpen(row);
    setCash({
      amount: row.payment ? String(Math.max(0, row.payment.dueAmount - row.payment.paidAmount)) : "",
      cashReceiptNumber: "",
      collectedBy: "",
      note: "",
    });
    setVoidReason("");
  }, []);

  const takeCash = useCallback(async () => {
    if (!open?.payment) {
      return;
    }

    const amount = Number(cash.amount ?? "");

    if (!Number.isInteger(amount) || amount <= 0) {
      toastError("Check the amount", "Whole rupees, and more than zero.");
      return;
    }

    if (!cash.cashReceiptNumber?.trim()) {
      toastError(
        "Which paper receipt?",
        "It is also the idempotency key, so the same slip cannot be banked twice.",
      );
      return;
    }

    if ((cash.collectedBy?.trim().length ?? 0) < 2) {
      toastError("Who took the money?", "Frequently not the person typing.");
      return;
    }

    setBusy(true);

    try {
      await recordCashPayment(open.payment.id, {
        amount,
        cashReceiptNumber: cash.cashReceiptNumber.trim(),
        collectedBy: cash.collectedBy.trim(),
        note: cash.note?.trim() || undefined,
      });
      toastSuccess("Cash recorded", formatMoney(amount));
      setOpen(null);
      money.reload();
    } catch (error) {
      toastError("Could not record it", readApiError(error));
    } finally {
      setBusy(false);
    }
  }, [cash, money, open]);

  const voidIt = useCallback(async () => {
    if (!open?.payment) {
      return;
    }

    if (voidReason.trim().length < 3) {
      toastError(
        "Say why",
        "The reason is shown to the resident word for word — a reversal they cannot explain is the same problem as one nobody told them about.",
      );
      return;
    }

    setBusy(true);

    try {
      await voidInvoice(open.payment.id, voidReason.trim());
      toastSuccess("Voided", "The resident has been told, with your reason.");
      setOpen(null);
      money.reload();
    } catch (error) {
      toastError("Could not void it", readApiError(error));
    } finally {
      setBusy(false);
    }
  }, [money, open, voidReason]);

  // "Payments", in step with the tab and with the portal — see `_layout.tsx`.
  const header = <AppBar actions={<NotificationBell />} title="Payments" />;

  if (money.loading) {
    return (
      /*
        Skeletons, not a spinner. The shape of this screen is known before the
        data is — a money card, then a list of people — so drawing that shape
        means nothing moves when the figures land. A centred spinner followed by
        a full page appearing is what makes an app feel slower than it is.
      */
      <Screen header={header} insideTabs scroll>
        <View className="gap-6 pt-2">
          <SkeletonCard rows={2} />
          <SkeletonRows rows={6} />
        </View>
      </Screen>
    );
  }

  if (money.error || !money.data) {
    return (
      <Screen header={header} insideTabs>
        <ErrorState
          message={money.error ?? "This month's figures could not be loaded."}
          onRetry={money.reload}
        />
      </Screen>
    );
  }

  const { totals } = money.data.invoices;
  const visible = showAll ? listed : listed.slice(0, 8);

  return (
    <>
      <Screen
        header={header}
        insideTabs
        onRefresh={() => {
          money.refresh();
          alerts.refresh();
        }}
        padded={false}
        refreshing={money.refreshing || alerts.refreshing}
        scroll
      >
        <View className="gap-6 pt-2">
          <AdminMoneyCard
            billed={totals.due}
            collected={totals.collected}
            month={money.data.invoices.month}
            proofs={claimRows.length}
          />

          {/*
            The last few months, under the card for this one — it was on Home,
            above a collection card that repeated the same month's figures, and
            it is the one thing on this screen that answers "is this month
            normal".

            Absent, not empty. Without `viewPayments` there is no monthly roll-up
            to plot, and an empty axis reads as "this hostel has earned nothing"
            — the same mistake as showing 0% occupancy for a hostel that never
            configured its rooms.
          */}
          {trend.length > 0 ? (
            <View className="px-5">
              <Card>
                <EarningsTrend bars={trend} />
              </Card>
            </View>
          ) : null}

          <View className="px-5">
            <SectionHeader
              subtitle="A resident's money is in limbo until one of these is decided"
              title="Claims to verify"
            />

            <DeniedNotice denied={alerts.data?.denied ?? []} />

            {claimRows.length === 0 ? (
              <EmptyCard
                description="Every payment a resident has claimed has been checked."
                title="Nothing to verify"
              />
            ) : (
              <View className="gap-3">
                {claimRows.map((row) => (
                  <AlertCard
                    actions={actions}
                    claim={claimById.get(row.id)}
                    key={row.id}
                    row={row}
                  />
                ))}
              </View>
            )}
          </View>

          <View className="gap-3">
            <View className="px-5">
              <Segmented
                onChange={(next) => {
                  setSegment(next);
                  /*
                   * "Show all" belongs to the list that was open, not to the
                   * screen: carrying it across means switching from a 40-row
                   * segment to a 3-row one and back leaves the first silently
                   * expanded, with no control on screen saying so.
                   */
                  setShowAll(false);
                }}
                options={segments}
                value={segment}
              />
            </View>

            <View className="px-5">
              {listed.length === 0 ? (
                <EmptyCard
                  description={
                    segment === "settled"
                      ? "Nobody has settled this month yet."
                      : "Nothing in this list — try another tab above."
                  }
                  title="Nothing here"
                />
              ) : (
                /*
                  Separate cards, each with the resident's own initial circle.

                  This was one bordered card of hairline-separated rows, which is
                  the shape for facts that belong together — and a roster of
                  people who each owe their own money is the opposite of that.
                  Every banking app in `ui_inspiration_folder/app_recordings/`
                  draws a transaction list this way, and the reason is legibility
                  under a thumb: the gap between cards is a bigger, more reliable
                  visual break than a hairline, so the eye lands on one person at
                  a time instead of reading a table.
                */
                <View className="gap-3">
                  {visible.map((row) => (
                    <CardRow
                      key={row.resident.id}
                      /*
                       * The face, not a generic person glyph. Almost nobody here
                       * has a photo, so this is the initial circle — coloured
                       * from the name, which is what lets two adjacent rows of a
                       * forty-person roster tell themselves apart before either
                       * is read. Residents already does this; Money was drawing
                       * the same people as forty identical outlines.
                       */
                      left={<Avatar name={row.resident.fullName} size="md" />}
                      /*
                       * Opens the row rather than dialling. Calling used to be
                       * its only action because "editing an invoice, waiving a
                       * fee or recording a cash payment are portal jobs" — they
                       * are not, and taking cash at the desk is the most
                       * phone-shaped act in the whole finance surface. The call
                       * button is inside, next to the two writes and a way into
                       * the resident's record.
                       */
                      onPress={() => openRow(row)}
                      right={
                        /*
                         * `shrink-0` on the amount column. A seven-figure amount
                         * otherwise takes width from the status pill beside it
                         * and pushes it past the screen edge — the failure the
                         * payments-UI literature keeps naming, and the reason
                         * the name to its left is the thing allowed to truncate
                         * instead.
                         */
                        <View className="shrink-0 items-end gap-1">
                          {amountOwed(row) > 0 ? <Amount value={amountOwed(row)} /> : null}

                          {/*
                            Only on the mixed list.

                            `Overdue`, `Unbilled` and `Paid` are each a single
                            `displayStatus` by construction — `invoiceSegment`
                            filters on exactly that field — so a pill in those
                            three repeats the segment the reader is standing in,
                            once per row, for the whole list. `Owing` is the one
                            that mixes (everything not PAID: unpaid, partial,
                            pending proof, overdue, never billed), and it is also
                            the default, so the pill is on screen where it means
                            something and absent where it was only ever
                            furniture.
                          */}
                          {segment === "owing" ? (
                            <StatusPill status={row.displayStatus} />
                          ) : null}
                        </View>
                      }
                      subtitle={[
                        humanizeEnum(row.resident.roomType),
                        row.resident.roomNumber,
                        /*
                         * Says so when there is no number, rather than simply
                         * leaving it out: the sheet this opens leads with a call
                         * button, and a row that cannot be called should say so
                         * before it is tapped.
                         *
                         * Truthiness, not `??`: the server sends `phone` as
                         * optional and an empty string reaches here as often as
                         * an absent key.
                         */
                        row.resident.phone ? row.resident.phone : "No phone on file",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      title={row.resident.fullName || "Unnamed resident"}
                    />
                  ))}

                  {listed.length > visible.length ? (
                    <Card padding="px-4 py-1">
                      <ListRow
                        icon="chevron-down-outline"
                        onPress={() => setShowAll(true)}
                        title={`Show all ${listed.length}`}
                      />
                    </Card>
                  ) : null}
                </View>
              )}
            </View>
          </View>

          <View className="px-5">
            <SectionHeader title="Set it up" />
            <Card className="gap-3">
              <Text variant="muted">
                This screen is the ledger. The rate card these invoices are computed
                from, the monthly billing run, where residents are asked to send money,
                and the statement reconciliation all live one screen along.
              </Text>
              <Button
                label="Open Finance"
                onPress={() => router.push("/manage/finance")}
                variant="secondary"
              />
            </Card>
          </View>
        </View>
      </Screen>

      <Sheet
        onClose={() => setOpen(null)}
        open={open !== null}
        title={open?.resident.fullName || "Resident"}
      >
        {open ? (
          <View className="gap-4 pb-2">
            <View className="gap-2">
              <View className="flex-row items-center justify-between gap-2">
                <View className="flex-1">
                  <Text variant="label">
                    {open.payment
                      ? `${open.payment.month} invoice`
                      : "Not billed this month"}
                  </Text>
                  <Text variant="caption">
                    {[humanizeEnum(open.resident.roomType), open.resident.roomNumber]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
                <StatusPill status={open.displayStatus} />
              </View>

              {open.payment ? (
                <View className="flex-row flex-wrap gap-2">
                  <Chip
                    icon="pricetag-outline"
                    label={`Billed ${formatMoney(open.payment.dueAmount)}`}
                  />
                  <Chip
                    icon="checkmark-circle-outline"
                    label={`Paid ${formatMoney(open.payment.paidAmount)}`}
                  />
                  {amountOwed(open) > 0 ? (
                    <Chip
                      icon="alert-circle-outline"
                      label={`Owing ${formatMoney(amountOwed(open))}`}
                      tone="brand"
                    />
                  ) : null}
                </View>
              ) : null}

              <View className="flex-row flex-wrap gap-2">
                {open.resident.phone ? (
                  <Chip
                    icon="call-outline"
                    label={open.resident.phone}
                    onPress={() => void Linking.openURL(`tel:${open.resident.phone}`)}
                    tone="brand"
                  />
                ) : null}
                <Chip
                  icon="person-outline"
                  label="Open their record"
                  onPress={() => {
                    const residentId = open.resident.id;

                    setOpen(null);
                    router.push(`/manage/resident/${residentId}`);
                  }}
                />
              </View>
            </View>

            {open.payment ? (
              <>
                <View className="gap-3 border-t border-border pt-3">
                  <Text variant="label">Take cash</Text>
                  <Input
                    keyboardType="number-pad"
                    label="Amount (NPR)"
                    onChangeText={(amount) => setCash((prev) => ({ ...prev, amount }))}
                    value={cash.amount ?? ""}
                  />
                  <Input
                    hint="Your own paper receipt. It is also the key that stops the same slip being banked twice."
                    label="Receipt number"
                    onChangeText={(cashReceiptNumber) =>
                      setCash((prev) => ({ ...prev, cashReceiptNumber }))
                    }
                    value={cash.cashReceiptNumber ?? ""}
                  />
                  <Input
                    hint="Who physically took the money — frequently not whoever is typing."
                    label="Collected by"
                    onChangeText={(collectedBy) =>
                      setCash((prev) => ({ ...prev, collectedBy }))
                    }
                    value={cash.collectedBy ?? ""}
                  />
                  <Input
                    label="Note"
                    onChangeText={(note) => setCash((prev) => ({ ...prev, note }))}
                    value={cash.note ?? ""}
                  />
                  <Button
                    label="Record the cash"
                    loading={busy}
                    onPress={() => void takeCash()}
                  />
                </View>

                <View className="gap-3 border-t border-border pt-3">
                  <Text variant="label">Void this invoice</Text>
                  <Input
                    hint="Shown to the resident word for word."
                    label="Reason"
                    multiline
                    onChangeText={setVoidReason}
                    placeholder="Billed in error — they moved out in June"
                    style={{ height: 72 }}
                    value={voidReason}
                  />
                  <Button
                    label="Void it"
                    loading={busy}
                    onPress={() => void voidIt()}
                    variant="danger"
                  />
                </View>
              </>
            ) : (
              <Text variant="muted">
                Nothing has been billed to this person for this month, so there is
                nothing to take cash against. Run billing from the Finance screen.
              </Text>
            )}
          </View>
        ) : null}
      </Sheet>

      {actions.sheet}
    </>
  );
}
